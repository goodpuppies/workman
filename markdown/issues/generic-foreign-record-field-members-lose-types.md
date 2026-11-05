# Members of a generic foreign record field are typed as Js.Value

Status: open. Reproduced 2026-11-05 on 0.6.0 (HEAD `469ee7c`) and on the working tree, so it isn't caused by the global type argument identity fix.

## Reproduction

```wm
from js.module("node:buffer") import { Buffer };
from js.global import type { ArrayBuffer };
record Holder = { bytes: Buffer<ArrayBuffer> };
let viaField = (holder: Holder) => { holder.bytes :> .readUInt8(0) };
let direct = Buffer.alloc(4) :> Result.map((b) => { b :> .readUInt8(0) });
```

- `viaField` is `Holder -> Result<Js.Value, Js.Error>`.
- `direct` is `Result<Result<Number, Js.Error>, Js.Error>`.

`.length` on the field also gives `Result<Js.Value, Js.Error>`. Both calls work at runtime, so the program runs and only the static type is lost.

## Expected

A member of `Buffer<ArrayBuffer>` has the same type whether the receiver comes from a record field or from a call: `readUInt8` and `length` should both give `Number`.

## Not yet known

The cause hasn't been traced. A likely place to start is the reference built for an imported generic type, because `jsModuleTypeRef` in `src/ffi/reflect/types.ts` fills every type argument with `any`, but that hasn't been confirmed.
