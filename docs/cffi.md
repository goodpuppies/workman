# C interoperability

`c.header` reflects C declarations through bundled Aro. Calls use Deno FFI on
the JavaScript backend. C value imports must include `unsafe`.

```wm
from "host/c/pointer.wm" import * as Pointer;
from c.header("stdio.h") import unsafe { puts };
let main = () => { puts(Some(Pointer.fromString("hello from C"))); };
```

On Windows, reflection uses Zig's matching MinGW/compiler headers. An installed
Zig is discovered automatically; `WM_C_HEADER_ZIG_LIB_DIR` can point directly to
its `lib` directory without invoking Zig. See the
[extractor configuration](../tooling/c-header-extractor/README.md).

## Header imports

C headers support both unqualified and qualified wildcard imports:

```wm
from c.header("winsock2.h", lib: "ws2_32") import unsafe *;
// Or: import unsafe * as Winsock, then use Winsock.socket, Winsock.sockaddr_in{}, etc.
```

Unqualified wildcards make referenced functions, constants, and reflected types
available directly. Explicit named imports take precedence. Wildcard reflection
and native symbol loading use the declarations referenced by the module, so
unrelated header functions need not exist in the selected library. The header
specifier remains `c.header(...)`; a bare name such as `winsock` is not a module alias.

## Pointers and C allocation

Reflected C pointer parameters and results use `Option<Ptr<T>>`, including
character pointers. `None` is a C null pointer. `malloc`/`calloc` return
`Option<Ptr<Opaque>>`; match the result before using it. A cast changes the
pointee type without changing the address.

Allocation is an ordinary imported C operation:

```wm
from "host/c/pointer.wm" import * as Pointer;
from c.header("stdlib.h") import unsafe { malloc, free };
let main = () => {
  match(malloc(Word64.fromNumber(1024))) {
    None => { Panic("malloc failed") },
    Some(raw) => {
      let bytes = Pointer.cast(raw);
      Pointer.writeUtf8(bytes, 0, "hello");
      print(Pointer.readUtf8(bytes, 5));
      free(Some(raw));
    },
  }
};
```

This example's size argument uses the reflected 64-bit `size_t` on the supported
64-bit targets. `calloc` can supply zero-filled memory. Release native allocations
using the matching C allocator's `free`, exactly once after their last use.

`host/c/pointer.wm` is an explicitly imported host module, loaded on demand. It
provides pointer casts, equality, byte offsets, scalar reads/writes, and text
conversion. It has no allocator, ownership wrapper or automatic native-memory
release. Reads and writes use raw addresses; allocation bounds and validity are
the caller's responsibility. Integer accesses use native endianness and byte
offsets. Use C functions such as `htons` for network byte order.

`Pointer.fromString(text)` produces NUL-terminated UTF-8 storage and a pointer.
On Deno this storage is managed: the pointer retains its backing bytes. Do not
pass this pointer to `free`. `Pointer.toString(pointer)` reads to the first NUL;
`readUtf8(pointer, count)` reads an explicit byte count. `writeUtf8` writes bytes
without adding a terminator. `byteLength` counts encoded UTF-8 bytes. Pointer
offsets retain the base pointer for managed conversions, but cannot prevent a
caller from freeing a native allocation prematurely. C retaining pointers after
calls requires keeping their backing storage valid for that entire period.

`host/c/resource.wm` separately provides an optional synchronous
`withCleanup(body, cleanup)` helper that runs cleanup on return or exception.
The HTTP example defines its own `withMemory` wrapper using ordinary `free`.
There is no globally opened `Unsafe` namespace.

## Struct sizes and field access

Reflected concrete structs provide `sizeOf<Type>` and
`offsetOf<Type>_<field>` values, including structs containing arrays or pointers.
Aro supplies the target layout. Scalar fields additionally have
`get<Type>_<field>(pointer)` and `set<Type>_<field>(pointer, value)` bindings.
These use the vendored `byte_type` primitive codecs at reflected field offsets,
and work with memory allocated by C. They do not allocate or free that memory.

Construct reflected aggregates with `TypeName{ field = value }`. On Windows:

```wm
from c.header("winsock2.h") import type { sockaddr_in };
from c.header("winsock2.h", lib: "ws2_32") import unsafe {
  AF_INET, htons, inet_addr
};
from "host/c/pointer.wm" import * as Pointer;
let address = sockaddr_in{
  sin_family = AF_INET,
  sin_port = htons(Word16.fromNumber(8080)),
  sin_addr = { S_un = { S_addr = inet_addr(Some(Pointer.fromString("127.0.0.1"))) } }
};
```

The result is an ordinary `CStorage<sockaddr_in>` record with `pointer: Ptr<sockaddr_in>`
and `size: Number` fields. Pass `Some(Pointer.cast(address.pointer))` as the native
address, and convert `address.size` with `I32.fromNumber` for `bind`'s C `int`
length argument. The size is the allocated aggregate's byte count,
including padding. Qualified type names also work. Nested
initializers infer their struct or union type from the containing field; a union
initializer must select exactly one member. Omitted struct fields and padding
are zero-filled. Unknown fields, duplicates and incompatible scalar values are
compile errors. Nested literals populate one allocation, using Aro's layout and
`byte_type` primitive writes. An existing constructed aggregate can also be
copied into a field when its type is imported.

Construction uses managed backing storage on Deno: retain the record or its pointer while C
uses it, and do not pass it to `free`. Supplying array or pointer field values
in literals is not supported yet; omitted fields of those kinds remain zero.
Bitfields remain unsupported. Windows' `s_addr` macro is not a reflected field:
use its actual `S_un.S_addr` layout as above.

Numeric-only structs retain their existing generated `new<Type>` convenience
constructors. Those constructors use managed backing buffers on Deno and must
not be freed with C's `free`. Whole-struct codecs validate size and offsets
against Aro; mixed-struct scalar field codecs validate field bounds and use Aro's
explicit offsets. No permanent keepalive array or fixed-size string ring is used.

## Exact integers

| C representation | Workman representation |
| --- | --- |
| Unsigned 8-, 16-, 32-bit integers | `Word8.Word`, `Word16.Word`, `Word32.Word` |
| Signed integers through 32 bits | `I32` |
| Signed 64-bit integer | `Int64.Int` |
| Unsigned 64-bit integer | `Word64.Word` |

The 64-bit types carry JavaScript bigints. Use `Int64.fromNumber`,
`Int64.fromString`, `Int64.toNumber`, `Int64.toString`, or the existing `Word64`
operations. Number conversions reject inexact values. Constants such as
`INVALID_SOCKET` also preserve every bit. Wider C integers are unsupported.

Widths and signedness come from Aro for the selected target, rather than the C
type's spelling: a 16-bit `unsigned short` maps to `Word16.Word`, while a target
with a 32-bit `unsigned short` maps to `Word32.Word`. `htons`, for example, takes
and returns `Word16.Word` on Windows. Use `Word16.fromNumber(8080)` at the call
site. Signed 8- and 16-bit values use `I32`, with their narrower native ABI
preserved; wm currently has no separate signed 8-/16-bit types. Integer constants,
scalar pointer pointees, struct fields, getters, and setters use the same mapping.

Convert ordinary byte counts to `I32` when a C function expects `int`, and use
`I32.toNumber` when a returned C integer is needed for Number-based pointer byte
offsets. Unsigned word conversions retain the existing standard library semantics.

## Windows HTTP example

For the smaller sketch with a recursive accept loop:

```powershell
.\wm.bat run examples/c_ffi/http_server_windows_minimal.wm
```

It listens on all IPv4 interfaces and replies `Hello from workman!` to successive
connections until interrupted. Each handler
reads one chunk (at most 1024 bytes), calls send once, and closes the connection.
This is deliberately unchecked sketch code: allocation results use
`let Some(pointer) = ...`, and startup/bind failures return 1. Other Winsock
return codes are mostly ignored. It omits
full header parsing, partial-write handling, exception cleanup and timeouts.
Allocation uses C `calloc` and `free`; there is no stack-allocation emulation.
Reflected nullable pointers use `Some(pointer)` and `None`.

For the more thorough one-request example:

From the repository root:

```powershell
.\wm.bat run examples/c_ffi/http_server_windows.wm
```

After `LISTENING 8080`, use another terminal:

```powershell
curl.exe --max-time 5 http://127.0.0.1:8080/
```

The response is `hello from wm C FFI — moi!`. The example serves one connection
and exits. It uses reflected Winsock, C allocation/free, scalar struct codecs,
and explicit string-pointer conversion; no function signature annotations are
required. The receive buffer is 4096 bytes plus a NUL terminator for `strstr`.
Partial sends and fragmented headers are handled, UTF-8 lengths are byte counts,
and accepted sockets have three-second send/receive timeouts. Accept remains
blocking. This is a fixed-response demonstration, without routing, request-body
processing, concurrent clients, or full HTTP validation.

The host module interface is intentionally separate from the portable Basis.
Its present primitive implementation is Deno-specific; no SML backend
implementation is claimed here.
