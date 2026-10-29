# Bundled C header reflection (beta)

This tool parses C headers through Aro and emits Workman's reflection JSON directly
from its AST and target layouts. It never translates headers to Zig or compiles/runs
a reflected Zig program. Zig is a build dependency only.

The compiler and Deno/Node LSPs automatically select a bundled binary for Linux,
macOS or Windows on x64 or ARM64. The JSR package and universal VSIX carry compressed
assets for all six platforms. Only the matching asset is loaded, on first C header
reflection. Ordinary Workman files do not load or unpack binary payloads.

The runtime verifies SHA-256 checksums and installs the binary, Aro resource headers
and license notices into a versioned temporary cache. Set `WM_C_EXTRACTOR_CACHE_DIR`
to use another writable/executable location. Concurrent processes publish complete
cache directories atomically. Reflection results separately hash all parsed include
files so transitive header edits invalidate them.

The extractor itself needs no Zig installation or separate binary download.
System C headers are still needed for headers that include them. Linux executables
are statically linked. WASM packaging is deferred.

### Windows headers

Native Windows reflection defaults to the GNU target and uses the MinGW-w64 and
compiler headers from a local Zig distribution (tested with **Zig 0.16.0**). For
now, `zig env` locates its `lib` directory via `zig` on PATH or `WM_ZIG_PATH`.
Zig only locates the headers; the bundled Aro executable parses them directly.
There is no header download or large bundled Windows header payload yet.

Set `WM_C_HEADER_ZIG_LIB_DIR` to use the headers without invoking Zig at all:

```powershell
$env:WM_C_HEADER_ZIG_LIB_DIR = "C:/path/to/zig/lib"
```

The directory must contain both `libc/include/any-windows-any/` and `include/`.
Keeping this layout also permits a future separately installed header package.
Reflection uses the UCRT declarations to match `ucrtbase.dll`. It disables default
system includes, keeping Microsoft's `INCLUDE` environment and Aro's resource
headers out of the MinGW/compiler header pair. Explicit user include directories
(`WM_C_HEADER_INCLUDE_DIRS`) still take precedence. Parsed headers are hashed for
cache invalidation. Extraction suppresses warnings so large header sets cannot
overflow the subprocess stderr buffer; C errors still fail extraction.

An explicit MSVC target (`WM_C_HEADER_TARGET=x86_64-windows-msvc`, or
`aarch64-windows-msvc`) instead uses the installed Microsoft SDK and Visual C++
headers via Zig's bundled `WindowsSdk.find` implementation. That path also honors
a Developer Prompt's `INCLUDE`. Its compatibility remains limited: the pinned Aro
cannot parse all Microsoft SDK constructs in `winsock2.h`.

The compiler maps `c.lib("c")`/`c.lib("libc")` and the default library for system
headers to `ucrtbase.dll` on Windows, `/usr/lib/libSystem.B.dylib` on macOS, and
`libc.so.6` on Linux. Other bare library names use the platform's `.dll`, `.dylib`,
or `.so` naming convention. Supply `lib: "ws2_32"` for Windows Winsock headers;
header discovery does not infer which DLL exports an arbitrary SDK function.
`examples/c_ffi/winsock.wm` exercises reflected Winsock constants and `htons` on
Windows. It prints `36895`, `2`, and `1` on separate lines.

## Rebuild

Use a complete Zig **0.16.0** installation:

```sh
deno task c-header:build
deno task c-header:check
```

`WM_ZIG_PATH` selects the build compiler. The build imports the Aro module from
that pinned Zig distribution; Aro sources are not separately vendored yet. It
cross-builds all six targets into `dist/<platform>-<arch>/` and regenerates checked-in
JavaScript assets under `src/generated/c_header_extractor/`. Each native directory
contains its executable, resource headers, license notices and checksum manifest.
Distribute that directory together if using a standalone override.

`deno task generate` and the local-only `deno task publish` include this build.
CI runs `c-header:check` to detect stale source, notices, resources or payloads
without needing Zig. After extractor changes, regenerate and stage the assets too.

## Overrides and limits

`WM_C_HEADER_EXTRACTOR` explicitly selects another standalone executable and takes
precedence over automatic selection. `WM_C_HEADER_BACKEND=zig` selects the previous
system-Zig backend for compatibility; it needs Zig 0.16.x on PATH or `WM_ZIG_PATH`.
Unsupported host platforms also use that backend. A broken bundled/explicit
extractor reports an error rather than silently invoking Zig.

Implemented: structs and typedefs, opaque records, target sizes/alignment/offsets,
arrays, pointer constness, function signatures, enum backing types/constants, and
foldable object macros including arithmetic and compound struct/array literals.
Function macros and nonconstant expressions are omitted. Enums retain the existing
integer-alias representation. Unions, bitfields, anonymous fields, and variadic or
old-style function declarations are rejected. String/address macros, some complex
initializers and macOS SDK discovery need further compatibility work.

Run the small native test set using the bundled assets, with Zig unavailable:
On Windows, first set `WM_C_HEADER_ZIG_LIB_DIR` to the local header installation
so discovering the headers does not require `zig env`.

```sh
WM_ZIG_PATH=/deliberately/missing deno test -A tests/c_header_aro_test.ts
```
