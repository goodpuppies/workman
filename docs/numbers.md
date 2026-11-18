# Numeric literals

Convert a number to a native string with `Text.of`:

```wm
let number = 10;
let text = Text.of(number); // "10"
```

This also works in `wm repl`, where `Text` includes the Basis Unicode text operations. JavaScript
interop can call `10 :> .toString()`, which returns a `Result`; for example,
`10 :> .toString() :> Result.getOr("failed")` produces `"10"`. The parentheses call the method.
`Int32.toString` also formats a 32-bit integer without using JS member access.

An ordinary integer literal takes its numeric type from context. There is no separate word-literal
prefix:

```wm
let byte: Word8.Word = 255;
let port: Word16.Word = 8080;
let flags: Word32.Word = 0xffffffff;
let mask: Word64.Word = 0xffffffffffffffff;
let minimum: Int64.Int = -9223372036854775808;
let count: Int32 = 1024;
```

`Word64.Word` and `Int64.Int` literals retain all 64 bits. Literal patterns use the same contextual
typing and exact values. Type aliases preserve this behavior.

At the end of each top-level declaration, integer literals without determining context default to
`Int32` when all literals sharing their type fit its signed 32-bit range. Larger literals default to
`Real64`, with JavaScript number rounding. Decimal-point and exponent literals, such as `1.0` and
`1e3`, are `Real64` or `Real32` by context (`let half: Real32.Real = 0.5;` rounds to single
precision) and otherwise `Real64`; inside `@gpu` code they are always `Real64`. An operator that
nothing decides takes its class's default, as in Standard ML (Appendix E): `+`, `-`, `*`, `%` and
the comparisons default to `Int32`, so `(a, b) => a + b` is `(Int32, Int32) -> Int32`, and `/`
defaults to `Real64`. Inside `@gpu` code, where shader arithmetic is floating point, undecided
literals and operators default to `Real64`.

A later declaration cannot change an earlier default. This helper takes and returns `Int32`:

```wm
let nonNegative = x => if (x < 0) { 0 } else { x };
```

Write `(x: Real64)` or use `0.0` when the helper should operate on reals.

The selected type determines the allowed literal range:

| Type          | Range                |
| ------------- | -------------------- |
| `Int32`       | −2³¹ through 2³¹ − 1 |
| `Word8.Word`  | 0 through 2⁸ − 1     |
| `Word16.Word` | 0 through 2¹⁶ − 1    |
| `Word32.Word` | 0 through 2³² − 1    |
| `Word64.Word` | 0 through 2⁶⁴ − 1    |
| `Int64.Int`   | −2⁶³ through 2⁶³ − 1 |

Out-of-range literals are compile-time errors. Word literals do not wrap; word arithmetic and
explicit conversions retain their existing modular behavior.

Qualified functions also supply context:

```wm
let next: Word8.Word = Word8.add(254, 1);
```

Reflected C signatures supply their ABI types, so calls such as `calloc(1, 1024)` and `htons(8080)`
no longer need constructors around their literal arguments.

Existing values retain their types:

```wm
let number: Real64 = 1;
let byte = Word8.fromReal64(number);
```

A `Real64` variable does not implicitly become a word at a later call. Conversions remain necessary
for values such as real-valued byte lengths. TypeScript's `number` continues to reflect as `Real64`.
At a JS import boundary an `Int32` can flow into a `number` parameter, since both use JavaScript
numbers at runtime. This compatibility does not widen ordinary WM function arguments or narrow
results returned by JS. `Int32` receivers expose JavaScript Number methods.

## Arithmetic operators

The arithmetic operators are overloaded over a fixed table, following the Definition of Standard
ML's Appendix E. Both operands and the result have one type:

| Operators | Types |
|---|---|
| `+ - *`, `%`, `< <= > >=` | every numeric type: `Int32`, `Int64`, `Word8`–`Word64`, `Real32`, `Real64` |
| `/` | `Real32`, `Real64` |
| unary `-` | `Int32`, `Int64`, `Real32`, `Real64` |

`Int32` and `Int64` arithmetic panics on overflow, word arithmetic wraps, and `Real32` rounds each
result to single precision. `%` truncates toward zero for every type: the remainder takes the
dividend's sign, so `-7 % 2` is `-1`. An integer `%` by zero panics. Integer division is never
implicit: `Int32.div` and `Int32.mod` round toward negative infinity, as SML's `div` and `mod` do,
and so do `Int64.div`/`Int64.mod` and the word types' `div`/`mod`.

```wm
let checksum = (a: Word8.Word, b: Word8.Word) => { a + b * 31 };
let isEven = n => n % 2 == 0;  -- Int32 -> Bool
```

The named forms such as `Word8.add` remain.

## Integer library functions

`Int32` and `Int64` share the same parsing and checked-arithmetic API. Changing the namespace
and integer annotations preserves these contracts:

| Function | Return value |
| --- | --- |
| `fromString(text)` | `Result<Int, Error>`; skip ASCII whitespace and scan a decimal prefix, accepting `+`, `-` or `~` |
| `parseDecimal(text)` | `Result<Int, Error>`; signed decimal with no whitespace or trailing input |
| `parseNatural(text)` | `Result<Int, Error>`; one or more decimal digits, with no sign |
| `checkedAdd(a, b)`, `checkedSub(a, b)`, `checkedMul(a, b)` | `Ok(value)` or `Err(Overflow)` |
| `fromReal64(value)` | `Ok(value)` for an integral real in range; otherwise `Err(InvalidInteger)` or `Err(Overflow)` |
| `toString(value)` | `String` |
| `minimum`, `maximum` | The bounds of the selected integer type |

Parsing errors are `InvalidInteger`, `Overflow`, or `StringError<String.Error>`. Fractional
and nonfinite real inputs produce `InvalidInteger`; integral real inputs outside the destination
range produce `Overflow`. These functions return `Result` for invalid input, following the
Basis failure convention. Ordinary arithmetic operators and `div`/`mod` retain their panic behavior.

```wm
let id = Int64.parseDecimal("456456") :> Result.debug;
let total = Int64.checkedAdd(id, id) :> Result.debug;
```

Conversions reflect whether failure is possible. `Int32.toReal64` returns a real directly because
every `Int32` is exactly representable. `Int64.toReal64` returns `Result<Real64, Int64.Error>`
and reports `PrecisionLoss` when a real cannot represent the integer exactly. It accepts exactly
representable values above the safe-integer range, such as powers of two.

Collection counts and indexes default to `Int64`. Explicit `32` variants accept and return
`Int32`. At an intentional width boundary, use `Int64.fromInt32` to widen and `Int64.toInt32`
to narrow with a checked `Result`; no conversion through a real is needed.

Migration: `Int32.checkedAdd`/`checkedSub`/`checkedMul` and `Int32.fromReal64` now return `Result`
instead of `Option`; use `Ok`/`Err` and `Result` combinators. `Int64.fromString`, `fromReal64` and
`toReal64` now return `Result` instead of throwing on invalid input.

## Generating and folding ranges

Use `Int32.range(first, last)` or `Int64.range(first, last)` to enumerate integer **values**.
Both bounds are inclusive. Values appear in ascending order; reversed bounds produce `[]`.
The endpoint can be the maximum integer of the selected type without overflowing the next step.

```wm
let ids = Int64.range(3000000000, 3000000002);
-- [3000000000, 3000000001, 3000000002]
```

The values do not pass through collection indexes. `List.length(ids)` returns `Int64`;
`List.length32(ids)` returns `Int32`. Its elements are `Int64`. Range generation does not calculate `last - first + 1`, so no count
conversion is needed. Building a very large list can still exhaust memory.

Use `foldRange(first, last, initial, f)` to process a range without building an intermediate list.
Its callback takes `(value, accumulator)`, as with `List.foldLeft`. The accumulator can have a
different type from the range values. Reversed bounds return `initial` without calling `f`.

```wm
let total = Int64.foldRange(3000000000, 3000000002, (0: Int64),
  (id, sum) => Int64.checkedAdd(id, sum) :> Result.debug);
```

`List.unfold(initial, step)` is the portable state-based generator underneath range generation.
Each call to `step(state)` returns `Some((value, nextState))`, or `None` to finish normally.
The state and elements can have different types. No integer count or index is involved.

```wm
let values = List.unfold(["a", "b"], match(state) => {
  [] => None,
  [value, ..rest] => Some((value, rest))
});
-- ["a", "b"]
```

`List.unfold` and the Int32 helpers are implemented in the shared SubsetML Basis without new
host primitives. The Int64 helpers use the same contracts in WM's Int64 module; the explicit `32` collection APIs keep the portable subset's integer requirements unchanged.

## Collection count and index widths

Unsuffixed list, byte-string and Unicode-text count/index functions use `Int64`. Their `32`
variants preserve the signed 32-bit contract:

| Int64 default | Int32 variant |
| --- | --- |
| `List.length`, bare `length` | `List.length32`, bare `length32` |
| `List.repeat`, `splitAt`, `at`, `take`, `drop`, `tabulate` | `repeat32`, `splitAt32`, `at32`, `take32`, `drop32`, `tabulate32` |
| `String.size`, bare `size` | `String.size32`, bare `size32` |
| `String.extract`, `substring` | `String.extract32`, `substring32` |
| `Text.size`, `extract`, `substring` | `Text.size32`, `extract32`, `substring32` |
| `StringCvt.padLeft`, `padRight`, `padTextLeft`, `padTextRight` | `padLeft32`, `padRight32`, `padTextLeft32`, `padTextRight32` |

`List.tabulate` passes an `Int64` index to its callback; `List.tabulate32` passes `Int32`.
The element type is independent of the index type. Validation and typed errors are the same
at both widths. Wide operations traverse using wide arithmetic; they do not silently narrow
counts to Int32. Bounds checks avoid adding a start and count, which could overflow.

```wm
let ids: List<Int64> = List.tabulate(3, i => 3000000000 + i) :> Result.debug;
let count: Int64 = List.length(ids);
let (left, right) = List.splitAt(ids, Int64.div(count, 2)) :> Result.debug;
let smallCount: Int32 = List.length32(ids);
```

Ordinary integer literal and arithmetic defaulting remains Int32. A separately bound Int32
count must use a `32` function or be explicitly widened; later calls do not change an earlier
binding's type. Character/scalar codes, compiler source offsets, and fixed-format codecs
retain their explicitly sized contracts. This change does not alter vector APIs that use reals.

The shared SubsetML Basis owns the `32` variants and generic traversal cores; WM's `std`
extensions provide the unsuffixed Int64 wrappers. Explicit `basis/` imports expose the shared
32-bit names; implicit namespaces and `std/` imports also expose the wide defaults. The
current native SML reader stages the portable 32-bit surface. Int64 calls there remain
unsupported; MLWorks runtime panic support is deferred, with no fallback to 32-bit arithmetic.

## Explicit arithmetic domains

Numeric folds can take an ordinary arithmetic record instead of fixing their element type:

```wm
let narrow: Int32 = [1, 2, 3] :> List.sumWith(Int32);
let wide: Int64 = [3000000000, 2] :> List.sumWith(Int64.math);
let product: Real64 = [1.5, 2.0] :> List.productWith(Real64);
```

`Numeric.Arithmetic<T>` has four fields: `zero: T`, `one: T`, `add: (T, T) -> T`, and
`mul: (T, T) -> T`. `sumWith(items, math)` starts with `zero` and calls `add(total, item)`
from left to right. `productWith` starts with `one` and calls `mul(total, item)` in the same
order. Empty inputs return the corresponding identity.

Int32, Int64, Real32, Real64, Word8, Word16, Word32 and Word64 export this record as `math`
and also as `carrier`. Bare `Int32` in value position selects `Int32.carrier` through the
existing namespace rule; `Int32.math` is the explicit spelling. No contextual switching is
performed: each module's `carrier` is one fixed value with one type scheme. A numeric arithmetic
record and a monadic `Carrier` have different types. `Result.carrier` retains its existing shape.

The selected operations retain their normal semantics: signed integer overflow panics, word
arithmetic wraps, and real arithmetic rounds as usual. A previously bound `List<Int32>` does
not become `List<Int64>` merely by choosing Int64 arithmetic; convert its elements explicitly.

The record and fold implementations live in the portable SubsetML Basis. User-defined domains
can supply `Numeric.Arithmetic<T>` values with the same shape; no compiler specialization or
new host primitive is required.
