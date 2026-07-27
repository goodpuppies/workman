# Analysis boundary

## Goal

Create one persistent, version-aware language service that turns documents and workspace state into
compiler facts and answers editor-oriented semantic queries. Protocol handlers should capture a
snapshot, call this service, and convert the result to standard LSP types.

The boundary must initially wrap the current compiler rather than require a compiler rewrite. It
should permit progressively finer caching and frontend-v2 integration later.

The module pass has since fixed a stronger boundary: the per-module, per-project-snapshot compiler
interface is the sole semantic API for this service. See
[`../module-update26.7/tooling-interface.md`](../module-update26.7/tooling-interface.md). References
below to `AnalysisStore`, entry snapshots, partial fallback, or project indexing mean storage and
aggregation of those interfaces, not permission to reconstruct semantics.

## Layering

```text
editor client
    |
    v
LSP protocol shell
  framing | lifecycle | capabilities | cancellation | LSP conversion
    |
    v
LanguageService
  snapshots | query coordination | stale-result checks
    |
    +---------------------+---------------------+
    |                     |                     |
    v                     v                     v
DocumentStore        ProjectIndex          AnalysisStore
text/version         roots/dependencies     parse/load/infer snapshots
line maps            reverse deps           semantic indexes
    |                     |                     |
    +---------------------+---------------------+
                          |
                          v
                  compiler/frontends
```

The layers have strict responsibilities:

- the protocol shell owns JSON-RPC and LSP types;
- `LanguageService` owns captured-state queries;
- document/project stores own mutable input state;
- `AnalysisStore` owns compiler artifacts, semantic indexes, cache keys, and invalidation;
- compiler/frontends own language semantics.

### Implemented initial service

`src/lsp/semantic_service.ts` now supplies the first coarse version of this boundary:

- `ProjectIndex` feeds one syntax-only `ReverseImportDiscoveryIndex`;
- `ProjectContextRegistry` selects closest-headed or detached contexts and preserves open-document
  association;
- all ordinary semantic requests and validation consume the selected immutable
  `ProjectSnapshot`/`ModuleInterface`;
- repeated unchanged requests reuse that snapshot;
- a changed path invalidates every context whose forward closure contains it;
- overlapping heads retain separate snapshots even when they share source modules;
- strict compiler failures remain paired with recovered snapshots so diagnostic presentation can
  report the originating failure without discarding partial editor facts;
- closing the last document using a context releases it.

This is deliberately whole-project caching. Semantic operations are serialized so concurrent
requests share the first rebuilt snapshot rather than racing duplicate construction. The protocol
shell captures a coarse workspace revision, returns `RequestCancelled` for cancelled reads, and
returns `ContentModified` rather than publishing a result after document state changes. A separate
fine-grained `AnalysisStore`, per-document generations, cooperative compiler cancellation, and stale
diagnostic suppression remain Phase 2 work.

## State model

### Document state

Each open document records:

- client URI;
- canonical path when applicable;
- full source text;
- client document version;
- a monotonically increasing server revision;
- UTF-16 line map;
- open/closed status.

The server revision must advance even when a client omits or repeats a version. Queries use the
server revision as the local freshness authority.

Closing a document removes its source override, but not necessarily the file from the workspace. The
next relevant snapshot must use the on-disk text and revalidate affected entry points.

### Workspace state

Workspace state records:

- workspace folders;
- configuration generation;
- known Workman files;
- canonical compilation-unit identities;
- dependency and reverse-dependency edges, separate from local structure aliases;
- open documents;
- watched-file state;
- an analysis generation or graph epoch.

A workspace folder is not itself a Workman project. One Workman project is one head file containing
`main`, its analysis configuration, and its reachable imports. A workspace may contain several
overlapping headed projects. An unrelated `.wm` file beneath a workspace folder must not be silently
checked or added to reference/rename scope. Open unattached files use detached snapshots.

Any change that can affect language facts advances the appropriate generation:

- source change;
- create/delete/rename;
- import edge change;
- workspace-folder change;
- frontend-mode change;
- basis/catalog change;
- FFI reflection input change.

### Analysis snapshots

The initial cache may be entry-oriented because `analyzeFile` already analyzes a module graph:

```ts
type EntrySnapshotKey = {
  entryPath: string;
  workspaceGeneration: number;
  frontendConfiguration: string;
};
```

An entry snapshot contains:

- module graph and topological order;
- one canonical `ModuleId` and exported file environment per graph node;
- source text/version used for every node;
- inference results and compiler binding facts;
- diagnostics by source path;
- exports and imports;
- per-module semantic indexes;
- specialized FFI and GPU facts;
- whether the result is complete or partial.

This is deliberately a coarse first cache. Later work may reuse module summaries or update one
module at a time, but the public query API should not depend on cache granularity.

### Captured queries

Every request captures:

```ts
type QueryContext = {
  uri: string;
  documentRevision: number;
  workspaceGeneration: number;
  cancellation: CancellationToken;
};
```

The response is sent only if:

- the request was not cancelled;
- the relevant document revision is still current;
- the result's workspace generation is still valid for that query.

Diagnostics follow the same rule. Older analysis must not overwrite newer diagnostics.

## Core language-service queries

The first stable query surface should include:

```ts
interface LanguageService {
  diagnostics(uri: string, context: QueryContext): Promise<DiagnosticFact[]>;
  hover(uri: string, position: Position, context: QueryContext): Promise<HoverFact | null>;
  definition(uri: string, position: Position, context: QueryContext): Promise<LocationFact[]>;
  references(
    uri: string,
    position: Position,
    scope: ReferenceScope,
    context: QueryContext,
  ): Promise<LocationFact[]>;
  documentSymbols(uri: string, context: QueryContext): Promise<SymbolFact[]>;
  completions(uri: string, position: Position, context: QueryContext): Promise<CompletionFact[]>;
  inlayHints(uri: string, range: Range, context: QueryContext): Promise<InlayFact[]>;
  signatureHelp(
    uri: string,
    position: Position,
    context: QueryContext,
  ): Promise<SignatureFact | null>;
  semanticTokens(uri: string, context: QueryContext): Promise<SemanticTokenFact[]>;
  workspaceSymbols(query: string, context: QueryContext): Promise<WorkspaceSymbolFact[]>;
}
```

Expected extensions:

- `typeDefinition`;
- `documentHighlights`;
- `prepareRename` and `rename`;
- `workspaceSymbols`;
- `codeActions`.

These methods return compiler/language-service facts, not `lsp_types`-shaped objects. This keeps the
analysis usable by a CLI, REPL, tests, frontend-v2 preview, or a future Workman-native server.

The implemented signature slice follows this boundary directly. `ModuleInterface.callSites` contains
compiler-resolved callable types, argument spans, pipe arity, and authored parameter-name metadata.
`semanticSignatureHelpAt` selects an immutable `SignatureFact`, including conservative
current-source recovery from certified scope facts. The LSP layer only converts source positions and
renders that fact as standard `SignatureHelp`.

The initial semantic-token slice is equally protocol-neutral. Each module interface classifies
resolved occurrence spans using compiler-owned target namespaces, types, callable shapes, and
lambda-parameter binding identities. The LSP layer owns only the standard legend and relative
integer encoding. Exact-span multi-namespace collisions remain separate semantic occurrences and use
a deterministic presentation precedence because the LSP wire format forbids overlapping tokens.

## Semantic index

Every analyzed module should produce a semantic index with:

- syntax nodes and their precise source ranges;
- declaration and occurrence entries;
- stable symbol identities;
- value/type/constructor/field/module namespace;
- declaration/use/import/qualifier/pinned-pattern role;
- lexical scope and visibility range;
- inferred occurrence type;
- declared or generalized scheme where applicable;
- expected type where available;
- module ownership and export status;
- import-target module identity, local structure alias identity, and target-symbol identity;
- optional documentation;
- specialized FFI/GPU metadata.

### Symbol identity

A first symbol identity can use:

```ts
type SymbolId = {
  namespace: "value" | "type" | "constructor" | "field";
  module: ModuleId;
  definingNodeId: number;
};

type ModuleId = {
  canonicalPath: string;
};

type StructureAliasId = {
  owner: ModuleId;
  definingNodeId: number;
};
```

When a stable compiler node ID is unavailable, a definition span and declaration kind may be used
within the captured snapshot. Names alone must never define identity.

Aliases and imports need explicit relationships:

- a named import occurrence refers to the exported target symbol;
- a local import alias has a local spelling but the same target identity for definition/reference
  purposes;
- a namespace alias is a local structure binding and refers separately to the target `ModuleId`;
- a namespace qualifier occurrence refers to that local structure alias;
- a record type and its constructor are different symbols;
- a pinned pattern name is a reference;
- a type alias declaration is a symbol even though its denoted type may share another nominal
  identity.

Rename may later need both "rename target symbol" and "rename local alias" operations. The semantic
index must retain enough role information to make that choice explicit.

The module/file semantics underlying these identities are being specified in
[`../module-update26.7/`](../module-update26.7/). This section is provisional until that plan's LSP
handoff. In particular, importing one canonical source unit under multiple aliases must not create
multiple nominal type identities.

## Partial analysis

Snapshots have a completeness description rather than a single success bit. Required categories
include:

- syntax complete/incomplete;
- module graph complete/incomplete;
- host type analysis complete/partial;
- FFI reflection complete/partial;
- GPU elaboration complete/partial.

These are compiler-produced facts for the current source snapshot. Last-known-good results are not a
semantic fallback, and an LSP feature must not invent an environment when a current fact is absent.

Queries state their minimum fact requirements. Examples:

- import-path completion needs tokens and filesystem/module facts, not typing;
- lexical completion may use a partial scope index;
- definition may work when typing failed;
- hover may return a known host type plus an explicit unresolved GPU note;
- rename should refuse when symbol identity is ambiguous;
- diagnostics can publish every error accumulated by successful earlier passes.

An exception from one optional elaboration stage must not erase unrelated facts.

## Type and symbol presentation

Create one structured presentation service used by:

- hover;
- completion detail and documentation;
- inferred-type inlays;
- signature help;
- diagnostics;
- future workspace symbol detail.

It should accept a presentation surface and options rather than post-process strings:

```ts
type TypePresentationSurface =
  | "hover"
  | "completion"
  | "inlay"
  | "signature"
  | "diagnostic";
```

Surface policies may control:

- generalized scheme versus occurrence type;
- type-variable naming;
- carrier/effect detail;
- nominal record expansion;
- generated FFI detail;
- GPU representation;
- maximum length and multiline layout.

The underlying type must remain structured until this final rendering step.

## Cache and invalidation rules

1. Cache keys include all source overrides used by an analysis, indirectly through
   workspace/document generations.
2. A changed module invalidates entry snapshots that depend on it.
3. An import change updates dependency edges before affected-entry selection.
4. A deleted file clears its cached module facts and invalidates dependents.
5. Closing an unsaved document invalidates snapshots that used the override.
6. Queries for the same current snapshot share an in-flight analysis promise.
7. Failed analysis may be cached for the same generation if its partial facts and diagnostics are
   deterministic.
8. Cache eviction must be bounded; old document generations are not retained indefinitely.
9. Diagnostic publication may be fingerprinted independently from analysis caching.

## Initial implementation slice

The first slice should be intentionally narrow:

1. introduce `LanguageService` and `AnalysisStore`;
2. route existing validation and hover through a shared entry snapshot;
3. add snapshot generation and stale-result tests;
4. route definition, references, and document symbols through semantic indexes built from that
   snapshot;
5. remove feature-local module graph rebuilds once parity tests pass;
6. route current GPU completion through the same captured snapshot.

No new visible feature is required for the first slice. Its acceptance criterion is behavioral
parity with fewer independent analyses and a stable query seam for general completion.

## Acceptance criteria

- Existing LSP tests retain their behavior.
- One unchanged document generation shares analysis across diagnostics, hover, symbols, and
  completion.
- A source or dependency edit cannot return or publish a stale result.
- Partial FFI/GPU failures retain unrelated host-language facts.
- Symbol identity is shared by definition and references.
- Compiler analysis code imports no LSP protocol types.
- The boundary can represent frontend-v1 and frontend-v2 snapshots.
- Timing tests or instrumentation show cache hits and invalidations explicitly.
