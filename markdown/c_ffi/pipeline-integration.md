# C FFI: pipeline integration

The JS FFI already built every compiler slot C needs (see
`../js-ffi-architecture.md`, `../dynamic-ffi-type-solving.md`). C FFI is a new
reflection source + target kind feeding the same machinery, not a parallel
pipeline.

## Surface → AST

- New target node family beside `JsTarget` in `src/ast.ts`:
  `CHeader(header, lib?)` / `CLib(name)` with the existing `JsImportClause`
  machinery (spec aliases, `type`, `unsafe`) reused as-is.
- Grammar: extend the `js.global`/`js.module` alternatives in
  `src/grammar.peggy` with `c.header(...)` / `c.lib(...)` — one new token pair,
  same clause parser.

## Inference pipeline (`src/staged_analysis.ts`)

New phase beside the existing ones, before partial HM:

- `prepareCReflection` (new, in `src/ffi/c/`): scans C imports across the
  module graph, runs/binds the extractor (async, cache-aware), returns
  `CReflection { types, fns, values }` per header — the C analog of
  `prepareInitialJsImportReflection`.
- Seeding (extend `src/ffi/elab.ts`): `type`-only C imports create nominal
  foreign types exactly like `js.global import type` (via
  `generatedTypeAliases`-style generated decls); value imports seed
  `FfiBinding`s whose `type` comes from the C mapping instead of TS reflection.
  Reuse `FfiBinding`/`FfiVariant` from `src/ffi/shared.ts` — a C fn is just a
  monomorphic binding with no callback params and no overload selection, so it
  skips most of the delayed machinery by construction.
- Delayed resolution (`src/ffi/delayed/`): C bindings resolve eagerly at seed
  time (extractor output is concrete, no overloads, no receivers). The delayed
  passes should simply not need to engage; if a C decl slips through
  unresolved, that's a bug, not a feature.

## Codegen

- New emitter alongside `src/core/emit_js_import.ts` (e.g.
  `src/core/emit_c_import.ts`):
  - One `Deno.dlopen(libPath, symbols)` registration per (lib, module) —
    symbol table built from resolved bindings: `Deno.Type` descriptors from
    type-mapping.
  - Generated wrapper consts: unsafe C fns become direct symbol calls; struct
    codecs are emitted as byte_type-style `DataView` read/write helpers keyed
    by the extracted layout (offsets baked into the generated code, no runtime
    reflection).
  - Enum constants emitted as plain Workman values of the nominal type.
- Cross-module: the same generated-import dedupe/pruning story as JS imports
  (`delayed.ts` handles this for JS; C repeats the pattern).

## Diagnostics

Follow `../ffi-principles.md` rule 12, adapted to C — three cases, always
distinguished:

1. Symbol not declared by the header (extractor output says so).
2. Symbol exists but its C type is not representable in v1 (fn pointers,
   unsupported variadics, exotic unions) — diagnostic includes the reflected
   C type text (`@typeName` output is already in the JSON).
3. Representable but the Workman-side pipeline dropped it — implementation
   bug; diagnostic says so.

Plus: `zig run` extractor failures (stderr surfaced, generated file path
given), and `Deno.dlopen` load failures at runtime (panic with lib path and
symbol table size, same channel as failed JS reflection).

## Implementation language

The compiler's frontend is bootstrapped: wmslang slices (`tooling/wmslang/*.wm`)
compile to `wmslang.generated.mjs` and are imported in-process by the TS
compiler. So a `.wm` implementation of a C FFI piece is feasible in principle
(no subprocess, no file hop) — the split is by coupling, not by language:

- **TS (HM-coupled, stays TS):** `prepareCReflection` seeding, `FfiBinding`
  construction, delayed resolution, `emit_c_import.ts`. Their output is
  `Type`/`TypeScheme`/`Env.TypeInfo` and generated decls — structures a
  `.wm` slice would have to reach across the module boundary to construct.
  Same reason the JS FFI's TS reflection is TS.
- **Could be `.wm` (pure data; deferred):** JSON cache → mapped-type-description, and
  layout materialization (JSON → concrete offsets). Total functions over
  plain data; movable into a `slice_cffi.wm` wholesale if the wmslang
  frontend ever needs C FFI.

v1 keeps all of it TS: the data layer currently has exactly one consumer (the
TS HM path), so a `.wm` slice would be an abstraction with one client. The
insurance is that the layer is data-driven — JSON in, plain descriptor out —
so the descriptor boundary is already the seam if it ever moves.

## Caching

Extracted JSON caches in workman-old's style, keyed by
`(header, target, includes, defines, extractor hash)`. No incremental
invalidation subtleties in v1: any key change = re-extract.

## Milestone order

1. Extractor port + struct-offset JSON; verify `raylib.h` layout output
   against known layouts (Vector3 = 12 bytes, f32×3, align 4).
2. `c.lib` manual imports end-to-end: `printf("hello\n")` through dlopen.
3. `c.header` reflected imports: same printf via `stdio.h` (exercises the
   full reflection path on a header that's dlopen-backed by libc).
4. Struct codecs + `Vector3.new` / field access.
5. raylib window open/close acceptance program.
