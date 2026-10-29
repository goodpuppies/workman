# Deno FFI memory and Workman's byte_type bridge

Research date: 2026-10-29. Local Deno checkout: `C:/Git/deno`, commit
`e7b39ebd` (2026-10-26). Its `ext/ffi` working tree was clean. The installed
Deno 2.9.8 also has the pointer-to-buffer WeakMap in `UnsafePointer.of`; this
was checked through the runtime function's source rather than assumed from the
checkout. No product implementation was changed during this investigation.

## Managed buffers are already native-addressable

`ext/ffi/ir.rs::parse_buffer_arg` obtains the address of an ArrayBuffer's backing
storage or the contents of an ArrayBufferView. A Deno FFI parameter declared
`buffer` passes that address to C without copying. C can write those bytes, and
JavaScript sees the changes. A typed-array subarray supplies a view into the same
allocation, with its offset already incorporated.

The separate `pointer` parameter representation accepts a V8 External or null,
not a typed array. Although both represent an address at the C ABI, they have
different JavaScript input and lifetime behavior. A compiler must account for
this when supporting both owned buffers and pointers returned by C.

## Pointer identity and ownership are separate

`ext/ffi/00_ffi.js` stores `pointer -> original buffer` in
`POINTER_TO_BUFFER_WEAK_MAP` inside `UnsafePointer.of`. Keeping the resulting
pointer object live therefore also retains the source buffer. The map does not
permanently retain either after the pointer becomes unreachable.

`UnsafePointer.offset` only calls `op_ffi_ptr_offset`; it does not copy that
ownership relation to the new pointer object. An interior pointer alone is not a
substitute for retaining the original owner. Pointer values returned by C, or
created from integer addresses, likewise do not establish ownership of an
allocation.

## Pointer views alias, rather than copy or own

`ext/ffi/repr.rs::op_ffi_get_buf` builds a V8 backing-store wrapper around the
supplied address, using `noop_deleter_callback`. `UnsafePointerView.getArrayBuffer`
is a zero-copy alias of native memory. Writes through a DataView/Uint8Array over
that ArrayBuffer mutate the original memory. The wrapper neither frees native
memory nor retains a managed allocation's original owner.

`copyInto` is the explicit copying API. Neither API can infer the allocation's
valid bounds from a raw pointer; sizes and lifetimes remain caller contracts.

A pointer from `malloc` is still native-owned storage: call the matching `free`
after its last use. A borrowed ArrayBuffer view does not change that contract.

## Nonblocking calls

`ext/ffi/ir.rs::BackingStoreHolder` retains V8 backing-store references for buffer
and by-value struct arguments. `ext/ffi/call.rs` moves the holder into the blocking
worker task and drops it only after the native call completes. The code rejects
user-resizable backing stores on this path because retaining the store alone
cannot ensure a stable data pointer.

Raw pointer arguments take a different parsing branch and do not add backing
stores to that holder. C retaining a pointer beyond the completed call also lies
outside Deno's per-call retention. Such uses need an independently retained owner
or native ownership, with an explicit release point. The API does not prevent
concurrent access races, incorrect lengths or explicit detachment of memory.

## What byte_type already supplies

Workman vendors the `byte_type_C` fork, commit
`56cdc7b28a064c85ee3f9a681d48149776f7a02d`. Its sized codecs provide byte size,
alignment, struct field offsets, nested structs and fixed-size arrays, and read or
write through DataView. `src/ffi/c/byte_type.ts` currently composes primitive-only
struct codecs and validates their byte size and field offsets against Aro's C
target layout. The vendored codec implementation is more capable than this
bridge; extending the bridge is preferable to recreating struct serialization.

Codec layout is distinct from allocation ownership and the physical alignment of
a particular address. Aro remains the target C layout authority. The existing
validation does not establish that an arbitrary external pointer meets a struct's
alignment requirement.

## Implications for the prototype

- Ordinary synchronous input/output buffers do not require malloc/free, a native
  stack allocator, or a separate general-purpose unsafe-memory subsystem. They
  can use managed backing storage that C borrows for the call.
- Reflected struct literals can be encoded with byte_type into owned backing
  storage. Out parameters can be read back through the same codec after C writes.
- Keep the owner with borrowed pointers/views, especially interior pointers.
  Passing buffers directly also permits Deno's nonblocking retention machinery
  to work when that backend feature is added.
- Workman's permanent `__wm_c_keepalive` array is unnecessary for ordinary
  managed argument/struct lifetimes. Its fixed 256-entry C-string ring is not a
  general lifetime solution either. Replace those only after choosing the
  owner/borrow representation; no implementation change is made here.
- A backend-independent foreign-storage contract can have a Deno backing-buffer
  implementation and a different implementation on an SML backend. It need not
  promise C stack allocation or expose Deno classes to portable code.

## Small installed-runtime probe

`research/deno_ffi_memory_probe.ts` calls UCRT `memset` with a `buffer` parameter,
mutates its storage through `UnsafePointerView.getArrayBuffer`, then calls
`memset` on a subarray. The original bytes and the borrowed view both finish as
`ABAACCCC`. This verifies direct mutation and aliasing; it is not a GC/lifetime
stress test. Ownership conclusions above come from the inspected implementations.
