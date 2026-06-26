# Structural editor implementation checklist

This checklist turns the advanced structural-editor plans into an execution order. It is subordinate
to:

- [`structural-editor-model.md`](./structural-editor-model.md) for the product model;
- [`tolerance-and-recovery-model.md`](./tolerance-and-recovery-model.md) for marks, fallbacks,
  recovery, and diagnostics;
- [`frontend-v2-migration.md`](./frontend-v2-migration.md) for migration details;
- [`grain-inventory.md`](./grain-inventory.md) for the working predecessor.

The phases are ordered. Items within a phase may move when implementation evidence requires it, but
later phases should not create a second parser, recovery model, or diagnostic format to bypass an
unfinished earlier boundary.

## Testing policy

Tests should protect behavior, compatibility boundaries, recovery invariants, and known regressions.
A mechanical refactor, document update, type-only declaration, or wiring change does not
automatically need its own test when existing tests already exercise it.

Add or update tests when a change introduces or modifies:

- observable compiler/editor behavior;
- a public WM-to-JavaScript or WM-to-TypeScript boundary;
- parsing, fallback, mark, source-map, or inlay behavior;
- process framing, versioning, caching, or invalidation;
- a previously reported regression;
- a performance-sensitive path where accidental repetition is plausible.

Prefer one strong end-to-end test plus focused unit tests for algorithms with many edge cases. Avoid
tests that only duplicate typechecking or implementation details.

## Code-size rule

- [x] Keep every maintained code file at or below 500 lines.
- [ ] Treat Markdown as exempt from the line limit.
- [ ] Treat generated artifacts as reproducible output, not hand-maintained source.
- [x] Choose coherent module boundaries before a file approaches the limit.
- [ ] Split by ownership—lexer, parser forms, recovery, rendering, maps, diagnostics, transport,
      workspace, and features—not arbitrary line ranges.
- [ ] Do not use existing oversized repository files as precedent.
- [ ] When substantially modifying an existing oversized code file, split it when practical and do
      not casually increase the violation.
- [ ] Include a code-file line-count check in phase completion reviews.

## Phase 0 — standalone WM frontend proof

This is the first implementation phase. It verifies the structural frontend inside WM before
importable-library or TypeScript integration work.

### Package skeleton

- [x] Read [`how-to-workman.md`](./how-to-workman.md) and run its recommended small examples before
      choosing frontend module shapes.
- [x] Read [`docs/carriers.md`](../../docs/carriers.md) before designing error flow or FFI-heavy
      APIs.
- [x] Keep new implementation logic in WM; do not add convenience TypeScript or JavaScript helpers.
- [x] Create the frontend-v2 WM package in its intended bootstrap location.
- [x] Add source/span and minimal token/trivia types.
- [x] Add minimal structural node, mark, fallback, and virtual artifact types.
- [x] Keep these as reusable package modules; isolate demonstration code in a separate entry point.

### WM-only vertical slice

- [x] Implement lossless lexing for identifiers, `let`, `=`, semicolons, whitespace, comments, and
      EOF.
- [x] Implement exact concrete rendering.
- [x] Implement enough tolerant parsing for a complete let binding.
- [x] Implement recovery for `let thing =` using an inferred expression hole and missing-semicolon
      mark.
- [x] Distinguish recovery class/severity in the result.
- [x] Emit ordered virtual `?` and `;` artifacts.
- [x] Implement a marked preview comparable in spirit to Workmangr's preview tool.
- [x] Run the proof through `wm run` with no TypeScript import dependency.
- [x] Record any WM language, standard-library, performance, or ergonomics blocker discovered by the
      proof.

### Tests likely needed

- [x] WM assertion: complete sample round-trips exactly.
- [x] WM assertion: incomplete sample returns a valid structural document.
- [x] WM assertion: fallback and mark reference the same recovery identity.
- [x] WM assertion: virtual artifacts render in `?` then `;` order.
- [x] WM assertion: a comment is preserved concretely.
- [ ] A TypeScript process harness is optional at this phase; use it only if needed to run `wm`
      reliably in the existing test suite, not to import frontend code.

### Exit gate

- [x] A non-throwaway frontend-v2 slice demonstrates total recovery and virtual rendering entirely
      within WM.

## Phase A — importable WM libraries

### Compiler API and emission

- [x] Define an explicit library-emission target separate from executable emission.
- [x] Decide the public compiler API name, such as `compileLibraryFile` or an emission-target
      option.
- [x] Prevent library output from invoking `main`.
- [x] Export entry-module WM values through a stable ES module API.
- [x] Keep imported WM modules internal unless re-export is intentionally added.
- [x] Ensure runtime helpers do not leak accidental globals.
- [x] Ensure generated library modules can be imported more than once safely.
- [x] Preserve current executable compilation behavior.
- [x] Document the repository command that builds a WM library artifact.

### Boundary spike

- [x] Add a tiny WM library fixture exporting a pure function over plain values.
- [x] Compile the fixture to JavaScript.
- [x] Import it from TypeScript and call the exported function.
- [x] Verify arrays/records/options needed by the frontend DTO have an intentional boundary
      representation.
- [x] Decide whether the frontend artifact is checked in, generated during tests, or built by a
      dedicated task.

### Tests likely needed

- [x] Compiler test: library output does not call `main`.
- [x] Compiler test: executable output still calls `main` as before.
- [x] Integration test: TypeScript imports generated WM code and calls an export.
- [x] Integration test: two imports/calls do not share unintended mutable state.
- [x] Snapshot or semantic assertion for export names only if naming stability is part of the public
      ABI.

### Exit gate

- [x] A generated WM library is callable from TypeScript through a documented, deterministic build
      path.

## Phase B — frontend package and lossless lexer

### Package and ABI

- [x] Choose the initial source location, preferably `tooling/frontend-v2/` during bootstrap.
- [x] Add schema-versioned public DTO types.
- [x] Define source offsets as UTF-16 code-unit offsets at the JS/TS/LSP boundary.
- [x] Define token, trivia, span, line-map, and concrete-origin types.
- [x] Keep internal WM representations private behind plain-data exports.
- [x] Add one TypeScript loader/adapter as the only direct importer of generated frontend-v2
      JavaScript.
- [x] Add a reproducible frontend artifact build command.

### Lossless lexer

- [x] Implement tokens for the current `wm-mini` grammar.
- [x] Preserve exact concrete token text.
- [x] Preserve whitespace and comments as trivia or explicit tokens.
- [x] Preserve unknown/unlexable text as valid opaque/error tokens.
- [x] Produce line starts once per source snapshot.
- [x] Ensure every concrete character belongs to a token or trivia region.
- [x] Implement concrete rendering from the lexed result.
- [x] Export a temporary `lexRoundTrip(source)` boundary function.
- [x] Review the predecessor lexer at `research/workmangr/src/frontend/lexer.gr` before finalizing
      token policy.

### Tests likely needed

- [x] Golden lexer tests for every token family and trivia form.
- [x] Round-trip tests: rendered concrete text equals input exactly.
- [x] Unicode tests covering astral characters and combining characters.
- [x] Newline tests covering LF, CRLF, empty input, and no final newline.
- [x] Opaque-token test showing unknown text remains owned by the structural result.
- [x] Corpus test over `std/`, `examples/`, and `.wm` fixtures.
- [x] Bounded fuzz/property test for coverage and termination if practical.
- [x] TypeScript integration test calling `lexRoundTrip` through generated JS.

### Exit gate

- [x] Every finite string lexes into a lossless, renderable result with valid offsets.

## Phase C — tolerant parser and structural document

### Structural types

- [x] Define structural node IDs and recovery IDs.
- [x] Define concrete, virtual, error, opaque, and hole node forms.
- [x] Define marks with rule, expectation, observation, recovery, fallback, repair class, pair ID,
      ordering, and dependencies.
- [x] Distinguish user-authored holes from inferred recovery holes.
- [x] Define `OptionalCanonical`, `AutoFix`, and `RecoveryOnly` behavior.
- [x] Define one valid root structural document for every finite buffer.
- [x] Ensure tree mark references point to canonical mark entries rather than divergent copies.

### Parser foundation

- [x] Implement parser state and context-specific synchronization boundaries.
- [x] Implement required-slot helpers that return a value on success and a typed fallback plus mark
      on failure.
- [x] Add progress assertions around repetition and recovery loops.
- [x] Retain skipped/unclassified concrete text in error or opaque nodes.
- [x] Return marks and diagnostics as parse-result data; do not use global buffers.
- [x] Parse current `wm-mini` forms before adding syntax from the larger Workmangr language.

### Grammar coverage

- [x] Imports and JavaScript import forms.
  - [x] Recognize Workman and JavaScript import forms as non-opaque top-level structural items and
        recover missing import terminators without swallowing the following declaration.
  - [x] Recover missing import sources, `import` keywords, named clauses, closing braces, and
        JavaScript namespace aliases while preserving Workman wildcard imports.
  - [x] Recover missing JavaScript import target closers before `import` or EOF while preserving
        subsequent namespace-alias, clause, and terminator recovery order.
- [x] `let`, recursive groups, annotations, and declaration terminators.
  - [x] Preserve shallow `let` type annotations before `=` and recover incomplete annotated bindings
        without splitting the declaration into opaque items.
  - [x] Preserve shallow `let rec ... and ...` groups as one structural declaration and recover a
        missing group terminator before the next top-level declaration.
- [x] Type and record declarations.
  - [x] Recognize shallow top-level `type` and `record` declarations as structural items and recover
        missing declaration terminators before the next top-level declaration.
  - [x] Recover missing declaration names, type-parameter closers, `=`, type bodies, record bodies,
        and nested type-expression delimiters.
- [x] Literals, names, tuples, lists, records, JSON, calls, and projections.
  - [x] Preserve shallow multi-token let expressions, including calls, projections, indexing, and
        operators, through the declaration terminator.
  - [x] Recover unmatched shallow call, tuple/group, list, record, and block delimiters in nesting
        order without swallowing a concrete terminator or following declaration.
  - [x] Cover complete JSON object/array expressions and EOF recovery for damaged nested JSON
        delimiters.
- [x] Blocks, lambdas, pipes/lifts, `if`, and `match`.
  - [x] Recognize bare lambda arrows as shallow lambda expressions and render optional canonical
        unit parameters separately from error recovery.
  - [x] Recover bare lambda expression bodies with separate virtual `{` and `}` artifacts while
        preserving semicolon order.
  - [x] Recognize parenthesized parameter lists as shallow lambda heads, preserve existing body
        blocks, and recover bare or missing bodies with paired braces.
  - [x] Preserve complete shallow `if`/`else` blocks and recover bare or missing branches with
        independent paired braces.
  - [x] Preserve carrier-lift and pipeline expressions, and recover bare lifted-lambda bodies
        without misclassifying ordinary `lift` applications.
  - [x] Recover missing shallow match-arm commas as separate virtual artifacts.
  - [x] Recover bare shallow match-arm bodies with paired virtual block artifacts.
- [x] Patterns and type expressions.
  - [x] Preserve shallow tuple, record/list-like, and constructor let patterns through `=` without
        converting them into error recovery.
  - [x] Recover missing tuple, list, record, and constructor pattern closers before annotations,
        required slots, EOF, or following declarations.
  - [x] Preserve shallow function, tuple, variable, named, and generic type expressions while
        recovering missing nested delimiters.
- [x] Top-level unknown/error regions.
- [x] EOF and incomplete forms at each required slot.
  - [x] Recover missing expression closers at EOF before synthesized branch/block closers and the
        top-level terminator.
  - [x] Recover missing pattern closers before inferred `=`, expression holes, and terminators at
        EOF.
  - [x] Recover missing type/record declaration slots and nested type closers before the EOF
        terminator.
  - [x] Recover missing import spine/clause slots and clause closers before the EOF terminator.
  - [x] Recover missing JavaScript import target closers before remaining EOF import slots.

### Virtual rendering and maps

- [x] Implement virtual rendering from structural nodes and marks.
- [x] Emit virtual artifacts with anchor, text, order, class, pair ID, and recovery provenance.
- [x] Implement concrete-to-virtual and virtual-to-concrete piece maps.
- [x] Preserve the order of several virtual tokens at one anchor.
  - [x] Sort artifacts by concrete anchor and backend structural order after independent recovery
        passes contribute insertions.
- [x] Keep virtual insertions out of comments and opaque regions unless the mark explicitly belongs
      at their boundary.
- [x] Keep concrete rendering exact and independent from canonical formatting.

### Auditable structural diagnostics

- [x] Extend diagnostic severity with information/hint if required by policy.
- [x] Add syntax predicates and syntax violations to the wm-mini diagnostic model.
- [x] Add recovery anchors and `RecoveryEntry` support evidence.
- [x] Replace always-empty repairs with justified structured repairs.
- [x] Map mark rule/path to `failure.frame`.
- [x] Map expectation to `failure.premise`.
- [x] Map observation to `failure.violation`.
- [x] Map fallback/recovery to support evidence.
- [x] Keep optional canonical explanations available without necessarily filling the Problems panel.
- [x] Prevent one recovery event from producing duplicate primary diagnostics.

### Workmangr behavior to port first

- [x] `let thing =` structurally becomes `let thing = ?;`.
- [x] `let =` receives a virtual pattern, expression hole, and semicolon.
- [x] Missing top-level semicolon preserves later declarations.
- [x] Missing match-arm commas remain separate artifacts.
  - [x] Shallow match-arm comma recovery emits an independent `,` artifact between arms.
- [x] Missing lambda/clause blocks preserve brace/comma/semicolon order.
  - [x] Bare lambda bodies recover `{`, `}`, and `;` as separate ordered artifacts.
  - [x] Bare match-arm bodies recover paired braces, with `}` ordered before a missing `,` at a
        shared anchor.
- [x] Shared-anchor artifacts follow backend structural order.
- [x] Optional unit parameters remain distinct from error recovery.
- [x] Comments and opaque regions do not receive spurious artifacts.
- [ ] Compare behavior with `research/workmangr/tests/lsp_inlay_test.gr` and `format_test.gr`.
  - [x] Port frontend-v2-relevant match-arm block, shared-anchor brace/comma, bare-lambda,
        missing-let-hole, wildcard-binder, and import-format regression expectations.

### Tests likely needed

- [x] Complete-syntax parser goldens for each supported construct.
  - [x] Cover complete Workman imports, JavaScript imports, let declarations, type declarations,
        record declarations, lambdas, lifts, if/else, match, tuple/list/record literals, and
        pipelines with lossless no-mark goldens.
- [x] Incomplete-syntax goldens containing structural tree, marks, virtual text, and diagnostics.
- [x] Invariant test: every finite fixture returns a valid structural document.
- [x] Corpus test: current repository `.wm` files parse into valid structural documents without
      top-level opaque items.
- [x] Invariant test: every fallback references exactly one recovery mark.
- [x] Invariant test: every concrete character survives concrete rendering.
- [x] Invariant test: applying artifacts in declared order equals virtual rendering.
- [x] Progress/termination tests for damaged lists, blocks, matches, and declarations.
  - [x] Cover current shallow declaration and tail-consumption loops with a bounded progress
        invariant.
  - [x] Cover damaged shallow match blocks and arms with the bounded progress invariant.
  - [x] Cover damaged shallow parameterized lambdas with the bounded progress invariant.
  - [x] Cover damaged shallow lifted lambdas with the bounded progress invariant.
  - [x] Cover damaged shallow `if` conditions and branches with the bounded progress invariant.
  - [x] Cover unmatched shallow expression delimiters with the bounded progress invariant.
  - [x] Cover damaged nested JSON expression delimiters at EOF with the bounded progress invariant.
  - [x] Cover unmatched shallow pattern delimiters with the bounded progress invariant.
  - [x] Cover damaged shallow type parameters, type expressions, and record bodies with the bounded
        progress invariant.
  - [x] Cover damaged Workman and JavaScript import spines/clauses with the bounded progress
        invariant.
- [x] Tests distinguishing optional, auto-fix, and recovery-only marks.
- [x] Tests distinguishing user-authored and inferred holes.
- [x] Diagnostic shape tests for rule, premise, violation, recovery evidence, and justified repairs.
- [ ] Port the relevant Workmangr regression expectations before inventing new ones.
  - [x] Port the bare match-arm block and shared-anchor brace/comma ordering expectations from
        `research/workmangr/tests/lsp_inlay_test.gr`.
  - [x] Port the Workman wildcard import regressions from
        `research/workmangr/tests/lsp_inlay_test.gr`.

### Exit gate

- [ ] Every finite buffer has a valid, lossless structural interpretation with deterministic marks,
      diagnostics, and virtual rendering.
  - [x] Current repository `.wm` corpus parses deterministically with identical marks, diagnostics,
        virtual artifacts, maps, and concrete rendering across repeated runs.
  - [x] Bounded generated finite strings parse deterministically and rebuild virtual text from
        ordered artifacts.

## Phase D — semantic projection and compiler comparison

### Semantic projection

- [x] Define the schema-versioned semantic projection DTO.
- [ ] Project complete structural nodes into the current TypeScript `Module` shape.
  - [x] Project complete simple `let name = value;` declarations into the current TypeScript
        `Module`/`LetDecl`/`PVar`/`Var` shape.
  - [x] Project complete simple `let _ = value;` declarations into the current TypeScript
        `Module`/`LetDecl`/`PWildcard` shape.
  - [x] Project complete simple nullary constructor-pattern let declarations into the current
        TypeScript `Module`/`LetDecl`/`PCtor` shape.
  - [x] Project complete simple bool, int, string, and void pattern let declarations into the
        current TypeScript `Module`/`LetDecl` pattern shape.
  - [x] Project complete simple let declarations with single-token int, float, string, bool, and
        void literal expressions.
  - [x] Match Peggy's current top-level `let` export flag for the supported simple-let subset.
  - [x] Preserve and project simple `TName` annotations on complete simple let declarations.
  - [x] Preserve and project generic `TName<...>` annotations on complete simple let declarations.
  - [x] Preserve and project `TVar` annotations on complete simple let declarations.
  - [x] Preserve and project tuple and function annotations on complete simple let declarations.
  - [x] Preserve and project the `rec` flag on complete simple let declarations.
  - [x] Prevent `let ... and ...` groups from silently projecting only the first binding; report
        them as unsupported until all bindings are represented.
- [ ] Define projections for holes, error nodes, missing names, and skipped declarations.
  - [x] Project recovered let holes, authored expression holes, and opaque skipped declarations with
        explicit semantic status.
- [x] Preserve structural IDs and recovery provenance through projection.
- [x] Keep authored versus recovered semantic facts distinguishable.
- [ ] Keep all DTO translation in one TypeScript adapter.
  - [x] Add a dedicated frontend-v2 semantic adapter that converts semantic DTOs to TypeScript
        `Module` results and reports unsupported/recovered declarations instead of inventing
        bindings.
  - [x] Split WM semantic DTO translation from lexical/structural DTO translation before the
        frontend DTO module reached the maintained-file line limit.

### Dual-frontend migration

- [ ] Add `v1`, `v2`, and `compare` frontend modes internally.
  - [x] Add a compiler/module-graph frontend mode option with default/explicit `v1` behavior and
        explicit compiler gates for unfinished `v2` and `compare` execution.

### Minimum real v2 LSP slice

This slice is the next high-level target before full AST coverage. The goal is not to cover the
whole language yet; it is to choose a small, coherent subset that proves the current compiler,
LSP, and editor extension can run in a real `frontend: "v2"` mode. The representative editor test
case is: a user edits a small multi-file program, leaves a recoverable syntax issue such as a
missing semicolon, and the LSP still typechecks the rest of the file through frontend v2 while
reporting the recovery as a warning or information diagnostic.

Full AST coverage remains required before frontend v2 becomes the default, but it is explicitly
not required for this milestone.

- [ ] Define the supported-source contract for the first real v2 LSP mode.
  - [ ] Chosen first subset:
    - [x] Named Workman imports, including aliases, for small multi-file fixtures.
    - [x] Top-level non-grouped `let` bindings with annotations and recovered declaration
          terminators.
    - [x] Simple patterns already covered by the semantic adapter: variables, wildcard, nullary
          constructors, and literal patterns.
    - [x] Expression forms needed for the first fixtures: variables, literals, `void`,
          parenthesized single expressions, and simple calls.
    - [x] Type expressions needed for annotations and imported signatures used by the chosen
          fixtures.
  - [ ] Explicitly deferred from the first subset unless a gate fixture proves it is necessary:
    - [ ] Wildcard imports.
    - [ ] Namespace imports and qualified variable expressions such as `Lib.value`.
    - [ ] Tuple expressions.
    - [ ] Full declaration/expression/pattern/type AST coverage.
  - [x] Explicitly reject unsupported declarations and expressions with frontend-v2 diagnostics;
        do not silently drop them from the module.
- [ ] Build a small v2-mode fixture corpus for the slice.
  - [x] Single-file fixture: complete simple program typechecks through frontend v2.
  - [x] Single-file fixture: missing top-level semicolon produces a structural diagnostic and still
        allows independent later bindings to typecheck through frontend v2.
  - [x] Multi-file fixture: imported binding is resolved and typechecked through frontend v2.
  - [x] Multi-file fixture: named import alias is resolved and typechecked through frontend v2.
  - [x] Multi-file fixture: unsaved imported source override is resolved and typechecked through
        frontend v2.
- [ ] Treat this slice as the first editor-extension v2 gate.
  - [x] `validateUri` can route semantic analysis through frontend v2 for the minimum slice and
        publish structural diagnostics from the same frontend-v2 source.
  - [x] The VS Code/LSP v2 mode may be exposed for this subset only after `validateUri`, module graph
        loading, and hover use frontend v2 for the same files.
    - [x] Thread frontend mode through the server validation, project-index dependency tracking, and
          hover analysis entry points.
    - [x] Add VS Code `wmMini.frontendMode` setting and pass it to the server process.
    - [x] Add VS Code `wmMini.frontendV2ModulePath` setting and document the required generated
          frontend-v2 artifact build step.
    - [ ] Add source-span parity and v2 hover behavior tests before treating hover quality as
          complete.
      - [x] Attach frontend-v2 source spans for minimum-slice let declarations, simple patterns,
            atom expressions, and simple calls.
      - [x] Add v2 hover tests for top-level simple-let bindings, variable uses, and simple call
            callees.
      - [x] Add a source-span regression where repeated RHS text is anchored after the binding
            equals instead of reusing the pattern span.
  - [x] Document unsupported syntax in the mode as a known limitation rather than falling back to
        Peggy for semantic analysis.
  - [x] Add explicit launch/extension smoke tests for selecting frontend-v2 mode with the generated
        artifact path and receiving v2 diagnostics.
    - [x] LSP server launch test verifies `WM_MINI_FRONTEND=v2` publishes v2 structural diagnostics.
    - [x] VS Code extension config test verifies frontend-v2 mode and generated artifact path are
          passed into the Deno server environment.

- [ ] Run Peggy and frontend v2 over the same valid-source corpus.
  - [x] Add a supported-source semantic comparison harness that runs Peggy and frontend v2 over the
        same simple-let corpus.
  - [x] Include named Workman imports and named import aliases in the supported-source comparison
        corpus.
  - [x] Include wildcard simple let declarations in the supported-source comparison corpus.
  - [x] Include nullary constructor-pattern simple let declarations in the supported-source
        comparison corpus.
  - [x] Include bool, int, string, and void pattern let declarations in the supported-source
        comparison corpus.
  - [x] Include typed simple let declarations in the supported-source comparison corpus.
  - [x] Include nested generic typed simple let declarations in the supported-source comparison
        corpus.
  - [x] Include type-variable annotations in the supported-source comparison corpus.
  - [x] Include tuple and function annotations in the supported-source comparison corpus.
  - [x] Include recursive simple let declarations in the supported-source comparison corpus.
- [ ] Normalize irrelevant node-ID/metadata differences before comparison.
  - [x] Normalize the currently supported semantic subset to plain declaration, binding, pattern,
        and atom-expression data before comparison.
- [ ] Record and justify intentional semantic or span differences.
- [ ] Run compiler/check tests in v2 mode.
- [ ] Measure lexing, parsing, DTO construction, adaptation, and total compile time.
- [ ] Define the bootstrap artifact policy before frontend v2 becomes the default.

### Recovery-aware semantics

- [ ] Decide the initial TypeScript representation of `HoleExpr`, `ErrorExpr`, `HolePattern`,
      `ErrorType`, and `ErrorDecl`.
- [ ] Give inferred holes fresh types with recovery provenance.
- [ ] Prevent error declarations/opaque regions from inventing bindings.
- [ ] Attach recovery dependencies to semantic diagnostics.
- [ ] Suppress diagnostics caused solely by uninteresting fallback artifacts.
- [ ] Retain useful conflicts supported by authored context, including unfillable holes.

### Tests likely needed

- [ ] Normalized v1/v2 AST comparison over repository sources.
- [ ] Compiler test suite under v2 mode.
- [x] Minimum-slice compiler tests where v2 typechecks simple complete and missing-semicolon
      programs without invoking Peggy for semantic analysis.
- [x] Minimum-slice module graph tests where v2 resolves imports from disk and source overrides.
  - [x] Minimum-slice compiler/LSP tests where v2 resolves named import aliases.
- [ ] Source-span parity tests for nodes used by hover and diagnostics.
  - [x] Minimum-slice v2 hover tests cover spans for simple let patterns, variable uses, and call
        callees.
  - [x] Source-span regression covers repeated RHS text that matches the binding pattern.
- [ ] Recovery test: missing semicolon does not suppress independent inference.
  - [x] LSP validation v2-mode test: missing semicolon publishes a structural warning while
        independent later bindings still typecheck through frontend v2.
- [ ] Recovery test: hole receives an expected type from authored context.
- [ ] Cascade test: fallback-only noise is suppressed or depends on the mark.
- [ ] Diagnostic test: authored contradictions remain visible near recovered syntax.
- [ ] Performance baseline for v1, v2, and adapter overhead.

### Exit gate

- [ ] Frontend v2 produces compiler-compatible semantics for supported source, and every known
      difference from Peggy is intentional and documented.

## Phase E — compiler and current-LSP adoption

The next high-level target is a real frontend-v2 mode for the current compiler,
LSP, and editor extension. This must replace the parser used for semantic
analysis, module graph loading, hover, and diagnostics. A structural-only
sidecar mode is intentionally out of scope: it would let frontend v2 recover and
render syntax while the typechecker still depends on Peggy/v1, which would not
test the editor mode that matters. The plan should therefore advance only modes
where frontend v2 is the parser feeding semantic analysis; structural display on
top of v1 typechecking is not a milestone for this project.

### Compiler adoption

- [ ] Enable real compiler `compare` mode: run frontend v1 and frontend v2 over the same
      source, keep v1 semantics only as the execution oracle, and fail/report unexplained
      normalized differences.
  - [x] Cover compare mode on the first supported single-file simple-let and simple-call corpus.
  - [x] Cover compare mode on the first supported multi-file named-import alias corpus.
- [ ] Enable real compiler `v2` mode for the supported semantic subset by routing parsing
      through frontend v2's semantic projection instead of Peggy.
- [ ] Run representative compiler/check tests with `frontend: "v2"` before any editor-facing
      v2 mode is exposed.
- [ ] Make frontend v2 the default compiler frontend after comparison parity.
- [ ] Retain a short-lived v1/debug mode rather than permanent user-facing dual parser
      configuration.
- [ ] Ensure module graph loading uses frontend v2 consistently for disk and in-memory source
      overrides.
- [ ] Publish structural diagnostics from the same frontend-v2 parse used for semantic analysis.
- [ ] Apply batch acceptance policy to recovery-only marks without invalidating the structural
      document model.
- [ ] Remove Peggy once the comparison soak period is complete.

### Current TypeScript LSP improvements

- [x] Add an editor/LSP frontend-v2 mode only after `validateUri` can route semantic analysis
      through frontend v2; do not add a structural-only sidecar mode.
  - [x] Add the `validateUri` frontend option and cover v2 validation for the minimum real-v2 slice.
- [x] Pass the selected frontend mode from the VS Code extension to the LSP server.
  - [x] Pass the optional generated frontend-v2 artifact path from the VS Code extension to the LSP
        server.
- [x] Thread frontend mode through validation, module graph loading, hover, and dependency
      invalidation.
- [x] Cache the active frontend-v2 parse result by URI and document version.
  - [x] Add an LSP frontend-v2 parse cache keyed by URI, source text, and optional document version.
  - [x] Thread the cache through server validation and clear closed-document entries.
  - [x] Cover cache reuse, source invalidation, version invalidation, and explicit delete.
- [x] Publish multiple structural diagnostics from the active frontend-v2 parse result.
  - [x] Add validation and server tests where one v2 document publishes two missing-semicolon
        structural diagnostics while semantic analysis succeeds.
- [ ] Add `textDocument/inlayHint` for structural virtual artifacts.
- [ ] Keep structural and type inlays independently configurable.
- [ ] Analyze the semantic projection through recoverable syntax.
- [ ] Project semantic facts through the concrete/virtual source map.
- [ ] Preserve existing hover, definitions, module diagnostics, and dependency invalidation.
- [ ] Discard results computed for stale document versions.
- [ ] Add a marked preview helper comparable to Workmangr's `lsp_preview.ts`.

### Tests likely needed

- [ ] Current compiler and LSP suites using real frontend-v2 mode, where v2 is the parser feeding
      semantic analysis.
- [x] LSP/editor-extension launch test that selects v2 mode and verifies diagnostics are produced
      through the v2 validation path.
- [ ] LSP protocol test for structural inlay capability and responses.
- [ ] LSP test for shared-anchor token order.
- [ ] LSP test for range filtering and valid UTF-16 positions.
- [ ] LSP test for multiple diagnostics from one incomplete document.
- [ ] LSP test for stale-version result rejection.
- [ ] Module test: an edited dependency refreshes affected open documents.
- [ ] Preview goldens ported from Workmangr structural cases.
- [ ] Edit-trace benchmark on representative complete and incomplete files.

### Exit gate

- [ ] The existing TypeScript LSP acts as a real frontend-v2 structural-editor renderer before
      transport is rewritten in WM.

## Phase F — WM structural-editor LSP

### Host substrate

- [ ] Implement JSON-RPC message types and dispatch in WM.
- [ ] Implement byte framing with partial headers, partial bodies, and multiple messages per chunk.
- [ ] Serialize stdout writes; send logs only to stderr.
- [ ] Implement initialize, initialized, shutdown, and exit lifecycle.
- [ ] Implement full-sync open/change/close document state first.
- [ ] Implement line maps, URI/path handling, and document versions.
- [ ] Add stale-result and cancellation policy before concurrency.
- [ ] Benchmark cold startup and framing throughput.

### Frontend and feature integration

- [ ] Import frontend v2 directly as a WM module.
- [ ] Do not duplicate parser, recovery, virtual renderer, or diagnostic logic in the server.
- [ ] Add structural inlays and structural diagnostics first.
- [ ] Define a narrow plain-data bridge to TypeScript semantic services.
- [ ] Add type inlays and hover.
- [ ] Add definitions and module-aware invalidation.
- [ ] Add formatting/materialization commands.
- [ ] Preserve Workmangr preview and inlay behavior unless a change is documented.

### VS Code rollout

- [ ] Add extension configuration for selecting the WM server during migration.
- [ ] Keep a temporary TypeScript-server fallback.
- [ ] Add separate controls for structural tokens, type inlays, and diagnostic visibility.
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

- [ ] The WM server is the default structural-editor LSP and the TypeScript server is retained only
      as a temporary fallback.

## Phase G — advanced editing, incrementality, and cleanup

### Structural interactions

- [ ] Add explanation UI for virtual tokens and marks.
- [ ] Add explicit materialization actions for safe completions.
- [ ] Add interpretation/ambiguity choices where the model supports alternatives.
- [ ] Add structural selection ranges and folding.
- [ ] Add semantic styling/decorations when inlay styling is insufficient.
- [ ] Explore direct manipulation of holes and virtual structure within VS Code's extension limits.
- [ ] Decide whether any interpretation choices require persistent sidecar metadata or must become
      concrete edits.

### Performance and incrementality

- [ ] Reproduce Workmangr edit/hover benchmarks for frontend v2 and the WM server.
- [ ] Profile before selecting incremental algorithms.
- [ ] Add bounded caches with explicit owners and invalidation rules.
- [ ] Add incremental line maps only if measured.
- [ ] Add token reuse and subtree correspondence only if measured.
- [ ] Add worker isolation or concurrency only after version/state ownership is explicit.
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
- [ ] Performance regression thresholds only after stable representative baselines exist.

### Exit gate

- [ ] One WM-owned structural-editor implementation handles the frontend and LSP, while TypeScript
      remains only the semantic engine until a separate project intentionally replaces it.

## Cross-phase completion checks

- [ ] Every maintained code file changed by this project is at or below 500 lines, or an existing
      violation is explicitly identified with no added growth and a concrete split plan.
- [ ] No feature has a second private parser or recovery interpretation.
- [ ] Every finite buffer still produces a valid structural document.
- [ ] Concrete text remains lossless.
- [ ] Every non-authored structural element is visible or explainable through the editor rendering
      policy.
- [ ] Marks remain the shared source for diagnostics, inlays, and repairs.
- [ ] Structural and semantic diagnostics use the same auditable object model.
- [ ] Workmangr behavior changes are deliberate and recorded.
- [ ] Performance is measured with edit traces, not inferred from microbenchmarks alone.
- [ ] Unrelated existing compiler/LSP behavior remains covered during migration.
