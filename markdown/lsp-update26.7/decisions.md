# Decisions and open questions

This file is the review surface for choices that materially affect the plan. Items marked
**proposed** are directions expressed by the current document set, not final decisions.

## Proposed decisions

### D1. Introduce the analysis boundary before general completion

**Status:** proposed

General completion is the first large user-visible feature, but it should query a shared snapshot
and semantic index rather than add another independent parse and analysis path.

### D2. Improve the current TypeScript server without waiting for the server rewrite

**Status:** proposed

The analysis/query boundary is a migration seam. General LSP progress should not wait for the
Workman-native structural server. Frontend v2 and a future Workman-native LSP should be able to
implement or consume the same fact model.

### D3. Keep structural and ordinary inlays separate

**Status:** proposed

Structural inlays describe interpreted missing or implicit syntax. Ordinary inlays describe inferred
types and parameter names. They have separate settings, fact sources, and failure behavior even when
returned through the same standard LSP method.

### D4. Keep push diagnostics initially

**Status:** proposed

The current dependency-aware push model is already strong. Add freshness, fingerprinting, and
close-to-disk correctness before considering pull diagnostics.

### D5. Use explicit UTF-16 positions initially

**Status:** proposed

Current JavaScript string offsets are naturally UTF-16 and LSP defaults to UTF-16. Advertise it
explicitly and centralize conversions. Supporting other position encodings is not an initial goal.

### D6. Start with coarse, correct snapshot caching

**Status:** proposed

Cache whole entry analyses by captured workspace generation first. Preserve a query API that permits
module-summary or finer incrementality later. Do not make fine-grained invalidation a prerequisite
for the first shared snapshot.

### D7. Use compiler facts rather than syntax heuristics for semantic roles

**Status:** proposed

Pinned patterns, nominal record fields, aliases, FFI symbols, and GPU contexts make token-shape
heuristics unsafe. Token-level fallbacks are acceptable only when semantic facts are unavailable and
the returned information remains conservative.

### D8. Make the standalone server a supported product surface

**Status:** proposed

The server should have a documented artifact/command independent of the VSIX. The VS Code extension
consumes that server like any other client plus supplies grammar and configuration UI.

## Open questions

### Q1. What is the canonical standalone command?

Candidates:

- `wm lsp`;
- installed `workman-lsp`;
- packaged `workman-lsp.mjs`;
- Deno source invocation for development plus a separate release artifact.

The choice affects installation, Node/Deno discovery, FFI reflection, and editor configuration
documentation.

### Q2. Keep the custom JSON-RPC shell or adopt a library?

Keeping it:

- preserves a small bundle and current control;
- requires implementing cancellation, typed params, lifecycle validation, registration, progress,
  and error behavior correctly.

Adopting a maintained library:

- provides protocol types and common lifecycle behavior;
- may increase dependencies and complicate Deno/Node/Workman-native migration.

This can be decided during Phase 1 after listing the exact missing behavior and bundle/runtime
costs.

### Q3. What exactly is a workspace-wide scope? — decided

References and rename use the selected `ProjectSnapshot`; they do not implicitly cross into another
headed project. Initial workspace-symbol search aggregates active headed snapshots plus currently
open detached contexts. Recursive discovery is syntax-only indexing and never authorizes analysis or
semantic participation for every `.wm` file under a workspace folder.

Overlapping project snapshots retain distinct semantic identities. Workspace-symbol presentation may
deduplicate the same declaration path/span/kind when it is reachable from several active heads,
because that removes duplicate UI rows without merging the underlying project facts. A follow-up
identity-sensitive operation must select a real owning snapshot again.

### Q4. How stable must `SymbolId` be?

The first implementation can guarantee identity within one captured workspace generation. Rename and
persistent indexes may benefit from identity that survives unrelated edits.

Possible bases:

- compiler node ID plus module identity;
- declaration kind and exact span;
- syntax-tree stable pointer;
- a generated declaration identity tracked across reparses.

Avoid requiring cross-edit stability until a concrete feature needs it, but do not expose raw names
as identity.

### Q5. How should import alias rename behave? — decided and implemented

For:

```wm
from "./math.wm" import { add as plus };
```

renaming `plus` could:

- rename the local alias and its uses only;
- rename exported `add` across the workspace;
- offer both as distinct actions.

The initial behavior is local alias rename when the alias or one of its local uses is selected.
Selecting the original imported name or the exported declaration renames the target across the
selected project snapshot. The compiler owns this role-aware grouping; the LSP converts it to a
standard workspace edit.

### Q6. Which incomplete-source facts can frontend v1 guarantee?

The current hover path already recovers some partial semantic facts, while strict completion returns
nothing after parse failure. Before designing fallback completion, document:

- which parser/lowering failures retain AST nodes;
- which inference facts survive diagnostics;
- whether a last-successful snapshot is safe for names but not types;
- where token/import scanning is the only reliable fallback.

### Q7. Should the server advertise incremental text sync?

Full sync is simple and current. Incremental sync reduces transfer and update cost for large
documents but requires correct ordered edit application and position conversion. Decide from
profiling and protocol tests, not as a prerequisite for the analysis boundary.

### Q8. Where should configuration defaults live?

Defaults should have one authoritative definition shared by:

- standalone server;
- initialization-options decoding;
- VS Code settings;
- future editor documentation;
- tests.

Possible implementations include a server-owned schema exported to clients or a generated manifest
fragment.

### Q9. What is the first canonical formatter?

The current repository does not yet expose a general LSP-ready formatter. Formatting should wait
until CLI and LSP can call the same semantics-preserving implementation with a defined
malformed-source policy.

### Q10. How are FFI reflection inputs invalidated?

Reflection may depend on:

- imported JS/TS modules;
- TypeScript declarations;
- Deno global declarations;
- `denoPath` and runtime version;
- project configuration.

The snapshot key and watcher strategy need a conservative first policy before completion and
signature help expose more foreign facts.

### Q11. When should analysis initialize relative to the initialize response?

Small workspaces can be indexed synchronously today. Large workspaces may need:

- prompt initialize response;
- background discovery/indexing;
- work-done progress;
- queries that return partial workspace results until indexing completes.

Measure current repositories before choosing a threshold or background policy.

## Review protocol

When resolving a question:

1. add the answer as a numbered decision;
2. state the reason and rejected alternatives;
3. update every affected plan document;
4. add an acceptance criterion or test when the decision is observable;
5. keep superseded decisions with a short replacement note rather than erasing design history.
