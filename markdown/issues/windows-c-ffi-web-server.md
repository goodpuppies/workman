# Windows C FFI: reach a web-server acceptance example

## Verified on 2026-10-29

Zig 0.16.0 uses Aro for C translation, as documented in its
[release notes](https://ziglang.org/download/0.16.0/release-notes.html#C-Translation).
The source used by wm is the Aro copy in that pinned Zig distribution.

The original `wm run examples/c_ffi/header.wm` failed to locate `stdio.h`.
Aro's `Toolchain.discover` selects the generic toolchain; its
`defineSystemIncludes` adds resource headers and `/usr/include`, with no Windows
SDK discovery. Furthermore, our Windows extractor is built with the GNU ABI, so
`-target native` selects GNU parsing rather than Microsoft's dialect.

Windows now defaults to a GNU target with the matching MinGW/compiler headers
from Zig's `lib` directory, located via `zig env` or configured through
`WM_C_HEADER_ZIG_LIB_DIR`. The explicit directory option does not invoke Zig.
The extractor disables default includes so the Microsoft SDK and Aro resource
headers cannot contaminate this header environment. It selects UCRT declarations.
`std.zig.WindowsSdk.find` remains available for explicit MSVC targets only.
The existing `puts` example runs on Windows. Default C-library selection
also needed fixing: emitted programs previously loaded `libc.so.6` on every OS;
Windows now uses `ucrtbase.dll`, and macOS uses `libSystem.B.dylib`.

## Why stdio is not the whole Windows story

On this machine, Microsoft SDK 10.0.26100.0 `winsock2.h` still fails in Aro on
`__ptr32`/`__ptr64` and constructs involving `DECLSPEC_NOINITALL` and `__pragma`.
`WIN32_LEAN_AND_MEAN` alone does not resolve these failures. Do not erase pointer
width qualifiers to make the header parse: that could silently change layouts.

The GNU route works with the same parser:

```powershell
zig translate-c -lc -target x86_64-windows-gnu research/windows-cimport.h
```

The input includes `stdio.h` and `winsock2.h`. Zig supplies its MinGW libc headers
and compiler headers. The standalone wm Aro extractor also reflects `socket`,
`bind`, `listen`, `accept`, `send`, and `closesocket` successfully when explicitly
given those two include directories and the GNU target. `-w` suppresses a large
warning stream that otherwise can exceed the TypeScript driver's subprocess
output limit. Research inputs/results are in the gitignored `research/` folder.

## Server acceptance example achieved

`examples/c_ffi/http_server_windows.wm` now runs through reflected Winsock imports.
It binds IPv4 loopback, accepts one connection, reads fragmented request headers,
sends a fixed UTF-8 response using byte counts, and releases Winsock/socket
resources through synchronous cleanup thunks. No application-specific C shim or
JavaScript networking implementation is used.

The integration test uses a separate client, an ephemeral port, and a bounded
timeout. A test-only wrapper limits the real Winsock `send` call to three bytes
per invocation, checking partial writes and UTF-8 split across writes.

The implementation exposed and repaired these C FFI gaps:

- All reflected C pointers, including `char*` and `const char*`, now expose
  `Option<Ptr<T>>`. String conversion is explicit through the import-only
  `host/c/pointer.wm` module, so send/setsockopt need no authored signatures.
- `SOCKET` results and `INVALID_SOCKET` had inconsistent/rounded representations.
  Unsigned 64-bit values now use `Word64.Word`, signed values use `Int64.Int`, and
  the extractors serialize 64-bit constants as decimal strings. Bigints survive
  scalar calls and numeric struct fields without Number conversion.
- `Ptr` was declared separately for each C-importing module. Shared host type
  identities now allow pointers to cross module boundaries.
- Struct tags such as `WSAData` differed from typedef names such as `WSADATA`.
  Symbol collection now considers tag declarations, normalizes their names, and
  fetches types referenced by constants as well as functions.
- Generated field getters split names incorrectly when fields contained
  underscores. They now resolve struct/field prefixes against reflected names.
- Mixed structs such as WSAData lacked a way to allocate storage without writing
  a full codec. Reflected `sizeOf<Type>` and `offsetOf<Type>_<field>` metadata
  provide layouts for raw buffers, while numeric-only codecs remain available.
- The experimental `std/unsafe.wm` allocator has been removed. The server imports
  ordinary C `malloc`, `calloc` and `free`, checks nullable results, and explicitly
  casts raw pointers. `host/c/pointer.wm` supplies address operations, scalar
  access and UTF-8 conversion. The separate optional `host/c/resource.wm` helper
  only provides synchronous exception cleanup. Neither is globally opened.
- Scalar fields in mixed structs now have generated getters/setters backed by
  byte_type primitives at Aro's explicit offsets. These work directly on
  malloc-backed storage; no new foreign-storage ownership model was added.
- The extractor's per-process header cache now expands its symbol set when a
  later module imports additional declarations from the same header. Previously
  importing malloc in one module could hide free in another.
- The runtime's permanent struct keepalive array and 256-slot string ring were
  removed. Managed conversion pointers rely on Deno's existing retention;
  offset helpers retain their base pointer. Native allocations remain explicitly
  freed by the program.

See `docs/cffi.md` for the current public API and ownership rules.

## Remaining work

- Package or install the Windows header environment separately. The current
  local setup uses the MinGW/compiler pair from an installed Zig distribution.
  A later CLI download command can supply the same directory layout. Header
  packaging and downloads are deliberately deferred; account for licensing,
  package size and x64/ARM64 validation when implementing them.
- Carry that choice through runtime DLL selection. Winsock functions come from
  `ws2_32.dll`; importing a header does not identify its exporting DLL. Existing
  `lib: "ws2_32"` expresses this explicitly. `examples/c_ffi/winsock.wm` and a
  runtime test exercise reflected `htons` and socket constants against that DLL.
- Validate the new server path on Windows ARM64 and implement a POSIX counterpart.
- Add nonblocking/asynchronous FFI before building a concurrent server. The
  example deliberately blocks in accept/recv and serves one connection.
- Generalize array, nested-struct, pointer-field and union codecs. Raw reflected
  layout metadata supports this example but is not a replacement for those codecs.
- Implement backend adapters for another SML runtime before claiming cross-backend
  portability. Native C allocation/free is explicit; asynchronous pointer
  retention and over-aligned allocation requirements remain the caller's job.
- The separate issue about 64-bit results reached through JS reflection of
  `Deno.dlopen` remains open. This work fixes the direct C-header/manual C path.

## Upstream age check

Compared against upstream Aro commit
`a75ad1385a91402f1b5399e144f2b3686bfa4081` (2026-10-26).
This is newer than the copy shipped in Zig 0.16.0. Upstream now requires
`0.18.0-dev.567+7f0281900`; it also changed the `Toolchain` API (for example,
`defineSystemIncludes` now takes the include list explicitly).

Upstream tokenizes and accepts `__ptr32`/`__ptr64`, unlike our snapshot, but
`test/cases/msvc pointer keywords.c` explicitly expects warnings saying those
attributes are unimplemented. `TypeStore` still has their sizes commented out.
An upgrade may fix syntax acceptance without fixing ABI correctness. Windows
still selects upstream's generic toolchain, whose system include fallback is
`/usr/include`, so updating does not replace the discovery work above.

The current build pins Zig 0.16.0 and imports Aro from that distribution;
there is no independent Aro commit pin. Before an upgrade, pin the upstream
revision, adapt the extractor to its API, verify SDK layouts against a native
C compiler, and rerun reflection/runtime tests on the shipped architectures.
Do not treat accepting a header as proof that its reflected ABI is correct.

Sources:
[upstream build requirements](https://github.com/Vexu/arocc/blob/a75ad1385a91402f1b5399e144f2b3686bfa4081/build.zig.zon),
[pointer keyword tests](https://github.com/Vexu/arocc/blob/a75ad1385a91402f1b5399e144f2b3686bfa4081/test/cases/msvc%20pointer%20keywords.c),
[toolchain selection](https://github.com/Vexu/arocc/blob/a75ad1385a91402f1b5399e144f2b3686bfa4081/src/aro/Toolchain.zig).
