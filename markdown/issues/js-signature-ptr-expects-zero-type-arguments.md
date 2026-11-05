# `Ptr` in a JS import signature can fail with "expects 0 type arguments"

Status: open, cause unknown. Recorded 2026-11-05.

## Symptom

Some JS imports whose declared signature mentions `Ptr<...>` fail with:

```
error[error file.wm:LINE:0]: Ptr expects 0 type arguments
```

The error points at the whole import declaration, and it doesn't suggest what to do instead. Others
with the same kind of signature compile. The message comes from `src/types.ts:1228`. `Ptr` is
defined in `src/host/c_manifest.ts` and `src/ffi/c/prepare.ts`.

## What was observed

Fails:

```wm
from js.global("Deno.UnsafePointer") import unsafe { value: Ptr<I32> -> Js.Value };
```

```wm
// examples/enterprise/address.wm, with a local address.js exporting of and value
from js.module("./address.js") import unsafe {
  of: bytes -> Option<Ptr<t>>,
  value: Ptr<t> -> Js.Value,
};
```

Compiles:

```wm
from js.global("Math") import unsafe { floor: Ptr<I32> -> Number };
```

```wm
from js.global import type { Uint8Array };
from js.global("Math") import unsafe { floor: Ptr<I32> -> Number };
```

`host/c/pointer.wm` also uses `js.module` with `Ptr<t>` in its signatures, and compiles.

The failing cases were seen through `wm check` and `wm run`, and the compiling ones through
`wm check`, in files that were otherwise empty, so a compiling case may just not reach the failing
code.

## Ruled out

Each of these was suspected and then contradicted by a probe:

- A C import in the same file: the `js.module` case above fails with none.
- The pointee: `Ptr<I32>`, `Ptr<t>` and `Ptr<Word8.Word>` all compile against `Math`.
- A reflected type import in the same file: the `Uint8Array` case above compiles, and the
  `js.module` case fails without one.
- Import order.

## Workaround

Use the host pointer module rather than declaring `Ptr` in a JS signature. `Pointer.fromBytes` gives
C the address of a JS typed array, as `examples/enterprise/writev.wm` does.

## Also worth fixing

Whatever the cause, the error should name the signature and say what's allowed there.
