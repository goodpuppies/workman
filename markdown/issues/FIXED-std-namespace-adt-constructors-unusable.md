# Issue: Constructors of Standard-Library Namespace ADTs Are Unusable From Source

Status: fixed

## Resolution

Fixed on 2026-09-28 by stage B of [`../basis-update/plan.md`](../basis-update/plan.md).

- **Patterns** (`missing constructor ID for PCtor`): the program's user analysis resolved nominal
  facts without the std modules, so a reference to a std constructor had no constructor id, and the
  later std merge only patched some fact shapes. Code generation now analyzes program and library
  modules as one graph (`withStandardLibrary`), so std constructors resolve like constructors of an
  imported user module.
- **Expressions** (`Binary.Bounds_ctor_0 is not a function`): the emitter named a qualified
  constructor reference as if it were a local constructor. A qualified constructor with no local
  binding is now emitted through its namespace export (`Binary.Bounds`), like a qualified value.

Regression tests: `tests/library_discovery_test.ts`, "qualified std datatype constructors work in
patterns" and "… in expressions".

Discovered while writing the wmthree low-level Basis capability test and the NTO parser fixtures
on 2026-09-23.

## Summary

`std/binary.wm` is the first auto-imported standard module that exports its own datatype
(`Binary.Error = Bounds<Number, Number, Number> | UnterminatedAscii<Number>`). Values of that type
flow correctly through `Result`, but user code cannot name its constructors:

- a qualified constructor **pattern** crashes the compiler with an internal invariant;
- a qualified constructor **expression** type-checks and then fails at runtime.

The same program shape works for a user module imported with `import * as E`, so the defect is
specific to the standard-library namespace path.

## Minimal reproduction

Pattern:

```wm
let main = () => {
  let s = Word8VectorSlice.full(Word8Vector.fromList([Word8.fromNumber(1)]));
  match(Binary.u32le(s, 1)) {
    Err(Binary.Bounds(offset, width, available)) => { print(offset) },
    _ => { print("other") }
  }
};
```

```text
/tmp/q.wm: missing constructor ID for PCtor
```

Expression:

```wm
let main = () => {
  let s = Word8VectorSlice.full(Word8Vector.fromList([Word8.fromNumber(1)]));
  match(Binary.u32le(s, 1)) {
    Err(e) => { print(e == Binary.Bounds(1, 4, 1)) },
    _ => { print("other") }
  }
};
```

```text
TypeError: Binary.Bounds_ctor_0 is not a function
return print(__wm_eq(e_1, Binary.Bounds_ctor_0([1, 4, 1])));
```

Unqualified `Bounds(...)` reports `unknown constructor Bounds`, which is the expected behavior for
a namespace import.

Control (works, prints `3`):

```wm
-- errmod.wm
type Error = Bounds<Number> | Other;

-- main.wm
from "./errmod.wm" import * as E;
let main = () => {
  match(E.Bounds(3)) {
    E.Bounds(n) => { print(n) },
    E.Other => { print("o") }
  }
};
```

## Expected behavior

`Binary.Bounds(...)` and `Binary.UnterminatedAscii(...)` behave like constructors of any other
namespace-imported module in both patterns and expressions, so parsers can distinguish bounds
failures from unterminated strings and tests can assert exact error values.

## Current workaround

wmthree matches only the outer carrier (`Err(error)`) and compares `Text.of(error)` against the
expected rendering, e.g. `"Bounds(156, 4, 158)"`. See `tests/low_level_basis.wm` and
`sotcexperiment/pipeline/test_nto_summary.wm`. This is explicit but relies on the display format.

## Suspected implementation boundary

- Patterns: `src/pattern_facts.ts` (`PCtor` case) finds no entry in
  `nominalFacts.constructorReferences` for a constructor resolved through a standard namespace.
  The nominal-facts pass probably records constructor references for local and user-module
  namespaces only.
- Expressions: `src/core/emit_js.ts` emits `ctorRefName(name, ctorId)` against the namespace object
  (`Binary.Bounds_ctor_0`), but the emitted standard namespace (`__wm_std_Binary`, see
  `standardRuntimeGraph` in `src/standard_library.ts`) exposes only `sourceMembers`/`hostMembers`
  values, not constructor bindings. `composeInitialStructure` carries `adts` across, so the checker
  accepts the reference.

## Constraints for a fix

- Do not make standard-library constructors available unqualified; that would change name
  resolution for every program.
- The type checker and emitter must agree; a constructor that checks must exist at runtime.
- Keep standard ADT identity nominal and shared with values returned by the standard functions,
  so `Binary.u32le(...) == Err(Binary.Bounds(...))` compares the same constructor tags.

## Focused regression coverage

- Matching `Err(Binary.Bounds(o, w, a))` binds all three fields.
- Constructing `Binary.UnterminatedAscii(2)` and comparing it with a returned error is `true`.
- Exhaustiveness over `Binary.Error` recognizes both constructors.
- The user-module `import * as E` control keeps working.
