# General LSP update, 26 July

## Status

Implementation has resumed on the compiler-owned boundary produced by the module/SML correctness
pass in [`../module-update26.7/`](../module-update26.7/). Remaining module documentation gates stay
open, but new LSP features must consume the implemented `ProjectSnapshot`/`ModuleInterface` API
rather than stabilize paths, public environments, or import behavior in an LSP-owned model.

This directory plans the next general-purpose Workman language-server update. The immediate
objective is a fast, compiler-backed, editor-independent LSP with a reusable analysis boundary. The
plan is intentionally review-first: decisions should become explicit here before implementation
commits to an API or cache model.

The current server already has strong diagnostics, hover, definition and type definition,
references, document highlights, role-aware safe rename, document symbols, dependency-aware
revalidation, and compiler-owned ordinary/GPU/import and initial expected-type completion. This
update should preserve those strengths while completing richer completion recovery, foreign/curried
parameter-name hints, semantic tokens, and other standard LSP features.

## Scope

This plan covers:

- a persistent language-service and analysis boundary;
- document, workspace, dependency, semantic, and query state;
- editor-independent JSON-RPC/LSP behavior;
- standalone server launch and configuration;
- general completion and inferred-type inlays;
- navigation, symbol, rename, and highlighting improvements;
- diagnostics publication and performance;
- a staged feature roadmap and acceptance gates.

This plan does not redefine the structural-editor product or frontend-v2 recovery model. Those are
owned by [`../advanced-lsp/`](../advanced-lsp/). Frontend v2 should eventually plug into the same
analysis boundary, but general LSP improvements must not depend on a VS Code-only renderer or on
completing the structural-editor migration first.

## Documents

- [`current-state.md`](./current-state.md) inventories the current server and the useful behavior in
  `workman-old`, `workmangr`, and Millet.
- [`sml-and-millet.md`](./sml-and-millet.md) maps Millet's architecture onto Workman's SML semantics
  and identifies the Workman-specific parts that cannot be inherited blindly.
- [`analysis-boundary.md`](./analysis-boundary.md) proposes the central language-service API,
  snapshot model, symbol identities, invalidation rules, and layering.
- [`protocol-and-portability.md`](./protocol-and-portability.md) defines the editor-neutral
  protocol, configuration, watching, cancellation, packaging, and conformance work.
- [`feature-roadmap.md`](./feature-roadmap.md) defines feature behavior and ordering.
- [`milestones.md`](./milestones.md) turns the architecture into implementation phases with
  acceptance gates.
- [`decisions.md`](./decisions.md) records proposed decisions and unresolved questions for review.

## Current direction

After the module update completes, the proposed sequence is:

1. **Initial protocol-correctness slice implemented:** lifecycle, JSON-RPC errors, explicit UTF-16,
   cancellation publication, stale read rejection, and close-to-disk validation; dynamic watching,
   packaging, parameter validation, and diagnostic freshness remain;
2. **Initial persistent service implemented:** place a versioned language-service facade around
   current compiler analysis; explicit revisions, cancellation, and stale-result rejection remain;
3. **Initial boundary implemented:** build one shared semantic index and type-rendering path;
4. **Implemented to the initial milestone:** implement general completion against that index;
5. **Implemented:** add ordinary inferred-type inlays;
6. **Initial milestone implemented:** expand symbol queries to type definition, highlights, safe
   project rename, and active-context workspace symbols; cross-project references remain;
7. **Initial signature-help, semantic-token, and workspace-symbol milestones implemented:** add
   portable rich features against compiler queries; formatting and code actions remain.

The analysis boundary comes before the new features. Without it, each feature would parse, load,
infer, identify symbols, and format types independently, as several older implementations eventually
did.

## Design principles

1. **LSP means standard LSP.** Core language features must not depend on a VS Code extension API,
   custom decorations, commands, or middleware.
2. **Compiler facts are authoritative.** The LSP may add recovery and presentation, but it must not
   invent a competing type or binding model.
3. **Partial programs still produce useful facts.** A failed pass should retain every trustworthy
   syntax, scope, type, and dependency fact it produced.
4. **One fact, many presentations.** Hover, completion details, inlays, signatures, and diagnostics
   should share symbol identities and type rendering.
5. **Queries run against captured state.** Results from stale document or workspace generations are
   discarded rather than published late.
6. **The shared fragment is SML, not SML-like.** Accepted shared forms use the Revised Definition's
   semantics exactly. Unsupported forms are restrictions; surface conveniences have exact
   translations; genuine Workman extensions are identified explicitly.
7. **Measure before adding fine-grained incrementality.** Correct version-keyed whole-file or
   whole-entry caching is preferable to premature incremental tree surgery.

## Relationship to implementation language

The current server is TypeScript and the advanced plan eventually moves more of the frontend and
server into Workman. This plan treats the language-service API as the migration seam:

- the current TypeScript server can adopt it immediately;
- frontend v1 and frontend v2 can provide snapshots behind it;
- a later Workman-native server can consume or implement the same DTO-level concepts;
- LSP protocol objects do not leak into compiler analysis.

This lets the general LSP improve now without prejudging the final server implementation language.
