# C FFI plan

Reintroducing C support in wm-mini, based on the workman-old implementation
(`research/workman-old/src/foreign_types/`), with a Deno FFI backend. Linux
first. This iteration deliberately avoids the old magic: no `@raw`, no
region-tracked `Ptr<T, s>`, no infection system, no opaque fallbacks.

## Decisions

- **Base**: workman-old only (`c_header_extract.zig`, `c_header_provider.ts`).
  workmangr's foreign_types is not the base.
- **Platform**: Linux-first. Default Linux target `<host-arch>-linux-gnu`. Bundled Aro binaries cover
  Linux/macOS/Windows x64 and ARM64; platform headers/SDKs are still needed. No WinSDK/Windows plumbing in v1 (the env knobs stay extensible).
- **Backend**: Deno FFI only (`Deno.dlopen`). No zig backend, no `zig run -lc`
  runtime like workmangr.
- **Structs in v1**: byte-layout codecs derived from the extractor JSON
  (`size`, `align`, per-field `offset` supplied by Aro target layouts or legacy Zig comptime), marshaled
  with byte_type-style `DataView` codecs (same approach as
  `raylib_ts_bindings_deno/utils.ts`).
- **No magic**: `Ptr<T>` is a plain type; unsafe ops live in a small std unsafe
  module. Annotations are checks, C declarations are trusted boundary
  declarations. Same rules as `../ffi-principles.md` adapted to C.
- **Syntax note**: examples write `Option<Ptr<T>>` because that is today's
  spelling. The planned language-wide convenience shorthand `?T` (= `Option<T>`)
  will replace it once it lands — docs are not committing to the long form,
  only to the type.
- **No zig shim in v1**: symbols must exist in a dlopen-able `.so`. A generated
  `zig cc -shared` thunk builder is a tracked non-goal, entered later only if a
  static/header-only lib actually needs it.

## Plan documents

1. [Surface syntax](./surface-syntax.md) — `c.header` / `c.lib` import forms.
2. [Reflection extractor](./reflection-extractor.md) — bundled Aro tool and legacy embedded Zig program,
   JSON shape (with struct offsets), caching, env knobs.
3. [Opaque foreign types](./opaque-types.md) — nominal opacity, `Ptr<Opaque>` policy,
   why not `Js.Value`-style universals.
4. [Type mapping](./type-mapping.md) — Zig JSON → Workman types → Deno FFI
   descriptors; struct codecs; pointers; enums; failure policy.
5. [Low-level programming](./low-level-programming.md) — codegen absorbs Deno FFI
   plumbing; std/unsafe + std/cstring own explicit discipline; lifetimes stay manual.
6. [Struct codecs](./struct-codecs.md) — byte_type_C embedded in the compiler;
   generated codec composition, no handwritten codecs; offset validation gate.
7. [Pipeline integration](./pipeline-integration.md) — compiler slots,
   delayed resolution, codegen, diagnostics.
8. [Namespace, records, by-value](./namespace-records.md) — `import unsafe * as Raylib`,
   C structs as Workman records (literal inference), Deno struct-by-value ABI.

## Acceptance milestone

`examples/raylib`-style program: `c.header("raylib.h", lib: "raylib")`,
open/close a window end-to-end through `Deno.dlopen`, plus a `libc` example
(`printf`). Both typecheck and run.
