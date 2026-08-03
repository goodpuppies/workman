# Protocol correctness and editor portability

## Goal

Any conforming LSP client should be able to launch Workman, negotiate its capabilities, edit files,
receive diagnostics, and use semantic features without a VS Code-specific extension API.

The VS Code extension remains a useful packaged client, syntax grammar, and configuration UI. It
must not be required for core server behavior.

## Standalone launch

Provide and document one stable stdio command. Candidate delivery forms:

- `wm lsp`;
- a packaged `workman-lsp.mjs`;
- a small executable wrapper around the packaged Node server;
- the current Deno source command for development.

The review decision is recorded in [`decisions.md`](./decisions.md). Regardless of packaging, the
server contract is:

- JSON-RPC/LSP over stdin/stdout;
- logs only on stderr or through `window/logMessage`;
- no editor-specific environment assumptions;
- working directory does not determine workspace semantics;
- all required runtime dependencies have clear discovery rules.

The Node bundle currently included in the VSIX is evidence that a portable artifact is feasible. It
should be published or installed somewhere other editors can reference directly.

## Initialization and configuration

### Initialization

Read and retain:

- client name and version;
- client capabilities;
- workspace folders, with deprecated `rootUri`/`rootPath` fallback;
- initialization options;
- supported position encodings.

Respond with:

- explicit `positionEncoding: "utf-16"` initially;
- only capabilities actually enabled by the selected frontend/configuration;
- workspace-folder support if implemented;
- server name and version from the package rather than a duplicated literal.

Status: the server now advertises `positionEncoding: "utf-16"` explicitly and exposes only its
implemented standard capabilities. Client metadata retention, package-derived versioning, and
background initialization remain.

Workspace indexing should not make the initialize response unbounded. If large workspaces become
slow, initialize the protocol promptly and complete indexing as background work with progress
reporting.

### Configuration

Define an editor-neutral initialization-options schema:

```ts
type WorkmanInitializationOptions = {
  frontendV2Module?: string;
  denoPath?: string;
  structuralInlayHints?: boolean;
  typeInlayHints?: boolean;
  parameterInlayHints?: boolean;
  diagnostics?: {
    onChange?: boolean;
  };
};
```

Environment variables may remain command-line fallbacks, but the VS Code client should pass the same
options through `initializationOptions`.

The server now consumes `frontend`, `frontendV2Module`, `structuralInlayHints`, `typeInlayHints`,
and `parameterInlayHints` from `initializationOptions`. `WORKMAN_STRUCTURAL_INLAYS`,
`WORKMAN_TYPE_INLAYS`, and `WORKMAN_PARAMETER_INLAYS` remain deterministic command-line fallbacks.
The three inlay categories share the standard `textDocument/inlayHint` request but are produced and
configured independently.

Later, if dynamic configuration is useful, support `workspace/didChangeConfiguration` and request
`workspace/configuration` only when the client advertises it. Missing support must leave
deterministic defaults.

## File watching and workspace folders

The server currently understands `workspace/didChangeWatchedFiles`, but the VS Code extension
installs the watcher. A portable server should:

1. inspect client dynamic-registration support;
2. register a `**/*.wm` watcher after initialization when supported;
3. continue accepting statically configured watcher notifications;
4. document that clients without either mechanism may require manual watcher configuration;
5. use save notifications as a limited fallback, not as proof that all filesystem changes are
   observed.

Support `workspace/didChangeWorkspaceFolders` before claiming dynamic multi-root behavior. Adding or
removing a root must update known files, dependency edges, caches, and diagnostics.

Created, changed, deleted, and renamed files must:

- update canonical path state;
- update dependency edges;
- invalidate affected entry snapshots;
- clear diagnostics for removed URIs;
- republish diagnostics from the new on-disk graph.

## Request dispatch and lifecycle

Required lifecycle behavior:

- reject a second `initialize`;
- handle `initialized`;
- return `null` from `shutdown`;
- stop accepting normal requests after shutdown;
- exit with success only after an orderly shutdown;
- return JSON-RPC errors for malformed, invalid, or unknown requests;
- never leave a request unanswered.

At minimum use:

- `ParseError` for invalid JSON where an ID can be recovered appropriately;
- `InvalidRequest`;
- `MethodNotFound`;
- `InvalidParams`;
- `InternalError`;
- LSP request-cancelled/content-modified errors where applicable.

Whether to retain the small custom dispatcher or adopt a maintained LSP library is an open decision.
The behavior above is required either way.

Status: **initial lifecycle/error milestone implemented.** The custom dispatcher now rejects
pre-initialize requests, duplicate initialization, and post-shutdown requests; accepts
`initialized`; returns `null` for shutdown; exits successfully only after shutdown; returns
`MethodNotFound` for unknown methods; and emits `ParseError`/`InvalidRequest` for malformed JSON-RPC
payloads while continuing with later frames. Method-specific `InvalidParams` validation remains.

## Concurrency, cancellation, and stale work

Serial stdout writes are correct and should remain serialized. Request computation does not need to
be globally serial.

The target model:

- document and workspace notifications update state in arrival order;
- a semantic request captures a `QueryContext`;
- expensive analysis can run asynchronously;
- duplicate queries share in-flight snapshot work;
- `$/cancelRequest` marks the query cancelled;
- results are discarded when cancelled or stale;
- diagnostics from an old revision never overwrite newer diagnostics;
- shutdown does not wait indefinitely for irrelevant analysis.

The compiler may not initially support deep cooperative cancellation. The first stage can still stop
publication and response construction, then add `AbortSignal` checks at graph, reflection, and GPU
elaboration boundaries.

Status: **first publication-safety stage implemented.** Read requests may run concurrently while
notifications continue in arrival order. `$/cancelRequest` produces `RequestCancelled`; a document
or watched-file change advances a workspace revision and an older request produces
`ContentModified`. Semantic-service operations remain serialized, preventing snapshot construction
from racing invalidation and sharing the resulting snapshot across queued requests.

The compiler work itself is not yet cooperatively aborted. Diagnostic notifications are still
computed serially with document mutations, so a newer edit cannot be read until the prior diagnostic
pass finishes; per-document generations and stale diagnostic suppression remain.

## Text synchronization and positions

The current full-sync model is simple and correct. Keep it until incremental change application has
dedicated tests.

Position rules:

- negotiate UTF-16 explicitly;
- centralize URI, offset, line-map, position, and range conversion;
- test astral Unicode before and inside identifiers/comments/string literals;
- clamp invalid client positions safely;
- use precise identifier spans rather than whole declaration spans;
- include optional hover ranges where a concrete target is known.

Incremental synchronization can be introduced later if profiling shows full document transfer or
line-map rebuilding is significant.

## Diagnostics protocol behavior

Keep push diagnostics initially. Improve publication by:

- including document versions only for open documents whose exact version was analyzed;
- fingerprinting diagnostics to suppress unchanged publications;
- retaining the set of previously published URIs so stale diagnostics are cleared;
- reanalyzing on close after removing the source override;
- checking client support before including optional related information;
- keeping `message` concise while placing secondary anchors in `relatedInformation`;
- eventually attaching `codeDescription` links when diagnostic documentation has stable URLs;
- using `data` for safe code-action correlation where useful.

Pull diagnostics may be reconsidered later, but adopting them is not required for editor
portability.

The close-to-disk behavior is implemented: `didClose` removes the editor override, refreshes
discovery, invalidates affected semantic closures, and republishes diagnostics from the on-disk
graph instead of blindly clearing the URI.

## Capability-independent features

Core features must return standard protocol objects:

- hover as `Hover`;
- completion as `CompletionList` or completion items;
- inlays as `InlayHint`;
- rename as `WorkspaceEdit`;
- fixes as `CodeAction`;
- highlighting as semantic tokens or document highlights.

Custom commands or metadata may enhance a feature, but the feature must remain useful when a client
ignores unknown fields and implements only the standard request.

Structural inlay metadata is acceptable because the visible artifact is still a standard inlay hint.
A future materialize-repair command is an enhancement, not the only way to understand the document.

## Conformance tests

Add protocol-level tests for:

- initialize capabilities with and without optional client capabilities;
- unknown request response;
- shutdown and exit ordering;
- cancellation;
- stale hover/diagnostic suppression after a rapid change;
- watched-file dynamic registration;
- workspace-folder changes;
- didClose reverting to disk;
- UTF-16 positions;
- multiple messages in one input chunk;
- fragmented headers and bodies;
- malformed framing and JSON;
- stdout containing protocol frames only.

Implemented coverage now includes explicit UTF-16 capability negotiation, lifecycle errors, unknown
and invalid requests, fragmented/multiple frames, malformed JSON, cancellation, stale read-request
suppression, and close-to-disk revalidation. Dynamic registration, workspace-folder changes,
diagnostic staleness under rapid edits, and cross-editor smoke recipes remain.

At least one smoke-test recipe should launch the same standalone artifact from VS Code, Neovim,
Helix, and a minimal test client. These are conformance checks, not separate editor-specific feature
implementations.

## Acceptance criteria

- A client needs only a stdio command, `.wm` file association, and standard LSP support.
- Configuration has a documented non-environment transport.
- Watched files do not rely exclusively on the VS Code extension.
- Every request receives a result or protocol error.
- cancelled or stale work cannot publish late results.
- UTF-16 behavior is explicit and tested.
- no core feature requires VS Code commands, decorations, middleware, or extension-private state.
