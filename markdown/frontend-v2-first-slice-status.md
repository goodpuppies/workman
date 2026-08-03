# Frontend-v2 first slice status

Updated: 2026-07-30

## Goal

The first slice is shippable when:

1. the generator covers the complete Peggy grammar with no unknown or unemitted rule, and
   frontend-v2 matches the frozen Peggy-derived acceptance set for every `.wm` file under
   `examples`;
2. every parity-valid grammar form has enough Surface structure for canonical whitespace formatting;
3. canonical formatting is deterministic and idempotent;
4. committed missing `;`, `{`, and `}` positions create marks;
5. ordinary formatting omits those fallbacks and fix formatting materializes only those fallbacks.

Semantic AST parity, semantic lowering, arbitrary malformed-input totality/losslessness, generalized
recovery, structural inlays, LSP integration, and default-parser rollout are not first-slice gates.

## Ship checklist

- [x] Normalize every Peggy construct currently used by `src/grammar.peggy`.
- [x] Give every grammar action a stable identity and classification.
- [x] Inventory initializer state/helpers without compiling embedded JavaScript.
- [x] Validate generator exception/action/reference contracts.
- [x] Add a reproducible normalized-grammar golden.
- [x] Add recognizer smoke cases and initial formatter fixtures.
- [x] Prove the normalized IR has recognition parity with Peggy.
- [x] Emit scannerless generated WM recognition modules below 500 lines.
- [x] Prove generated WM recognition parity for every `.wm` file under `examples`.
- [x] Generate the grammar-complete formatting Surface schema.
- [x] Construct that Surface tree for parity-valid example input.
- [x] Implement canonical whitespace rendering for every valid form exercised by the complete
      examples corpus and focused grammar-family fixtures.
- [x] Add committed missing-`;` recovery marks.
- [x] Add committed missing-`{`/`}` recovery marks.
- [x] Implement ordinary and fix projections over one traversal.
- [x] Pass focused spacing/block/recovery fixtures.
- [x] Pass corpus formatting authored-content preservation, determinism, and idempotence.
- [x] Record a parse/format performance baseline and investigate material regressions.

## Current work

The original formatter slice and its parser-correctness extension pass. Frontend-v2 is generated
from the syntax intended for this first release.

Frontend-v2 is now the packaged default compiler, CLI, REPL, and LSP parser. The repository-wide
default-v2 release soak passes all 856 tests. Keep broader recovery and arbitrary malformed-input
totality deferred.

## Parser-correctness extension

- [x] Add explicit nominal record expressions such as `SomeRecord{ x = "a" }`, including empty,
      qualified, punning, and spread forms; retain `.{ ... }` and ordered `SomeRecord(...)`.
- [x] Replace function-type `=>` with right-associative `->`.
- [x] Add lightweight chained curried lambdas.
- [x] Complete expression and pattern type constraints.
- [x] Reject redundant direct payload binders such as `Ctor(Var(x))` and migrate them to `Ctor(x)`.
- [x] Regenerate both Peggy-derived parsers and pass focused compiler/formatter tests plus every
      `.wm` file under `examples`.

Mutually recursive datatype groups, simultaneous alias groups, `private`, and `withtype` remain
separate later slices.

## Parser direction after this slice

Frontend-v2 is Workman's runtime parser, not only a formatter parser.
After the formatter slice, parser development remains an ongoing direction rather than another large
shipping gate. Parser fixes, new syntax, diagnostics, and performance work should generally advance
the generated parser. Do not add a second Workman runtime path.

The executable Workman Peggy parser is deleted. Peggy remains only as build-time infrastructure for
reading `grammar.peggy` into the generator's AST; it also generates the separate WMSML parser.
The initial 99-file recognition and normalized semantic/span baseline was captured from Peggy before
retirement and is now a checked-in golden. Compatible compiler behavior matters; duplicating Peggy's
internal implementation does not. This direction is not an additional gate on the first shippable
formatter slice.

For ongoing parser work:

- make grammar and generator changes feed frontend-v2 rather than maintaining parallel parsers;
- keep the exact repository corpus and semantic/span golden synchronized through explicit reviewed
  snapshot changes;
- improve recovery, diagnostics, losslessness, totality, and performance incrementally without
  making all of them prerequisites for the first formatter release;
- prevent production or tests from reintroducing an executable Workman parser beside frontend-v2.

### Next parser slice

- [x] Replace emitter-internal `;`/brace rule lists with explicit validated recovery annotations.
- [ ] Derive conservative continuation/FIRST evidence from the Peggy AST for additional required
      token sites.
- [ ] Add one additional uniquely determined exact token family, starting with committed closing
      `)`, without making general malformed-input totality a prerequisite.
- [ ] Prove ordinary formatting omits the new fallback, fix formatting materializes only eligible
      marks, later syntax survives, and valid-source semantic/span goldens remain unchanged.

### Peggy runtime retirement checklist

- [x] Project every constructor exercised by all Peggy-valid `.wm` examples directly from the
      generated Surface tree, including existing desugarings.
- [x] Match Peggy semantic AST fields across that corpus after erasing parse-local node metadata and
      normalizing option encoding.
- [x] Route compiler `v2` and `compare` modes through that Surface projection.
- [x] Reach source-node/span parity across the examples corpus.
- [x] Expand semantic and source-location parity across every `.wm` file under `std`, `examples`,
      and `tooling`.
- [x] Drive committed `;`, `{`, and `}` diagnostics and inlays from generated Surface recovery
      marks, with document/version caching.
- [x] Preserve a bounded farthest failure offset, expectation, and grammar rule for generated
      rejections, and surface it as compiler/LSP `ParseError` provenance.
- [x] Remove the earlier handwritten parser/DTO path from live compiler and LSP use; retire its
      generalized hole diagnostics instead of carrying them into this slice.
- [x] Rebaseline generated failure-provenance overhead before the default soak.
- [x] Package one generated frontend asset and make it the default compiler/CLI/REPL/LSP parser.
- [x] Soak the default frontend across the repository suite, including generated recognition and
      semantic/span parity gates.
- [x] Remove frontend selection from the LSP and VS Code extension; their sole Workman parser is the
      generated frontend, with only an optional artifact-path override.
- [x] Remove production compiler `compare` mode; dedicated differential tests remain the parity
      authority without parsing every runtime compilation twice.
- [x] Isolate and remove the remaining explicit Workman `v1` compiler path; Peggy remains only as
      build-time grammar/generator infrastructure.
- [x] Replace the v1 frontend build with a tracked stage-0 frontend-v2 artifact that reproducibly
      compiles its own successor.
- [x] Move ordinary compiler, Core, inference, FFI, module, binding-fact, and wmslang AST tests off
      the Peggy oracle before retiring it.
- [x] Isolate the executable Peggy wrapper and generated artifact entirely under `tests` before
      retirement.
- [x] Freeze the complete 99-file Peggy-derived recognition and normalized semantic/span baseline as
      a compact checked-in golden, including the exact invalid-file set.
- [x] Retire the test-only executable Peggy parser after generated-parser conformance coverage can
      stand on its own; Peggy may remain solely as grammar/generator infrastructure.

## Work log

### 2026-07-30 — recovery selection moved into the generator contract

- Replaced hard-coded recovery rule sets in the compiled-probe emitter with 26 explicit annotations
  covering the shipped missing-`;`, `{`, and `}` sites. The generator report and recognizer manifest
  now expose the exact rule/token, commitment description, and synchronization boundary inventory.
- Contract validation rejects unknown rules, duplicate rule/token sites, empty commitment or
  synchronization metadata, and tokens that are not required literals in the annotated Peggy rule.
  A focused emission test proves that recovery calls disappear when the annotations are absent.
- Regeneration leaves the packaged frontend byte-identical at SHA-256
  `43396edb16b7f4cecb18d180f45d5523dfa65bf331424e1227b2a3090341e05a`.
  All 11 grammar-IR tests and all 24 generated parser/formatter tests pass, including the complete
  repository semantic/span golden.
- The next bounded parser step is conservative continuation evidence and committed closing-`)`
  recovery. Broader losslessness, islands, and arbitrary malformed-input totality remain separate.

### 2026-07-30 — green repository release soak

- Resolved the six stale or environment-sensitive expectations found by the first default-v2 audit:
  deterministic Task input, nullable child-process exit status, precise GPU diagnostics, the current
  installer banner, complete wmslang occurrence evidence in a backend test double, and the current
  schema-v2 environment diagnostic.
- The authoritative full repository run passes all 856 tests in 20m59s. This includes the complete
  examples formatter gate, the 99-file semantic/span golden, grammar-IR recognition, generated
  parser recovery and formatting, compiler/CLI/LSP integration, self-hosting, wmslang lowering, and
  WebGPU render coverage.
- The first formatter slice therefore has a green release soak. Fully lossless/total malformed-input
  parsing and broader recovery remain later parser work rather than release blockers.

### 2026-07-30 — executable Workman Peggy parser retired

- Captured SHA-256 hashes of Peggy's normalized semantic AST including source spans for all 99
  `.wm` files under `std`, `examples`, and `tooling`. The golden records exactly one rejection,
  `examples/exercises/tree.wm`.
- Proved that regenerating the complete golden through frontend-v2 is byte-identical to the initial
  Peggy-derived file, then changed the updater to use frontend-v2 for explicit reviewed snapshot
  changes.
- Replaced live recognition comparisons with three independent checks: the normalized grammar-IR
  interpreter, the generated strict/tolerant parser, and the frozen semantic/span golden. Negative
  smoke cases must either reject or recover with an actual planned `;`, `{`, or `}` mark.
- Deleted the executable Workman Peggy artifact, its test wrapper, asset-generation hook, and profile
  label. Peggy remains only to expose the grammar AST to generation and to build the separate WMSML
  parser.
- All ten grammar-IR tests and all 24 generated parser/formatter tests pass without the oracle. The
  latter completes every-example recognition/format/semantic/idempotence checks plus the full
  repository semantic/span golden in 4m47.

### 2026-07-30 — ordinary tests retired from the Peggy oracle

- Migrated twelve compiler, Core, inference, FFI, directive, module-interface, binding-fact, and
  wmslang suites from `parseWorkmanPeggy` to the generated `parseCompilerModule` entry point.
  Ordinary tests now exercise the parser shipped to users instead of silently retaining a second
  Workman frontend.
- Made directive validation a shared post-projection step. Frontend-v2 now rejects unknown and
  duplicate directives with the same located `ParseError` behavior previously applied only by the
  generated Peggy/WMSML adapter.
- Updated two stale strict-Peggy expectations exposed by the migration. A missing `@gpu` semicolon is
  targeted recovery: ordinary formatting preserves the omission and fix formatting materializes
  it. Unsupported-syntax rejection fixtures now use forms that cannot be reinterpreted through the
  intentional missing-semicolon recovery.
- Moved the oracle wrapper from `src` to `tests`. Only the grammar-IR recognizer comparison,
  generated Surface differential, and dedicated compiler-frontend parity suite import it.
- The 28 dedicated grammar/compiler-frontend tests pass. All parser-dependent assertions in the
  migrated suites pass; their two observed failures are already recorded unrelated expectations:
  one environment-sensitive real-network Task output assertion and one GPU diagnostic wording
  assertion. `deno task check` remains green.

### 2026-07-30 — generated matcher stack-depth reduction

- The repository semantic/span differential exposed a real `RangeError` while frontend-v2 parsed
  `tooling/frontend-v2/generated/compiled_probe_rules_03.wm`. A standalone parse was close to the
  default JavaScript stack limit and took about 7.5 seconds.
- Changed mechanically generated action, label, optional, text-capture, and negative-lookahead
  combinators to wrap an already evaluated match. Their recognition and capture results are
  unchanged, but child rules no longer execute underneath inert wrapper frames.
- Added a focused regression for the generated matcher module. It now parses in about 1.4 seconds,
  and the complete current 99-file `std`/`examples`/`tooling` semantic/span differential passes in
  1m47 without excluding generated sources.
- Replaced the differential's stale 120-file floor with stronger corpus invariants: each root must
  be non-empty, every discovered `.wm` file is compared, and the rejection set must be exactly the
  deliberately invalid `examples/exercises/tree.wm`.
- The complete examples recognition, source-span, formatted-semantic, and idempotence gate passes in
  2m39. The rebuilt self-hosted frontend asset is 1,158,675 bytes with SHA-256
  `43396edb16b7f4cecb18d180f45d5523dfa65bf331424e1227b2a3090341e05a`.

### 2026-07-30 — Workman Peggy runtime isolated

- Removed the explicit compiler `v1` path and routed embedded standard-library Workman modules
  through frontend-v2. Compiler, CLI, REPL, formatter, and LSP now have one Workman runtime parser.
- Removed the superseded handwritten frontend/DTO implementation and its isolated compatibility
  tests. Current formatting, recovery diagnostics, inlays, and semantic lowering share the generated
  Surface program.
- Moved the generated executable Peggy parser under `tests/generated` and made it an explicit
  differential oracle. Production compiler and LSP import graphs no longer contain it; WMSML keeps
  its separate production parser.
- Preserved the compiler-significant `-- @no-prelude` and `// @no-prelude` directive in the Surface
  program and canonical renderer after the stronger formatted-source semantic differential exposed
  its loss.
- Future parser work should advance frontend-v2 and reduce the remaining oracle dependency. The
  executable Peggy parser may be deleted once replacement conformance coverage is sufficient; Peggy
  may remain solely as grammar/generator infrastructure.

### 2026-07-30 — packaged default frontend and repository soak

- Compiled `tooling/frontend-v2/compiler_frontend.wm` into the tracked
  `src/generated/frontend_v2_parser.js` runtime asset. Compiler, formatter, CLI, REPL, and LSP
  defaults now consume that same artifact; WMSML and explicit `v1` remain on the stable parser.
- Removed the handwritten structural parser/DTO from live compiler and LSP paths. Generated Surface
  marks are the only live source of missing `;`, `{`, and `}` diagnostics and inlays; the broader
  recovery-only hole inlays are deliberately deferred.
- Made the tracked frontend-v2 artifact the deliberate stage-0 compiler for its own successor. The
  self-hosted output is byte-for-byte identical: 1,295,403 bytes with SHA-256
  `aa2a889be35db45cafc00482bc0e67e836765226205e7a782a7b6fc73ac960df`. The build fails clearly if
  the tracked seed is absent.
- The full default-v2 repository soak reached 935 passing tests and six failures unrelated to parser
  recognition or lowering. Generated examples recognition parity passed in 3m39, and the complete
  repository semantic/span differential passed in 4m13.
- Corrected two stale soak expectations: strict missing-semicolon rejection now explicitly selects
  `v1`, while disabling all LSP inlay providers also explicitly disables generated structural
  inlays. Both focused tests and `deno task check` pass.

### 2026-07-30 — single LSP frontend

- Removed `workman.frontendMode`, `WORKMAN_FRONTEND`, and LSP initialization-time frontend
  selection. The language server and VS Code extension now have one Workman parser: the packaged
  generated frontend-v2 artifact.
- Retained only the optional frontend artifact-path override used for development and focused
  generated-module tests.
- Made direct LSP validation load generated recovery diagnostics by default instead of requiring an
  explicit `frontend: "v2"` option. WMSML remains excluded from Workman Surface diagnostics.
- `deno task check` and all seven focused default-validation, server-launch, and extension-config
  tests pass.

### 2026-07-30 — runtime compare mode retired

- Removed `compare` from compiler frontend modes and project configuration. Normal compiler calls no
  longer have a path that runs both parsers and returns Peggy's module after comparison.
- Kept the dedicated normalized semantic/span differential harness as test-only migration evidence;
  the complete repository comparison remains stronger than an opt-in runtime mode.
- Converted compiler integration coverage to exercise frontend-v2 directly through the packaged or
  explicitly supplied generated artifact.
- `deno task check`, all 18 compiler frontend-v2 tests, and all 14 WMSML tests pass.

### 2026-07-30 — generated rejection provenance

- Extended the generated PEG runtime result with the farthest failed UTF-16 offset, expectation, and
  owning grammar rule. Successful alternatives retain latent failures across sequence, choice,
  optional, and repetition boundaries, so a failed declaration does not collapse to offset zero
  when `Start` later checks end-of-input.
- Added `parseSurfaceFailure` to the generated WM and TypeScript ABIs. Compiler-v2 now turns a
  generated rejection into the existing located `ParseError` shape, and LSP validation publishes
  that generated range and message without consulting Peggy.
- Failure tracking is enabled only for the diagnostic entry point. The first unbounded
  implementation raised examples parity to 5m10; separating normal capture construction brought it
  back to 3m39. The repository-wide semantic/span differential completes in 4m16. Keep performance
  rebaselining visible before the default soak rather than hiding this cost.
- The generated negative fixture reports offset 9, expected `)`, and rule `LetPattern`; every
  Peggy-rejected repository `.wm` file must now expose a bounded non-empty generated failure.
- `deno task check`, generated reproducibility, the complete 121-file semantic/span differential,
  all 18 compiler frontend-v2 tests, all 11 direct LSP validation/hover tests, and all three
  frontend-v2 LSP server tests pass.

### 2026-07-30 — generated recovery marks in the LSP

- Extended the combined frontend-v2 ABI and LSP parse cache with the generated Surface program.
- Missing `;`, `{`, and `}` diagnostics and structural inlays now come from the generated parser's
  Surface recovery marks. The LSP retains the earlier structural parser only for recovery that is
  deliberately outside the first slice, such as missing-pattern and missing-expression holes.
- Matching legacy punctuation artifacts are de-duplicated during this transition. Existing
  diagnostic codes, line-ending insertion positions, range filtering, and recovery-only `_`/`?`
  inlays remain covered by the focused LSP tests.

### 2026-07-30 — generated Surface-to-compiler projection

- Added a strict loader for the generated parser's native Surface tree. It keys variants by stable
  constructor name rather than Workman's generated JavaScript constructor numbers.
- Added direct Surface-to-compiler lowering for imports, JavaScript imports, let/type/record
  declarations, patterns and constraints, expressions, directives, and Peggy's list, match-function,
  and carrier-lift desugarings. It does not reparse rendered or sliced source text.
- Compiler `v2` and `compare` modes now use this projection. A temporary combined frontend module
  retains the older structural DTO only for hole/generalized editor recovery diagnostics; committed
  punctuation diagnostics use generated Surface marks.
- All 120 Peggy-valid `.wm` files under `std`, `examples`, and `tooling` project without an
  unsupported constructor. Their normalized semantic AST fields and source spans match Peggy
  exactly after erasing only parse-local node IDs and normalizing option encoding; the single
  intentionally invalid example is rejected by both parsers.
- The broader corpus exposed record/list parameter-pattern construction that the examples corpus did
  not exercise. Added Surface builders for those Peggy-derived pattern families and retained the
  500-line handwritten WM module limit.
- `deno task check`, all 17 compiler frontend-v2 tests, all ten direct LSP validation/hover tests,
  all three frontend-v2 LSP server tests, the complete examples formatter gate, and both
  span-sensitive semantic corpus gates pass.

### 2026-07-30 — general expression and pattern type constraints

- Replaced the compiler parser's lambda-call ascription desugaring with explicit `Ascribed` and
  `PAscribed` semantic nodes. Both infer the constrained phrase, elaborate the written type, and
  unify them at the authored constraint site; Core lowering erases the checked wrapper.
- Constraints accept canonical whitespace before `:`, preserve binders and exhaustiveness behavior,
  disambiguate constrained record literals, and retain their colon and grouping ownership in
  frontend-v2's generated Surface tree. Formatting is deterministic and idempotent for expression
  and pattern constraints.
- General-constraint type variables are scoped to one constraint site. Existing let-group and
  lambda-signature annotation variables retain their current shared scopes.
- Regenerated both parser paths. The grammar now has 128 classified rules, 220 mechanical actions,
  13 named actions, no unclassified actions or unresolved references, and hash
  `195621adf008708ca11f8121167021a542a7dfb2f34917ce6b46eaf29071514d`.
- `deno task check`, grammar-IR tests, focused inference/diagnostic/Core tests, 120 affected
  binding/fact/module/FFI/GPU/wmslang tests, and all 18 generated-frontend tests pass. The latter
  again proves Peggy recognition parity, Surface construction, canonical formatting, authored
  content preservation, and idempotence for every `.wm` file under `examples`.
- The repository-wide suite reaches 930 passing tests and the same six audited failures outside
  this slice.

### 2026-07-30 — coordinated function-type arrow

- Replaced function-type `=>` with `->` across the Peggy grammar, generated frontend-v2 parser,
  Surface schema/builders/renderer, compiler-facing annotations, FFI signatures, examples, standard
  library, diagnostics, inferred-type rendering, Core/REPL snapshots, LSP hover/completion/signature
  help/inlays, tests, and current language documentation. Lambda and match arrows remain `=>`.
- Function types are right-associative. The accepted focused forms are `T -> U`, `(T, Y) -> U`,
  `T -> Y -> Z`, `(T -> Y) -> Z`, and `Void -> Z`; standalone `(T)`, `(T) -> U`, and the old
  `(T) => U` type spelling are rejected by both Peggy and the generated frontend.
- Regenerated both parser paths. The grammar now has 127 classified rules, 214 mechanical actions,
  13 named actions, no unclassified actions or unresolved references, and hash
  `5e0dd1c9699974ac7223c2e28a9852dafd3e7412091259a646b0dca40ecabc39`.
- `deno task check`, grammar-IR tests, focused compiler/diagnostic/LSP/FFI suites, the generated
  formatter fixtures, and generated recognition/formatting across every `.wm` example pass. The full
  suite reached 922 passing tests and nine failures; three were the intentionally changed grammar
  count/hash goldens and pass after update. The six remaining failures are outside this slice: one
  live README-content expectation, one child-process output expectation, two GPU diagnostic-message
  expectations, one installer help-banner expectation, and one wmslang backend error-class
  expectation.

### 2026-07-30 — lightweight chained curried lambdas

- Lambda bodies may now be another lambda, so `(a) => (b) => (c) => { ... }` constructs the existing
  nested lambda AST without introducing expression-bodied lambdas.
- The generated frontend-v2 parser consumes the same Peggy rule and its existing recursive Surface
  node renders the chained spelling canonically.
- The current 124-rule grammar hash is
  `1ad3f24f3529d31a5ebd568cfb5817b753f9ba26a7218370a2e35870ea962194`.
- All 42 compiler tests, `deno task check`, frontend-v2 compilation, and all 16 generated-frontend
  tests pass, including every `.wm` example.

### 2026-07-30 — direct constructor payload binders

- Constructor payload identifiers already bind, so `Ctor(Var(x))` is now rejected while `Ctor(x)`
  remains the canonical spelling. Explicit `Var(...)` remains available inside nested tuple/list
  patterns where bare identifiers retain their pinning behavior.
- Migrated the compiler-facing WM frontend sources and affected tests/docs; no positive `.wm` source
  retains the redundant direct form.
- Regenerated the Peggy and WM parsers. The current 124-rule grammar hash is
  `3dc21734f4a9e20989ed98a3c037f421875909802a9051161f2eb139f557ef15`.
- All 16 pattern tests, all 39 module-interface tests, `deno task check`, frontend-v2 compilation,
  and all 15 generated-frontend tests pass, including every `.wm` example.

### 2026-07-30 — explicit nominal record expressions

- Added `RecordName{ ... }` as a real record-expression form with an explicit nominal type target,
  rather than desugaring it to an ordered constructor call.
- Inference resolves local and qualified record names, infers generic arguments from field values,
  records type-reference facts, and reuses existing field, punning, spread, and runtime lowering.
- Regenerated both Peggy and WM parsers. Frontend-v2 constructs and renders a dedicated named-record
  Surface node; the grammar now has 124 classified rules and hash
  `03c5bc49c8603b7d900c8e2167c9d11fba71a93d6c2cc715d860fcf6ef3f82d6`.
- `deno task check`, all 28 record tests, and all 15 generated-frontend tests pass. The latter
  includes recognition and idempotent formatting across every `.wm` example.

### 2026-07-29 — generator boundary

- Added a versioned normalized grammar IR covering 123 rules and all currently used Peggy node
  kinds.
- Verified all 634 rule references resolve.
- Classified 210 actions as restricted portable expressions and 13 as named semantic actions; zero
  remain unclassified.
- Inventoried two initializer state values and 31 named helpers. The formatter plan's earlier count
  of 26 helpers was stale.
- Added generator contract validation, an eight-exception cap, initial fixtures, and the
  `frontend-v2:grammar-report` command.
- Added a structural grammar hash:
  `7393da1db063d16969a96863da188bce5f7a35b1491bda518c23226c0a458982`.

### 2026-07-29 — normalized recognition parity

- Added a recognition-only interpreter over the normalized grammar IR. Actions are transparent
  syntax wrappers; the one bootstrap semantic predicate is an explicit known success.
- Added small positive and negative recognizer smoke cases. These do not define grammar parity.
- Matched Peggy recognition on every `.wm` file under `examples`; the same test also covers `std`
  and `tooling` as additional evidence, for 81 files total.
- Added rule/offset memoization so the corpus comparison remains a small test checkpoint.

### 2026-07-29 — generated WM recognition

- Added a reproducible generator that emits all 123 normalized rules as scannerless WM grammar data.
- Partitioned the output into five rule modules; the largest is 337 lines.
- Added a small hand-written WM PEG recognition runtime. Grammar actions are transparent and the
  known bootstrap predicate is explicit.
- Compiled the generated recognizer through the existing Workman compiler.
- Matched Peggy recognition for every `.wm` file under `examples` (43 files).
- Added reproducibility, module-size, compiler, and end-to-end parity tests.

### 2026-07-29 — formatting Surface schema

- Added a generated, formatting-focused Surface AST with explicit declaration, import, type,
  pattern, expression, block, token, comment, and recovery constructors.
- Used one recursive `SurfaceNode` sum because current Workman does not support forward references
  between separately declared mutually recursive `Expr`, `Decl`, and `BlockItem` types.
- Kept the constructors domain-specific; there is no generic capture-tree layer.
- Classified all 123 Peggy rules as node, list, transparent, token, trivia, or boundary ownership.
- Added a complete rule-to-constructor builder plan: every node-owning rule names its allowed
  Surface constructor(s), and every referenced constructor exists in the generated schema.
- Generated `surface_types.wm` is 111 lines and checks with the existing Workman compiler.

### 2026-07-29 — first direct Surface parse/render slice

- Added a private PEG value stack that preserves sequence, choice, repetition, token, and rule
  results only while rules are completing. It is not exposed as a syntax-tree API.
- Kept generated recognition parity with Peggy for all 43 `.wm` files under `examples` while rule
  completion began constructing explicit Surface constructors.
- Constructed complete Surface programs for type-only inputs, including aliases, variant lists, type
  parameters, nested type arguments, named types, and type variables.
- Expanded direct construction through the let, pattern, lambda, block, if, match, match-function,
  binary-expression, call, tuple/group, and list forms exercised by `examples/exercises/math.wm`.
- Added the handwritten, depth-aware Surface renderer and canonicalized the complete `math.wm`
  program with stable two-space block and match-arm indentation.
- Added `wm fmt [--stdout] <file.wm>` as the user-facing formatter path. It formats in place by
  default; `--stdout` provides the non-mutating projection. The standalone
  `deno task frontend-v2:format` command retained as a development entry point. Both share the same
  TypeScript loader and WM Surface renderer.
- Running the formatter twice on a copy of `math.wm` produced the same SHA-256, and the stable Peggy
  parser accepts the formatted result.
- Added idempotence tests for both the type-declaration slice and the complete math example.
- Surface construction refuses incomplete rule results instead of descending into a private failed
  capture and silently exposing a partial tree.

### 2026-07-29 — direct Peggy-AST parser generation

- Added a direct compiler from every normalized Peggy expression and all 123 rules to readable WM
  parser functions. Generated rule modules are partitioned below 500 lines.
- Generated literals, classes, any-character matches, rule references, sequences, ordered choices,
  optionals, repetition, lookahead, text captures, labels, actions, and semantic-predicate calls
  directly from the Peggy AST; this is no longer a rule-name table around handwritten parsing.
- Generated recursion is passed through one generated rule dispatcher, avoiding cyclic imports
  between partitioned rule modules.
- Direct parser results now carry the private sequence/choice/optional/repeated/label/action/rule
  capture structure needed by Surface construction.
- Embedded Peggy action JavaScript is never executed. Generated calls retain stable action IDs for
  later portable/native WM action binding; the one semantic predicate currently used by the grammar
  remains an explicit native runtime decision.
- The direct generated parser typechecks and matches Peggy recognition while producing a complete
  capture for every `.wm` file under `examples`.
- Surface construction now consumes those generated captures bottom-up and `wm fmt` still formats
  `math.wm` idempotently.
- Removed the superseded grammar-data interpreter and its generated expression-data modules; Peggy
  parity now exercises the same directly generated parser used by Surface construction.
- Split the handwritten Surface construction code into parse-value, shared support, type,
  expression, pattern/block, declaration, dispatch, and capture-conversion modules. Every maintained
  Surface-construction module and every generated frontend-v2 WM module remains below 500 lines.

### 2026-07-29 — generated metadata and import Surface coverage

- Moved token, trivia/boundary, list, and transparent rule classification into generated
  `surface_rule_metadata.wm`; the Surface runtime no longer duplicates those Peggy rule inventories
  by hand.
- Preserved the deepest unresolved capture through transparent rules and exposed a construction-gap
  probe, so corpus work is driven by the first missing Surface owner rather than collapsing every
  failure to `TopPhrase`.
- Added Surface construction and rendering for Workman imports, JavaScript targets, JavaScript
  imports, named/all/namespace clauses, aliases, type-only imports, and import specifications.
- Increased end-to-end canonical and idempotent formatting coverage under `examples` from 7 files to
  12 files through the import family.
- Corrected the authoritative rule classification where `Primary`, binary precedence, pattern, and
  `MatchFnParams` rules had been labeled as generic transparent/list rules despite owning custom
  Surface values. Generated metadata now routes them to their builders.
- Added record declarations and fields, space calls, unary expressions, pipe members and pipe
  expressions, carrier/tuple lifts, record expressions, record fields/spreads, and tuple-pattern
  construction. Pipe-member syntax retains its leading dot instead of becoming a semantically
  different ordinary call.
- Every Peggy-valid `.wm` file currently under `examples` now constructs a Surface tree, renders to
  Peggy-valid canonical text, and is byte-identical after a second formatting pass. Peggy-invalid
  examples remain rejected rather than entering Surface construction.
- Added a generated-capture syntax fingerprint and used it to reject a weaker definition of
  “formatting coverage”: parseable/idempotent output can still omit unsupported authored syntax.
  Added JSON objects/arrays and fields, function types, explicit `Var(...)` patterns, directives,
  panic expressions, and constructor/tuple pattern arguments. The all-examples regression now proves
  authored content preservation (apart from canonical optional trailing commas), Peggy-valid output,
  and second-pass byte identity for every Peggy-valid example.

### 2026-07-30 — committed punctuation recovery and fix projection

- Generated strict and recovering parser dispatch from the Peggy AST. Strict recognition remains the
  Peggy-parity oracle; recovery is entered only for formatting/Surface construction.
- Added declarative recovery sites for committed semicolons and brace-delimited grammar families.
  Opening-brace recovery requires authored body evidence, and three ambiguous ordered-choice rules
  retain explicit authored probing before recovery.
- Threaded fresh recovery identities through capture-to-Surface construction. Every synthesized
  punctuation token carries one ID, every reachable marked slot references it, and
  `SurfaceProgram.marks` records its anchor, expected text, rule site, and `AutoFix` class.
- Added a single renderer traversal with authored and fix projections. Plain `wm fmt` omits marked
  fallbacks; `wm fmt --fix` materializes only marked `;`, `{`, and `}`. Both modes retain in-place
  formatting as the default and support `--stdout`.
- Added focused fixtures for top-level and block-declaration semicolons, missing opening and closing
  braces across lambda/block/record/import/JSON/if families, normal-versus-fix behavior, fixed-text
  Peggy acceptance, and fix idempotence.
- Preserved a concurrent Peggy grammar addition for postfix type ascriptions by adding an explicit
  Surface constructor, builder, renderer, and fixture. Also closed the previously uncovered
  parenthesized-sequence Surface path. The regenerated grammar IR hash is
  `d9bb191c8e9dad43f39e59918e426b2ec8671dd5efddc346b24f9ee72a271b76`.
- The complete generated-frontend regression passed over all 44 `.wm` examples. The 240,235-byte
  corpus costs about 21–22 seconds per generated-WM parse pass on this machine; the comprehensive
  test deliberately performs multiple independent recognition, capture, formatting, fingerprint,
  validity, and idempotence passes and completed in about 2m39s. Timing each pass separately showed
  no recovery-specific outlier; the aggregate runtime is repeated full-corpus traversal.
- `deno task check` passes. The complete `deno task test` run passed 914 tests, including every
  formatter/recovery test, and reported five failures outside this slice: one live GitHub README
  expectation, two GPU diagnostic-message expectations, one installer help-banner expectation, and
  one wmslang backend error-class expectation. None exercises the generated formatter, Surface
  parser, `wm fmt`, or recovery marks.

## Deferred follow-up

- semantic AST/desugaring parity with Peggy;
- compiler semantic lowering and default-parser migration;
- arbitrary malformed-input islands and complete lossless ownership;
- repairs other than `;`, `{`, and `}`;
- generalized FIRST/continuation recovery;
- `Virtual` projection and structural inlays;
- LSP document formatting and rollout.
