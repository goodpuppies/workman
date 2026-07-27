# SML semantics and the Millet mapping

The applicability of Millet is unusually direct because Workman is not merely ML-shaped. As
documented in [`../../docs/smlparallels.md`](../../docs/smlparallels.md), Workman implements an SML
subset and follows the Revised Definition's static and dynamic semantics where the languages
overlap.

This document identifies which Millet concepts should transfer directly, which need adaptation, and
which remain Workman-owned.

The governing standard is the
[`SML compatibility contract`](../module-update26.7/sml-compatibility-contract.md): the shared
fragment is semantically equivalent to its SML translation, not merely similar to SML. Workman's
smaller feature set is normally a grammar or admissibility restriction. Features without an exact
SML account are explicit extensions.

## Shared semantic core

### Lexical environments and Hindley-Milner schemes

Both languages have:

- lexical value binding;
- polymorphic type schemes;
- generalization and instantiation;
- recursive and mutually recursive binding groups;
- nested expression scopes;
- expression and pattern type constraints.

Consequences for the analysis boundary:

- completion should query the lexical environment at a position;
- hover should distinguish a declaration's general scheme from a use-site instantiation;
- symbol identity must not be name-only;
- recursive groups must expose the correct visibility point;
- all type-bearing features should use one scheme/type rendering service.

### Patterns and binders

Both languages use patterns for:

- value declarations;
- function parameters;
- tuple and datatype destructuring;
- match arms;
- recursive function clauses in desugared form.

Millet's syntax-to-HIR and HIR-to-syntax mapping is therefore directly relevant. A language service
needs to answer both:

- which semantic binder does this concrete token introduce or reference?
- where should a fact attached to a lowered pattern or expression be displayed?

Workman's pinned match identifiers are a deliberate difference. A bare name in a match arm may
reference an existing value rather than bind a new one, while `Var(x)` creates a fresh binder. The
semantic index must consume the compiler's resolved pattern facts; it must not infer binding
behavior from capitalization or token shape.

### Datatypes, constructors, and type aliases

Workman preserves SML's important distinctions:

- datatype declarations introduce nominal types and value constructors;
- constructor payloads are one logical argument, often tuple-shaped;
- type aliases do not introduce fresh identity;
- mutually recursive datatype groups share type scope.

This supports Millet-like separate namespaces and queries:

- go to definition of a constructor;
- go to definition of a type;
- go to type definition from a value;
- constructor and type completion with distinct item kinds;
- document and workspace symbols;
- datatype-aware hover and future case-completion actions.

The analysis service should represent alias identity and nominal datatype identity explicitly.
Textual type names are insufficient.

### Application, tuple arguments, and currying

Workman preserves the SML distinction between:

- one tuple-shaped argument;
- a chain of curried arguments;
- a function returning another function.

This matters to:

- signature help;
- parameter hints;
- completion ranking by expected argument/result type;
- call hierarchy and hover formatting;
- pipe expressions, which are another spelling of application.

Features must use elaborated application shape rather than counting commas or parentheses in source
text.

### File modules as a Workman packaging rule

The SML Definition does not say that a physical file is a structure. It defines structures as
environments and leaves file inclusion and its effect on the basis to implementations. Millet
accordingly treats an SML source file as top-level declarations elaborated under an incoming basis;
it does not create an implicit structure from every filename.

Workman makes a different, narrower choice: each canonical source file is elaborated once to an
exported flat environment, and explicit imports alias, open, or project that environment. This can
be specified using SML environment operations, but the file-to-structure packaging is Workman
semantics rather than inherited SML file semantics.

The full comparison and proposed normative model moved to
[`sml-files-and-structures.md`](../module-update26.7/sml-files-and-structures.md). After that module
pass is implemented, the analysis boundary should expose:

- one compilation-unit identity per canonical Workman file;
- the file structure's exported value, type, record, and constructor members;
- import edges and their concrete source spans;
- local structure aliases and named-member aliases;
- namespace qualifier and target-symbol identities.

It should not model full SML signatures, functors, sharing, ascription, or nested structures that
Workman does not implement. It also must not conflate a path identity, local namespace alias, and
semantic structure environment.

## Millet ideas that transfer directly

### Best-effort passes

Editor analysis should conceptually have the shape:

```text
input -> partial output + diagnostics
```

not:

```text
input -> complete output OR first failure
```

The current compiler already retains useful facts in several failure cases, especially hover. The
new boundary should make partial output a normal result rather than a feature-specific exception
path.

This is partly SML semantics and partly implementation policy. The Definition specifies that a
top-level declaration which fails elaboration contributes no basis change and permits later program
phrases to continue from the previous basis. It explicitly leaves parse-error handling to
implementations. Workman therefore uses SML environment modification for successfully recovered
declarations, while its compiler/frontends own declaration recovery boundaries. Millet is evidence
for tolerant parsing and lowering, not the normative source for basis modification.

Each pass should state which facts remain trustworthy after failure. Examples:

- import scanning can survive a parse failure;
- lexical tokens and line maps can survive any syntax failure;
- declarations before a recovery boundary may still have stable binders;
- a type mismatch does not invalidate the entire syntax or symbol index;
- delayed FFI or GPU elaboration failure need not erase host-language types.

### Stable semantic indexes

Millet places language queries behind its analysis API. Workman should do the same for:

- syntax node at position;
- symbol occurrence at position;
- definition and references;
- lexical environment at position;
- inferred type and general scheme;
- expected type;
- document symbols;
- diagnostics and related evidence;
- module exports and dependencies.

The server should translate these facts into LSP objects. Compiler analysis should not construct LSP
ranges, completion items, hovers, or workspace edits.

### Bidirectional source mapping

Workman needs mappings between concrete source and semantic nodes for the same reason Millet does:

- semantic diagnostics need exact source anchors;
- hover begins from a source position and asks for semantic facts;
- lowered/desugared application and pattern forms still need concrete spans;
- definitions and references need the specific identifier token, not the enclosing declaration;
- frontend-v2 virtual source will eventually require concrete-to-virtual mapping as an additional
  layer.

The first implementation may use current AST node spans and fact maps. The API should nevertheless
name the mapping responsibility explicitly so a future lossless frontend can replace the
implementation without changing every LSP feature.

## Workman-specific semantic extensions

### Nominal records

Unlike SML's structural records, Workman records are nominal and declarations also introduce ordered
constructors. The index must distinguish:

- record type;
- record constructor value;
- field declarations;
- field projections and literal/update fields;
- punned fields;
- nominal type identity.

Record field completion should be based on the resolved nominal type, not a global field-name table.

### Pinned patterns

Pinned identifiers are references, not declarations. Rename, references, semantic highlighting, and
completion must consume resolved pattern roles.

### JavaScript FFI

Foreign values and types may come from reflected JavaScript or TypeScript declarations. They need
stable language-service representations for:

- completion items;
- function signatures and parameter names;
- hover documentation;
- generated versus source-authored symbol visibility;
- invalidation when reflection inputs change.

The analysis API should expose plain facts rather than TypeScript compiler objects.

### GPU regions and contextual builtins

GPU regions have contextual builtin namespaces and occurrence-local representation types. These are
not SML concepts. They should extend the same query model:

- the environment at a position can include contextual GPU builtins;
- a symbol occurrence can have a host type and a GPU representation type;
- completion can merge ordinary lexical candidates with contextual builtins;
- failure to elaborate GPU types must be explicit rather than silently falling back to a misleading
  host type.

### Carriers, `Result`, and effect-oriented presentation

Workman's FFI and carrier abstractions add presentation beyond ordinary HM types. Hover,
diagnostics, completion details, signatures, and inlays must share one structured renderer with
surface-specific verbosity options.

## Long-term frontend relationship

Millet's lossless CST and partial HIR are strong long-term models for frontend v2, but this general
LSP update should not wait for full frontend-v2 coverage.

The analysis boundary should accept either frontend:

```text
concrete document
  -> frontend v1 strict/partial adapters
  -> or frontend v2 tolerant structural snapshot
  -> common language-service facts
  -> standard LSP queries
```

Structural repair artifacts remain frontend-v2 facts. Ordinary symbol, scope, type, and module facts
belong to the shared semantic query layer.

## Resulting rule

Adopt Millet's separation, partial-analysis discipline, semantic indexing, and source mappings for
Workman's SML-defined core. In particular, preserve Millet's separation between compilation-manager
input and SML structure semantics; do not copy Millet's accumulated-basis file policy. Do not copy
Millet's exact SML syntax tree or full module model. Workman's compiler remains authoritative for
nominal records, pinned patterns, file-structure packaging, FFI, GPU types, carriers, and the
documented omissions from SML.

The completed module comparison, including project isolation and the differences from Millet's
path-keyed `SourceFile` store and single-root server, is in
[`../module-update26.7/tooling-interface.md`](../module-update26.7/tooling-interface.md).
