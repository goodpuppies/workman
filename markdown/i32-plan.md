# I32: signed 32-bit integers in WM

Status: decided 2026-10-23; steps 1–5 in wm-mini, step 6 in SubsetML (`make test` passes). Background:
[docs/integer-investigation.md](../docs/integer-investigation.md) and SubsetML's
`docs/integers.md`, whose language contract WM matches.

## Decisions

- **Name:** `I32`. SubsetML's bootstrap integer namespace (`Int.toString`,
  `Int.fromString`, `Int.minInt`, …) should be renamed to `I32` later so both
  languages share one name. SML's type keyword `int` stays, for SML
  compatibility.
- **Range:** exactly −2,147,483,648 to 2,147,483,647 on every backend.
- **Literals are overloaded and default to `Number`.** An integer literal (no
  `.` or exponent) has a numeric type variable that becomes `I32` or `Number`
  from context. If nothing decides it by the enclosing binding's
  generalization, it becomes `Number`, so existing WM code keeps its meaning.
  Literals outside the `I32` range are `Number` only. Float literals are
  always `Number`.
- **Operators:** `+ - *`, unary `-`, and `< <= > >=` accept `I32` or `Number`
  operands of one type. `/` and `%` stay `Number`-only: JS `%` truncates while
  SML `mod` floors. `I32.div` and `I32.mod` follow SML: `div` rounds toward
  negative infinity, and a nonzero `mod` has the divisor's sign. `==`/`!=` already
  work on any equality type. There are no implicit conversions between `I32`
  and `Number`.
- **Errors:** overflow, division by zero, and `minimum div -1` panic, matching
  SubsetML's `Overflow`/`Div`. The Basis offers checked forms
  (`I32.checkedAdd`, `I32.fromNumber`, `I32.fromString`). They return
  `Option<I32>`, like SML's `Int.fromString`: each has a single failure, so an
  error type would carry nothing. Switch to `Result` if a typed error is wanted.

## JS representation

`I32` values are ordinary JS numbers that always hold an integer in range, so
FFI, equality, printing, and patterns need no conversion. Inference lowers `I32`
`+ - *` and unary `-` to checked prelude helpers. A double result is exact or
out of range for every int32 operand pair, so a range check on the double
result is exact. Comparisons emit plain JS operators.

## Steps

1. `I32` primitive type; numeric constraint on type variables (bind only to
   `Number` or `I32`), copied through instantiation; defaulting to `Number` at
   generalization.
2. Literal and operator typing; integer literal patterns.
3. Lowering of `I32` arithmetic to checked helpers; prelude helpers.
4. `I32` Basis: `div`, `mod`, `toNumber`, `fromNumber`, `toString`, `fromString`,
   `checkedAdd`/`checkedSub`/`checkedMul`, `minimum`, `maximum`.
5. Tests: inference (defaulting, mixing errors, range), runtime (boundaries,
   overflow panics, div/mod sign cases).
6. SubsetML translator: SML `int` ↔ WM `I32`; remove the "WM support deferred"
   rejection; fix the seven stale real-typed Basis fixtures; `make test`.
7. Refresh wm-mini's Basis snapshot and update its users (WON, frontend-v3,
   pakman-subsetml).

## Implementation notes

- A numeric variable that meets a type other than `Number` or `I32` fails as if
  it were `Number`, so existing diagnostics are unchanged. Types display numeric
  variables as `'num` (`operator +: ('num, 'num) -> 'num`).
- Numeric variables are never generalized. A top-level binding defaults its
  leftovers to `Number`, so `let inc = (x) => { x + 1 }` is `Number -> Number`.
- Lowering happens on the host target only (`i32Operator` in
  `src/core/from_surface.ts`); the shared Core keeps the plain operator. The
  helpers and the `I32` object live in `src/core/emit_prelude.ts`.
- `I32.toString` writes `-`, not SML's `~`. `I32.fromString` accepts exactly
  `-?[0-9]+`; the translator must map SML's `Int.toString`/`Int.fromString`
  spelling differences.

## Known gaps

- Operators used through a user carrier (`map2` lifting) and first-class
  operator values use the unchecked JS operator at `I32`.
- Reflected JS FFI maps TS `number` to `Number` only; an `unsafe` import may declare
  `I32` explicitly.
- `Gpu.i32` is unrelated to `I32`.

## SubsetML translation (step 6)

SML→WM ascribes every int constant, `(42: I32)`, and prints `div`/`mod` as
`I32.div`/`I32.mod`. The reader turns `(n: I32)` back into an SML int constant, so
the round trip is unchanged. An operation typed only by a default
(`fn (a, b) => a + b`) is rejected in both directions. SubsetML's
`docs/translation.md#integers` has the rules. `Int.*` and `abs` are not mapped yet.

wm-mini changes this needed:

- `-2147483648` (also `(-2147483648: I32)`) is range-checked as one literal.
- `unsafe` JS imports may declare `I32`.
- Constructor patterns: a lone `_` ignores a multi-field payload (`Invalid(_)`), and
  a constructor whose one parameter is a type variable takes several patterns as a
  tuple (`Some(_, b)`), matching `Some(1, "a")` in expressions. Inference normalizes
  both to one pattern per parameter.
