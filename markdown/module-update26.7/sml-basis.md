# The SML basis model for Workman

## Purpose

Workman may have a much smaller standard library than Standard ML without inventing a different kind
of basis.

The size of the library and the semantics of the basis are independent questions. The Revised
Definition deliberately reduced its own initial basis to a minimal execution substrate and moved the
richer library into the separately specified Standard ML Basis Library. That is strong precedent for
Workman to keep a small library while using the SML model accurately.

This document distinguishes four ideas that the current implementation partly combines:

1. the **initial basis** required to elaborate and evaluate the language;
2. the **standard-library basis** produced by adding ordinary library structures;
3. the **pervasive environment** containing explicitly selected unqualified bindings;
4. a module's **working basis**, extended sequentially by imports and declarations.

“Basis” in this document means the semantic environment used by elaboration or evaluation. It is not
a synonym for “all functions in the standard library,” a JavaScript prelude object, or a privileged
kind of import.

## Sources and authority

The primary language sources are:

- [The Definition of Standard ML (Revised)](../../research/The-Definition-of-Standard-ML-Revised/),
  especially Chapters 4, 5, and 8 and Appendices C and D;
- the [Standard ML Basis Library](https://smlfamily.github.io/Basis/) and its
  [overview](https://smlfamily.github.io/Basis/overview.html);
- the Basis Library's
  [top-level environment](https://smlfamily.github.io/Basis/top-level-chapter.html).

Millet is implementation evidence, not language authority. Its separation between a minimal basis
and a full source-built basis is nevertheless a useful implementation model:

- [`crates/sml-statics/src/basis.rs`](../../../millet/crates/sml-statics/src/basis.rs);
- [`crates/mlb-statics/src/std_basis.rs`](../../../millet/crates/mlb-statics/src/std_basis.rs).

When Workman accepts an SML construct, the Revised Definition owns its meaning. The Standard ML
Basis Library is precedent for organizing library facilities and pervasive aliases. Workman does not
claim conformance to that library merely by adopting its architecture.

## What the Revised Definition actually provides

### A basis is a structured environment

For the module language, the Revised Definition uses a static basis containing type-name, functor,
signature, and core-environment information. The core environment is:

```text
Env = StrEnv x TyEnv x ValEnv
StrEnv = StrId -> Env
```

The corresponding dynamic basis carries the environments needed during evaluation. Workman does not
implement signatures or functors, so those components may be absent. It still needs the components
used by its accepted fragment:

```text
WorkmanStaticBasis  = TyNameSet x Env_static
WorkmanDynamicBasis = Env_dynamic
```

The exact representation may differ, but it must preserve the Definition's separate structure, type,
and value namespaces and its nominal type identities.

### The initial basis is intentionally small

Appendix C defines an initial static basis `B0`. Its structure, signature, and functor portions are
empty. Its type and value environments contain only the primitive material needed by the language:
primitive type names, datatype constructors such as `true`, `false`, `nil`, `::`, and `ref`,
selected exceptions, and primitive operations.

Appendix D defines the corresponding initial dynamic basis. Static types and identifier statuses
therefore have runtime values with the same intended meaning. The appendices also record facts that
are easy to lose in a hand-built prelude:

- type-constructor arity;
- equality admissibility;
- nominal type identity;
- the constructor environment associated with a datatype;
- the value-environment entry and identifier status of each constructor;
- overloaded classes and defaulting where the language supports them.

The Definition explicitly describes this basis as a bare minimum and leaves a richer environment to
libraries. A small initial basis is therefore more SML-like, not less, provided its construction and
extension obey the same rules.

### Elaboration and evaluation extend corresponding bases

A successful top-level declaration produces a basis fragment. Sequential processing extends the
current static and dynamic bases using ordinary right-biased environment modification. A later
binding shadows an earlier binding in the same namespace.

The Definition presents static and dynamic semantics separately, but an implementation need not
store two unrelated tables. It does need a checked correspondence:

- every runtime-visible initial value has the static information needed to use it;
- every statically available primitive value has a runtime implementation;
- constructors agree across type metadata, value lookup, pattern matching, and runtime tags;
- nominal identities agree wherever a semantic identity is shared.

Special implementation IDs may support this correspondence. They must not become a second source of
language semantics.

### Initial bindings obey ordinary binding rules

Initial bindings are not unshadowable merely because they came from the basis. The Definition's
overloading rules are particularly clear: an initially overloaded identifier may be rebound, after
which occurrences in that scope refer to the new non-overloaded binding.

Workman may restrict which symbolic identifiers users can declare. It must choose one coherent rule:

- if an operator is a value identifier in the SML sense, ordinary rebinding and shadowing apply; or
- if it is fixed compiler syntax, it is a documented syntactic restriction and should not masquerade
  as an unshadowable ordinary `ValEnv` binding.

Provenance flags such as `basis` or `standardLibrary` cannot decide collision semantics.

## What the Standard ML Basis Library adds

The Standard ML Basis Library is larger than the Definition's initial basis and is specified
separately. It organizes operations into structures and selects a relatively small pervasive
top-level environment.

For example, an implementation may provide both `List.length` and the pervasive `length`. These are
not two independently inferred functions that happen to behave alike. The unqualified binding is an
explicit projection or alias of the structure member. Likewise, a library can make a structure
available initially without flattening its members into dotted value names.

The relevant architectural lessons for Workman are:

- library operations normally belong to structures;
- only deliberately selected bindings are pervasive;
- the pervasive environment is explicit rather than every structure member being implicitly open;
- the set of structures installed initially is an implementation/library choice;
- library size does not alter environment composition, identity, shadowing, or qualification;
- claiming Standard ML Basis Library compliance would require its specified interface, but Workman
  need not make that claim.

Workman can therefore expose `List`, `Option`, `Result`, `Task`, `Js`, and `Gpu` as its own selected
structures while using the SML environment model. Workman-specific structures remain extensions;
putting them in a `StrEnv` does not mislabel them as Standard ML facilities.

## Millet's implementation pattern

Millet makes the semantic split visible in code.

Its minimal basis constructs only facts that cannot be recovered by elaborating ordinary SML source:
primitive type names and identities, constructor statuses, equality properties, overload classes,
and primitive value schemes. Its full standard basis then:

1. starts from that minimal basis;
2. parses and lowers bundled SML library sources;
3. elaborates them with the ordinary static semantics;
4. appends the resulting basis fragments using normal basis composition.

Analysis chooses a minimal or full basis, but does not switch to another namespace or collision
calculus. This is the important model for Workman. It does not require copying Millet's API surface,
MLB conventions, or complete SML library.

## Proposed Workman basis architecture

### Composition

Use the following conceptual construction:

```text
KernelBasis
  = minimal static/dynamic facts that cannot be defined as ordinary Workman

LibraryBasis
  = elaborate selected standard Workman modules against KernelBasis

PervasiveEnv
  = explicit projections of selected KernelBasis or LibraryBasis bindings

DefaultBasis
  = KernelBasis + LibraryBasis + PervasiveEnv

WorkingBasis(M)
  = selected initial-basis profile, then M's imports and declarations in source order
```

`+` denotes the appropriate SML basis/environment modification, not JavaScript object merging.

`KernelBasis` and `DefaultBasis` are useful specification names even if the implementation stores
them in one immutable artifact. They identify which facts are irreducible compiler/runtime facts and
which are ordinary elaborated library facts.

### Initial-basis profiles

Workman already has a `prelude` selection. Its semantics should become explicit:

- a **kernel** profile contains the mandatory minimal basis required for the language to make sense;
- a **default** profile adds the selected standard structures and pervasive bindings.

If source syntax continues to call the first profile `prelude none`, “none” means no optional
standard prelude. It cannot literally mean an empty basis: numeric and string literals, primitive
types, primitive runtime operations, and other accepted syntax still require static and dynamic
meaning.

The exact contents of each profile are an interface to specify and test. They must not be inferred
from whichever names `baseEnv`, the emitter prelude, and standard-library injection happen to
contain.

### Ownership of definitions

Every initial facility belongs to one of these categories:

| Category                    | Definition mechanism                          | Examples                                                              |
| --------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Primitive semantic fact     | Kernel basis manifest                         | primitive type identity, equality property, constructor status        |
| Primitive runtime operation | Kernel static/dynamic entry                   | arithmetic or host operation that Workman source cannot define        |
| Ordinary library code       | Elaborated `.wm` module installed in `StrEnv` | list traversal, option helpers, monadic combinators                   |
| Pervasive alias             | Explicit projection table                     | an intentionally unqualified alias of a structure member              |
| Compiler syntax             | Language rule, not a fake library binding     | a fixed operator or literal form, if Workman chooses that restriction |

Prefer ordinary Workman source whenever it can express the definition without changing its
semantics. Keep only irreducible facts in the kernel manifest.

### Structures, extensions, and intrinsics

Standard modules are structure bindings, not dotted entries in a flat value or type map:

```text
StrEnv("List")   = Env_list
StrEnv("Result") = Env_result
StrEnv("Task")   = Env_task
```

Qualification performs `StrEnv` lookup followed by member lookup. A backend may later emit
`Result.map` as a JavaScript property access, but the dotted spelling does not define its static
meaning.

Workman extensions such as `Js` and `Gpu` should use the same structure semantics. If a member needs
special lowering, its resolved semantic object may carry an intrinsic tag. The tag selects compiler
behavior after resolution; it does not replace the structure/member binding or create a parallel
namespace.

### Standard-library initialization

Elaborated standard Workman modules participate in one compiler-owned initial-basis build. Their
runtime components are initialized once, before the user module graph that uses the selected
profile. Their order and failure behavior must be deterministic.

This does not make them privileged imports in source semantics. It is the implementation process
that constructs the initial dynamic basis corresponding to the initial static basis. If standard
library initialization is allowed to perform visible effects, that policy must be specified rather
than inherited accidentally from bundling order.

## Required coherence invariants

The implementation should make the following mechanically checkable.

### Static/dynamic correspondence

1. Every value visible in an initial static `ValEnv` has a dynamic implementation or a documented
   compile-time-only role.
2. Every language-visible dynamic primitive has a static entry.
3. Static and dynamic entries agree on semantic identity, constructor status, and structure path.
4. A selected basis profile builds both halves from the same versioned description.

### Type and constructor coherence

1. Every primitive type records arity, equality behavior, and nominal identity.
2. A datatype's constructor environment and its constructor `ValEnv` entries refer to the same
   constructors.
3. Pattern elaboration, expression elaboration, exhaustiveness analysis, and emission consume those
   shared facts.
4. Shadowing a type binding does not delete an independently present value/constructor binding.

### Structure and alias coherence

1. Standard structures are entries in `StrEnv`.
2. A pervasive alias denotes the same semantic target as the selected structure member; it is not
   re-elaborated, re-generalized, or assigned a fresh nominal identity.
3. Structure membership does not depend on splitting dotted strings.
4. A Workman-specific intrinsic tag does not change SML lookup, shadowing, or qualification.

### Composition coherence

1. Kernel, library, pervasive, imported, and local bindings all use ordinary namespace-specific
   environment modification.
2. Provenance is diagnostic/tooling metadata only.
3. A later legal binding shadows an earlier binding in its namespace.
4. Choosing a smaller profile removes optional bindings; it does not select different semantics for
   bindings that remain.

## Audit of the current Workman implementation

The current implementation contains useful pieces of the proposed design, especially that several
standard modules are written in Workman. It does not yet have one coherent initial basis.

### B1. The basis has several independent sources of truth

Static names and types are assembled in [`src/types_basis.ts`](../../src/types_basis.ts). Nominal
basis types are also described in [`src/basis.ts`](../../src/basis.ts), while lowering has another
basis-ID table in [`src/compiler_semantics.ts`](../../src/compiler_semantics.ts). Runtime values and
constructor representations are handwritten separately in
[`src/core/emit_prelude.ts`](../../src/core/emit_prelude.ts).

**Required fix:** define one basis description or a set of generated/validated artifacts with
explicit static/dynamic correspondence. Backend IDs may be derived from it but are not the
definition of identity.

### B2. Standard structures are represented as dotted values and types

`baseEnv` and standard-library injection install names such as `Task.map` and `Gpu.color` in flat
maps. This duplicates the structure system with a string convention.

**Required fix:** install standard modules in the same explicit `StrEnv` required by the module
update. Qualified basis lookup must be indistinguishable from qualified imported-structure lookup.

### B3. Provenance flags affect binding semantics

Inference distinguishes `basis`, `imported`, and `standardLibrary` bindings when deciding whether a
new binding is accepted. This makes the origin of a name part of the collision calculus.

**Required fix:** use SML environment modification and the same-namespace binding rules. Preserve
provenance only for diagnostics, navigation, documentation, and implementation selection.

### B4. Type and constructor namespaces are coupled by deletion

Import handling can call `removeBasisConstructors` when a type is shadowed. In SML, the datatype
constructor information stored with a type binding does not mean that replacing the type binding
retroactively removes independent entries from the value environment.

**Required fix:** compose `TyEnv` and `ValEnv` separately. Preserve constructor status on projected
or imported value bindings.

### B5. Static and runtime preludes can drift

The emitter prelude, inference basis, semantic-ID tables, and ADT metadata are manually
synchronized. There is no complete check that a selected profile exposes the same structures,
members, schemes, statuses, and identities at compile time and runtime.

**Required fix:** validate every profile against the coherence invariants above and generate
mechanical portions where practical.

### B6. `Result` and `Task` use hybrid object merging

Parts of `Result` and `Task` are handwritten runtime basis objects while other parts are compiled
from standard `.wm` modules. Runtime bundling merges these objects specially. Static construction
has a corresponding but separate combination path.

**Required fix:** give each member one owner. Primitive members may originate in the kernel
structure; ordinary source-defined members extend that structure using an explicit basis-building
step. Do not make JavaScript object merging the semantic definition.

### B7. Prelude profiles are implicit

`prelude none` changes whether algebraic and compiled-library material is included, but primitive
types, values, and operators still remain. The exact boundary is distributed across conditionals.

**Required fix:** specify named profile contents and test their static and dynamic interfaces. Treat
the existing spelling as surface compatibility, not proof that the basis is empty.

### B8. Operator status is ambiguous

Operators are installed as standard-library values, yet their parser and inference treatment is more
privileged than ordinary identifiers. The current representation does not clearly choose between
SML-like operator value bindings and fixed Workman syntax.

**Required fix:** decide the language rule, then reflect it honestly in the basis. Do not use a
`standardLibrary` flag to obtain an accidental third option.

### B9. Overload and equality facts need one representation

Primitive schemes alone are not enough to specify SML-style overloaded classes, defaulting, or
equality admissibility. Workman may support a smaller set, but each accepted behavior needs explicit
semantic metadata rather than special cases scattered through inference.

**Required fix:** inventory the accepted Workman subset and put irreducible type-classification
facts in the kernel basis description.

## Implementation plan additions

The module correctness pass should now include:

1. specify the exact `kernel` and `default` static and dynamic interfaces;
2. introduce a compiler-owned `InitialBasis`/`BasisProfile` artifact;
3. introduce structural `StrEnv` before migrating standard modules;
4. consolidate primitive type, constructor, equality, overload, and intrinsic metadata;
5. build source-expressible standard modules through the ordinary Workman front end;
6. install their inferred public environments as structure bindings;
7. define an explicit pervasive-projection table;
8. remove provenance-based collision behavior and basis-constructor deletion;
9. replace `Result`/`Task` runtime object merging with explicit structure construction;
10. add static/dynamic profile conformance tests;
11. expose the final initial-basis facts to the eventual LSP rather than making it recreate them.

The LSP update remains deferred until these facts are compiler-owned. Completion, hover, navigation,
and diagnostics need to see the same structure membership, schemes, statuses, aliases, and
provenance that elaboration uses.

## Non-goals

This pass does not require:

- implementing the full Standard ML Basis Library;
- using the same standard structure names or function inventory as Standard ML;
- adding signatures, functors, or a user-extensible overloading mechanism;
- adopting Millet's MLB file protocol;
- exposing compiler internals merely because a primitive is recorded in the kernel manifest;
- deciding every future `Js` or `Gpu` API.

It requires the smaller Workman basis to be constructed and extended with the same semantic
discipline.

## Recorded decisions and required inventory

The blocking choices raised by this research are resolved in
[`decisions.md`](./decisions.md#d18-preserve-the-default-basis-api-during-the-semantic-migration):

- preserve the current default source API during the semantic migration;
- treat fixed Workman operators as syntax rather than `ValEnv` bindings;
- preserve only an explicit compatibility set of pervasive bindings;
- require compiled standard-basis construction to be observationally effect-free;
- resolve intrinsic tags only after ordinary semantic binding resolution.

The exact current API is intentionally not written from memory into the language specification.
Stage 0 of [`checklist.md`](./checklist.md) requires a mechanically checked inventory before any
entry moves. That inventory applies the decided ownership categories; it does not reopen their
semantics.
