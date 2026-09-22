# C FFI: low-level programming

Where the boilerplate goes, and what stays explicit. Two layers; the rule is
**plumbing is generated, discipline is std**.

## Layer 1: absorbed by codegen (invisible)

All Deno-FFI calling-convention plumbing is emitted by `emit_c_import.ts`
(`pipeline-integration.md`). A Workman program never writes:

- `Deno.dlopen` symbol tables — generated from resolved bindings, one per
  (lib, module).
- `Deno.Type` descriptor mapping — the type-mapping layer's code-side output.
- `PointerValue<T>` threading / null marshaling — emitted wrappers handle
  `Ptr<T>` ⇄ `Deno.PointerValue<T>` and `Option<Ptr<T>>` ⇄ null (`None` maps
  to a null pointer argument; pointer returns become `Option` at the
  boundary).
- Library path resolution — standard naming (`lib<name>.so`), plus
  `WM_C_LIB_PATH` (`;`-separated search list) for non-standard installs; the
  resolved path is embedded at codegen time, so runtime failures are load
  failures with a path in the message, not path guessing.
- Struct `DataView` codecs, `BigUint64`/32-bit-JS-number juggling, cstring
  transient-buffer caches — generated codecs (`type-mapping.md`) and
  `std/cstring.wm` internals.

This layer exists because hand-written Deno bindings (see
`raylib_ts_bindings_deno/bindgen.ts`) spend most of their lines here. Codegen
deletes the category.

## Layer 2: std modules (explicit, small)

Real low-level programming is the 20% that stays visible on purpose. Hiding
malloc/free behind compiler magic is the old-magic path
(`../README.md`). The API is small enough to carry in your head:

```wm
-- std/unsafe.wm
alloc     : Usize -> Ptr<Void>          -- malloc-backed
allocOf   : type -> Ptr<t>              -- codec-known types
free      : Ptr<t> -> Void
deref     : Ptr<t> -> t
setDeref  : (Ptr<t>, t) -> Void
getField  : (Ptr<t>, String) -> ?       -- generated per-struct readers are
setField  : (Ptr<t>, String, value) -> Void   -- preferred; these are generic
cast      : Ptr<a> -> Ptr<b>            -- the only door out of Ptr<Opaque>
offset    : (Ptr<t>, Isize) -> Ptr<t>
toInt     : (enum type) -> I64          -- escape hatch for C raw-value APIs

-- std/cstring.wm
cstr      : String -> (Ptr<Char>, transient buffer)
fromCStr  : Ptr<Char> -> String         -- reads to NUL
```

Everything the JS FFI would make you hand-roll stays inside these modules.
Nothing requires a `DataView`/`ArrayBuffer` unless the program asks
(`std/unsafe` may expose a raw-bytes escape; nothing depends on it).

## Deliberately not abstracted

- **Lifetimes.** No GC, no regions, no `<Opened>/<Closed>`. Codec-allocated
  struct buffers may use `FinalizationRegistry` reaping — if so, it is
  *documented at the boundary* (buffers are JS-GC-reaped, C never frees them),
  never silent. malloc/free is the programmer's discipline, same as in C.
- **`Deno.UnsafeCallback` / function-pointer imports.** Hard error in v1
  (`type-mapping.md`). Callback support is a v2 design, not a hole.
- **`nonblocking` calls / threading.** Deno FFI's nonblocking variant is a
  codegen flag, not a Workman concept — if a v2 adds it, it appears as an
  explicit Task-returning import form, never as silent semantic variation.
- **Raw calling convention.** No "call arbitrary pointer with these args"
  primitive. If a C API needs it, that API needs a shim (ffi-principles
  rule 6).

## Design test

Any proposed std/unsafe addition must answer: is this plumbing (belongs in
codegen) or discipline (belongs in std, and must be explicit)? If neither —
if it's convenience that hides a real decision — it does not get added.
