# Implementation milestones

Each milestone has an acceptance gate. Later work should not build on a phase whose freshness,
identity, or protocol behavior remains ambiguous.

## Phase 0: Review and baseline

Work:

- review and revise this document set;
- agree on the decisions in [`decisions.md`](./decisions.md);
- consume the completed compiler/tooling handoff from
  [`../module-update26.7/`](../module-update26.7/);
- record representative latency for initialize, edit diagnostics, hover, definition, and references
  on small and large repository examples;
- retain the focused existing LSP test baseline;
- identify compiler functions currently invoked by each LSP feature.

Gate:

- the module update's LSP handoff gate is complete;
- architecture and first implementation slice are agreed;
- no new feature is being built on an undefined cache or symbol model.

## Phase 1: Protocol shell

Status: **initial lifecycle/framing/cancellation slice implemented.** Dynamic watching, standalone
packaging, parameter validation, and diagnostic freshness remain.

Work:

- formalize request dispatch and JSON-RPC errors;
- add `initialized`, shutdown-state enforcement, and cancellation tracking;
- negotiate UTF-16 explicitly;
- parse editor-neutral initialization options;
- move VS Code configuration transport to initialization options with environment fallback;
- dynamically register watched files when supported;
- define a stable standalone launch command/artifact;
- add protocol conformance tests.

Gate:

- every request receives a result or error;
- the same artifact launches from the VS Code client and a minimal generic client;
- watched-file and configuration behavior no longer requires extension-private state.

This phase may overlap the internal language-service work as long as neither changes compiler
semantics.

## Phase 2: Language-service facade and snapshots

Status: **initial registry/snapshot-reuse slice implemented.** Explicit request generations,
in-flight sharing, cancellation, and stale-publication rejection remain.

Work:

- add `LanguageService`, `AnalysisStore`, `QueryContext`, and generation state;
- capture document and workspace revisions;
- share in-flight entry analysis;
- route diagnostics and hover through shared snapshots;
- discard stale/cancelled results;
- add cache hit, invalidation, and stale-publication tests;
- add timing logs behind an opt-in flag.

Gate:

- diagnostics and hover agree on one snapshot;
- repeated unchanged queries do not repeat full analysis;
- an edit during analysis cannot publish old diagnostics or hover;
- existing diagnostics and hover tests pass.

## Phase 3: Shared semantic index

Work:

- define `SymbolId`, occurrence roles, namespaces, scopes, and precise spans;
- index values, types, constructors, fields, modules, imports, and pinned pattern uses;
- route definition, references, and document symbols through the index;
- define structured type presentation and migrate hover to it;
- represent partial-index completeness.

Gate:

- definition and references use the same identity;
- shadowing and import alias tests pass;
- record type/constructor/field identities are distinct;
- no feature-local graph traversal remains for migrated queries;
- existing symbol tests retain parity.

## Phase 4: General completion

Work:

- implement lexical environment completion;
- add imported values, types, constructors, modules, and namespace members;
- add nominal record field completion;
- merge contextual GPU builtins;
- rank by context and expected type;
- add incomplete-source fallbacks;
- add completion performance and correctness tests.

Gate:

- completion is useful in ordinary Workman code;
- locals and shadowing are correct;
- namespace, type, constructor, field, and GPU contexts are distinguished;
- a common half-written expression still returns safe candidates;
- completion reuses the current snapshot.

## Phase 5: Ordinary inlay hints

Status: **initial gate complete.**

Work:

- [x] implement inferred-type inlays;
- [x] add shared configuration independent of structural inlays;
- [x] add tooltips and structured truncation;
- optionally add reliable parameter-name hints;
- [x] cover UTF-16, range filtering, annotations, and certified partial interfaces.

Gate:

- generic LSP clients render useful type hints;
- explicit annotations are not redundantly repeated;
- structural and type hints can be independently enabled;
- hover and inlay types come from the same presentation path.

## Phase 6: Navigation and safe rename

Work:

- add type definition;
- add document highlights;
- create a workspace occurrence index or bounded workspace reference strategy;
- extend references to the workspace;
- implement `prepareRename`;
- implement rename with role-aware workspace edits.

Gate:

- workspace references remain symbol-identity-correct under shadowing;
- unsafe or ambiguous rename is rejected;
- imports, constructors, types, modules, fields, and pinned patterns have explicit test coverage;
- edits are standard `WorkspaceEdit` values with no VS Code dependency.

## Phase 7: Rich portable features

Work may proceed independently once the semantic index is stable:

- signature help and parameter hints (**initial compiler-owned standard-LSP milestone
  implemented**);
- semantic tokens (**initial compiler-owned full-document milestone implemented**);
- workspace symbols (**initial active-context milestone implemented**);
- canonical formatting integration;
- structured code actions.

Each feature needs its own acceptance tests and must use existing analysis facts rather than create
a parallel parser or typechecker.

## Cross-phase testing

### Unit tests

- generation and invalidation;
- semantic index construction;
- symbol identity and scope;
- type presentation;
- completion ranking;
- range and UTF-16 conversion.

### Server integration tests

- real JSON-RPC frames;
- unsaved source overrides;
- dependencies and watched files;
- cancellation and stale results;
- multi-root workspaces;
- feature requests before, during, and after edits.

### Reference behavior tests

Convert valuable old behaviors into current-language fixtures rather than testing old internal APIs:

- type-directed completion from `workman-old`;
- let, record-field, parameter, and hole inlays from `workman-old`;
- cache reuse and diagnostic deduplication from WorkmanGR;
- incomplete-program semantic queries inspired by WorkmanGR and Millet;
- type definition and datatype-aware actions inspired by Millet.

### Performance checks

Track:

- initial workspace discovery;
- first and cached entry analysis;
- edit-to-diagnostics latency;
- hover and completion latency;
- modules reused versus recomputed;
- cache size and eviction;
- cancellation/stale work count.

Performance gates should be based on measured repository examples. Avoid fixed microbenchmarks that
do not resemble real module graphs.

## Documentation gate

When a phase changes a proposed decision or discovers a false assumption:

1. update the relevant architecture document;
2. record the decision in [`decisions.md`](./decisions.md);
3. update this milestone's work and gate;
4. only then let later phases depend on the new behavior.
