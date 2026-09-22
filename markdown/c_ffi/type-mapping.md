# C FFI: type mapping

Three layers: extractor JSON → Workman types (inference-side) → Deno FFI
descriptors (code-side). Mapping is total-and-honest: unmappable = diagnostic,
never a silent opaque fallback (`../ffi-principles.md` rules 3, 4, 7).

## Primitives

| JSON                       | Workman | Deno FFI          |
| -------------------------- | ------- | ----------------- |
| bool                       | `Bool`  | `Deno.Type.bool`  |
| void                       | `Void`  | — (result only)   |
| int (8/16/32/64, signed)   | `I8`…`I64` | `Deno.Type.i8`… |
| int (unsigned)             | `U8`…`U64`, `Usize` | `Deno.Type.u8`… |
| float (32/64)              | `F32` / `F64` | `Deno.Type.f32`/`f64` |

Zig's `c_int`/`c_uint`/`c_long` come through as their concrete `int{bits}`
forms per target — correct on Linux by construction of the extractor target.

## Pointers

- `*T` → `Option<Ptr<T>>`, **uniformly**. The backend's pointer value is
  literally `Deno.PointerValue<T> = null | PointerObject<T>` — nullable at
  runtime regardless of what the C type says — so the Workman type tells the
  truth about its backend: every C pointer is optional. No nullability
  inference is needed or attempted (C's type system has none, translate-c
  surfaces no `_Nullable`): the rule is uniform, which is exactly why it is
  cheap. Unwrapping is the deref gate; a generated wrapper maps `None` to a
  null pointer for the C call, so passing NULL is expressible and honest.
  This restores workman-old's `Optional<...>` shape with the fix that
  matters: the inner type is the real nominal `T`, never an opaque `Null`.
  `Ptr<T>` alone (non-optional) is reserved for values the program has
  already unwrapped and verified.
- `anyopaque` / `void*` → `Option<Ptr<Opaque>>` (a C pointer, so Option-wrapped
  like all pointers; the inner type is the only source of `Opaque` — see
  [opaque-types.md](./opaque-types.md)): a raw pointer to unknown stuff; getting
  anything typed back out requires an explicit `unsafe.cast` after the unwrap.
  Widening `Option<Ptr<T>>` → `Option<Ptr<Opaque>>` is implicit and free (the
  width rule lifts through `Option`); see
  [opaque-types.md](./opaque-types.md) "Moving unknown values around".
  Known-name C types (`FILE*`, `sqlite3*`, raylib handles) are **never**
  collapsed into it — they keep their own nominal opaque types.
- `[*c]T`-style C arrays decay to pointers, keeping element type.
- `char*` in string positions → `Ptr<Char>`; string conversion helpers
  (`createCString`/`cstr`-style, transient buffer cache) live in
  `std/cstring.wm`, patterned after `raylib_ts_bindings_deno/utils.ts` rather
  than invented.

## Structs

- Reflected structs become **nominal foreign types** (as JS type-only imports
  do) with extracted layout: `size`, `align`, field offsets/types.
- Usage rules:
  - Pointer-passing (the dominant C pattern): `Vector3*` params/returns work
    with `Option<Ptr<Vector3>>` — pass `None` for NULL, unwrap to hand the
    pointer to the wrapper.
  - Value construction: generated `Vector3.new(x, y, z)` allocates an
    `ArrayBuffer` (byte_type `Struct` codec from the extracted layout) and
    returns `Ptr<Vector3>` (owned buffer; freed via a generated `free` or GC
    via `FinalizationRegistry` — decide at implementation, documented at the
    boundary). Codec generation is byte_type *composition*, not handwritten
    codecs — see [struct-codecs.md](./struct-codecs.md).
  - Field access: `p.x` / generated accessor returning `F32` reads through the
    codec at the extracted offset. Mutation via unsafe set op in
    `std/unsafe.wm` (see below).
  - Struct-by-value params/returns (non-pointer `Vector3`): supported only when
    Deno FFI's struct support covers the shape (aggregate of primitives per
    its ABI table). Everything else: diagnostic, not fallback.
- Value equality/serialization of structs is out of scope; codecs are
  read/write only.

## Enums

Distinct nominal types with generated constants:

```wm
from c.header("raylib.h") import type { MOUSE_BUTTON };
from c.header("raylib.h") import { MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT };
```

`MOUSE_BUTTON_LEFT : MOUSE_BUTTON` (backing int available via an explicit
`toInt` op in `std/unsafe.wm` when a C API wants the raw value). No implicit
`I32` conversions.

## Function pointers, variadics, unions

- Fn-pointer params/returns: **hard error** with a diagnostic naming the C
  type ("not representable in v1"). No `Js.Value`-style escape.
- Variadic C functions (`printf`-style): variadic tail is not reflectable;
  import requires a manual `c.lib` signature (or a fixed-arity manual type on
  the `c.header` import). Diagnostic says exactly that.
- Unions: layout extracted, but v1 exposes them as `Ptr<Opaque>`-accessed
  buffers with unsafe field ops (offset-known, type-erased), or hard error —
  implementation decides once raylib's usage patterns are visible; both are
  honest.

## Constants

Extractor `values` entries (including raylib-style macro colors — see
reflection-extractor.md) become plain Workman values:

```wm
from c.header("raylib.h") import { RED, LIGHTGRAY };
-- RED : Color  (materialized through the Color codec at codegen time)
```

- Struct constants: emitted as a codec call with the extracted field values —
  no runtime lookup (no symbol exists; they are compile-time macros).
- Scalar constants: emitted as literals of the mapped primitive type.
- A declared constant absent from extractor output = macro translate-c cannot
  represent → diagnostic case 1 with a hint ("header defines this as a macro,
  not a symbol").

## `std/unsafe.wm`

The no-magic replacement for workman-old's `std/zig/rawmem.wm` + region
effects. Plain `Ptr<T>` ops, all unsafe, all explicit. The canonical op list
lives in [low-level-programming.md](./low-level-programming.md) (alloc/free,
deref/set, generated per-struct readers over generic field ops, `cast` as the
only door out of `Ptr<Opaque>`, `offset`, enum `toInt`).

No regions, no lifetime inference, no `<Opened>/<Closed>`. Bounds and validity
are the programmer's job at the boundary, same as any C caller.

## Deno FFI descriptor mapping

The codegen layer turns each resolved signature into a `Deno.dlopen` symbol
entry: `Deno.Type.*` for scalars, `Deno.PointerValue<T>` for pointers (the
Workman-side `Ptr<T>` stays nominal — the runtime value is just a pointer),
struct buffers passed as `Deno.PointerValue<T>` (pointer-backed) or
`struct`-typed descriptors for by-value shapes Deno supports.
