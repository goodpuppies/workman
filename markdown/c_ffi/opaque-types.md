# C FFI: opaque foreign types

Design note on what "opaque" means at the C boundary, and why it must not
repeat the JS FFI's `Js.Value`/`Js.Object` situation.

## The JS problem

`Js.Object` and `Js.Value` each try to serve three jobs:

1. genuinely dynamic declarations (`js.meta`-adjacent values, truly untyped JS);
2. recovery types when reflection fails (forbidden by `../ffi-principles.md`
   rule 7, but they still attract that use);
3. "some JS thing" in manual signature authoring.

And their semantics are over-committed: `Js.Object` claims objectness,
`Js.Value` claims any-value-including-primitives. Neither claim is checkable,
neither dispatches usefully without runtime probing, and their existence makes
it tempting to type a failing reflection as one of them instead of reporting
the failure. Two types, three jobs, zero honest guarantees.

## The C-side principle

**Opacity is a property of a nominal type, not a universal type.**

C APIs are typed by name: `sqlite3*`, `FILE*`, `HANDLE`, `ImGuiContext*`. The
extractor already knows whether a struct's layout is visible (`fields` is
empty / `opaque: true`) or not. That knowledge should produce a nominal type
with that exact name, and programs should traffic in `Ptr<sqlite3>` — not
`Ptr<Opaque>` with the identity thrown away.

Concretely, the extractor output yields three shapes:

| Header declares | Workman type | Usable for |
| --------------- | ------------ | ---------- |
| struct with fields | nominal `T` with codec (size/align/offsets) | value + pointer + fields |
| struct without fields (`opaque`) | nominal `T`, opaque, pointer-only | `Ptr<T>` params/returns only |
| `void*` / `anyopaque` | `Ptr<Opaque>` | casting in/out of anything, nothing else |

This is the mlton-shaped answer: the C type system's own opacity discipline
(opaque structs in headers, forward declarations) is preserved as nominal
identity, and nothing pretends to know what it doesn't.

## Rules

1. **One `Opaque`, no family.** `Opaque` exists for exactly two sources:
   `anyopaque` and `void*`. It has no subtypes, no predicates, no "is it an
   object" semantics. It is `Ptr<Opaque>` or nothing — a raw `Opaque` value
   without a pointer is not a thing C APIs give you.
2. **No extraction failure → `Opaque`.** If a symbol's type can't be
   represented, that's diagnostic case 2 of `pipeline-integration.md`
   (reflected C type included in the message). Never silently retyped to
   `Ptr<Opaque>`. (`Type-mapping.md` unions clause: union → pointer-accessed
   erased buffer is a *declared* choice with known offsets, not opaque.)
3. **Opaque nominal types are complete types.** `Option<Ptr<FILE>>` can be
   passed, compared for equality via unsafe ops after the unwrap. What's
   missing (deref, fields) is missing honestly — the header didn't say.
4. **Getting out of `Ptr<Opaque>` costs an explicit cast.** `unsafe.cast` in
   `std/unsafe.wm` is the only door, and it must be written at the call site.
   Same spirit as `Json.assert` on the JS side: an explicit checked
   conversion, not an implicit coercion. (Checked = declares the target type;
   the check is trust-at-boundary like every manual import.)
5. **`char*` is not opaque.** String positions are `Ptr<Char>` with
   `std/cstring.wm` helpers. Retyping C strings as opaque handles is the same
   semantic-overcommit mistake in miniature.
6. **No Workman-side "foreign value" universals.** C has no runtime type tag,
   so there is nothing honest for a `C.Value` analog to claim. If a C API
   hands back `void*` payloads it documents elsewhere, that's `Ptr<Opaque>`
   plus a shim or explicit cast — the shim rule from `../ffi-principles.md`
   rule 6 applies unchanged.

## Moving unknown values around

In the JS FFI, "unknown" is a property of the value (runtime tag), so handing
an unknown value onward means coercing it (`x :> y`-style) into what the
target expects. In C, "unknown" is a property of the static type: unknown
stuff is an address. So there is no coercion operator for it — there is one
width rule:

- **Widening `Ptr<T> → Ptr<Opaque>` is implicit and free.** The program knows
  more than the callee; nothing is destroyed. A `handle : Ptr<T>` flows
  directly into a `void*` parameter, no operator, no annotation.
- **Narrowing `Ptr<Opaque> → Ptr<T>` requires `unsafe.cast`.** The unsound
  direction; the trust claim must be written at the call site.
- **`Ptr<T> → Ptr<U>` for two known distinct types: also `unsafe.cast`.**
  Same door, same noise, one escape hatch total.
- **Non-pointer "unknown" is not opaque.** A `GLuint`, an errno, an
  integer handle — C gave you the type; it is known; it is a number. Opaque
  exists exclusively for addresses C refuses to type.
- **The width rule lifts through `Option`.** `Option<Ptr<T>>` widens to
  `Option<Ptr<Opaque>>` freely (every C pointer is `Option`-wrapped — see
  type-mapping.md); narrowing still requires unwrap + `unsafe.cast`.

Consequence: there is no C-side analog of "carry an unknown value through" —
you carry a `Ptr<Opaque>` only when the C type itself was `void*`, and every
point at which it becomes specific again is a written `unsafe.cast`.

## Ripple effects on the other docs

- `type-mapping.md` unions/fn-pointer rows: unions stay in the "declared
  erased-buffer" category, never `Ptr<Opaque>`.
- `reflection-extractor.md`: opaque structs must still emit `size`/`align`
  when known (pointer param passing and Option-wrapping need nullability, not
  size; size is kept for completeness but nothing in v1 derefs them).
- JS FFI (future work, out of scope here): the same taxonomy suggests JS wants
  nominal foreign types per reflected TS class/interface (it already does this
  via type-only imports) and a *single* genuinely-dynamic type reserved for
  declarations that are dynamic — with failed reflection never allowed to
  manufacture one. That's a note for a future `js-ffi` revision, not this C
  plan.
