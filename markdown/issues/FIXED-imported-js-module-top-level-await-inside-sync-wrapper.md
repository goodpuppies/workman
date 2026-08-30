# Issue: Imported `js.module` Setup Is Emitted Inside a Synchronous Wrapper

Status: fixed

## Resolution

Fixed in the JavaScript emitter. Imported Workman modules are now initialized with an awaited
`async` closure at generated module scope:

```js
const importedModule = await (async () => {
  const __wm_js_module_0 = await import("@dimforge/rapier3d-compat");
  // dependency declarations...
  return exports;
})();
```

The awaited result remains the ordinary dependency namespace object, so consumers do not receive a
promise and dependency initialization remains in the compiler's existing topological order.

Regression coverage compiles and runs an entry module that imports a Workman dependency containing
a `js.module(...)` import. The fix has also been validated in the `wmthree` game project.

Discovered while extracting the Rapier physics runtime from the `wmthree` FPS entry module.

## Summary

A Workman module that contains a reflected `from js.module(...) import ...` declaration works when
it is the program entry module. Importing that Workman module from another Workman entry module can
produce invalid JavaScript: the dependency's generated `await import(...)` setup is placed inside a
non-`async` synchronous wrapper.

`wm check` succeeds, but `wm run` fails while parsing the emitted module:

```txt
error: Uncaught SyntaxError: Unexpected reserved word
const __wm_js_module_0 = await import("@dimforge/rapier3d-compat");
                         ^
```

This prevents safe FFI boundaries from being organized into reusable Workman modules. Large entry
modules must currently inline foreign package imports and every function that depends on their
reflected types.

## Minimal Reproduction

Dependency module:

```wm
-- foreign_runtime.wm
from js.module("node:path") import { basename };

let fileName = (path: String) => {
  basename(path)
};
```

Entry module:

```wm
-- main.wm
from "./foreign_runtime.wm" import { fileName };

let main = () => {
  match(fileName("one/two.txt")) {
    Ok(name) => { print(name) },
    Err(_) => { print("path error") }
  }
};
```

Commands:

```txt
wm check main.wm
wm run main.wm
```

The same `js.module("node:path")` declaration and call work when written directly in `main.wm`.

The original discovery used:

```wm
from js.module("@dimforge/rapier3d-compat") import {
  init,
  World,
  RigidBody,
  Collider,
  KinematicCharacterController
};
```

The imported module exposed an opaque `PhysicsRuntime` record and functions such as
`startPhysics`, `moveRuntimeCharacter`, and `syncRuntimeCharacter`. The complete graph passed
`wm check`; a one-frame `wm run` failed with the syntax error above.

## Observed Emission Shape

The imported Workman dependency is lowered into a synchronous initialization closure resembling:

```js
const importedModule = (() => {
  const __wm_js_module_0 = await import("@dimforge/rapier3d-compat");
  // dependency declarations...
  return exports;
})();
```

`await` is illegal because the containing arrow function is not `async`. Making that closure
`async` mechanically would also change the dependency value into a promise, so consumers and
initialization ordering would need corresponding lowering support.

## Expected Behavior

Reflected JavaScript-module setup required by imported Workman dependencies should execute at valid
module/async scope before synchronous Workman declarations consume the bindings.

Possible valid shapes include:

1. Hoist dependency `await import(...)` setup to the emitted module's top level, then initialize the
   Workman dependency synchronously with the resolved bindings.
2. Make dependency initialization explicitly asynchronous and propagate/await that initialization
   before evaluating consumers.
3. Statically emit ordinary ESM imports when the reflected import shape permits it.

Whichever strategy is chosen should preserve dependency order, deduplicate identical foreign
module imports where appropriate, and keep eager Workman module initialization semantics clear.

## Architectural Impact

This is not limited to cosmetic module organization. In `wmthree`, the issue prevents moving these
mechanisms out of the executable entry module:

- Rapier world and collider construction
- the kinematic character adapter (`moveCharacter`)
- Three/WebGPU renderer construction and mesh realization
- any other reusable engine module whose implementation imports an npm/JSR/Node module

Pure Workman modules and modules using only suitable `js.global` declarations can still be
extracted. The failure specifically blocks Workman dependency modules that require emitted dynamic
module setup.

## Current Workaround

Keep `js.module(...)` declarations and functions whose inferred/reflected foreign types depend on
them in the entry `.wm` module. Extract pure policy, authored content, and device-independent
interfaces into ordinary Workman modules.

For `wmthree`, `moveCharacter` therefore remains physically in `scripts/play.wm` even though its
architectural owner is the engine physics adapter. Moving it into the pure player controller would
also be the wrong abstraction: the player controller emits immutable movement force and semantic
intent, while `moveCharacter` realizes that intent through Rapier.

## Candidate Regression Tests

Add end-to-end compile/run coverage for:

1. An entry module importing one Workman dependency containing a named `js.module` import.
2. The same case with a namespace `js.module` import.
3. A dependency exporting a function whose signature contains reflected foreign types.
4. An opaque Workman record that stores reflected foreign values and is passed back to exported
   dependency functions.
5. Two Workman dependencies importing the same JavaScript module.
6. A nested Workman dependency graph where only the leaf contains `js.module`.
7. Both `wm compile` syntax validation and `wm run` behavior, since `wm check` currently misses the
   invalid emitted placement.

## Non-Goals

- Treating arbitrary foreign values as `Js.Value` to hide type information.
- Requiring applications to hand-write TypeScript wrappers solely to make module initialization
  order valid.
- Moving foreign side effects into pure gameplay controllers.
