# ArrayBuffer generic arguments lose identity across Workman modules

Status: fixed 2026-11-05. Reproduced 2026-11-05 with WM 0.6.0 and Deno 2.9.8 while adding inline image rendering to atview.

## Minimal reproduction

`holder.wm`:

```wm
from js.module("node:buffer") import { Buffer };
from js.global import type { ArrayBuffer };
record Holder = { bytes: Buffer<ArrayBuffer> };
```

`main.wm` beside it:

```wm
from "./holder.wm" import { Holder };
from js.module("node:buffer") import { Buffer };
let main = () => {
  Buffer.alloc(4) :> Result.map((bytes) => { Holder(bytes) })
};
```

`wm check main.wm` fails with `type.pipe-input-mismatch`, showing ArrayBuffer on both sides. Putting Holder and the allocation in a single file checks successfully. This is exact foreign type identity, not a request for TypeScript subtyping or variance.

Also reproduces in atview by passing `Buffer.alloc(4)` to imported `Png.byte`. In the larger graph, `wm err tui/sixel.wm` reports only `type mismatch` at `phase: resolve delayed FFI`, without a concrete conflicting pair. Later reductions exposed `ArrayBuffer` versus `ArrayBuffer`.

## Expected

The ArrayBuffer type argument reflected from node:buffer and the global ArrayBuffer type imported in another compilation unit retain one canonical identity. Importing a record constructor must preserve that identity recursively through its foreign generic arguments.

## Impact

Blocks the existing atview pixel record (`Pixels.bytes: Buffer<ArrayBuffer>`) from being shared between the PNG decoder, terminal image loader, and sixel/half-block renderers. Local helpers avoid some crossings but do not solve record construction elsewhere.

Bare Buffer is intentionally disallowed in record fields according to `FIXED-node-buffer-declaration-rejected-for-missing-type-argument.md`; writing the explicit argument exposes this separate problem. See also `FIXED-foreign-class-compatibility-across-workman-modules.md`, whose exact-class fix may need extending to nested generic arguments/global types.

## Validation to add

- The two-file reproduction passes, including constructing the holder and reading a byte from its buffer.
- Single-file behavior stays unchanged.
- Distinct foreign argument types remain distinct.
- Delayed FFI mismatch diagnostics retain both foreign identities and their origins rather than only `type mismatch` or identical display names.
