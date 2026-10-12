# Issue: Equality Through an Imported Generic Function Rejects User-Declared Types

Status: open

Discovered while writing testman's `assertEqual` and pakman's test suite on 2026-10-07.

## Summary

A polymorphic function that uses `==`, defined in one module and called from another, cannot be
used with any type declared outside the built-in basis: datatypes and records are both rejected
with "does not admit equality". The same call works when the function is defined in the calling
module, and `==` on those types works directly in any module.

This is not how Standard ML behaves. In the Definition (`research/The-Definition-of-Standard-ML-Revised`,
`statcor.tex`, "Types and Type functions" and the datatype rule), equality is an attribute of the
type name, fixed where the datatype is declared ("maximise equality"), and it travels with the type
name to every structure that uses it. Only abstraction removes it (`abstype`, or a signature that
exports the type as `type` rather than `eqtype`). A function with an equality type variable
(`''a`) can be instantiated at any equality type from any structure. Workman has no abstraction
mechanism that hides equality, and no operator overloading or user-defined equality, so `==` should
follow the declared structure of the type wherever it is used.

## Minimal reproduction

`colors.wm`:

```workman
type Color = | Red | Green;
record Point = { x: Number, y: Number };
```

`helpers.wm`:

```workman
let same = (a, b) => { a == b };
```

`main.wm`:

```workman
from "./colors.wm" import { Red };
from "./helpers.wm" import { same };

let main = () => { print(same(Red, Red)) };
```

```text
wm check main.wm
```

## Actual behavior

```text
type "Color" does not admit equality
```

| case | result |
|---|---|
| imported datatype, through a helper in another module | rejected |
| datatype declared in `main.wm`, through a helper in another module | rejected |
| imported record, through a helper in another module | rejected |
| imported datatype, through a helper declared in `main.wm` | ok |
| `Red == Green`, `Point(1, 2) == Point(1, 2)` directly, in any module | ok |
| `Option<Number>` or `Option<Local>` through the helper | ok |

## Expected behavior

All of these check and run. `Color` and `Point` admit equality (their constructors and fields do),
so instantiating `same` at them is valid regardless of where `same` is defined.

## Suspected implementation boundary

`src/infer/equality.ts`: for a type variable, `requireEquality` registers a deferred check
(`addEqualityConstraint`) that closes over the `typeEnv` and `adts` of the module being inferred.
When the generic function is defined in `helpers.wm`, that closure appears to run with helpers'
environment after the variable is bound at the call site in `main.wm`. Helpers' environment knows
neither `Color` nor `Point`, so `typeInfoById` finds no record and `adts.get` finds no datatype,
and the check rejects. Basis types succeed because they are resolved through the basis manifest
rather than the module's tables.

The deferred check should resolve type information from the type itself (its declaring module, or a
program-wide type table), not from the module that created the constraint.

## Workaround

testman's `assertEqual` is generic and defined in `tooling/testman/test.wm`, so tests compare such
values through a description or a projection (see `tooling/pakman/tests/resolve.test.wm`), or wrap
them in a list or tuple, which takes the basis path.

## Focused regression coverage

- `same(Red, Red)` and `same(Point(1, 2), Point(1, 2))` through a helper in another module check
  and print `true`.
- A datatype declared in the calling module works through the helper.
- A record or datatype containing a function is still rejected through the helper.
- testman's `assertEqual` works on pakman's `Selector` (`tooling/pakman/tests/resolve.test.wm` can
  drop its `describe` workaround).
