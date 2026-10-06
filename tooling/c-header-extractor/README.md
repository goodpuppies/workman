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

No Zig installation or separate binary download is needed at runtime. System C headers/SDKs
are still needed for headers that include them. Linux x64 was tested end to end;
other platforms are cross-built and checksum-verified but still need native smoke
checks. Linux executables are statically linked. WASM packaging is deferred.

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
initializers and cross-platform SDK discovery need further compatibility work.

Run the small native test set using the bundled assets, with Zig unavailable:

```sh
WM_ZIG_PATH=/deliberately/missing deno test -A tests/c_header_aro_test.ts
```
