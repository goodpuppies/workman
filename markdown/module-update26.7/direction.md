# Direction

## Thesis

Workman's module system should be:

> Standard ML semantics for declarations, environments, namespaces, inference, and identity, plus a
> small ESM-derived protocol for resolving and evaluating file-backed compilation units.

This avoids two category errors:

1. treating SML/NJ CM or MLton MLB behavior as though it were part of Standard ML;
2. treating ESM's JavaScript runtime semantics as though they should replace ML environments.

The Revised Definition explicitly leaves file inclusion and its effect on the basis to
implementations. Workman should use that freedom to define a portable file protocol, not to create
parallel structure or type semantics.

At project scale, the result is a DAG of sequential SML elaborations. The detailed comparison with
`use`, MLB, and SML/NJ CM is in [`sml-relative-comparison.md`](./sml-relative-comparison.md).

## Ownership boundary

### Revised SML owns

- declaration elaboration;
- lexical scope and sequential environments;
- value, type, constructor, and structure namespaces in the supported subset;
- generalization and instantiation;
- datatype and constructor identity;
- structure environments and environment composition;
- static and dynamic behavior of every accepted shared form.

Unsupported SML syntax is a restriction. It is not permission to redefine the remaining fragment.

### Workman's file protocol owns

- which import declarations contribute graph edges;
- specifier resolution;
- canonical compilation-unit identity;
- graph roots;
- cycle policy;
- dependency loading and initialization order;
- initialization multiplicity;
- derivation of a file's public environment;
- how imported aliases connect to exported declarations;
- future package/import-map and integrity policy.

These questions have no single answer in the Revised Definition.

### Explicit Workman extensions own

- nominal records;
- pinned patterns;
- JavaScript FFI;
- GPU regions;
- bare-namespace-to-`carrier` expression rewriting;
- any future behavior that cannot be defined by SML translation or an exact operation on SML
  semantic objects.

## What “use the best parts of ESM” means

The phrase is useful for discovery but too vague for a specification. The initial selected
properties are:

- imports are statically discoverable;
- resolution produces a stable module identity;
- all spellings resolving to one identity share one module instance;
- imports denote original exported bindings rather than copied declarations;
- dependencies initialize before an importing module;
- each module initializes at most once;
- resolution/linking is conceptually separate from evaluation.

Workman rejects dependency cycles for the current design. It therefore does not adopt ESM's strongly
connected-component linking, temporal initialization states, or top-level-await machinery.

It should also omit dynamic import, default exports, runtime namespace reflection, side-effect-only
imports as a special form, and host-specific conditional package resolution until a concrete need
justifies each feature.

## File model

A `.wm` source unit contains an SML-defined declaration sequence plus explicit Workman extensions.
After resolution, the unit is assigned one canonical `ModuleId`. Elaborating the unit produces:

- its complete internal static environment;
- its public environment;
- declarations and nominal identities owned by the unit;
- dependency edges and imported binding aliases;
- an initialization body.

The module graph is not an SML structure graph. It is compilation input. The public environment can
be represented using the same semantic objects as an SML structure environment without making the
file a first-class runtime Workman value.

## Public-by-default direction

The current visibility rule is:

> Every module-owned top-level declaration is public.

This matches an un-ascribed SML structure more closely than ESM's explicit `export` markers.
`private` is deferred until a concrete need appears. When introduced, it should be an explicit
restriction of the public environment; automatically making a type abstract would introduce opaque
signature behavior and requires a separate deliberate feature.

## Import timing

Two forms of ordering should remain distinct:

- the compiler discovers all dependency edges before elaborating bodies;
- imported names extend the lexical basis at their declaration positions.

The preferred rule is the current declaration-position behavior: an import extends the working basis
where it occurs, like an ordered SML environment declaration. A preamble should replace this only if
the correctness pass finds a concrete semantic or implementation problem that cannot be solved
cleanly. Marginal implementation simplicity alone is not enough reason to reject existing programs.

Runtime initialization of dependencies happens before evaluation of any declaration in the importer.
Static graph discovery and runtime dependency order therefore remain independent from lexical name
visibility.

## Basis model

“Shared basis” means the common prelude plus ordinary basis/environment operations, not one ambient
project scope populated by every compiled file.

For a module `M`:

```text
Basis0(M) = PreludeBasis
Basis(i + 1) =
  Basis(i) + imported projection   when phrase i is an import
  Basis(i) + elaborated Env        when phrase i is a local declaration
FullBasis(M) = final sequential basis
PublicEnv(M) = top-level declarations introduced by M
```

`ImportedBasis(M)` may still be useful as graph/interface metadata meaning all dependency-owned
fragments selected by `M`; it is not a single environment installed before source elaboration. In
all cases:

- imported semantic objects retain their defining identities;
- imported and prelude bindings are not automatically re-exported;
- a dependency of a dependency is not automatically in scope;
- topological compilation order does not grant visibility.

## File modules are static

A file module should not be a general Workman value. Users should not be able to dynamically select,
spread, reflect on, or pass a file environment as an ordinary record.

Namespace syntax is a static structure qualifier. The retained `carrier` feature is a syntactic
fallback from bare `Module` in expression position to the structural lookup `Module.carrier`; it
does not add a module value. Ordinary value lookup takes precedence.

## Recorded cycle rule

Reject every cycle in the file dependency graph.

Cross-file recursion otherwise requires a real recursive-module design: whole-component inference,
predeclared identities, and initialization rules for values that may not yet exist. It should not
arrive accidentally through permissive graph loading.

The initial rule is:

> Recursive definitions are expressed by language recursion constructs, not recursive file
> dependencies.

## Intended outcome

The finished module pass should leave the LSP with stable, compiler-owned facts:

- canonical module identity;
- public environment;
- declaration and alias identities;
- namespace membership;
- dependency and reverse-dependency edges;
- interface hashes or generations;
- initialization and graph diagnostics.

Only after those facts are correct should the deferred LSP plan build completion, navigation,
references, rename, and incremental invalidation around them.
