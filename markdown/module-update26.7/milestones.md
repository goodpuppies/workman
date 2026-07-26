# Module update milestones

[`checklist.md`](./checklist.md) is the canonical item-level progress tracker. This document remains
the higher-level phase summary.

## Phase 0: Agree on semantics

Work:

- review the SML compatibility contract;
- establish the conformance matrix described in
  [`sml-correctness-audit.md`](./sml-correctness-audit.md);
- review the basis architecture and current-implementation findings in
  [`sml-basis.md`](./sml-basis.md);
- specify the exact contents of Workman's kernel and default basis profiles;
- decide whether Workman operators are SML-like value identifiers or documented fixed syntax;
- resolve every finding in [`parallel-semantics-audit.md`](./parallel-semantics-audit.md) as an
  exact semantic rule, accepted extension, or planned implementation fix;
- agree on the SML/file-protocol ownership boundary;
- confirm every decided constraint is reflected in the normative specification;
- audit the module section of [`../../docs/smlparallels.md`](../../docs/smlparallels.md) against the
  accepted terminology and current implementation;
- resolve `ModuleId`, import timing, collision, `carrier`, and initialization-order questions
  required for the first implementation;
- turn the proposed semantics into accepted normative text.

Gate:

- every rule is owned by SML, the Workman compilation-unit protocol, or an explicit extension;
- accepted shared forms have exact SML semantics;
- every shared semantic area used by module interfaces has an audit row and evidence requirement;
- initial static and dynamic bases have one agreed correspondence and ordinary SML composition;
- standard-library size is treated separately from basis semantics;
- selected ESM properties are stated as Workman rules rather than analogies.

## Phase 1: Correctness baseline

Work:

- add permanent same-file/multiple-alias identity tests;
- test normalized specifiers resolving to one module;
- test namespace preservation for values, types, constructors, and records;
- exhaustively test import collisions and later shadowing;
- test that structure and value namespaces may share one spelling;
- test that type shadowing does not delete independently bound constructors;
- test imports interspersed with declarations;
- verify that dependency-first runtime initialization remains compatible with declaration-position
  static visibility;
- test one-time dependency initialization and stable sibling order;
- test dependency failure propagation;
- retain focused regressions for same-target namespace aliases, shadowed open-import exports, and
  same-basename modules;
- compare inference, core lowering, and emitted runtime behavior;
- inventory every use of path, emit name, module alias, and nominal identity;
- inventory every primitive type, constructor, exception, operator, intrinsic, pervasive binding,
  and compiled standard-library member;
- add profile tests comparing initial static structure/value/type interfaces with runtime
  availability;

Gate:

- current behavior is either confirmed compliant or represented by a focused failing test;
- static and dynamic import ordering agree;
- declaration-ordered imports remain the rule unless a future explicit decision supersedes it;
- no identity is accidentally derived from a basename or local alias;
- every initial binding has one semantic owner and static/dynamic correspondence.

## Phase 2: Semantic model

Work:

- introduce an explicit opaque `ModuleId`;
- separate specifier, resolved identity, display path, and backend emit name;
- replace semantic dotted-name namespace flattening with explicit structure-environment facts;
- introduce an explicit `InitialBasis`/`BasisProfile` artifact;
- consolidate primitive type identity, arity, equality, constructor status, overload, and intrinsic
  metadata;
- build source-expressible standard modules through ordinary elaboration and install their public
  environments in `StrEnv`;
- define pervasive bindings as explicit projections of kernel or structure members;
- make binding resolution consume imports at declaration positions rather than preinstalling every
  import;
- remove namespace-to-carrier value injection and basis-constructor deletion;
- represent public environments and import projections as compiler facts;
- preserve target declaration identity through all import forms;
- allocate backend module names independently of source aliases and basenames;
- derive runtime namespace fields from final public environments rather than declaration history;
- make graph diagnostics retain edge paths;
- define module interface summaries.

Gate:

- compiler consumers do not infer module identity from strings intended for display or emission;
- semantic structure lookup does not depend on parsing dotted backend names;
- every import occurrence links to a target module and target semantic object;
- same-target aliases share nominal identities;
- kernel, library, pervasive, imported, and local environments use the same namespace-specific
  composition rules.

## Deferred: visibility restriction

Work:

- wait for a concrete use case requiring non-public declarations;
- add and parse `private`;
- restrict public environments;
- reject private nominal type leakage;
- define visibility for recursive groups, datatypes, constructors, and records;
- add public-interface rendering and tests.

Gate:

- private declarations remain usable internally and cannot be imported;
- no public scheme or type metadata contains an inaccessible nominal type;
- public-by-default behavior remains source-compatible.

## Phase 4: Runtime module protocol

Work:

- make initialization-once explicit in core/runtime artifacts;
- make dependency order deterministic;
- align entry, library, and REPL initialization;
- specify and test failure propagation;
- remove accidental dependence on JavaScript namespace-object semantics;
- construct the initial dynamic basis from the same profile as the initial static basis;
- replace special `Result`/`Task` object merging with explicit, single-owner structure construction;
- initialize compiled standard-library modules once in deterministic order;
- lower the specified `Module`-to-`Module.carrier` expression rewrite without creating a semantic
  module value.

Gate:

- runtime behavior follows the module specification independently of backend representation;
- every `ModuleId` initializes at most once;
- cycles fail before evaluation;
- every statically available initial primitive or standard member has a corresponding runtime
  implementation;
- entry behavior is explicit for every output target.

## Phase 5: Interface artifact and conservative invalidation

Work:

- define the compiler-owned module interface artifact;
- attach a snapshot-local interface generation;
- expose dependency and reverse-dependency facts;
- invalidate dependents conservatively when an input generation changes;
- expose import occurrences separately from target declarations;
- document package/import-map work as a separate future phase.

Gate:

- invalidation is correct without relying on persistent fingerprints;
- module and alias semantics do not have to be reconstructed from syntax or paths;
- compiler APIs expose the facts required by tooling.

Persistent semantic fingerprints, cross-build identity, serialization, and reuse optimization are
deferred until the snapshot-local artifact is correct.

## Phase 6: LSP handoff

Work:

- update the deferred LSP plan to consume `ModuleId`, public environments, aliases, and interface
  generations;
- expose basis profiles, structure membership, identifier status, pervasive aliases, and intrinsic
  provenance as compiler-owned facts;
- remove provisional module assumptions from LSP documents;
- rerun navigation, references, diagnostics, and completion baselines;
- resume the general LSP implementation plan.

Gate:

- the LSP does not reconstruct module semantics from syntax or paths;
- navigation and rename distinguish local aliases from target declarations;
- dependency invalidation follows compiler-owned identities and interfaces.
