# Node's `Buffer` type is rejected for a missing type argument

Status: open, found 2026-11-04. Failing since before `4e9b523`. The cause below is unverified.

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

The diagnostic has no source location (`from generated: unknown`).

Current `@types/node` declares `Buffer<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike>`, so
the likely cause is that foreign type arity ignores TypeScript type parameter defaults. Foreign
declarations started carrying arity in the `effect-sequencing-loses-instantiated-types` work.

Known-issue test: `tests/compiler_cache_test.ts`.
