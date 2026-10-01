# Issue: Fully Typed `unsafe` Imports Take the Delayed FFI Path

Status: partly fixed (2026-10-01)

## Progress

Fix 1 below landed for correctness, not speed. A binding whose body calls a JS import was never
generalized, so library code over primitives couldn't be polymorphic (`Task.map`, and
`Word8Vector.unfoldN` had silently become monomorphic). Authored `unsafe` imports with a manual
type, no clause alias and no `Js.Value`/`Js.Object` in the type are now ordinary typed bindings
(`isDeclaredUnsafeImportSpec` in `src/ffi/imports.ts`): no FFI binding, no `?ffi` obligation, and
calls to them don't block generalization.

The cost described below remains. `analyzeModuleGraph` still stages the whole graph when any module
has source JS imports (`requiresFfiStaging` counts `sourceJsImports`), even if every spec is now
declared. Counting only imports with a non-declared spec would give the library one inference pass.

Discovered while piloting `basis/word8_vector.wm` (basis update stage C3) on 2026-10-01.

## Summary

A manual `unsafe` import states its complete type, so nothing about it depends on the call site:

```wm
from js.module("./js/word8_vector.js") import unsafe {
  sub as primSub: (Word8Vector.Vector, Number) -> Word8.Word,
};
```

Calls to it still become delayed FFI obligations (`?ffi#0:sub`), resolved by the staged pipeline.
Deferral exists for reflected imports, where the selected overload and the result type depend on
the arguments. For a manual import with one declared type it does no work, but it costs a whole
inference pass.

## Cost

`analyzeModuleGraph` decides staging for the whole graph (`requiresFfiStaging`). If any module has
an FFI binding, every module gets an initial partial-inference pass and a final pass, instead of the
one pass a graph without FFI gets.

Since `Word8Vector` moved into `basis/`, the library is such a graph. Its 8 `std/` modules have no
FFI, but they are inferred twice as well:

| Library inference | First run in process | Warm |
|---|---|---|
| One pass (std modules, old path) | ~67 ms | ~30 ms |
| Staged pipeline (now) | ~100 ms | ~60 ms |

Cold start of `wm run` on a small `List.map` program went from about 590 ms to about 625 ms. There
is no TypeScript reflection involved: the library makes no reflection requests, and compiling a
manual import doesn't read the JS file. User programs that use manual `unsafe` imports pay the same
cost for their own graph.

Every layer-1 structure that migrates in stage C4 uses manual `unsafe` imports, so this stays on
every process's startup path until it is fixed.

## Minimal reproduction

```wm
from js.module("./w.js") import type { Vec };
from js.module("./w.js") import unsafe { make: Number -> Vec, size: Vec -> Number };
let main = () => { print(size(make(3))) };
```

Passing `onTiming` to `analyzeModuleGraph` shows both the "initial partial inference" and the "final
inference" phases running for this module.

## Expected behavior

A manual `unsafe` import with a single declared type is an ordinary typed binding. Its calls are
inferred like calls to a `let`-bound function, it creates no delayed obligation, and a graph whose
only FFI is such imports needs one inference pass.

## Possible fixes

1. **Bind manual `unsafe` imports as typed values** in `prepareFfiElaboration`, skipping call
   rewriting into `FfiCall`. This removes the cause for both the library and user code. Check what
   else the rewriting provides for manual imports: callback adaptation, receiver forms and spread
   arguments in emission.
2. **Stage per module**: run the partial passes only for modules with delayed FFI and the modules
   that import them. This keeps the cost off FFI-free modules but leaves manual imports deferred.

Fix 1 is preferred.

## Related

- Library parsing, not inference, is the larger part of library load time: about 320 of 445 ms,
  unchanged from before stage C. See `../cold-start-performance.md`.
- `../basis-update/plan.md`, C3.
