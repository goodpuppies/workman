# Buffer.from after inflate loses its concrete backing type

Status: open. Reproduced 2026-11-05 with WM 0.6.0 at d4e418c, after the primitive toString, global generic-arity, and cross-module global-identity fixes.

## Reproduction

```wm
from js.module("node:buffer") import { Buffer };
from js.module("node:zlib") import { deflateSync, inflateSync };
from js.global import type { ArrayBuffer };
record Holder = { bytes: Buffer<ArrayBuffer> };
let main = () => {
  Buffer.from("hello") :> Result.andThen((input) => {
    deflateSync(input) :> Result.andThen((packed) => {
      inflateSync(packed) :> Result.andThen((unpacked) => {
        Buffer.from(unpacked) :> Result.map((copy) => { Holder(copy) })
      })
    })
  })
};
```

Run `wm check repro.wm` and `wm err repro.wm`. The source uses only valid local operations; no network or credentials are involved.

Expected: the copied/sliced buffer is usable as Buffer<ArrayBuffer>. In the subarray case, its receiver comes straight from Buffer.alloc and already has that concrete backing argument. No arbitrary TypeScript subtyping is requested.

Actual: The Result pipeline fails with Js.Value versus ArrayBuffer when constructing Holder. Buffer.copyBytesFrom(unpacked) instead checks.

## Impact and retest

Atview retains copyBytesFrom in its PNG decoder and at dynamic pixel-data boundaries. Those are now single normalization copies; the extra-copy cross-module Png.fromBytes factory was removed.

The broader atview graph and offline worker/crop probes pass with these narrow boundaries retained. Do not conflate this remaining case with FIXED-foreign-arraybuffer-generic-identity-across-modules.md: its two-file record-construction reproduction now passes.
