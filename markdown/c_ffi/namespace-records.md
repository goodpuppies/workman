# C FFI: namespace imports, records, and struct-by-value

Plan for supporting the `examples/raylib2.wm` shape:

```wm
from c.header("raylib.h", lib: "raylib") import unsafe * as Raylib;

let center = .{ x = 400.0, y = 225.0 };
Raylib.DrawCircleV center 40.0 Raylib.RED;
```

Three features: namespace imports, C structs as Workman records, and
struct-by-value ABI support.

## Ground truth established (probed, 2026-09-22)

- **Deno 2.9 supports struct-by-value**: parameter descriptor
  `{ struct: ["f32", "f32"] }` is accepted (the plain string `"struct"` is
  not — it must be the newtype-variant object form). Arguments are passed as
  `ArrayBuffer`s (byte_type `write` output), returns come back as buffers
  readable via the codec. Verified against a real `zig cc` fixture:
  `v2dot({x:1,y:2},{x:3,y:4}) → 11`.
- The current extractor already emits per-field offsets; the fixture header
  `examples/c_ffi/fixtures/vec3.{h,c}` contains the by-value test case
  (`v2dot`).

## Feature 1: namespace imports (`import unsafe * as Raylib`)

- **Extractor all-symbols mode**: the templated extractor gets an
  `{{ALL_SYMBOLS}}` flag; when set, it enumerates every declaration of the
  cImport namespace (`@typeInfo(c).@"struct".decls`) instead of a fixed
  symbol list. Raylib exposes ~hundreds of decls; comptime enumeration must
  be verified against comptime blowup (fall back to curated lists if it
  does).
- **Symbol table**: `Deno.dlopen` needs one table; emit *function* symbols
  with descriptors and skip type entries (types become records/codecs, not
  runtime values). Constants materialize eagerly at module init.
- **Namespace object**: emitted as the bound alias — `const Raylib = {
  WindowShouldClose: (...args) => ..., RAYWHITE: <materialized>, ... }`.
- **Typing**: the namespace binds as a Workman **record type** whose fields
  are the members' types (fn types + constant types). `Raylib.X` is plain
  record field access — no JS FFI receiver machinery, consistent with the
  C path's eager resolution. Member count ~200+ fields on one record type;
  verify HM perf, fall back to per-member synthetic value decls (bound via
  a structure binding) if record inference is too slow.
- **Tree-shaping**: only emit dlopen entries for symbols actually referenced
  in the module (post-inference walk), keeping startup cost proportional to
  usage; the *type-level* record exposes everything the header offers.

## Feature 2: C structs as Workman records (not nominal foreign types)

This is the design change that makes `.{ x = 400.0, y = 225.0 }` infer:

- Every extracted struct becomes a generated `RecordDecl` with its numeric
  fields (`Vector2 = { x: Number, y: Number }`, `Color = { r, g, b, a }`).
  Workman record literals then unify against the parameter type by plain HM
  record inference — no annotation, no type import needed for the literal
  case.
- Nested struct fields become nested record field types (`Camera3D.position
  : Vector3`-shaped) as far as extraction depth allows; array fields
  (`char[8]`) are deferred (diagnosed, not represented).
- **Cost**: record types lose nominal identity — `Vector3` and any
  structurally identical type unify. That is the honest trade for literal
  inference and matches how C itself treats same-layout structs. Nominal
  `ForeignTypeDecl` remains the fallback shape behind an explicit
  `import type` (kept for opaque types, which have no fields to unify).
- Enum typedefs stay `Number` + constants (unchanged).

## Feature 3: struct-by-value ABI

- Parameter descriptors: `{ struct: [<denoType>, ...] }` built from the
  extracted layout (field order = C order; widths from the extractor).
- Wrapper converters:
  - **by-value param**: record object → byte_type `write` into an
    `ArrayBuffer` of `size` → pass the buffer (transient keepalive like the
    cstring cache).
  - **by-value return**: buffer back → codec `read` → record object
    (allocation via `getArrayBuffer`).
  - **pointer-to-struct params** stay `Option<Ptr<T>>`/pointer-backed; the
    converter accepts either an already-materialized pointer or a record
    (materialize-on-the-fly), so both calling styles work.
- Constants of struct type materialize as **record objects** (codec read of
  an initialized buffer) — `Raylib.RED : Color` is a plain Workman value,
  usable directly as a by-value argument.
- byte_type gap to check: struct *returns* need `read` over a
  `Deno.UnsafePointerView.getArrayBuffer(size)` DataView — verified pattern;
  if byte_type's `SizedType.read` requires alignment beyond DataView
  guarantees, that is the byte_type extension point (user's note: they would
  eventually rather **vendor byte_type into the compiler tree** than depend
  on an external path; the current `deno.json` file-URL import mapping is
  accepted as the interim state).

## Order of work

1. Extractor `{{ALL_SYMBOLS}}` mode; verify against raylib.h (count, timing).
2. Record conversion in `prepare` (replaces `ForeignTypeDecl` for
   non-opaque structs) + HM verification of literal inference.
3. Emitter: by-value descriptors + converters; constants as records.
4. Namespace emission + record-typed namespace binding.
5. Acceptance: `examples/raylib2.wm` runs (window, clear background, circle).
   Note `DrawCircleV(center, 40.0, RED)` needs by-value Vector2 + Color —
   exactly features 2+3.
