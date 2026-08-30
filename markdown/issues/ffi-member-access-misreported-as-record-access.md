# Issue: Two FFI member accesses fail as "<ForeignType> is not a record type"

Status: open

Discovered while writing a `writev(2)`-backed buffered stdout writer in Workman
(`examples/enterprise/writev.wm`).

## Summary

Two unrelated FFI member accesses on a reflected `Uint8Array` both fail with the same message:

```text
Uint8Array is not a record type
```

- **A.** A method call whose receiver is a record projection — `holder.bytes.subarray(2)` — is not
  reflected, though the identical call on a local binding is.
- **B.** The `buffer` property of a typed array is not in the reflected member set at all, on any
  receiver form.

The shared message is misleading in both cases. Nothing in either program is trying to use a
record; the checker has fallen back to record-field lookup after FFI reflection declined, and
reports the fallback's failure rather than the reflection failure.

Related: `FIXED-imported-record-projection-in-via-callback.md` is the mirror image of Issue A — a
Workman record projection wrongly rewritten into an FFI access. This report is an FFI member access
wrongly falling back to record lookup. The two share the boundary between record projection and
FFI receiver recognition and may share a fix.

## Environment

Observed in the current wm-mini checkout on 2026-08-26 with:

```text
deno run -A src/main.ts run <file>
```

## Issue A: method call on a record projection

### Minimal reproduction

```workman
from js.global import { Uint8Array };
from js.global import type { Uint8Array };

record Holder = { bytes: Uint8Array };

let main = () => {
  match(Uint8Array.new(8)) {
    Err(_) => { print("no") },
    Ok(buf) => {
      let holder = Holder(buf);
      match(holder.bytes.subarray(2)) {
        Ok(_) => { print("ok") },
        Err(_) => { print("err") },
      }
    },
  }
};
```

### Observed result

```text
error: Uint8Array is not a record type
    match(holder.bytes.subarray(2)) {
          ^^^^^^^^^^^^^^^^^^^^^
```

### Expected result

The receiver `holder.bytes` has the declared foreign type `Uint8Array`, so `.subarray` should
reflect exactly as it does for a plain binding.

### Working workaround

Bind the projection first:

```workman
let raw = holder.bytes;
raw.subarray(2)
```

This compiles and runs. `examples/enterprise/writev.wm` carries three of these `let raw = ...`
lines purely to work around the issue, which is the tell that it is a receiver-form problem and not
a typing problem.

## Issue B: `.buffer` is not a reflected member

### Minimal reproduction

```workman
from js.global import { Uint8Array };

let main = () => {
  match(Uint8Array.new(8)) {
    Err(_) => { print("no") },
    Ok(buf) => {
      match(buf.buffer) {
        Ok(_) => { print("ok") },
        Err(_) => { print("err") },
      }
    },
  }
};
```

### Observed result

```text
error: Uint8Array is not a record type
    match(buf.buffer) {
          ^^^^^^^^^^
```

The receiver is a plain local binding here, so this is not Issue A. `.subarray`, `.set` and
`.length` all reflect on the same binding; `.buffer` does not.

### Expected result

`buf.buffer` reflects to something usable. TypeScript declares it as `ArrayBufferLike`, which is
`ArrayBuffer | SharedArrayBuffer` — presumably the same union-collapse path that strands
`number | bigint` elsewhere. `ArrayBuffer` already has a param-position mapping in
`type_mapping.ts`, so a value-position mapping seems within reach.

### Practical consequence

Without `.buffer` there is no way to construct a `DataView` over an existing typed array, so the
usual JavaScript idiom for writing a packed C struct:

```ts
const view = new DataView(bytes.buffer);
view.setBigUint64(0, address, true);
```

has no Workman translation. `examples/enterprise/writev.wm` sidesteps this by allocating a
`BigUint64Array` directly and writing elements through `Reflect.set`, which happens to work for
`struct iovec` because both its fields are 8 bytes wide. A struct with mixed field widths would
have no workaround.

## Diagnostic quality

Independently of the two fixes, "X is not a record type" should not be the message a user sees for
a failed foreign member access. It names the wrong feature and gives no hint that reflection was
attempted, which member was wanted, or that binding the receiver to a local might help. Something
closer to the existing FFI diagnostics would be far more actionable:

```text
cannot resolve JS FFI member `buffer` on receiver type Uint8Array
```

## Likely compiler boundaries

- `src/ffi/receiver/`: how a receiver expression is recognised, and why a record projection is not
  treated as one (Issue A).
- `src/ffi/reflect/type_mapping.ts`: `ArrayBufferLike` in value position (Issue B); the union
  branch returns `undefined` for `ArrayBuffer | SharedArrayBuffer`.
- `src/ffi/record_fields.ts`: the fallback that produces the misleading message.

## Candidate regression tests

1. A method call on a record field of foreign type resolves.
2. The same call on a nested projection (`a.b.c.method()`) resolves.
3. `typedArray.buffer` resolves and can be passed to `DataView.new`.
4. `DataView` round-trip: `setBigUint64` then `getBigUint64` over a `Uint8Array`'s buffer.
5. A genuinely absent member on a foreign type reports an FFI diagnostic naming the member, not a
   record-type error.
6. A genuine record-type error on an actual record still reports the record message.

## Severity and impact

Issue A is cosmetic-ish but pervasive: any FFI code that keeps foreign handles in records needs
scattered rebinding lines. Issue B closes off packed-struct construction, which is the main reason
to reach for the FFI in the first place. The shared diagnostic makes both far harder to diagnose
than they need to be.

## Non-goals

- Reflecting the full typed-array/ArrayBuffer object model.
- Adding Workman-native struct layout syntax.
