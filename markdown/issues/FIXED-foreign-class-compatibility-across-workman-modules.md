# FIXED: Canonical Foreign Class Identity Across Workman Modules

Status: fixed (exact foreign-class identity)

Discovered while extracting Three/WebGPU scene realization from `wmthree/scripts/play.wm`.

## Summary

A Workman module can successfully type-check an exported recursive function that combines a
reflected TypeScript helper result, `Mesh.new`, and a lifted `Result` pipeline. Importing and calling
that function from another Workman module fails when the caller supplies a reflected foreign class
instance.

The concrete observed collision is:

```txt
module:...MeshStandardMaterial:value.new:return:0
module-type:three/webgpu.Material
```

`MeshStandardMaterial` extends Three's `Material`, and the reflected constructor result was treated
as a distinct nominal type rather than as the same `MeshStandardMaterial` imported elsewhere.

This supersedes the earlier report claiming that reflected helper results could not flow through
exported recursive functions. That diagnosis was incorrect: the renderer module checks by itself.
The identity failure appeared only when a foreign value crossed the Workman module-call boundary.

## Resolution

Module constructor refs now retain the canonical nominal type ref for their instance. In particular,
the result of:

```wm
from js.module("three/webgpu") import { MeshStandardMaterial };
```

is keyed as the same foreign type as an explicit:

```wm
from js.module("three/webgpu") import type { MeshStandardMaterial };
```

in another Workman module. Exact foreign classes can therefore be passed across Workman module
boundaries without losing identity.

Regression coverage includes a local JavaScript module class constructed in one Workman module and
accepted by a parameter annotated with that same class in another.

## Original Reproduction: Requires a Bridge

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

```wm
-- main.wm
from js.module("three/webgpu") import { MeshStandardMaterial };
from "./renderer.wm" import { buildMeshes };

let main = () => {
  MeshStandardMaterial.new(JSON{ color: 16777215 })
    :> Result.andThen((material) => { buildMeshes(material, 1) })
    :> Result.map((_) => { print("ok") })
};
```

The helper has a concrete nominal return:

```ts
import { BoxGeometry, BufferGeometry } from "three/webgpu";

export function boxGeometry(width: number, height: number, depth: number): BufferGeometry {
  return new BoxGeometry(width, height, depth);
}
```

Commands and results:

```txt
wm check renderer.wm  # ok
wm check main.wm      # type mismatch: MeshStandardMaterial -> Material is intentionally unsupported
```

Use the TypeScript bridge shown below when retaining this base-class parameter is necessary. To use
the fixed exact-class path directly, annotate `buildMeshes` with `MeshStandardMaterial` instead of
`Material`; that concrete class now keeps its identity across the Workman import boundary.

## Original Diagnostic Detail

Before the `type-debug` fix, running `wm type-debug main.wm` stopped during partial inference of
`renderer.wm` and reported an unresolved-FFI pipeline error around `Mesh.new`. That secondary
diagnostic was misleading: the same renderer module checks successfully in isolation. The normal
graph failure was caused by the foreign nominal value supplied at the imported call site.

`type-debug` now completes its shared analysis pipeline and reports the final/root failure instead.

## Exact-Class Control (Fixed)

Changing the renderer parameter from base `Material` to concrete `MeshStandardMaterial` formerly
produced a graph-level mismatch in the tested project, even though both modules referred to
`three/webgpu.MeshStandardMaterial`.

This distinguished two concerns:

1. canonical foreign nominal identity across separately elaborated Workman modules; and
2. foreign class inheritance/subtyping (`MeshStandardMaterial` satisfying `Material`).

The first is fixed. The second is intentionally not implemented.

## Supported Behavior

Reflected foreign values preserve canonical source identity across Workman modules. Referring to
the same concrete foreign class produces compatible types:

```txt
MeshStandardMaterial = MeshStandardMaterial
```

Workman does not model TypeScript class inheritance, so this remains unsupported:

```txt
MeshStandardMaterial -> Material
```

This is an intentional 80/20 boundary: foreign types remain nominal HM types, rather than growing a
foreign-only subtyping system or reproducing TypeScript's class relation machinery.

## Manual Workaround for Derived Foreign Classes

Keep the Workman boundary concrete, and move the inheritance-dependent operation into a small
TypeScript bridge. For example:

```ts
// three_bridge.ts
import { Mesh, MeshStandardMaterial } from "three/webgpu";

export function buildStandardMesh(material: MeshStandardMaterial): Mesh {
  // TypeScript checks MeshStandardMaterial -> Material here.
  return new Mesh(undefined, material);
}
```

```wm
-- renderer.wm
from js.module("three/webgpu") import type { MeshStandardMaterial };
from js.module("./three_bridge.ts") import { buildStandardMesh };

let build = (material: MeshStandardMaterial) => { buildStandardMesh(material) };
```

```wm
-- main.wm
from js.module("three/webgpu") import { MeshStandardMaterial };
from "./renderer.wm" import { build };

let mesh = MeshStandardMaterial.new(JSON{ color: 16777215 }) :> Result.andThen(build);
```

The bridge is the explicit boundary for the advanced relation. It can also hide a larger related
Three operation when several derived material types must be accepted.

## Architectural Impact

Opaque foreign runtimes work when all foreign handles remain inside their defining engine module,
as demonstrated by `wmthree`'s extracted Rapier `PhysicsRuntime`. Renderer APIs often need to pass
related Three classes between construction helpers and scene-realization functions, however.

Before the exact-class fix, the renderer had to:

- keep all Three construction and realization in one Workman module;
- erase values to broad JS types and lose safety; or
- introduce unnecessary TypeScript bridges.

`wmthree` can now extract helpers that share exact Three class types. Inheritance-heavy APIs should
continue to use a small TypeScript bridge or stay within one Workman module.

## Candidate Regression Tests

1. The same concrete foreign class imported independently by two Workman modules.
2. A module constructor result passed to a parameter annotated with that same class in another
   Workman module.
3. A TypeScript bridge accepting a derived class and using it where TypeScript requires its base
   class.
4. Unrelated foreign classes remain nominally incompatible.

## Non-Goals

- Adding class inheritance or subtyping to Workman foreign types.
- Adding structural subtyping to ordinary Workman records or datatypes.
- Treating every foreign object as `Js.Object` or `Js.Value`.
- Allowing unrelated JavaScript classes to unify because their fields happen to overlap.
- Using annotations as unchecked foreign casts.
