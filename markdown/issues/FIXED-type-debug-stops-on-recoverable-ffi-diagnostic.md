# FIXED: `type-debug` Stops on a Recoverable FFI Diagnostic

Status: fixed

Discovered while investigating a cross-module Three/WebGPU type mismatch in `wmthree`.

## Summary

`wm type-debug` can report failure during initial partial inference for a module that `wm check`
accepts successfully. It treats a delayed FFI diagnostic containing `?ffi#` as fatal, stops before
delayed reflection, and presents the intermediate state as the command's failure result.

This is not a complaint that `type-debug` exposes unresolved intermediate facts. Showing those facts
is useful and intentional. The bug is premature termination: the normal compiler classifies the
same diagnostic as recoverable and continues to phases that resolve it.

## Reproduction

The helper is the same narrow geometry bridge used by `wmthree`:

```ts
// three_helpers.ts
import { BoxGeometry, BufferGeometry } from "three/webgpu";

export function boxGeometry(width: number, height: number, depth: number): BufferGeometry {
  return new BoxGeometry(width, height, depth);
}
```

```wm
-- renderer.wm
from js.module("three/webgpu") import { Mesh };
from js.module("three/webgpu") import type { Material };
from js.module("./three_helpers.ts") import { boxGeometry };

let lift = Monad.lift;

let rec buildMeshes = (material: Material, remaining: Number) => {
  if (remaining <= 0) {
    Ok(void)
  } else {
    let continue = lift Result (mesh) => {
      buildMeshes(material, remaining - 1)
    };
    let create = lift Result (geometry) => {
      Mesh.new(geometry, material) :> continue
    };
    boxGeometry(1, 1, 1) :> create
  }
};
```

Commands:

```txt
wm check renderer.wm
wm type-debug renderer.wm
```

Observed results:

```txt
wm check renderer.wm
ok
```

```txt
wm type-debug renderer.wm
type-debug: failed

phase: initial partial inference

error: recoverable diagnostics were produced before later type phases

cannot pipe unresolved JS FFI result before FFI reflection resolves the member access: ?ffi#0
```

The reported intermediate facts are useful: `Mesh.new` and `boxGeometry` are still represented by
delayed `?ffi` obligations at this stage. They are not, however, a final type-checking failure.

## Resolution

`type-debug` now observes the same shared staged-analysis driver used by normal graph analysis. It
therefore shares:

- local JavaScript-module specifier resolution;
- imported record-field preparation;
- both partial-inference passes;
- both delayed-FFI resolution passes; and
- the recoverable delayed-FFI diagnostic classification.

The prior duplicated predicate has been removed. A `?ffi#` diagnostic remains visible in debug state
when relevant, but it no longer terminates analysis before the later phases that can resolve it.

Regression coverage verifies that `type-debug` completes for a `parseInt` pipeline that produces a
recoverable unresolved FFI placeholder during partial inference. The `wmthree` `play.wm` graph also
now succeeds under both `wm check` and `wm type-debug`.

## Original Immediate Cause

The normal compiler's partial-diagnostic filter treats a diagnostic as delayed/recoverable when its
rendered message contains `?ffi#`:

```ts
// compiler.ts
function isDelayedFfiPartialDiagnostic(message: string): boolean {
  return message.startsWith("cannot solve unresolved JS FFI type ") ||
    message.startsWith("unresolved JS FFI obligation in ") ||
    message.startsWith("unresolved JS FFI type in ") ||
    message.startsWith("unsolved JS boundary type in ") ||
    message.includes("?ffi#");
}
```

`type_debug.ts` maintains a separate copy that omits the final condition:

```ts
function isDelayedFfiPartialDiagnostic(message: string): boolean {
  return message.startsWith("cannot solve unresolved JS FFI type ") ||
    message.startsWith("unresolved JS FFI obligation in ") ||
    message.startsWith("unresolved JS FFI type in ") ||
    message.startsWith("unsolved JS boundary type in ");
}
```

Therefore `cannot pipe ... ?ffi#0` is recoverable in normal compilation but fatal in `type-debug`.

## Original Broader Pipeline Drift

The duplicated diagnostic predicate is not the only divergence. At the time of this report,
`analyzeFile` also performs work that `typeDebugFile` does not mirror:

- resolving local JavaScript-module specifiers before FFI preparation;
- supplying imported record field names during FFI preparation;
- partial inference after the first delayed-FFI resolution;
- a second delayed-FFI resolution pass; and
- final inference over the twice-resolved graph.

`type-debug` currently runs initial partial inference, callback contextualization, contextual partial
inference, one delayed-resolution pass, and final inference. Even after synchronizing the immediate
predicate, future compiler-pipeline changes can cause the two paths to drift again.

## Delivered Behavior

`type-debug` follows the same semantic pipeline and recoverability decisions as normal
compilation. For a file accepted by `wm check`, it does not terminate with `type-debug: failed` on
a recoverable intermediate diagnostic.

Useful intermediate data should remain visible. Suitable output could include phase snapshots such
as:

```txt
initial partial inference:
  recoverable delayed FFI facts: ...

delayed FFI resolution:
  resolved Mesh.new ...

type-debug: ok
```

When the complete graph genuinely fails, `type-debug` should identify the final/root failure and
then include relevant earlier snapshots as supporting compiler state.

## Implemented Direction

`analyzeFile` and `typeDebugFile` now share a staged-analysis driver. The debug path subscribes to
phase results rather than reimplementing:

- graph preparation;
- partial-diagnostic classification;
- contextualization;
- delayed reflection passes; and
- imported-result propagation.

At minimum, the recoverable-diagnostic predicate must be shared rather than copied.

## Candidate Regression Tests

1. A module where `wm check` succeeds after resolving a `cannot pipe ... ?ffi#` diagnostic.
2. `type-debug` on the same module reaches completion instead of reporting failure.
3. The output retains the initial unresolved FFI facts as a recoverable phase snapshot.
4. A genuine unresolved FFI obligation still produces `type-debug: failed`.
5. Imported-record preparation behaves identically in `check` and `type-debug`.
6. Relative local `js.module` specifiers resolve identically in both commands.
7. A case requiring post-resolution inference and the second delayed-resolution pass.
8. A failing multi-module graph reports the actual final collision while retaining dependency-phase
   facts as supporting context.

## Non-Goals

- Hiding unresolved FFI facts from debugging output.
- Treating every partial diagnostic as recoverable.
- Making `type-debug` print only the same authored diagnostic as `wm check`.
- Weakening the rule that genuinely unresolved foreign values cannot escape into HM types.
