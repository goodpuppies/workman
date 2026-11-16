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
precision) and otherwise `Real64`; inside `@gpu` code they are always `Real64`. Unconstrained operators without integer literals retain their `Real64`
default. Inside `@gpu` code, undecided integer literals also default to `Real64`.

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
