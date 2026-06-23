# Structural editor implementation checklist

This checklist turns the advanced structural-editor plans into an execution order.
It is subordinate to:

- [`structural-editor-model.md`](./structural-editor-model.md) for the product model;
- [`tolerance-and-recovery-model.md`](./tolerance-and-recovery-model.md) for marks,
  fallbacks, recovery, and diagnostics;
- [`frontend-v2-migration.md`](./frontend-v2-migration.md) for migration details;
- [`grain-inventory.md`](./grain-inventory.md) for the working predecessor.

The phases are ordered. Items within a phase may move when implementation evidence
requires it, but later phases should not create a second parser, recovery model, or
diagnostic format to bypass an unfinished earlier boundary.

## Testing policy

Tests should protect behavior, compatibility boundaries, recovery invariants, and
known regressions. A mechanical refactor, document update, type-only declaration,
or wiring change does not automatically need its own test when existing tests
already exercise it.

Add or update tests when a change introduces or modifies:

- observable compiler/editor behavior;
- a public WM-to-JavaScript or WM-to-TypeScript boundary;
- parsing, fallback, mark, source-map, or inlay behavior;
- process framing, versioning, caching, or invalidation;
- a previously reported regression;
- a performance-sensitive path where accidental repetition is plausible.

Prefer one strong end-to-end test plus focused unit tests for algorithms with many
edge cases. Avoid tests that only duplicate typechecking or implementation details.

## Code-size rule

- [ ] Keep every maintained code file at or below 500 lines.
- [ ] Treat Markdown as exempt from the line limit.
- [ ] Treat generated artifacts as reproducible output, not hand-maintained source.
- [ ] Choose coherent module boundaries before a file approaches the limit.
- [ ] Split by ownership—lexer, parser forms, recovery, rendering, maps,
  diagnostics, transport, workspace, and features—not arbitrary line ranges.
- [ ] Do not use existing oversized repository files as precedent.
- [ ] When substantially modifying an existing oversized code file, split it when
  practical and do not casually increase the violation.
- [ ] Include a code-file line-count check in phase completion reviews.

## Phase 0 — standalone WM frontend proof

This is the first implementation phase. It verifies the structural frontend inside
WM before importable-library or TypeScript integration work.

### Package skeleton

- [ ] Read [`how-to-workman.md`](./how-to-workman.md) and run its recommended small
  examples before choosing frontend module shapes.
- [ ] Read [`docs/carriers.md`](../../docs/carriers.md) before designing error flow
  or FFI-heavy APIs.
- [ ] Keep new implementation logic in WM; do not add convenience TypeScript or
  JavaScript helpers.
- [ ] Create the frontend-v2 WM package in its intended bootstrap location.
- [ ] Add source/span and minimal token/trivia types.
- [ ] Add minimal structural node, mark, fallback, and virtual artifact types.
- [ ] Keep these as reusable package modules; isolate demonstration code in a
  separate entry point.

### WM-only vertical slice

- [ ] Implement lossless lexing for identifiers, `let`, `=`, semicolons,
  whitespace, comments, and EOF.
- [ ] Implement exact concrete rendering.
- [ ] Implement enough tolerant parsing for a complete let binding.
- [ ] Implement recovery for `let thing =` using an inferred expression hole and
  missing-semicolon mark.
- [ ] Distinguish recovery class/severity in the result.
- [ ] Emit ordered virtual `?` and `;` artifacts.
- [ ] Implement a marked preview comparable in spirit to Workmangr's preview tool.
- [ ] Run the proof through `wm run` with no TypeScript import dependency.
- [ ] Record any WM language, standard-library, performance, or ergonomics blocker
  discovered by the proof.

### Tests likely needed

- [ ] WM assertion: complete sample round-trips exactly.
- [ ] WM assertion: incomplete sample returns a valid structural document.
- [ ] WM assertion: fallback and mark reference the same recovery identity.
- [ ] WM assertion: virtual artifacts render in `?` then `;` order.
- [ ] WM assertion: a comment is preserved concretely.
- [ ] A TypeScript process harness is optional at this phase; use it only if needed
  to run `wm` reliably in the existing test suite, not to import frontend code.

### Exit gate

- [ ] A non-throwaway frontend-v2 slice demonstrates total recovery and virtual
  rendering entirely within WM.

## Phase A — importable WM libraries

### Compiler API and emission

- [ ] Define an explicit library-emission target separate from executable emission.
- [ ] Decide the public compiler API name, such as `compileLibraryFile` or an
  emission-target option.
- [ ] Prevent library output from invoking `main`.
- [ ] Export entry-module WM values through a stable ES module API.
- [ ] Keep imported WM modules internal unless re-export is intentionally added.
- [ ] Ensure runtime helpers do not leak accidental globals.
- [ ] Ensure generated library modules can be imported more than once safely.
- [ ] Preserve current executable compilation behavior.
- [ ] Document the repository command that builds a WM library artifact.

### Boundary spike

- [ ] Add a tiny WM library fixture exporting a pure function over plain values.
- [ ] Compile the fixture to JavaScript.
- [ ] Import it from TypeScript and call the exported function.
- [ ] Verify arrays/records/options needed by the frontend DTO have an intentional
  boundary representation.
- [ ] Decide whether the frontend artifact is checked in, generated during tests,
  or built by a dedicated task.

### Tests likely needed

- [ ] Compiler test: library output does not call `main`.
- [ ] Compiler test: executable output still calls `main` as before.
- [ ] Integration test: TypeScript imports generated WM code and calls an export.
- [ ] Integration test: two imports/calls do not share unintended mutable state.
- [ ] Snapshot or semantic assertion for export names only if naming stability is
  part of the public ABI.

### Exit gate

- [ ] A generated WM library is callable from TypeScript through a documented,
  deterministic build path.

## Phase B — frontend package and lossless lexer

### Package and ABI

- [ ] Choose the initial source location, preferably `tooling/frontend-v2/` during
  bootstrap.
- [ ] Add schema-versioned public DTO types.
- [ ] Define source offsets as UTF-16 code-unit offsets at the JS/TS/LSP boundary.
- [ ] Define token, trivia, span, line-map, and concrete-origin types.
- [ ] Keep internal WM representations private behind plain-data exports.
- [ ] Add one TypeScript loader/adapter as the only direct importer of generated
  frontend-v2 JavaScript.
- [ ] Add a reproducible frontend artifact build command.

### Lossless lexer

- [ ] Implement tokens for the current `wm-mini` grammar.
- [ ] Preserve exact concrete token text.
- [ ] Preserve whitespace and comments as trivia or explicit tokens.
- [ ] Preserve unknown/unlexable text as valid opaque/error tokens.
- [ ] Produce line starts once per source snapshot.
- [ ] Ensure every concrete character belongs to a token or trivia region.
- [ ] Implement concrete rendering from the lexed result.
- [ ] Export a temporary `lexRoundTrip(source)` boundary function.
- [ ] Review the predecessor lexer at
  `research/workmangr/src/frontend/lexer.gr` before finalizing token policy.

### Tests likely needed

- [ ] Golden lexer tests for every token family and trivia form.
- [ ] Round-trip tests: rendered concrete text equals input exactly.
- [ ] Unicode tests covering astral characters and combining characters.
- [ ] Newline tests covering LF, CRLF, empty input, and no final newline.
- [ ] Opaque-token test showing unknown text remains owned by the structural result.
- [ ] Corpus test over `std/`, `examples/`, and `.wm` fixtures.
- [ ] Bounded fuzz/property test for coverage and termination if practical.
- [ ] TypeScript integration test calling `lexRoundTrip` through generated JS.

### Exit gate

- [ ] Every finite string lexes into a lossless, renderable result with valid
  offsets.

## Phase C — tolerant parser and structural document

### Structural types

- [ ] Define structural node IDs and recovery IDs.
- [ ] Define concrete, virtual, error, opaque, and hole node forms.
- [ ] Define marks with rule, expectation, observation, recovery, fallback, repair
  class, pair ID, ordering, and dependencies.
- [ ] Distinguish user-authored holes from inferred recovery holes.
- [ ] Define `OptionalCanonical`, `AutoFix`, and `RecoveryOnly` behavior.
- [ ] Define one valid root structural document for every finite buffer.
- [ ] Ensure tree mark references point to canonical mark entries rather than
  divergent copies.

### Parser foundation

- [ ] Implement parser state and context-specific synchronization boundaries.
- [ ] Implement required-slot helpers that return a value on success and a typed
  fallback plus mark on failure.
- [ ] Add progress assertions around repetition and recovery loops.
- [ ] Retain skipped/unclassified concrete text in error or opaque nodes.
- [ ] Return marks and diagnostics as parse-result data; do not use global buffers.
- [ ] Parse current `wm-mini` forms before adding syntax from the larger Workmangr
  language.

### Grammar coverage

- [ ] Imports and JavaScript import forms.
- [ ] `let`, recursive groups, annotations, and declaration terminators.
- [ ] Type and record declarations.
- [ ] Literals, names, tuples, lists, records, JSON, calls, and projections.
- [ ] Blocks, lambdas, pipes/lifts, `if`, and `match`.
- [ ] Patterns and type expressions.
- [ ] Top-level unknown/error regions.
- [ ] EOF and incomplete forms at each required slot.

### Virtual rendering and maps

- [ ] Implement virtual rendering from structural nodes and marks.
- [ ] Emit virtual artifacts with anchor, text, order, class, pair ID, and recovery
  provenance.
- [ ] Implement concrete-to-virtual and virtual-to-concrete piece maps.
- [ ] Preserve the order of several virtual tokens at one anchor.
- [ ] Keep virtual insertions out of comments and opaque regions unless the mark
  explicitly belongs at their boundary.
- [ ] Keep concrete rendering exact and independent from canonical formatting.

### Auditable structural diagnostics

- [ ] Extend diagnostic severity with information/hint if required by policy.
- [ ] Add syntax predicates and syntax violations to the wm-mini diagnostic model.
- [ ] Add recovery anchors and `RecoveryEntry` support evidence.
- [ ] Replace always-empty repairs with justified structured repairs.
- [ ] Map mark rule/path to `failure.frame`.
- [ ] Map expectation to `failure.premise`.
- [ ] Map observation to `failure.violation`.
- [ ] Map fallback/recovery to support evidence.
- [ ] Keep optional canonical explanations available without necessarily filling
  the Problems panel.
- [ ] Prevent one recovery event from producing duplicate primary diagnostics.

### Workmangr behavior to port first

- [ ] `let thing =` structurally becomes `let thing = ?;`.
- [ ] `let =` receives a virtual pattern, expression hole, and semicolon.
- [ ] Missing top-level semicolon preserves later declarations.
- [ ] Missing match-arm commas remain separate artifacts.
- [ ] Missing lambda/clause blocks preserve brace/comma/semicolon order.
- [ ] Shared-anchor artifacts follow backend structural order.
- [ ] Optional unit parameters remain distinct from error recovery.
- [ ] Comments and opaque regions do not receive spurious artifacts.
- [ ] Compare behavior with `research/workmangr/tests/lsp_inlay_test.gr` and
  `format_test.gr`.

### Tests likely needed

- [ ] Complete-syntax parser goldens for each supported construct.
- [ ] Incomplete-syntax goldens containing structural tree, marks, virtual text,
  and diagnostics.
- [ ] Invariant test: every finite fixture returns a valid structural document.
- [ ] Invariant test: every fallback references exactly one recovery mark.
- [ ] Invariant test: every concrete character survives concrete rendering.
- [ ] Invariant test: applying artifacts in declared order equals virtual rendering.
- [ ] Progress/termination tests for damaged lists, blocks, matches, and declarations.
- [ ] Tests distinguishing optional, auto-fix, and recovery-only marks.
- [ ] Tests distinguishing user-authored and inferred holes.
- [ ] Diagnostic shape tests for rule, premise, violation, recovery evidence, and
  justified repairs.
- [ ] Port the relevant Workmangr regression expectations before inventing new ones.

### Exit gate

- [ ] Every finite buffer has a valid, lossless structural interpretation with
  deterministic marks, diagnostics, and virtual rendering.

## Phase D — semantic projection and compiler comparison

### Semantic projection

- [ ] Define the schema-versioned semantic projection DTO.
- [ ] Project complete structural nodes into the current TypeScript `Module` shape.
- [ ] Define projections for holes, error nodes, missing names, and skipped
  declarations.
- [ ] Preserve structural IDs and recovery provenance through projection.
- [ ] Keep authored versus recovered semantic facts distinguishable.
- [ ] Keep all DTO translation in one TypeScript adapter.

### Dual-frontend migration

- [ ] Add `v1`, `v2`, and `compare` frontend modes internally.
- [ ] Run Peggy and frontend v2 over the same valid-source corpus.
- [ ] Normalize irrelevant node-ID/metadata differences before comparison.
- [ ] Record and justify intentional semantic or span differences.
- [ ] Run compiler/check tests in v2 mode.
- [ ] Measure lexing, parsing, DTO construction, adaptation, and total compile time.
- [ ] Define the bootstrap artifact policy before frontend v2 becomes the default.

### Recovery-aware semantics

- [ ] Decide the initial TypeScript representation of `HoleExpr`, `ErrorExpr`,
  `HolePattern`, `ErrorType`, and `ErrorDecl`.
- [ ] Give inferred holes fresh types with recovery provenance.
- [ ] Prevent error declarations/opaque regions from inventing bindings.
- [ ] Attach recovery dependencies to semantic diagnostics.
- [ ] Suppress diagnostics caused solely by uninteresting fallback artifacts.
- [ ] Retain useful conflicts supported by authored context, including unfillable
  holes.

### Tests likely needed

- [ ] Normalized v1/v2 AST comparison over repository sources.
- [ ] Compiler test suite under v2 mode.
- [ ] Source-span parity tests for nodes used by hover and diagnostics.
- [ ] Recovery test: missing semicolon does not suppress independent inference.
- [ ] Recovery test: hole receives an expected type from authored context.
- [ ] Cascade test: fallback-only noise is suppressed or depends on the mark.
- [ ] Diagnostic test: authored contradictions remain visible near recovered syntax.
- [ ] Performance baseline for v1, v2, and adapter overhead.

### Exit gate

- [ ] Frontend v2 produces compiler-compatible semantics for supported source, and
  every known difference from Peggy is intentional and documented.

## Phase E — compiler and current-LSP adoption

### Compiler adoption

- [ ] Make frontend v2 the default compiler frontend after comparison parity.
- [ ] Retain a short-lived v1/debug mode rather than permanent user-facing dual
  parser configuration.
- [ ] Ensure module graph loading uses frontend v2 consistently for disk and
  in-memory source overrides.
- [ ] Publish structural diagnostics alongside semantic diagnostics.
- [ ] Apply batch acceptance policy to recovery-only marks without invalidating the
  structural document model.
- [ ] Remove Peggy once the comparison soak period is complete.

### Current TypeScript LSP improvements

- [ ] Cache structural results by URI and document version.
- [ ] Publish multiple structural diagnostics.
- [ ] Add `textDocument/inlayHint` for structural virtual artifacts.
- [ ] Keep structural and type inlays independently configurable.
- [ ] Analyze the semantic projection through recoverable syntax.
- [ ] Project semantic facts through the concrete/virtual source map.
- [ ] Preserve existing hover, definitions, module diagnostics, and dependency
  invalidation.
- [ ] Discard results computed for stale document versions.
- [ ] Add a marked preview helper comparable to Workmangr's `lsp_preview.ts`.

### Tests likely needed

- [ ] Current compiler and LSP suites using frontend v2.
- [ ] LSP protocol test for structural inlay capability and responses.
- [ ] LSP test for shared-anchor token order.
- [ ] LSP test for range filtering and valid UTF-16 positions.
- [ ] LSP test for multiple diagnostics from one incomplete document.
- [ ] LSP test for stale-version result rejection.
- [ ] Module test: an edited dependency refreshes affected open documents.
- [ ] Preview goldens ported from Workmangr structural cases.
- [ ] Edit-trace benchmark on representative complete and incomplete files.

### Exit gate

- [ ] The existing TypeScript LSP acts as a real frontend-v2 structural-editor
  renderer before transport is rewritten in WM.

## Phase F — WM structural-editor LSP

### Host substrate

- [ ] Implement JSON-RPC message types and dispatch in WM.
- [ ] Implement byte framing with partial headers, partial bodies, and multiple
  messages per chunk.
- [ ] Serialize stdout writes; send logs only to stderr.
- [ ] Implement initialize, initialized, shutdown, and exit lifecycle.
- [ ] Implement full-sync open/change/close document state first.
- [ ] Implement line maps, URI/path handling, and document versions.
- [ ] Add stale-result and cancellation policy before concurrency.
- [ ] Benchmark cold startup and framing throughput.

### Frontend and feature integration

- [ ] Import frontend v2 directly as a WM module.
- [ ] Do not duplicate parser, recovery, virtual renderer, or diagnostic logic in
  the server.
- [ ] Add structural inlays and structural diagnostics first.
- [ ] Define a narrow plain-data bridge to TypeScript semantic services.
- [ ] Add type inlays and hover.
- [ ] Add definitions and module-aware invalidation.
- [ ] Add formatting/materialization commands.
- [ ] Preserve Workmangr preview and inlay behavior unless a change is documented.

### VS Code rollout

- [ ] Add extension configuration for selecting the WM server during migration.
- [ ] Keep a temporary TypeScript-server fallback.
- [ ] Add separate controls for structural tokens, type inlays, and diagnostic
  visibility.
- [ ] Make the WM server default only after protocol and feature parity.

### Tests likely needed

- [ ] Black-box framing tests with fragmented and concatenated messages.
- [ ] Lifecycle tests including shutdown/exit status.
- [ ] Exact structural inlay payload tests against shared frontend fixtures.
- [ ] Cross-server comparison tests during migration.
- [ ] Existing `tests/lsp_*` suite against the WM server where applicable.
- [ ] Selected `research/workmangr/tests/lsp_*` behavior ports.
- [ ] Dependency invalidation and stale-diagnostic tests.
- [ ] No-protocol-bytes-on-stdout test.
- [ ] Startup, edit-trace, and cached-query benchmarks.

### Exit gate

- [ ] The WM server is the default structural-editor LSP and the TypeScript server
  is retained only as a temporary fallback.

## Phase G — advanced editing, incrementality, and cleanup

### Structural interactions

- [ ] Add explanation UI for virtual tokens and marks.
- [ ] Add explicit materialization actions for safe completions.
- [ ] Add interpretation/ambiguity choices where the model supports alternatives.
- [ ] Add structural selection ranges and folding.
- [ ] Add semantic styling/decorations when inlay styling is insufficient.
- [ ] Explore direct manipulation of holes and virtual structure within VS Code's
  extension limits.
- [ ] Decide whether any interpretation choices require persistent sidecar metadata
  or must become concrete edits.

### Performance and incrementality

- [ ] Reproduce Workmangr edit/hover benchmarks for frontend v2 and the WM server.
- [ ] Profile before selecting incremental algorithms.
- [ ] Add bounded caches with explicit owners and invalidation rules.
- [ ] Add incremental line maps only if measured.
- [ ] Add token reuse and subtree correspondence only if measured.
- [ ] Add worker isolation or concurrency only after version/state ownership is
  explicit.
- [ ] Ensure incremental results are observationally equivalent to full rebuilds.

### Cleanup

- [ ] Remove the TypeScript LSP after parity and soak time.
- [ ] Remove Peggy and transitional frontend modes after the frontend-v2 soak.
- [ ] Remove stale generated artifacts and migration-only adapters.
- [ ] Update top-level project documentation and installation commands.
- [ ] Keep the Workmangr reference and ported regressions for historical context.

### Tests likely needed

- [ ] Interaction tests only for editor commands with observable behavior.
- [ ] Incremental-versus-full equivalence tests for any incremental subsystem.
- [ ] Cache eviction/invalidation tests for caches that can return stale facts.
- [ ] Persistence/reload test if structural choices are stored outside source text.
- [ ] Performance regression thresholds only after stable representative baselines
  exist.

### Exit gate

- [ ] One WM-owned structural-editor implementation handles the frontend and LSP,
  while TypeScript remains only the semantic engine until a separate project
  intentionally replaces it.

## Cross-phase completion checks

- [ ] Every maintained code file changed by this project is at or below 500 lines,
  or an existing violation is explicitly identified with no added growth and a
  concrete split plan.
- [ ] No feature has a second private parser or recovery interpretation.
- [ ] Every finite buffer still produces a valid structural document.
- [ ] Concrete text remains lossless.
- [ ] Every non-authored structural element is visible or explainable through the
  editor rendering policy.
- [ ] Marks remain the shared source for diagnostics, inlays, and repairs.
- [ ] Structural and semantic diagnostics use the same auditable object model.
- [ ] Workmangr behavior changes are deliberate and recorded.
- [ ] Performance is measured with edit traces, not inferred from microbenchmarks
  alone.
- [ ] Unrelated existing compiler/LSP behavior remains covered during migration.
