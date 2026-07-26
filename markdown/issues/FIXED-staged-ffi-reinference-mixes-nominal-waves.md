# Issue: Staged FFI Reinference Mixed Monotypes from Different Nominal Waves

Status: fixed

Discovered while extracting the generic terminal runtime used by the Workman AT Protocol client.

## Summary

A module exporting a deliberately monomorphic, FFI-touching callback runner could type-check by
itself, but fail when a downstream module passed a consumer-local nominal state through it and an
unrelated dependency triggered delayed FFI reinference.

The observed application diagnostic was effectively:

```txt
FeedState != FeedState
```

Both printed names referred to the same source declaration. Internally, however, one side belonged
to an earlier inference wave and the other to a later wave.

## Minimal Reproduction

FFI-touching generic runtime:

```wm
-- runtime.wm
from js.global("console") import unsafe {
  log: (String) => Void
} as Console;

type Step<State> = | Continue<State>;

let run = (initial, update) => {
  let _ = Console.log("start");
  update(initial)
};
```

Unrelated module that requires delayed receiver reflection:

```wm
-- trigger.wm
let clean = (text, needle: String) => {
  text :> .replaceAll(needle, "") :> Result.withDefault(text)
};
```

Consumer-local nominal state:

```wm
-- main.wm
from "./runtime.wm" import * as Runtime;
from "./trigger.wm" import * as Trigger;

type State = | State<Number>;

let label = Trigger.clean("hello", "h");
let result = Runtime.run(
  State(0),
  (state: State) => { Runtime.Continue(state) },
);
```

The runtime export crosses the JavaScript FFI and therefore remains monomorphic while downstream
constraints settle. The unrelated string member access causes staged contextualization and delayed
FFI resolution.

## Cause

Imported monomorphic schemes are intentionally shared across a module graph. This is required so a
downstream consumer can constrain an unresolved FFI binding rather than having that binding
unsafely generalized.

The staged analysis formerly reinferred only:

- the module whose AST had been contextualized or whose delayed FFI obligation had resolved; and
- modules downstream from that module.

Other dependency results were reused from the preceding inference wave. The reused runtime export
therefore retained a monomorphic type variable already constrained to the preceding wave's nominal
`State`, while the reinferred consumer created a fresh nominal identity for the same declaration.
Combining the two results produced the self-looking nominal collision.

This was not evidence that FFI bindings should become generic, nor that nominal types should unify
by printed name. Both changes would be unsound.

## Resolution

When contextualization or delayed FFI resolution requires any reinference, staged analysis now
rebuilds the module graph as one coherent dependency-ordered wave.

The relevant rule is:

```txt
if one module must be reinferred,
rebuild every imported monomorphic scheme and consumer nominal in the same wave
```

This preserves:

- identity-stable `?ffi` obligations;
- monomorphic FFI-crossing bindings;
- nominal type identity;
- downstream constraint flow.

It removes only the invalid mixture of inference results from different waves.

## Regression Coverage

`tests/compiler_module_test.ts` contains:

```txt
staged FFI reinference rebuilds shared monotypes with consumer nominals
```

The regression uses the three-module reproduction above: a generic FFI runtime, an unrelated
delayed-reflection trigger, and a consumer-local nominal state.

## Workaround Before the Fix

Keeping the callback runner and its nominal application state in one module avoided crossing the
incoherent result boundary. That workaround was undesirable for reusable runtimes and made normal
Workman module extraction appear unsafe.

## Non-Goals

- Generalizing unresolved FFI bindings.
- Treating annotations as foreign-runtime casts.
- Unifying nominal types by declaration name or printed representation.
- Cloning imported monomorphic schemes independently per consumer.
- Removing staged FFI inference.
