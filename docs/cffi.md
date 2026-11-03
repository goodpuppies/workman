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

For an authored `c.lib` signature, a `String` result decodes a non-null,
NUL-terminated UTF-8 string. Use `Option<String>` when C may return null: the
result is `None` or a decoded `Some(text)`. Input strings are temporary managed
UTF-8 storage. These conversions do not transfer ownership of C's returned
storage; functions returning allocated strings still need an explicit pointer
signature so the caller can release that allocation after copying its text.

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
  sin_port = htons(8080),
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

Calls pass existing `Int64` and `Word64` values directly as bigints, including
64-bit results. CFFI does not implicitly cast a `Number` to these types; use an
explicit conversion when the value comes from a Number-based API.

Known named C imports called with literal tuple arguments use fixed-argument
JavaScript entry points, avoiding the temporary WM argument tuple. Argument and
result conversions still follow the declared ABI. Passing a function as a value
or calling it with an existing tuple retains the ordinary WM calling convention.

Widths and signedness come from Aro for the selected target, rather than the C
type's spelling: a 16-bit `unsigned short` maps to `Word16.Word`, while a target
with a 32-bit `unsigned short` maps to `Word32.Word`. `htons`, for example, takes
and returns `Word16.Word` on Windows. Use `Word16.fromNumber(8080)` at the call
site. Signed 8- and 16-bit values use `I32`, with their narrower native ABI
preserved; wm currently has no separate signed 8-/16-bit types. Integer constants,
scalar pointer pointees, struct fields, getters, and setters use the same mapping.

Ordinary integer literals take their type from reflected parameters and aggregate
fields. For example, `calloc(1, 1024)` and `htons(8080)` select the exact ABI types
without explicit conversions. See [numeric literals](numbers.md) for ranges and defaults.

Convert ordinary byte counts to `I32` when a C function expects `int`, and use
`I32.toNumber` when a returned C integer is needed for Number-based pointer byte
offsets. Unsigned word conversions retain the existing standard library semantics.

## Nullary authored functions

In an explicitly authored `c.lib` signature, `Void -> T` means a C function with
no native arguments, corresponding to `T f(void)`:

```wm
from c.lib("c") import unsafe { getpid: Void -> I32 };
let processId = getpid();
```

Library and symbol names remain platform-specific; this example uses Unix libc.
