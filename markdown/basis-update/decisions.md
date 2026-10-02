# Decisions

## BD1. Four layers

**Status:** decided

The basis is organized as the layers in [`../basis-design.md`](../basis-design.md): the Definition's
initial basis (layer 0), an SML Basis Library subset (layer 1), Workman std (layer 2), and host
layers (layer 3). Only layer 0 is known to the compiler.

## BD2. Layer 1 follows the Basis Library spec

**Status:** decided. Supersedes the `module-update26.7/sml-basis.md` non-goal about structure names.

Layer-1 structures use the Basis spec's names, signatures and semantics, with systematic
differences: exception-raising functions return `Result` (BD4), `int` in a signature becomes
`Number` (`core-design.md`, Numbers), and mutable structures are omitted.
The reason is the planned MLton backend: a faithful layer 1 maps onto MLton's own Basis. The spec
lives in `research/sml-basis-spec/Basis/`.

## BD3. The default basis API may change, but existing names stay

**Status:** decided. Supersedes `module-update26.7` D18.

D18 froze the source-visible basis API so that the semantic migration could proceed separately
from library design. That migration is complete. This update may change the API where the layering
requires it, such as moving host bindings behind explicit imports. Each change is recorded in
`plan.md`, and examples and tests are migrated in the same step.

Existing Workman names are **not** renamed to their Basis spellings for now (BD9).

## BD4. Raised Basis exceptions become `Result`

**Status:** decided

`Result` is exceptions made explicit ([`../core-design.md`](../core-design.md)). A Basis function
that raises an expected-outcome exception returns `Result<T, Basis.Error>`. `Overflow`, `Div`, and
`Size` panic. The table is in [`../basis-design.md`](../basis-design.md#basis-exceptions).
`Subscript` and the granularity of the error type remain open there.

## BD5. `basis/` and `std/` at the repository root

**Status:** decided

Layer 1 goes in `basis/` and layer 2 in `std/`, both at the repository root. Host-layer bindings
will go under `host/` (for example `host/js/`) when they move out of the compiler. Primitive
implementations sit next to the modules that bind them (for example `basis/js/` for layer 1's
JavaScript primitives).

## BD6. Library modules are discovered, not listed

**Status:** decided

The asset generator and loader discover `.wm` files by walking the library directories. Load order
is derived from each module's imports, with ties broken by path so the order is deterministic. A
module's namespace alias comes from its snake_case file name, so `std/list.wm` defines `List` and
`basis/word8_vector.wm` defines `Word8Vector`. Snake_case file names avoid case-only renames, which
are unreliable on case-insensitive filesystems, and keep existing paths such as `std/result.wm`
valid. Adding a module never requires editing a TypeScript list.

## BD7. Primitives are bound through unsafe manual imports

**Status:** decided

A primitive is a function in a real JavaScript file, bound into a library module with the existing
`from js.module("./….js") import unsafe { name: Type }` form. `unsafe` imports are direct calls, so
this adds no overhead. The library module then applies the Workman rules on top, such as BD4's
`Result` wrapping. JavaScript implementations move out of the string literals in
`src/core/emit_prelude.ts`.

Exceptions to this rule:

- **Layer 0** (operators, equality, `print`, primitive types) stays compiler-owned.
- **Intrinsics with compiler lowering**, the `Gpu.*` catalog in particular, stay compiler-known
  because lowering refers to them by semantic ID. They move to a target manifest rather than
  becoming ordinary imports.

## BD8. Host-owned types are manual `import type` declarations

**Status:** decided; exact syntax settled in stage C

Primitives return values whose representation belongs to the host, such as `Word8Vector.Vector` and
`Task`. A library module declares such a nominal type with the FFI's existing type-only import,
extended with a manual form:

```wm
from js.module("./word8.js") import type { word };
from js.module("./task.js") import type { task<a, e> };
```

Type-only imports already exist for both FFIs (`from js.global import type { Request }`,
`from c.header("raylib.h") import type { Vector3 }`) and already elaborate to a nominal
`ForeignTypeDecl` whose representation belongs to the host. The basis reuses that mechanism instead
of adding a separate type clause, so the basis is not a special case and users get manual type
imports for their own shims.

The extension mirrors value imports, which come as a reflected form `{ f }` and a manual form
`{ f: T }`:

- **reflected** `import type { Request }`: TypeScript or the C extractor supplies the declaration,
  as today;
- **manual** `import type { task<a, e> }`: the Workman source states the declaration, for a plain
  `.js` file with no TypeScript types. It is a trusted boundary declaration in the sense of FFI
  principle 9, and keeps TypeScript reflection off the startup path, since the basis loads in every
  process.

Rules:

- **Arity** is stated in the manual form. `ForeignTypeDecl` gains type parameters.
- **Identity** is keyed by specifier and name, as reflected foreign types already are keyed by their
  foreign declaration. Two library modules importing `word` from the same file get the same type.
- **No `unsafe`.** A type-only import does not cross the boundary at runtime; the C FFI already
  treats type imports this way.
- **Equality stays compiler-owned.** Which host-owned types admit equality, and how their runtime
  equality works, remains a table in the compiler, as `BASIS_TYPES` records it today, together with
  the runtime equality in the prelude. The alternative, declaring equality and naming an equality
  primitive in source as LunarML does with `_equality`, was judged too complex for the benefit.
  Declared types that are not in the table do not admit equality.
- No overloading-class table is needed: Workman has no numeric overloading (`core-design.md`,
  Numbers), so the Definition's Appendix E hook goes unused.

This is not a representation-hiding feature for ordinary code, so it does not bring back
signatures or opaque ascription (see `core-design.md`). The C FFI's
[`../c_ffi/opaque-types.md`](../c_ffi/opaque-types.md) argues for nominal host-owned types on the C
side as well.

## BD9. Keep existing Workman names

**Status:** decided for now; may be reconsidered

Where a Basis structure overlaps an existing Workman name (`Option.andThen` versus `mapPartial`,
`Word8Vector.get` versus `sub`, `Text.of` versus the Basis `Text` structure), the Workman name stays
and the Basis spelling is not added next to it. New functions with no Workman equivalent use Basis
names. This limits BD2's fidelity to the parts that don't overlap; the MLton mapping needs a
generated rename table for the rest. See [`../basis-design.md`](../basis-design.md#names-for-now).

## BD10. Defer the Basis IO structures

**Status:** decided for now

`TextIO`, `BinIO`, `IO` and the primitive and stream IO layers are not part of this update.
Workman's current `Task`-shaped IO (`Bytes.readFile` and friends) and synchronous `print` stay as
they are. The question of synchronous Basis IO versus `Task`-shaped IO is revisited together with
the MLton backend, where `Task` itself still needs a meaning. See
[`../basis-design.md`](../basis-design.md#io-for-now).

## BD11. Basis type names are capitalized

**Status:** decided (2026-10-01). An exception to BD9 for type names.

Workman type names are capitalized at every level: `Binary.Error`, `Map.Map`. A bare lowercase name
in a type is a type variable, and the grammar accepts only capitalized parts in a qualified type
name. The SML spellings `Word8.word` and `Word8Vector.vector` therefore can't be written in Workman
source, not even in an annotation, and a library module can't name them in its primitive imports.

Layer-1 types take the capitalized spelling of the spec name instead:

| SML Basis | Workman |
|---|---|
| `Word8.word` … `Word64.word` | `Word8.Word` … `Word64.Word` |
| `Word8Vector.vector` | `Word8Vector.Vector` |
| `Word8VectorSlice.slice` | `Word8VectorSlice.Slice` |
| `Float32.real`, `Float64.real` | `Float32.Real`, `Float64.Real` |

New layer-1 types follow the same rule (`Vector.Vector<T>`, `String.String` if it is ever needed as a
structure type). Value names keep the spec's spelling, so `Word8VectorSlice.slice` remains the
function that makes a `Word8VectorSlice.Slice`. The MLton mapping adds type names to the rename
table that BD9 already needs.

The alternative, a grammar change allowing a lowercase final part (`Word8Vector.vector`), would
have kept the SML spelling at the cost of a second naming style for types.

## BD12. `Result` and `Task` types stay in layer 0

**Status:** decided (2026-10-01). Replaces plan items D1 and the type half of D2.

The compiler's FFI elaboration produces `Result` and `Task` values: safe imports wrap results in
`Result`, and asynchronous JS becomes `Task`. About seventy places in the FFI refer to the two types
by name. A type the language's own elaboration refers to belongs in the initial basis, as SML's
`bool` and `list` do, because derived forms produce them.

So `Result`, `Ok`, `Err` and `Task` stay compiler-owned (layer 0). Their operations don't: they are
ordinary library code in `std/result.wm` and `std/task.wm`, the second over promise primitives in
`std/js/task.js`. Moving the types into `.wm` would have required the compiler to depend on a
library declaration, and type parameters on manual type imports (C1) before any of it.

## BD13. One module per namespace; Workman std names take precedence

**Status:** decided (2026-10-01).

Where a Basis structure has the same name as a Workman std module (`Option`, `List`), there is one
module, not a layer-1 and a layer-2 module both defining the namespace. The Basis functions with no
existing Workman name go into the existing `std/` module, and overlapping operations keep the
Workman name (BD9). Structures with no std counterpart (`ListPair`, `Vector`) live in `basis/`.

The same precedence settles `Text`: `Text.of` stays, and the Basis `Text` structure is not added.
`Text.of` itself stays compiler-owned, next to `print`, because it is the compiler's value printer
and a library JS file can't reach it.

## BD14. `Subscript` returns `Result`

**Status:** decided (2026-10-01). Resolves the `basis-design.md` open decision.

Every Basis function that raises `Subscript` returns `Result<T, Basis.Error>` with
`Err(Basis.Subscript)`, including `Vector.sub`, `Vector.update`, and `VectorSlice.slice` and
`subslice` with an out-of-range start or length. There is no separate checked `get`.

The byte structures follow the same rule: `Word8Vector.sub` and `update`, `Word8VectorSlice.sub`,
`slice` and `subslice`, and every `Pack*.subVec` and `subSlice` return `Result`. The non-spec
`Word8Vector.get` and `Word8VectorSlice.get` were removed, since `sub` now does the same job. This
was a deliberate breaking change.

## BD15. Data-first argument order

**Status:** decided (2026-10-01). A third systematic difference from the spec, next to BD4 and
`int` → `Number`.

Basis functions take their data structure first, in one tuple, as the existing Workman modules do:
`Vector.map(vector, f)` for the spec's curried `map f vec`, and `ListPair.foldl(left, right, init, f)`
for `foldl f init (l1, l2)`. This keeps pipes working (`vector :> Vector.map(f)`) and keeps one
convention per module. Callback argument order follows the spec, so `ListPair.foldl`'s callback takes
`(a, b, accumulator)`. On MLton it is a mechanical wrapper like the other two differences.

The shared `Basis.Error` (`basis/basis.wm`) is in use as the proposed default. It gained
`UnequalLengths` for `ListPair`.

## BD16. One `Order` type

**Status:** decided (2026-10-01).

The Basis `order` type is `General.Order` with constructors `Less | Equal | Greater`
(`basis/general.wm`). `std/map.wm` dropped its own identical `Ordering` and uses `General.Order`, so
one concept has one name (principle 2). This is a breaking change for code matching on `Map.Less`.

The constructors stay qualified (`General.Less`) for now. The Basis opens `order` at top level, but
which names Workman opens unqualified is still the open "top-level unqualified values" question in
`basis-design.md`.

## BD17. The JS host layer: compiler-owned FFI vocabulary, imported helpers

**Status:** decided (2026-10-02). Replaces the "layer 3 always requires an explicit import" rule in
`basis-design.md`.

Layer 3 splits in two:

- **FFI vocabulary stays in layer 0 for the default profile.** `Js.Value`, `Js.Object`, `Js.Array`,
  `Js.ArrayLike`, `Js.Dict`, `Js.Table`, `Js.Error`/`Js.Unknown`, `Js.Array.toList`/`fromList`
  and `Json.assert` stay compiler-owned and always in scope when targeting JavaScript. The compiler
  itself writes these names into the types of JS imports (`Task<T, Js.Error>`, `Js.Array<T>`), and
  `Json.assert` is a typing intrinsic, so an import for them would be ceremony. The conversions
  stay with `Js.Array` because they depend on its runtime tag. The kernel profile (wmslang) gets
  none of them.
- **Host helpers are library modules behind `js.host`.** `Dict`, `Table`, `Bytes` and `Debug` are
  `.wm` modules in `host/js/` over JavaScript files in `host/js/js/`, like layer 1 and 2. They are
  never auto-opened. A program imports one by name:

  ```workman
  from js.host("table") import * as Table;
  from js.host("dict") import { get, set };
  ```

  `js.host("name")` is an ordinary module import of `host/js/name.wm`: the module is a real graph
  edge, so its values and constructors get ordinary binding identities. Library modules reach host
  modules with a relative import instead.

Portability is enforced inside the library, where it matters: a `basis/` module may name `Js.*`
only in the signatures of its primitive imports, never in its function bodies.
