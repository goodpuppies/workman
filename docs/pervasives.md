# Default pervasive values

The shared Basis ordering type `Order` and its constructors `Less`, `Equal`, and
`Greater` are available without imports. They retain the type and constructor
identities defined by `basis/order.wm`, including in patterns:

```wm
let rank: Order -> Number = match {
  Less => -1,
  Equal => 0,
  Greater => 1
};
let result = match(Real.compare(1, 0)) {
  Ok(Greater) => true,
  _ => false
};
```

This follows the SML Basis Library's top-level `order` datatype, using WM names.
Comparison functions remain qualified or explicitly imported. `Real.compare`
is available through the preloaded `Real` namespace; `compareInt` and `compareReal`
from `basis/order.wm` require explicit imports. The ordering type and constructors
are omitted under `-- @no-prelude`, shadow normally, and are not re-exported by
user modules.

These library functions are available without an import in ordinary Workman
modules. Calls keep the defining library's data-first argument order.

| Defining library | Unqualified functions |
| --- | --- |
| Shared Basis list (`basis/list.wm`) | `map`, `filter`, `forEach`, `foldLeft`, `foldRight`, `head`, `tail`, `length`, `isEmpty`, `reverse`, `concat` |
| Shared Basis option (`basis/option.wm`) | `getOr`, `isSome`, `toResult` |
| Shared Basis bool (`basis/bool.wm`) | `not` |
| Shared Basis char (`basis/char.wm`) | `chr` (`fromCode`), `ord` (`toCode`) |
| Shared Basis string (`basis/string.wm`) | `explode` (`fromNative`), `implode` (`toNative`), `size`, `str` |
| WM General | `before`, `ignore`, `o` |
| WM Real | `ceil`, `floor`, `round`, `trunc` |
| WM String (`std/string.wm`) | `toList` (`String.toList`) |
| WM Vector | `vector` (the `Vector.fromList` function) |

The shared SubsetML Basis owns the portable list, option, boolean, character and string operations. The
remaining functions come from existing WM extensions. Each pervasive refers to
the original function value, with the same polymorphism, error types and runtime
identity; it is not a wrapper with another calling convention.

```wm
let doubled = map([1, 2, 3], (n) => { n * 2 });
let selected = filter(doubled, (n) => { n > 2 });
let flattened = concat([[1, 2], [], [3]]);
let count: I32 = length(flattened);

// Both callbacks receive (element, accumulator).
let left = foldLeft([1, 2, 3], "", (item, acc) => { acc ++ Text.of(item) });
let right = foldRight([1, 2, 3], "", (item, acc) => { acc ++ Text.of(item) });
// left is "123"; right is "321".
```

`concat` flattens one list level. String concatenation expressions use `++`;
joining a list of strings remains available through an explicit import of
`basis/string.wm`'s `concat`.

`head` and `tail` return `Result` with the shared list module's `Error` type;
empty input produces its `EmptyList` error. `getOr` takes an `Option` and an
eager fallback value. `forEach` requires a callback returning `Void`.

`toResult(option, error)` turns `Some(value)` into `Ok(value)` and `None` into
`Err(error)`. The caller chooses the error type and value. `not` is a first-class
`Bool -> Bool` function, so `map([true, false], not)` returns `[false, true]`.

The character and string functions use the shared Basis's **byte** domain (codes
0–255), with checked `Result` boundaries:

| Function | Type | Failure |
| --- | --- | --- |
| `chr` | `I32 -> Result<Char, Chars.Error>` | `Chars.InvalidCode` outside 0–255 |
| `ord` | `Char -> Result<I32, Chars.Error>` | `Chars.NonByteCharacter` for a foreign non-byte character |
| `explode` | `String -> Result<List<Char>, Strings.Error>` | `Strings.NonByte(offset)` at the first non-byte element |
| `implode` | `List<Char> -> Result<String, Strings.Error>` | `Strings.NonByte(offset)` at the first non-byte character |
| `size` | `String -> Result<I32, Strings.Error>` | Same full byte validation as `explode` |
| `str` | `Char -> Result<String, Strings.Error>` | `Strings.NonByte(0)` for a non-byte character |

`Chars` and `Strings` denote explicit import aliases for `basis/char.wm` and
`basis/string.wm`; their errors are not implicitly opened. Empty strings, NULs
and high bytes round-trip exactly. `size` counts bytes after validation and takes
linear time. These functions do not encode or decode Unicode text.

```wm
let bytes = explode("abc"); // Ok(['a', 'b', 'c'])
let native = implode(['a', 'b', 'c']); // Ok("abc")
let count = size("abc"); // Ok(3: I32)
let initial = str('a'); // Ok("a")
let code = ord('a'); // Ok(97: I32)
let character = chr(97: I32); // Ok('a')
```

`toList: String -> List<String>` is a WM std convenience, also available as
`String.toList`. It composes shared Basis byte extraction and single-character
string construction: `toList("abc")` is `["a", "b", "c"]`, and `toList("")` is
`[]`. NUL and high bytes are preserved. Any conversion error returns `[]` for the
whole input, including non-byte text such as an emoji or a character above 255.
Use `explode` when the caller needs the typed error. `std/string.wm` has no direct
JS FFI; all host access stays behind the shared Basis adapters.

The current rounding helpers return `Result<Number, Basis.Error>`, report NaN as
`Err(Basis.Domain)`, and panic on infinity. `print` remains available separately
with its existing generic display and newline behavior.

The older preloaded `List` namespace still contains some transitional std APIs:
`List.length` returns `Number`, and its `List.foldLeft` callback is accumulator-first.
The new bare functions use the shared Basis API instead. To name that same owner
explicitly, import it:

```wm
from "basis/list.wm" import * as Lists;
let count: I32 = Lists.length([1, 2]);
```

Local declarations, parameters and explicit imports shadow pervasive values under
the ordinary scope rules. Pervasives do not become exports of every module.
`-- @no-prelude` selects the kernel profile and omits these library projections;
its existing `print` binding remains available. Other Basis operations and whole
`Subset*` namespaces are not implicitly opened.
