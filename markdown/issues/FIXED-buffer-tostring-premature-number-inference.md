# Buffer.toString("base64") is inferred as Number.toString(radix)

Status: fixed 2026-11-05. Reproduced 2026-11-05 with WM 0.6.0 and Deno 2.9.8, while adding image rendering to atview's REPL API.

## Reproduction

```wm
from js.module("node:buffer") import { Buffer };
let main = () => {
  Buffer.from("hello") :> Result.andThen((buffer) => {
    buffer :> .toString("base64")
  })
};
```

Run `wm check repro.wm` and `wm err repro.wm`.

Expected: a Result containing `aGVsbG8=`. Actual:

```text
type error: Number.toString radix can't be both:
- String
- Number
```

`wm err` identifies `InferJsMember.Constraint`, with the failed premise `argument matches numeric radix`. Adding an explicit `Buffer<ArrayBuffer>` callback parameter does not fix this.

## Investigation

`src/infer/expr_js_members.ts`, `jsPrimitiveFfiCallValue`, tries `inferPrimitiveReceiverFromMember` when the receiver is not already a primitive. The hypothesis is that this eagerly chooses Number for the shared method name `toString` before the reflected Buffer receiver settles. This is a hypothesis, not a confirmed root cause.

A foreign object's method must get reflected with its actual receiver and arguments. Merely naming `toString` must not turn it into Number.toString.

## Impact / workaround

atview's existing Kitty PNG loader uses this standard Buffer encoding operation. A verified workaround is `Buffer.prototype.toString.call(buffer, "base64")`, followed by `Json.assert` to check the dynamically typed call result as String. `toBase64()` exists in this runtime but did not resolve reliably through WM reflection in the full atview graph. This does not address the separate ArrayBuffer identity problem documented in `foreign-arraybuffer-generic-identity-across-modules.md`.

Do not weaken the foreign receiver type or add unsafe casts as the compiler fix.
