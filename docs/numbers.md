# Numeric literals

An ordinary integer literal takes its numeric type from context. There is no separate word-literal
prefix:

```wm
let byte: Word8.Word = 255;
let port: Word16.Word = 8080;
let flags: Word32.Word = 0xffffffff;
let mask: Word64.Word = 0xffffffffffffffff;
let minimum: Int64.Int = -9223372036854775808;
let count: I32 = 1024;
```

`Word64.Word` and `Int64.Int` literals retain all 64 bits. Literal patterns use the same contextual
typing and exact values. Type aliases preserve this behavior.

Without determining context, integer literals default to `Number`, retaining JavaScript number
representation and rounding. Decimal-point and exponent literals, such as `1.0` and `1e3`, remain
`Number`.

The selected type determines the allowed literal range:

| Type          | Range                |
| ------------- | -------------------- |
| `I32`         | −2³¹ through 2³¹ − 1 |
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
let number = 1;                 // Defaults to Number here.
let byte = Word8.fromNumber(number);
```

A `Number` variable does not implicitly become a word at a later call. Conversions remain necessary
for values such as Number-valued byte lengths. TypeScript's `number` continues to reflect as
`Number`.

Infix arithmetic currently supports `Number` and `I32`. Use qualified `Word8.add`, `Word64.mul`, and
related functions for word arithmetic. Extending infix operators to these types is the next
implementation slice.
