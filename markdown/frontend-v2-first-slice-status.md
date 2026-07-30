# Frontend-v2 first slice status

Updated: 2026-07-30

## Goal

The first slice is shippable when:

1. the generator covers the complete Peggy grammar with no unknown or unemitted rule, and
   frontend-v2 matches Peggy recognition for every `.wm` file under `examples`;
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

The original formatter slice passes. Before shipping it, complete the parser-correctness extension
below so frontend-v2 is generated from the syntax we actually intend to ship.

The repository-wide suite still has five failures outside this slice, recorded in the audit below;
resolve or explicitly waive those for a completely green repository release. Keep broader recovery,
arbitrary malformed-input totality, and frontend-v2 semantic lowering deferred.

## Parser-correctness extension

- [ ] Add explicit nominal record expressions such as `SomeRecord{ x = "a" }`, including empty,
  qualified, punning, and spread forms; retain `.{ ... }` and ordered `SomeRecord(...)`.
- [ ] Implement the bounded syntax updates from
  [`smlsyntaxupdates240726.md`](./smlsyntaxupdates240726.md): `->` function types, chained lambdas,
  and expression/pattern type constraints.
- [ ] Reject redundant direct payload binders such as `Ctor(Var(x))` and migrate them to `Ctor(x)`.
- [ ] Regenerate both Peggy-derived parsers and pass focused compiler/formatter tests plus every
  `.wm` file under `examples`.

Mutually recursive datatype groups, simultaneous alias groups, `private`, and `withtype` remain
separate later slices.

## Work log

### 2026-07-29 — generator boundary

- Added a versioned normalized grammar IR covering 123 rules and all currently used Peggy node kinds.
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
- Constructed complete Surface programs for type-only inputs, including aliases, variant lists,
  type parameters, nested type arguments, named types, and type variables.
- Expanded direct construction through the let, pattern, lambda, block, if, match, match-function,
  binary-expression, call, tuple/group, and list forms exercised by
  `examples/exercises/math.wm`.
- Added the handwritten, depth-aware Surface renderer and canonicalized the complete `math.wm`
  program with stable two-space block and match-arm indentation.
- Added `wm fmt [--stdout] <file.wm>` as the user-facing formatter path. It formats in place by
  default; `--stdout` provides the non-mutating projection. The standalone
  `deno task frontend-v2:format` command retained as a development entry point. Both share the same
  TypeScript loader and WM Surface renderer.
- Running the formatter twice on a copy of `math.wm` produced the same SHA-256, and
  the stable Peggy parser accepts the formatted result.
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
- Increased end-to-end canonical and idempotent formatting coverage under `examples` from 7 files
  to 12 files through the import family.
- Corrected the authoritative rule classification where `Primary`, binary precedence, pattern, and
  `MatchFnParams` rules had been labeled as generic transparent/list rules despite owning custom
  Surface values. Generated metadata now routes them to their builders.
- Added record declarations and fields, space calls, unary expressions, pipe members and pipe
  expressions, carrier/tuple lifts, record expressions, record fields/spreads, and tuple-pattern
  construction. Pipe-member syntax retains its leading dot instead of becoming a semantically
  different ordinary call.
- Every Peggy-valid `.wm` file currently under `examples` now constructs a Surface tree,
  renders to Peggy-valid canonical text, and is byte-identical after a second formatting pass.
  Peggy-invalid examples remain rejected rather than entering Surface construction.
- Added a generated-capture syntax fingerprint and used it to reject a weaker definition of
  “formatting coverage”: parseable/idempotent output can still omit unsupported authored syntax.
  Added JSON objects/arrays and fields, function types, explicit `Var(...)` patterns, directives,
  panic expressions, and constructor/tuple pattern arguments. The all-examples regression now
  proves authored content preservation (apart from canonical optional trailing commas), Peggy-valid
  output, and second-pass byte identity for every Peggy-valid example.

### 2026-07-30 — committed punctuation recovery and fix projection

- Generated strict and recovering parser dispatch from the Peggy AST. Strict recognition remains
  the Peggy-parity oracle; recovery is entered only for formatting/Surface construction.
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
  expectation, two GPU diagnostic-message expectations, one installer help-banner expectation,
  and one wmslang backend error-class expectation. None exercises the generated formatter,
  Surface parser, `wm fmt`, or recovery marks.

## Deferred follow-up

- semantic AST/desugaring parity with Peggy;
- compiler semantic lowering and default-parser migration;
- arbitrary malformed-input islands and complete lossless ownership;
- repairs other than `;`, `{`, and `}`;
- generalized FIRST/continuation recovery;
- `Virtual` projection and structural inlays;
- LSP document formatting and rollout.
