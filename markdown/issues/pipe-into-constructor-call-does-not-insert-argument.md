# Piping into an imported constructor call does not insert the piped value

Status: open. Reproduced 2026-11-12 while porting bskygraph's tile decoding.

## Reproduction

```ts
// classes.ts
export class Box { value: number; constructor(value: number) { this.value = value; } }
```

```wm
from js.module("./classes.ts") import { Box };
let piped = (n: Number) => n :> Box.new();
```

`wm check` fails: `cannot determine JS FFI overload for Box.new with 0 arguments; available
arities: 1`. The same holds inside a pipeline lambda, `Result.andThen(=> :> Box.new())`.

Expected: as for any other call stage, `n :> Box.new()` means `Box.new(n)`.

## Notes

- `Box.new(n)` and `(n) => Box.new(n)` work. Since the constructor-value fix, `Box.new` passed as
  a value also works when its arity is fixed (`Result.andThen(Box.new)`); a constructor with
  optional parameters (`@mapbox/vector-tile`'s `VectorTile`) is rejected as a first-class value
  with a message naming the lambda form.
- The constructor binding is selected as an `FfiBindingCall` from the authored argument list before
  pipe argument insertion reaches it.
