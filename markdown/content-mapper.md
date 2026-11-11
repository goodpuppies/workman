# Content mapper implementation notes

Content mappers and first-class TypeScript integration are wm's highest current priority.

The first slice attaches to wm's semantic analysis independently of runtime emission. It does not
require the planned TS backend and does not translate executable function bodies.

## Ownership

- `src/content_mapper/server.ts`: stdio JSON-RPC adapter, UTF-16 negotiation and project handles.
  Dispatch is sequential because inference currently has process-global state.
- `src/content_mapper/projection.ts`: recovered semantic analysis of the request buffer, followed by
  projection of `ModuleInterface.publicEnvironment` schemes. Original declaration locations come
  from the same module interface's origins. Scheme quantification is read explicitly, so unrelated
  variables are not accidentally generalized by TypeScript.
- `src/content_mapper/protocol.ts`: small local subset of the experimental wire protocol.
- `package.json`: main Workman package manifest, including the TS mapper contribution.
- `examples/content-mapper`: runnable TS project using the local package.
- `editors/fresh-typescript-sync`: Fresh plugin forwarding open wm buffer snapshots to the native
  TypeScript session through `workman/syncDocuments`.
- `src/content_mapper/typescript_lsp.ts`: stdio adapter converting those snapshots to native
  `didOpen`/`didChange`/`didClose` notifications. It preserves the normal TS protocol and serializes
  complete output frames so custom responses cannot interleave with partial native frames. Its
  diagnostic bridge pulls reports for open TS/JS consumers after wm changes and publishes them to
  Fresh, consuming its own internal request IDs and dropping stale or closed-file responses.

The projection preserves source export names in ambient declarations. Callable parameter names come
from `ModuleInterface.callableDefinitions`, selected by binding identity rather than spelling so
shadowing stays correct. Each curried result consumes the next parameter stage; callback parameter
types do not consume those stages. Multi-parameter WM functions use positional TS parameters,
sharing the outer argument-shape rule with library emission. Inferred generic names use `T`, `U`,
etc., with explicit WM names retained where available.

Names TS cannot bind, such as primed identifiers, use readable escaped local names and string-named
exports. Escapes cannot collide with actual source exports or parameters. Verbatim or alias mappings
connect declaration names to source, enabling only hover, signature help, definition, type
definition, and reference queries. No TS edits are allowed into WM source.

## Next steps

1. Improve module integration: automatically discover entry points for disk watching, project
   re-exports as TS forwarding declarations for navigation, track unresolved paths for creation, and
   narrow conservative project-wide invalidation. Cross-file semantic projection and Fresh
   unsaved-buffer propagation are implemented and tested.
2. Project nominal types with stable identities across files and actual runtime layouts. Never map
   WM lists to JS arrays or options to nullable values just because those TS types look easy.
3. Add source-level internal symbol projections using wm occurrence identities and feature-specific
   mappings, without lowering executable bodies merely to obtain language-service features.
4. Register the mapper with TS through the wm editor extension while preserving wm-owned features.
5. Package the mapper with its compiler assets before considering distribution. The current relative
   manifest command intentionally runs against the checkout.

## References

`research/ember-content-mapper` is a shallow reference clone, not project-owned source. Its protocol
adapter and tests were useful references for stdio framing, UTF-16 negotiation and native LSP
initialization. The production mapper reuses wm's existing RPC codec and adds no new runtime
dependency. TypeScript 7.1.0-beta is installed under the ignored `_scratch/content-mapper-ts/` for
integration testing; the compiler's reflection dependency remains TypeScript 6.

`research/fresh` is an unmodified shallow reference clone. Fresh 0.5.8 routes document sync to
language-scoped server processes, so opening a wm buffer does not update the separate TS process.
The first native LSP test covered direct buffer delivery, which was insufficient to establish live
updates in Fresh. Regression coverage now also exercises the installed adapter path and successive
edits/closing buffers. Changes to closed files made outside Fresh still need a watcher integration;
the current plugin supplies editor buffers only.

Fresh's real session subsequently showed the plugin timer running with no sync requests sent. The
initial event/revision-based adapter tests did not establish reliable delivery from the real editor.
The plugin now samples buffers every 250 ms and deduplicates by content, reports failures instead of
swallowing them, and recognizes the wrapper command as well as the configured name.
`tests/content_mapper_fresh_test.ts` runs an isolated headless Fresh instance and checks numeric,
string, then boolean hover through the actual QuickJS plugin and LSP APIs after unsaved edits. The
precise event/snapshot condition in the original session was not independently established; the fix
removes that reliance, and the headless check verifies the new delivery path.

The remaining config-based target gate could still suppress every sync request. Terminal-mode plugin
`getConfig()` snapshots were observed reporting default Deno settings instead of the native adapter
settings used to launch the LSP. The sync plugin no longer consults this metadata: it addresses the
live server through `sendLspRequest`, whose adapter-specific acknowledgement confirms delivery.
Success and failure are logged. Regression coverage now also launches an isolated terminal/server
session with wm LSP and autosave, changes an unannotated function from `+` to `++`, and verifies
both the imported function hover and the consumer variable's inferred type.

Fresh's installed client did not advertise `workspace.diagnostics.refreshSupport`, so TS scheduled
diagnostics after wm edits without the editor pulling dependent TS reports. The adapter now bridges
those reports to `publishDiagnostics`, including empty results to clear stale errors. Its input
queue keeps each group of wm changes ahead of the resulting pulls. Per-revision and document-version
checks reject obsolete results; one pending request per consumer coalesces subsequent edits. The
real Fresh test now reads `getAllDiagnostics()` before its hover queries and checks no-error → error
→ no-error without touching the TS buffer. Fresh's console lacks `console.info`; the sync
acknowledgement uses `console.log` instead so successful synchronization does not emit misleading
plugin failures.

That pull-to-push bridge alone was insufficient: Fresh stores push and pull results separately and
merges them. The live log showed three pulled errors plus three pushed errors becoming six displayed
errors; clearing the pushed report left the original pull cache intact. The regression previously
started clean, so its empty initial pull cache hid this. It now starts with a TS error, reproduces
the duplicate with the previous adapter, and checks error → clear → error → clear.

The adapter now presents push-only diagnostic capabilities to the client (including filtering
dynamic pull registrations) while owning native diagnostic pulls internally. It fetches initial
reports on consumer open, refreshes on source changes and native refresh requests, and consumes its
own native request IDs. Fresh therefore has only one authoritative diagnostic cache for this server.
Both web and terminal/server regressions check displayed errors as well as hover.

## WM module integration

The mapper uses `analyzeRecoveredVirtual` over the complete shared overlay map, retaining the
request's content as authoritative for its own file. `publicEnvironment` supplies visibility and
shadowing; exported structures recursively project to object members. No alternate module resolver
or TS-body lowering is involved. Callable metadata follows WM binding-identity aliases, including
namespace member aliases, in the semantic interface builder.

The TS adapter owns a unique temporary snapshot file inherited by mapper children through
`WM_CONTENT_MAPPER_SNAPSHOT`. Complete snapshots are atomically replaced before native document
notifications, followed by an explicit `workspace/didChangeWatchedFiles` for the snapshot. The
manifest declares `dynamicConfig`; `openProject` hashes overlays and configured entry-point source
graphs. The watch refresh closes/reopens the mapper project and changes its transform cache key.
This is deliberately conservative: every changed snapshot invalidates the mapper project's
projections. WM buffer content remains untouched; no source revision comments are injected.

`options.entryPoints` names public WM modules relative to the TS config. Their graphs register
transitive disk dependencies for native watching; unsaved snapshots work without that option. Native
editor clients that bypass the adapter do not share cross-file overlays. Re-export navigation,
unresolved-file creation watching, nominal types, and automatic graph-root discovery remain
incomplete. The native regression tests cover disk notifications; real Fresh tests cover web and
terminal/autosave inference and displayed diagnostics across three WM modules.

`research/typescript-go` is a reference-only shallow clone used to inspect dynamic configuration
refresh and mapper cache identity ownership.
