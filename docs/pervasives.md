# Default pervasive values

These library functions are available without an import in ordinary Workman
modules. Calls keep the defining library's data-first argument order.

| Defining library | Unqualified functions |
| --- | --- |
| Shared Basis list (`basis/list.wm`) | `map`, `filter`, `forEach`, `foldLeft`, `foldRight`, `head`, `tail`, `length`, `isEmpty`, `reverse`, `concat` |
| Shared Basis option (`basis/option.wm`) | `getOr`, `isSome` |
| WM General | `before`, `ignore`, `o` |
| WM Real | `ceil`, `floor`, `round`, `trunc` |
| WM Vector | `vector` (the `Vector.fromList` function) |

The shared SubsetML Basis owns the portable list and option operations. The
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
