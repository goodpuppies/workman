# SML correctness audit

## Purpose

The module update must not place a new file protocol on top of uncertain language semantics. Before
the LSP treats module environments and symbol identities as authoritative, verify the SML-defined
fragment against the Revised Definition.

The Definition is normative. Millet, SML/NJ, MLton, and other implementations are research aids and
executable comparison points, not substitutes for reading the applicable rules.

## Scope

The first audit covers semantic areas that cross file boundaries or determine public interfaces:

- sequential declaration elaboration;
- lexical scope and shadowing;
- separate value, constructor, type, and structure namespaces;
- type-scheme generalization and instantiation;
- recursive and mutually recursive value groups;
- datatype generativity and constructor identifier status;
- type-alias transparency;
- equality constraints in the supported subset;
- pattern binding versus reference roles;
- evaluation order of top-level declarations;
- environment projection, restriction, aliasing, and opening;
- preservation of semantic identity through imports.

The audit should record unrelated SML divergences it discovers, but it does not need to implement
the full SML language. Omitted signatures, functors, exceptions, references, flexible records, and
other unsupported forms remain limitations unless separately proposed.

Workman extensions such as nominal records, pinned patterns, FFI, GPU regions, and carriers need
composition tests. They are not judged as SML-equivalent.

## Audit record

For each feature, record:

| Field                   | Required content                                                      |
| ----------------------- | --------------------------------------------------------------------- |
| Workman form            | exact accepted syntax                                                 |
| Classification          | equivalent, restricted, definitional extension, or semantic extension |
| Definition source       | chapter/rule governing the shared behavior                            |
| Translation             | SML phrase or exact semantic-object operation                         |
| Compiler implementation | parser, inference, lowering, and runtime paths                        |
| Static tests            | binding, typing, namespace, identity, and rejection behavior          |
| Dynamic tests           | evaluation order, result, failure, and effects where relevant         |
| Status                  | conforming, intentional restriction, extension, bug, or unresolved    |

No row should be marked conforming solely because common examples behave plausibly.

## Priority audit areas

### Environments and shadowing

Verify:

- later declarations see earlier environments;
- later local declarations replace earlier imported bindings exactly where permitted;
- value and type namespaces do not collide accidentally;
- constructor status survives imports;
- open import restrictions reject additional programs without changing accepted-program binding;
- dotted implementation names do not become the semantic definition of qualification.

### Generalization across files

Imported values must retain the defining declaration's generalized scheme. Importing or renaming a
value must not:

- generalize it again under the importer;
- share fresh instantiation variables between independent use sites;
- monomorphize it because of backend alias generation;
- expose inference variables owned by an incomplete dependency.

Test polymorphic imported functions at multiple types and through namespace, open, and named forms.

### Nominal identity and generativity

Verify:

- one datatype declaration has one identity in its defining module instance;
- repeated imports and aliases preserve that identity;
- two distinct defining modules generate distinct identities;
- type aliases do not create fresh nominal identity;
- constructor values and pattern constructors refer to the defining datatype;
- interface caching does not derive equality from printed names.

### Recursive declarations

Verify the supported `let rec ... and ...` behavior against the intended SML recursive binding
translation:

- scope of every recursive binder;
- which right-hand sides are admissible;
- generalization behavior;
- interaction with imported values;
- no accidental cross-file recursion through graph cycles.

### Patterns

Separate SML-equivalent binders from Workman's pinned-pattern extension. Module imports must
preserve enough identifier status for constructor patterns and qualified constructors to resolve
without capitalization heuristics.

### Static and dynamic ordering

Verify separately:

- graph discovery order;
- dependency elaboration order;
- import binding visibility position;
- source declaration evaluation order;
- sibling dependency initialization order;
- entry `main` invocation.

Backend hoisting is allowed only when observationally equivalent to the specified ordering.

The specified sibling rule is depth-first traversal by first import occurrence. Dependency failure
is remembered, prevents importer initialization, and does not roll back effects already completed.

### Public-environment restriction

When `private` is added:

- restriction removes names without regenerating visible identities;
- public schemes cannot mention inaccessible private nominal types;
- private values may support public implementations without appearing in the interface;
- datatype constructors follow the chosen datatype visibility rule;
- interface fingerprints ignore private implementation changes unless they affect public semantics.

## Testing strategy

### Definition-derived examples

Create small examples directly from the applicable static and dynamic rules. Include positive and
negative cases and cases where two namespaces share one spelling.

### Translation pairs

For classifications 1 and 2, retain a Workman input and its SML translation. Compare:

- accepted/rejected status, accounting for documented restrictions;
- inferred principal types or schemes;
- binding targets;
- nominal equalities and inequalities;
- observable evaluation result.

Different surface formatting is irrelevant.

### Implementation comparisons

Where useful, run translations through more than one mature SML implementation or Millet's static
analysis. A disagreement triggers Definition research; majority behavior is not normative.

### Compiler-layer parity

For every module test, verify compiler analysis, core lowering, and emitted execution. Snapshotting
generated JavaScript alone is insufficient.

### Property-oriented tests

Useful invariants include:

- aliasing cannot change target identity;
- canonicalizing a specifier cannot change program meaning except by merging duplicate module
  instances that were intended to be identical;
- when `private` exists, renaming an unused private declaration cannot change a public interface;
- independent use sites of an imported polymorphic value instantiate independently;
- backend emit-name changes cannot affect binding.

## Initial known audit targets

| Area                             | Current observation                                                                    | Audit status                              |
| -------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Namespace representation         | qualified members are stored as dotted value/type keys plus side tables                | replace/isolate behind SML `StrEnv` facts |
| Import order                     | inference is declaration-ordered; runtime aliases are emitted before body declarations | needs parity proof                        |
| File identity                    | ordinary files use `realPath`; virtual files use normalized path strings               | wrap in opaque resolver-owned `ModuleId`  |
| Same-target datatype identity    | manually verified through two namespace aliases                                        | needs permanent test                      |
| Different-file datatype identity | covered by compiler tests                                                              | retain                                    |
| Imported polymorphism            | existing tests cover common use                                                        | expand across every import form           |
| Constructor/type shared spelling | named import test exists                                                               | expand namespace/open cases               |
| Private leakage                  | inference checks exist internally; no surface `private`                                | deferred until `private` is needed        |
| Collision policy                 | import collisions fail; later locals can shadow                                        | change to SML right-biased composition    |
| Cycle behavior                   | graph rejects cycles                                                                   | retain and improve diagnostics            |
| Module initialization            | current emitter initializes graph nodes once                                           | elevate to specified runtime rule         |
| `carrier` namespace value        | currently encoded as a value alias                                                     | lower as specified syntactic fallback     |

## Completion gate

The SML correctness pass is complete enough for the module update when:

- every shared behavior used by file interfaces/imports has an audit row;
- every row is conforming, an accepted restriction, or an explicitly accepted extension;
- known bugs have focused failing tests and are fixed;
- module identities and public environments no longer depend on display/backend encodings;
- static analysis and runtime behavior agree;
- the conformance matrix is linked from compiler-facing documentation.
