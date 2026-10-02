# Basis and standard library design

## Purpose

Workman's basis and standard library are currently a mix of mechanisms: compiler-owned types in
`src/basis_manifest.ts`, values defined in TypeScript in `src/types_basis.ts`, a JavaScript
runtime prelude in `src/core/emit_prelude.ts`, and `.wm` modules under `std/` auto-imported from a
hard-coded list in `src/standard_library.ts`. Host types (`Js.*`, `Gpu.*`) sit in the same
inventory as `Number` and `Bool`.

This document sets out how the basis should be layered, what each layer contains, and the order of
migration. It follows [`core-principles.md`](./core-principles.md) and
[`core-design.md`](./core-design.md). In short: Workman is an SML subset, so its basis should be
SML's basis, with Workman's own library built on top and host bindings kept separate.

## Sources

- **The Definition, Appendices C and D** (`research/The-Definition-of-Standard-ML-Revised/app3.tex`,
  `app4.tex`): the initial static and dynamic basis. This is layer 0.
- **The SML Basis Library specification** (`research/sml-basis-spec/Basis/`, a clone of
  `SMLFamily/smlfamily.github.io`). `overview.html` lists the required signatures and structures;
  `top-level-chapter.html` defines the top-level environment and overloading. This is the checklist
  for layer 1.
- **Basis Library proposals** (`research/BasisLibrary/`, a clone of `SMLFamily/BasisLibrary`):
  post-2004 amendments and their reference code. Consulted only when a proposal fills a real gap.
- [`low-level-numerics-bytes.md`](./low-level-numerics-bytes.md): the existing design and first
  implementation of words, byte vectors, slices and packing. It already follows this document's
  direction.

## The layers

| Layer | Contents | Defined in | Portable |
|---|---|---|---|
| **0. Initial basis** | Primitive types, constructors, equality, operators, top-level values | Compiler, plus a small primitive kernel per target | Yes |
| **1. SML Basis subset** | Basis Library structures: `Option`, `List`, `Word8Vector`, `PackWord32Little`, … | `.wm` over layer 0, plus per-target primitives | Yes |
| **2. Workman std** | What the Basis lacks: `Result`, `Task`, carriers, `Map`, `Traverse`, `Binary`, bootstrap helpers | Pure `.wm` over layer 1 | Automatically |
| **3. Host layers** | `Js.*`, `Json`, `Gpu.*` and C imports (compiler-owned); `host/js/` helper modules behind `js.host` | Target-specific | No |

### Layer 0: the initial basis

Appendices C and D of the Definition, minus Workman's deliberate omissions (`core-design.md`):

- types: `bool`, `real` (spelled `Number`), `char`, `string`, `list`, `unit` (spelled `Void`).
  `int` and `word` are not in layer 0: `Number` is the only core numeric type, and word types are
  layer-1 structures (`core-design.md`, Numbers);
- constructors: `true`, `false`, `nil`, `::` (Workman spelling `[]` and `[x, ..xs]`);
- polymorphic equality `==` / `!=`, the arithmetic and comparison operators on `Number` (not
  overloaded), and the
  top-level values the Basis places in scope (`top-level-chapter.html`);
- **omitted:** `ref` and `:=`/`!` (no mutation), and `exn` with `Match`/`Bind` (no exceptions).
  Match failure is a `Panic`.

Layer 0 is the only part of the basis the compiler knows about specially. It should be small enough
to read in one sitting.

### Layer 1: the SML Basis subset

Structures from the Basis Library, **with the Basis names and semantics**. That fidelity is what
makes the future MLton backend cheap: a faithful layer 1 maps onto MLton's own Basis, with at most
a mechanical wrapper, so only the JavaScript implementation has to be written and maintained. Every
other deviation from the spec is a place where native compilation has to translate instead of map.

Rules:

- **Names and signatures follow the spec, apart from two systematic differences and existing
  Workman names.** Where Workman already has a name for an operation, that name stays for now
  (see [Names](#names-for-now)). Otherwise the spec's name is used. Functions that are not in the
  spec do not go into a Basis structure.
  The spec itself says compliant implementations may not extend these interfaces. Workman additions
  go to layer 2. The systematic differences are the next two rules, plus data-first argument order
  ([BD15](basis-update/decisions.md#bd15-data-first-argument-order)). Both are mechanical, so on
  MLton they are generated wrappers rather than redesigns.
- **`int` becomes `Number`.** Workman has no `int` (`core-design.md`, Numbers), so every `int` in a
  spec signature is `Number`: `String.size : String -> Number`, `Word8.toInt` becomes
  `Word8.toNumber`. Arguments that must be integers are checked at runtime and fail with the
  exception the spec gives for a bad argument, usually `Subscript`, `Size` or `Domain`. On MLton the
  wrapper converts with `Real.fromInt` and a checked `Real.toInt`.
- **Raising functions return `Result`.** `Result` is exceptions made explicit (`core-design.md`).
  A Basis function that raises an expected-outcome exception has the result type
  `Result<T, Basis.Error>` in Workman, where the spec gives `T`. Each spec page documents what its
  functions raise, so the Workman signatures can be derived from the spec. On MLton the wrapper is
  `fn x => Ok (f x) handle E => Err E`. See [Basis exceptions](#basis-exceptions) for the error
  type and for which exceptions panic instead.
- **Mutable structures are omitted** (`Array`, `ArraySlice`, `CharArray*`, `Word8Array*`),
  following the `ref` decision. Whether mutable buffers exist at all is decided at the target
  boundary, not in layer 1 (see open decisions).
- **Implementations are ordinary `.wm` modules.** Where a structure needs something the language
  cannot express, the module imports a per-target primitive through the existing trusted-boundary
  declaration (a manually typed import, `ffi-principles.md` §9) rather than through a separate
  compiler registry.

### Layer 2: Workman std

What Workman adds that the Basis does not have: the carrier library, `Result`, `Task`, persistent
maps, traversal, checked binary decoding, and value rendering.

Rules:

- **It is written in pure `.wm` over layers 0 and 1.** Nothing in layer 2 touches a host directly.
  That makes all of it portable for free.
- **It does not duplicate layer 1** (principle 2). An operation has one name across std and
  layer 1, never both a Workman and a Basis spelling. For now the existing Workman name wins where
  they overlap (see [Names](#names-for-now)). The carrier protocol (`succeed`, `map`, `andThen`) is the
  exception: it is a uniform interface over several types, not a duplicate of one operation.
- **Bootstrap helpers are portable where possible.** A TypeScript-familiar layer (`split`,
  `replaceAll`, `startsWith`, common list and string helpers) makes porting TS code easier without
  rewriting everything against the literal Basis. Helpers implemented in `.wm` over layer 1 (for
  example `split` over `String.fields`) belong here and keep working on MLton. Helpers that must
  wrap JavaScript belong in layer 3, so porting code later shows exactly what needs replacing.

### Layer 3: host layers

Bindings that belong to one target by nature: `Js.Value`, `Js.Object`, `Js.Array`, `Json.assert`,
`Dict`, `Table`, `Debug.errorMessage`, the `Gpu.*` types and intrinsics, and C imports. Their rules
are in `ffi-principles.md` and the wmslang and C FFI documents.

For JavaScript the layer splits in two (BD17). The FFI vocabulary (`Js.*` types, `Js.Array`
conversions, `Json.assert`) is compiler-owned and in scope whenever the target is JavaScript, since
the compiler writes those names into the types of JS imports. Helper modules (`Dict`, `Table`,
`Bytes`, `Debug`) live in `host/js/` and are imported explicitly with `from js.host("table")`.

## Basis exceptions

The Basis raises a fixed, documented set of exceptions, which are split in two. Expected outcomes
become the error case of a `Result`. Violated invariants, the conditions Rust also treats as bugs,
panic.

| Exception | Raised by, for example | Workman |
|---|---|---|
| `Empty` | `List.hd`, `List.tl`, `List.last` on `[]` | `Result` |
| `Subscript` | `List.nth`, `Vector.sub`, `String.sub`, slice constructors | `Result` (open decision below) |
| `Chr` | `Char.chr`, `Char.succ`/`pred` out of range | `Result` |
| `Domain` | `Math` functions outside their domain, `Real.toInt` on NaN | `Result` |
| `Option` | `Option.valOf` on `NONE` | `Result` |
| `Fail` | Library-specific failures | `Result` |
| `IO.Io`, `OS.SysErr` | IO and OS operations | `Result`. Basis IO is deferred; current IO returns `Task` |
| `Overflow` | Conversions that cannot represent the result, such as `Word64.toNumber` above 2^53; `IntN` arithmetic if added | `Panic` |
| `Div` | Word division and modulo by zero, `Number.div`/`Number.mod` by zero | `Panic` |
| `Size` | Creating a vector or string longer than the implementation allows | `Panic` |

`Number` arithmetic itself follows IEEE doubles and raises nothing: `1 / 0` is infinity. The
panicking cases are in the exact numeric structures, where a `Result` from every word operation
would be unusable. `Match` and `Bind` from layer 0 also panic.

The error type is one closed datatype, sketched as:

```wm
type Error =
  | Empty
  | Subscript
  | Chr
  | Domain
  | Option
  | Fail<String>
  | Io<IoError>
  | SysErr<String>;
```

One shared type keeps signatures simple and makes errors from different structures compose in a
single carrier pipeline without conversion. A narrower type per function (only `Empty` for
`List.hd`) would be more precise, but would need a conversion at every point where two structures
meet. Which to choose is left open; the shared type is the proposed default.

Where the Basis already offers a total alternative, such as `List.getItem` or
`Real.fromString : string -> real option`, it keeps its spec type: it does not raise, so no `Result`
is added.

## Loading and scope

- **Only layer 0 is special.** Layers 1 and 2 are ordinary Workman modules, loaded and elaborated
  through the same module path as user code, and cached like any other module. There is no
  special std path, so bugs like `issues/FIXED-std-namespace-adt-constructors-unusable.md` go away as a
  class.
- **Top-level scope follows the Basis top-level chapter.** Basis structures are available as
  namespaces without an import. Only the values the Basis opens at top level are unqualified
  (`print`, `map`, `hd`, `not`, …), plus Workman's pervasive constructors (`Some`, `None`, `Ok`,
  `Err`). The exact list is an open decision.
- **Layer 2 structures are available as namespaces** in the same way. Layer 3 helper modules require
  an explicit `js.host` import; the JS FFI vocabulary does not (BD17).
- **The `kernel` and `default` basis profiles are replaced by the layers.** The kernel profile
  becomes "layer 0 only", which remains useful for tests and for wmslang.

## Required Basis structures

Every structure the spec requires (`overview.html`) and its intended Workman status. *Adopt* means
fully, as specified. *Subset* means specified behavior for the parts Workman implements. *Omit*
means left out by a core design decision.

| Structure | Status | Notes |
|---|---|---|
| `General` | Subset | No exceptions, no `ref`, `!`, `:=`. Keep `o`, `before`, `ignore`, `order` |
| `Bool` | Adopt | |
| `Option` | Adopt | Existing Workman names stay (see [Names](#names-for-now)) |
| `List`, `ListPair` | Adopt | Raising functions return `Result` |
| `Vector`, `VectorSlice` | Adopt | Immutable |
| `Word8Vector`, `Word8VectorSlice` | Adopt | Started. Existing names such as `get` stay for now |
| `Byte` | Adopt | Started |
| `Word`, `Word8`, `LargeWord` | Adopt | `Word8` started. `Word16/32/64` are optional Basis `WordN`: keep. `int` in signatures becomes `Number` |
| `Int`, `LargeInt`, `Position` | Omit | No `int` in the core. Optional `Int32`, `Int64` and `IntInf` only when a need appears |
| `Real`, `LargeReal`, `Math` | Adopt | `Real.real` is `Number`, and `LargeReal` is the same structure. Workman's `Number` std module adds `div` and `mod` |
| `IEEEReal` | Subset, later | |
| `Char`, `String`, `Substring`, `StringCvt`, `CharVector`, `CharVectorSlice` | Subset | Needs `char`. String operations currently come from JS FFI |
| `Text` | Adopt | A bundle of the text structures. Name clashes with Workman's `Text.of` |
| `Array`, `ArraySlice`, `CharArray`, `CharArraySlice`, `Word8Array`, `Word8ArraySlice` | Omit | No mutation in the core |
| `TextIO`, `BinIO`, `IO`, `TextPrimIO`, `BinPrimIO` | Deferred | See [IO](#io-for-now) |
| `OS`, `CommandLine`, `Date`, `Time`, `Timer` | Subset, later | `CommandLine` is small and useful early |

Optional structures (`Posix`, `Unix`, `Socket`, `IntInf`, `Array2`, …) stay out unless a concrete
need appears. `WordN`, `PackWordN*` and `PackRealN*` are already used by the bytes work and stay.

## Inventory of the current basis

Where each current item lives today and where it should end up.

| Current item | Defined in | Target | Action |
|---|---|---|---|
| `Number`, `Bool`, `String`, `Void` | manifest | 0 | `Number` is SML's `real` |
| Operators `+ - * / % ++ < <= > >= == != && \|\|` | manifest, prelude | 0 | Stay. `%`/`++` are Workman spellings of `mod`/`^`; `&&`/`\|\|` are `andalso`/`orelse` |
| `print` | manifest, pervasive | 0 | Top-level value, as in the Basis |
| `List` type, `Nil`/`Cons` | manifest | 0 | Primitive in the Definition |
| `Option` type, `Some`/`None` | manifest | 1 | Belongs to Basis `Option`. Stays pervasive |
| `Result` type, `Ok`/`Err` | manifest | 2 | Not in the Basis. Move the declaration into `std/result.wm` |
| `Task` type and 12 values | manifest, `types_basis.ts`, prelude | 2 | Move into `std/task.wm` over a small per-target primitive |
| `Text.of` | manifest, prelude | 2 | Needs a runtime primitive. Resolve the `Text` name clash |
| `Word8`/`16`/`32`/`64` | manifest, `types_basis.ts` | 1 | Declare in `.wm` over word primitives. Check names against `WORD` |
| `Word8Vector`, `Word8VectorSlice` | manifest, `types_basis.ts` | 1 | Same. `get`, `toList`, `unfoldN` are not Basis |
| `PackWordN*`, `PackRealN*`, `Byte` | `types_basis.ts` | 1 | Same |
| `Float32.Real`, `Float64.Real` | manifest | 1 | Align with the optional `Real32`/`Real64`. `Real64.real` is `Number` |
| `Bytes.readFile/readSlice/writeFile` | `host/js/bytes.wm` | 3 | Done (F3): `js.host("bytes")`. Stays `Task`-shaped while Basis IO is deferred |
| `Js.Value/Object/Array/ArrayLike/Dict/Table/Error`, `Js.Array.toList/fromList`, `Json.assert` | manifest | 3 | Stays compiler-owned, default profile only (BD17) |
| `Dict.*`, `Table.*` | `host/js/dict.wm`, `table.wm` | 3 | Done (F3): `js.host("dict")`, `js.host("table")` |
| `Debug.errorMessage` | `host/js/debug.wm` | 3 | Done (F3): `js.host("debug")` |
| `Gpu.*` types and intrinsics | manifest, `types_basis.ts` | 3 | wmslang target layer |
| `std/list.wm`, `std/option.wm` | std | 1 + 2 | Basis functions to layer 1; genuine Workman additions to layer 2 or removed |
| `std/result.wm`, `task.wm`, `monad.wm`, `traverse.wm`, `map.wm`, `binary.wm` | std | 2 | Load through the ordinary module path |

## Migration order

1. **Load std through the ordinary module path.** This doesn't depend on any open decision and
   fixes the std constructor bug. After this step, a std module is indistinguishable from a user
   module apart from being available without an import.
2. **Split the manifest.** Layer 0 stays in the compiler. `Js.*` and `Gpu.*` move to their target
   layers. The profiles become layers.
3. **Move `Result` and `Task` out of TypeScript** into `std/result.wm` and `std/task.wm`, with
   `Task`'s scheduling as a per-target primitive.
4. **Build layer 1 one structure at a time**, starting with the ones already begun (`Word8`,
   `Word8Vector`, `Byte`, `PackWord*`), keeping their existing names. Then `Option`,
   `List`, `ListPair`, `Vector`, then text once `char` exists.
5. **Realign layer 2** so it no longer duplicates layer 1.
6. **Add the bootstrap helpers**, portable `.wm` first and JS-backed only where needed.

Each layer-1 structure lands with conformance tests written from its spec page. Later, the planned
`wm → SML` emitter (`core-design.md`) can run the same programs against MLton's Basis as a
cross-check.

## Decided for now

### IO for now

The SML Basis IO structures (`TextIO`, `BinIO`, `IO` and the primitive and stream layers) are
deferred. Workman's current IO stays as it is: `Task`-shaped operations such as `Bytes.readFile`,
plus the synchronous `print`.

The underlying question is still open and should be revisited together with the MLton backend.
SML's IO is synchronous (`TextIO.inputLine` blocks) while Workman's is `Task`-shaped, and `Task`
itself has no MLton meaning yet. The options when it's revisited:

- adopt Basis IO faithfully. This works on Deno, which has synchronous filesystem calls, and on
  MLton, but not in a browser;
- keep IO `Task`-shaped in layer 2 and leave the Basis IO structures out;
- both, which conflicts with principle 2.

### Names for now

Existing Workman names are kept. Where a Basis structure overlaps something Workman already has,
the Workman name stays and the Basis spelling is not added next to it, so there is still one name
per operation (principle 2). Examples: `Option.andThen` rather than `Option.mapPartial`,
`Option.withDefault` rather than `Option.getOpt`, `List.at` rather than `nth`, and
`Text.of` stays while the Basis `Text` structure is not added. Functions with no existing Workman
equivalent use their Basis names.

Type names are the exception that goes the other way: Workman type names are capitalized, so
layer-1 types are `Word8.Word` and `Word8Vector.Vector` rather than the spec's `Word8.word` and
`Word8Vector.vector` ([BD11](basis-update/decisions.md#bd11-basis-type-names-are-capitalized)).

Consequences:

- Layer 1 is spec-faithful except where it overlaps existing Workman names. On MLton those overlaps
  need a rename table in addition to the two systematic wrappers. The table is mechanical and can
  be generated.
- Breaking renames toward the Basis spelling may be reconsidered later. If they happen, they are a
  deliberate, recorded migration of examples, docs and tests, not a side effect of this update.

## Open decisions

- ~~**`Subscript`: `Result` or `Panic`.**~~ Decided: `Result`
  ([BD14](basis-update/decisions.md#bd14-subscript-returns-result)).
- **Error type granularity.** One shared `Basis.Error` (proposed default, now in use in
  `basis/basis.wm`) or a narrower error type per function or structure.
- **Mutable buffers.** `low-level-numerics-bytes.md` plans `Word8Array` and native output buffers,
  which layer 1 omits. If they are needed, for C and GPU interop, they belong in a target layer
  with explicit operations, not in the portable core.
- **Top-level unqualified values.** The exact list, starting from the Basis top-level chapter.
- **Optional Basis structures.** Which of `IntN`, `RealN` and `WordN` Workman commits to beyond the
  ones the bytes work already uses.
