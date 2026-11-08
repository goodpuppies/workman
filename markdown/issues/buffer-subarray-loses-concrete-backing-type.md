# Buffer.subarray does not preserve the known backing type

Status: open. Reproduced 2026-11-05 with WM 0.6.0 at d4e418c, after the primitive toString, global generic-arity, and cross-module global-identity fixes.

## Reproduction

```wm
from js.module("node:buffer") import { Buffer };
from js.global import type { ArrayBuffer };
record Holder = { bytes: Buffer<ArrayBuffer> };
let main = () => {
  Buffer.alloc(4) :> Result.andThen((buffer) => {
    buffer :> .subarray(0, 2) :> Result.map((slice) => { Holder(slice) })
  })
};
```

Run `wm check repro.wm` and `wm err repro.wm`. The source uses only valid local operations; no network or credentials are involved.

Expected: the copied/sliced buffer is usable as Buffer<ArrayBuffer>. In the subarray case, its receiver comes straight from Buffer.alloc and already has that concrete backing argument. No arbitrary TypeScript subtyping is requested.

Actual: wm check fails with type.mismatch. wm err reports phase: resolve delayed FFI and an unresolved subarray boundary, but no useful conflicting pair.

## Impact and retest

Atview retains Buffer.prototype.subarray.call plus Buffer.copyBytesFrom for sixel row strips. Direct cross-module pixel record construction and imported byte helpers now work and were restored.

The broader atview graph and offline worker/crop probes pass with these narrow boundaries retained. Do not conflate this remaining case with FIXED-foreign-arraybuffer-generic-identity-across-modules.md: its two-file record-construction reproduction now passes.
