# C FFI: reflection extractor

Port of workman-old's C header reflection, upgraded for struct layouts. The
extractor is the C-side replacement for the TypeScript reflection host
(`src/ffi/reflect/host.ts`): it exists so nobody hand-writes a dlopen
signature.

## Pipeline

The bundled Aro backend collects the same symbol list, parses the header at runtime,
and reads target layouts from Aro. Its JSON goes through the same Workman mapping
below. Native binaries and resource headers are bundled, with checksummed unpacking
on first use. The legacy system-Zig path remains available for compatibility:

1. Collect `c.header` imports from the module graph (declared symbols become
   the extractor's symbol list — same as workman-old's `{{SYMBOLS}}` template
   slot).
2. Emit a templated Zig file (`src/ffi/c/zig/c_header_extract.zig`): template
   gets the header include and the symbol list; the program does
   `@cImport(@cInclude(header))` and comptime `@typeInfo`/`@typeName` /
   `@offsetOf` over the symbols, writes one JSON document to stdout.
3. `zig run` it (target triple from env; default `<host-arch>-linux-gnu` on
   Linux, otherwise `native`).
4. Cache the JSON keyed by (header path, target, include dirs, defines,
   extractor source hash, Zig version) next to the program or in a cache dir; workman-old's
   layout is a fine base.
5. `c_header_provider.ts` equivalent loads the cache, maps JSON → Workman
   types and nominal foreign types, and registers them in the environment.

## JSON shape

Per-symbol entries in three arrays: `types`, `fns`, `values` (workman-old's
shape, kept). The v1 upgrades:

### structs (the workman-old stub)

```json
{
  "kind": "struct",
  "name": "Vector3",
  "size": 12,
  "align": 4,
  "fields": [
    { "name": "x", "type": { "kind": "float", "bits": 32 }, "offset": 0 },
    { "name": "y", "type": { "kind": "float", "bits": 32 }, "offset": 4 },
    { "name": "z", "type": { "kind": "float", "bits": 32 }, "offset": 8 }
  ],
  "opaque": false
}
```

- `size`/`align`: `@sizeOf` / `@alignOf` on the cimport type.
- `offset`: `@offsetOf(c.T, "field")` per field — Zig's C layout is the
  authoritative layout; padding is never computed in TS.
- Field arrays (`[N]T` or `[N;M]T`) keep their element type and N so codecs can
  read/write fixed sub-ranges.
- `opaque: true` structs carry only `size`/`align` (if known) and are usable
  only behind pointers.

### enums

```json
{
  "kind": "enum",
  "name": "MOUSE_BUTTON",
  "tags": [{ "name": "MOUSE_BUTTON_LEFT", "value": 0 }],
  "backing": { "kind": "int", "bits": 32, "signed": false }
}
```

Values included (workman-old emitted names only) so Workman constants can be
generated and enums stay distinct types rather than raw ints.

### values (constants)

```json
{
  "name": "RED",
  "type": { "kind": "struct", "name": "Color", "size": 4, "align": 1 },
  "value": { "r": 255, "g": 0, "b": 0, "a": 255 }
}
```

- Scalars carry the literal (`"value": 42`, `"value": 3.14`).
- Struct constants (raylib color macros like `RED`, `LIGHTGRAY` — which are
  `#define` compound literals, not extern symbols) carry the field-value map;
  the type descriptor carries the layout. Workman codegen materializes them
  through the same struct codec as `Vector3.new` — there is no dlopen lookup,
  because there is no symbol.
- Enum-constant-style values link to their nominal enum type where the
  extractor can see the connection; otherwise they are plain ints of the
  backing type.
- Values whose initializer translate-c cannot represent (complex macro
  expressions) are simply absent from `@cImport` output → diagnostic case 1
  ("symbol not declared by header") at Workman level, which is honest: the
  header does not expose a symbol there, it exposes a macro.

### pointers / optionality

Pointer descriptors keep `child` + `const`/`volatile`. **Nullability is not
extracted** — C has no nullability in its type system and translate-c surfaces
no `_Nullable` — but no extraction is needed: the Workman mapping makes every
C pointer `Option<Ptr<T>>` uniformly, matching the backend's
`Deno.PointerValue = null | PointerObject` runtime shape (type-mapping.md).

## Environment knobs (workman-old parity)

- `WM_ZIG_PATH` — Zig executable; otherwise `zig` is resolved from PATH.
- `WM_C_HEADER_TARGET` — explicit target triple (default `<host-arch>-linux-gnu`
  on Linux, otherwise `native`). The explicit Linux target uses Zig's bundled
  libc rather than host CRT files. The Zig backend executes the reflected program,
  so the selected target must run on the host for the Zig backend. The bundled
  Aro backend reads target layouts without executing a target reflection program.
- `WM_C_HEADER_INCLUDE_DIRS` — `;`-separated.
- `WM_C_HEADER_DEFINES` — `;`-separated.
- `WM_C_CACHE_DIR` — reflection cache directory (default `.wm_cache/c_headers`).
- Dropped from v1: `WM_C_HEADER_USE_WINSDK` (Windows-only plumbing).

## Diagnostics

C header reflection automatically uses the bundled Aro binary on Linux, macOS and
Windows for x64/ARM64. The JSR toolchain and universal VSIX carry compressed binary
assets, loaded only on first reflection and unpacked with resource headers and
licenses into a checksummed cache. No Zig executable is invoked on this path.
System C headers/SDKs are still needed for included platform headers. Linux x64
has end-to-end runtime verification; other platforms are cross-built.

See [bundled extractor details and beta limits](../../tooling/c-header-extractor/README.md).
`WM_C_HEADER_EXTRACTOR` selects an explicit replacement. `WM_C_EXTRACTOR_CACHE_DIR`
changes the native cache location. `WM_C_HEADER_BACKEND=zig` opts into the previous
Zig 0.16.x backend, also used for unsupported host platforms. That backend embeds
the template, translates C through Aro, and compiles a Zig reflection program.
The bundled backend emits the same JSON directly from Aro's AST and target layouts.

The executable version is checked once per path per compiler process. Missing
or incompatible Zig produces an actionable C-header diagnostic. Reflection cache
keys include the version and, for native extraction, the host target so layouts
are not reused across Zig releases or host platforms.

- Zig compile failure → surface the stderr with the generated extractor file
  path (workman-old's `zig_diagnostics.ts` is the reference for source-map
  mapping; port what applies).
- Symbol not found in header → "symbol X not declared by header Y" — distinct
  from "found but unmappable" (rule 12 in `../ffi-principles.md`, adapted).
