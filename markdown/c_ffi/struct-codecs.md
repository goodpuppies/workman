# C FFI: struct codecs via byte_type

No handwritten codecs. `byte_type_C` is embedded in the compiler and the
codegen emits a *composition* of its codec objects; nested structs compose
recursively. Workman-side inference never sees bytes — it sees nominal types;
the byte layer is entirely in emitted code.

## Embedding

- `byte_type_C` (local `/home/ellie/git/byte_type_C`) is added as a compiler
  dependency (deno.json import path; vendored if the dependency must be
  self-contained). The compiler imports it directly — it is a build-time
  library of the codegen, not a runtime dependency of emitted programs beyond
  the composed codec objects it produces.
- Emitted modules import only the composed codec objects, expressed as a
  small generated module (see below), so a program does not import byte_type
  unless the generator chooses to emit `import`-based composition. v1 emits
  self-contained generated codec modules (byte_type objects constructed
  inline in the emitted file via an import of the library) — one import line
  per module, no vendored copies per program.

## Composition, not codegen-by-template

For each extracted struct, codegen emits a codec *expression* — an object
graph — not imperative read/write code:

```ts
// Generated for Vector3 (extractor: size 12, align 4, offsets 0/4/8)
const Vector3 = createSizedStruct({ x: f32, y: f32, z: f32 });

// Generated for Buffer (nested origin composes the existing Vector3 codec)
const Buffer = createSizedStruct({
  name: Array(u8, 8),
  counts: Array(u16, 4),
  origin: Vector3,
});
```

Named refs in the extractor JSON (`cimport.struct_Vector3` inside
`Buffer.origin`) resolve to previously composed codecs for the same header —
every struct's codec is emitted once, referenced elsewhere. Field access
through nested codecs is byte_type's job: `p.x` on a `Ptr<Buffer>` becomes
`Buffer.read(...).origin.x`-shaped generated code — or, for v1 simplicity, a
generated `getFieldAt(offset, childCodec)` primitive keyed by the flattened
offset (`getFieldOffsets()` already computes nested paths).

## Offsets: extractor vs byte_type

`SizedStruct` computes field offsets itself (`calculateFieldOffsets` —
standard C alignment math) and does not currently accept external offsets.
Two candidates:

1. **Trust byte_type's math, validate against the extractor.** Codegen
   compares `calculateFieldOffsets(...)` output with the extractor's
   per-field `offset` values and emits a diagnostic on mismatch. Zero library
   changes; the extractor remains the authority as a *check*.
2. **Extend byte_type with an explicit-offset constructor** (e.g.
   `createSizedStructWithOffsets(input, offsets)`) so C layout is fed in
   directly.

v1 uses (1): standard C structs will agree (the stdio probe and the synthetic
header already agree: Buffer name@0, counts@8, origin@16, size 28). If real
worlds diverge — packed structs (`__attribute__((packed))`, bitfields) —
mismatch diagnostics fire and (2) is implemented then, as a byte_type
feature, not as compiler magic. Bitfields are v1-nonrepresentable (the
extractor sees them as odd-sized ints; the mapping diagnoses them).

## What the codec layer provides to emitted code

- `read`/`write` full structs (with byte_type's alignment/`rangeCheck`
  behavior on unsized views).
- `writePartial` — single-field mutation without touching neighbors; the
  basis of `setField` in `std/unsafe.wm` and generated struct setters.
- `getFieldOffsets()` — flattened nested paths, basis of generated field
  accessors.
- Allocation: `size`/`align` from the extractor (or the codec's own, once
  validated equal) → `ArrayBuffer` + `DataView` for `Vector3.new`-style
  value construction.

## Enums, unions

- Enums (named): no byte codec needed beyond the backing int — constants are
  plain Workman values; `toInt` maps via the backing descriptor.
- Enum-typedef-as-int-alias (translate-c's anonymous-enum shape): the alias
  maps to the backing int type; imported tag constants are values of the
  named type with `toInt` semantics, same surface outcome.
- Unions: byte_type has a union codec, but v1 keeps unions pointer-accessed
  erased buffers (`type-mapping.md`); byte_type's union support is noted as
  the natural v2 upgrade if union field access is demanded.

## Alignment note

byte_type aligns reads/writes on `DataView` (`alignOffset`), which matches
`getBiggestAlignment` — same model as C struct alignment. Extracted `align`
values are the validation gate for this too.
