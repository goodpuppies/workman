# SML-shaped numeric type names

**Status:** implemented 2026-11-16. Supersedes the naming decision in [i32-plan.md](i32-plan.md)
(`I32`, and renaming SubsetML's `Int` to `I32`) and the `Number` default in
[numeric-overloading.md](numeric-overloading.md). Operator rules, ranges and runtime
representations are unchanged.

Completed: the `Self` lookup rule (`f5b89bc`), numeric rename (`5aab97a`), Basis-authority migration
(`9fb7015`), and integer-literal defaulting (`1bafa71`). User-facing numeric and Basis documentation
has been updated. The problem description and step list below record the original migration.

Remaining follow-ups are optional removal of translator literal ascriptions and the explicitly
deferred infix-overloading work. JS boundaries accept existing `Int32` values as numbers; ordinary
WM values do not widen. Undecided integer literals in GPU code retain the `Real64` default.

## Problem

WM's numeric names follow no single scheme:

| Meaning | SML | WM today |
|---|---|---|
| default integer | `int`, structure `Int` | `I32` (bare), namespace `I32`; the Basis `Int` only parses |
| 64-bit integer | `Int64.int` | `Int64.Int` |
| words | `Word8.word` … | `Word8.Word` … |
| default real | `real`, structure `Real` | `Number`; namespace `Real` works on `Number`; also `Number.div/mod` |
| 64-bit real | `Real64.real` | `Number` **and** a separate nominal `Float64.Real` |
| 32-bit real | `Real32.real` | `Float32.Real` |

Integer literals default to `Number` when nothing in context decides, where SML defaults to
`int`.

## Target

Every numeric type has SML's structure shape, a namespace holding the type and its operations,
and code writes the bare namespace name thanks to the `Self` rule below.

| Type (written) | Type (defined) | Namespace | Replaces |
|---|---|---|---|
| `Int32` | `Int32.Int` (compiler primitive) | `Int32` | `I32`, namespace `I32`, the Basis `Int` |
| `Int64` | `Int64.Int` | `Int64` | `Int64.Int` |
| `Word8` … `Word64` | `Word8.Word` … | `Word8` … | `Word8.Word` … |
| `Real64` | `Real64.Real` (compiler primitive) | `Real64` | `Number`, `Float64.Real`, namespaces `Real`, `Float64`, `Number` |
| `Real32` | `Real32.Real` | `Real32` | `Float32.Real`, namespace `Float32` |

- **No unsized defaults.** There is no `Int`, `Real` or `Number` type or namespace. SML needs
  `int` because its size varies by implementation; WM's sizes are fixed, so the size is always
  in the name. The same holds for the Basis: SubsetML's `SubsetInt` becomes `SubsetInt32`.
- **The namespace is one module** (rule 2 of [basis-authority-plan.md](basis-authority-plan.md)):
  `Int32` is the Basis `Int32` (`fromString`, `parseDecimal`, `parseNatural`) plus today's `I32`
  operations (`div`, `mod`, `checkedAdd/Sub/Mul`, `toString`, `minimum`, `maximum`).
  `I32.toNumber`/`fromNumber` become `Int32.toReal64`/`Int32.fromReal64`. `Real64` is today's
  `std/real.wm` with `Float64`'s operations merged in; their conversion functions disappear
  because the types are now the same. `Number.div`/`mod` (flooring division on doubles, two test
  callers) are removed: SML's `Real` has no `div`.
- **SubsetML's source language is unchanged.** It still writes SML's `int` and `real`; the
  translator maps them to `Int32.Int` and `Real64.Real`.
- **JS numbers are `Real64`** in FFI signatures, reflection and content-mapper types.
- **No compatibility aliases** for the old names. Callers are renamed.

### The `Self` rule

The existing rule that a bare namespace name in an expression means `Lib.carrier`
([modules.md](../docs/modules.md), `src/infer/expr.ts`) gets a type-position twin:

- **Expression position:** bare `Lib` means `Lib.carrier`, tried only after ordinary value
  lookup (unchanged).
- **Type position:** bare `Lib` means `Lib.Self`, tried only after ordinary type lookup. A
  `Self` with parameters takes them as written (`Lib<a>` is `Lib.Self<a>`).

`Self` is an ordinary type declaration in the module, usually an alias: `std/int32.wm` declares
`type Self = Int32.Int;`. Nothing in the Basis needs to know about it, so SubsetML keeps emitting
`Int32.Int`. Ordinary types win, so a user's own type of the same name, or an existing generic
such as `Option<a>`, is unaffected. `Self` and `carrier` are separate because a module such as
`Result` can want both.

Like `carrier`, `Self` is only a lookup rewrite: nothing else in the compiler knows about it.
Diagnostics, hovers and the REPL print the type's own name (`Int32.Int`).

## Steps

### 1. Rename (no behavior change)

- The `Self` rule in type lookup, with tests (done: `src/types.ts`, `tests/module_test.ts`).
- Compiler: `src/basis_manifest.ts` (`Number`→`Real64.Real`, `I32`→`Int32.Int`, merge
  `Float64.Real` into `Real64.Real`, `Float32.Real`→`Real32.Real`), `src/numeric.ts`, the `I32.*`
  values, type printing, FFI mappings (`src/ffi/c/mapping.ts`, `src/ffi/shared.ts`, reflection,
  receivers), wmslang normalization, GPU dialect, JSON inference and content-mapper interop types.
- SubsetML: rename `SubsetInt` to `SubsetInt32`; `src/wm_print.sml` and `src/wm_parse.sml` map
  SML `int` to `Int32.Int` (ascriptions `(n: Int32.Int)`) and `real` to `Real64.Real`; regenerate
  `subml-basis/` and bump the pin.
- Library: `std/real.wm` → `std/real64.wm` with `std/float64.wm` folded in, `std/float32.wm` →
  `std/real32.wm`, a new `std/int32.wm` extending the Basis `Int32`, `std/number.wm` removed,
  `Self` declared in every numeric module, `Pack*` and `binary.wm` signatures renamed.
- Sources: `.wm` files (≈2,060 `Number`, ≈440 `I32`), TS tests with WM snippets (≈1,500
  `Number`, ≈210 `I32`), docs (16 files). Renamed by type position, not blind text
  replacement: `Number` is also a JS global (`js.global("Number")`, `Number.isSafeInteger` in TS).
- Diagnostics and REPL output show the new names; golden files are regenerated.

### 2. Integer literals default to `Int32`

An integer literal whose type nothing decides becomes `Int32` instead of `Real64`. Decimal-point and
exponent literals stay `Real64`. Literals outside the `Int32` range default to `Real64`, so
`let big = 10000000000` still works. Context can select another sized numeric type when the
literal fits that type's range.

Consequences to check:

- A top-level `let n = 0;` used later with `Real64` values now fails to type-check; the fix is
  `0.0` or `: Real64`. Measure how many sites break before deciding whether anything else is
  needed.
- `Int32` arithmetic panics on overflow where a double silently lost precision. Counters that can
  exceed 2³¹ need `Real64` or `Int64`.
- `/` and `%` stay `Real64`-only, so `let half = n / 2` with an `Int32` `n` needs `Int32.div`.
- The SubsetML translator can stop ascribing `(n: Int32.Int)` on integer constants once the default
  matches SML's; do that as a follow-up, since the ascriptions are harmless.

### 3. Documentation

`docs/numbers.md`, `docs/smlparallels.md`, `docs/content-mapper.md`, the FFI docs, the std
README; mark `i32-plan.md` and the default rule in `numeric-overloading.md` superseded.

## Later: table-driven infix overloading

Planned, not part of this work. Today `+ - * < <= > >=` accept only `Int32` and `Real64`
(`OPERATOR_NUMERIC_TYPES` in `src/numeric.ts`); the other sized types use named functions such as
`Word8.add`. With every numeric type now an SML-shaped structure, the obvious next step is SML's
approach: a fixed table of overloaded infix operators and the types each accepts (the
Definition's Appendix E, the Basis's `num`/`realint`/`wordint` classes), extended to `Int64`,
`Word8`…`Word64` and `Real32`. It stays a hardcoded table, not user-definable overloading. The
current limited overloading is fine until then.

## Order with the Basis work

1. This plan's step 1 (rename) first, so the Basis migration writes `Int32.toReal64` directly
   instead of `I32.toNumber` that would be renamed again.
2. [basis-authority-plan.md](basis-authority-plan.md).
3. This plan's step 2 (literal default), last: it is the only semantic change and is easiest
   to judge once the libraries are settled.
