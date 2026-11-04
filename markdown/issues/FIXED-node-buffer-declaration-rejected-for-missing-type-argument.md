# Node's `Buffer` type is rejected for a missing type argument

Status: fixed 2026-11-04. Regression tests: `tests/ffi_generic_default_test.ts` and the Node
declarations test in `tests/compiler_cache_test.ts`.

```wm
from js.module("node:buffer") import { Buffer };
let main = () => {
  match(Buffer.from("ok")) {
    Err(_) => { print("failed") },
    Ok(buffer) => { let typed: Buffer = buffer; print("ok") }
  }
};
```

```text
Buffer expects 1 type arguments
```

## Cause

`@types/node` declares `Buffer<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike>`. Foreign
declarations carry their full arity, and annotations had to write exactly that many arguments, while
TypeScript lets a reference omit parameters with a default.

## Fix

Foreign types now also record `requiredArity`. Where free type variables are allowed, an omitted
defaulted argument is a fresh variable, so bare `Buffer` means `Buffer<'a>`.

- Applying the declared default doesn't work. `Buffer.from` returns `Buffer<ArrayBuffer>`, and HM has no
  subtyping to accept that as `Buffer<ArrayBufferLike>`.
- Dropping defaulted parameters from the arity doesn't work either. `Effect<A, E = never, R = never>`
  would lose its error type.
- A parameter with no default still has to be written, as in TypeScript.
- Record fields and other declarations still have to write every argument, because a free variable
  there would have nothing to generalize over.
