# Workmangr structural-editor implementation reference

The larger Grain attempt under `research/workmangr` was left unfinished, but its
structural frontend and LSP worked well and are the primary behavioral reference
for this project. Future agents should inspect that implementation before changing
recovery, virtual formatting, structural inlays, shared-anchor ordering, previews,
or the interaction between incomplete syntax and type inlays.

Do not infer that “the Grain project was unfinished” means “the structural editor
was only a sketch.” The frontend/LSP path contains working implementation,
regression tests, preview tools, and performance harnesses. The reasons to rebuild
are that `wm-mini` is now capable of hosting the work, the larger Grain codebase had
performance/maintenance pressure, and splitting future structural-editor features
between TypeScript and WM would create two owners.

## Reference map

All paths below are relative to the `wm-mini` repository root.

| Concern | Primary implementation | Verification/support |
| --- | --- | --- |
| Structural AST, holes, marks, repair classes | `research/workmangr/src/core/surface_ast.gr` | `research/workmangr/design/astupdate.md` |
| Tolerant parser and typed fallbacks | `research/workmangr/src/frontend/parser.gr` | `research/workmangr/tests/parser_semicolon_test.gr`, incomplete cases in formatter/inlay tests |
| Lexer, comments, opaque tokens, spans | `research/workmangr/src/frontend/lexer.gr` | `research/workmangr/tools/lexertiming.gr` |
| Real/virtual formatting and artifacts | `research/workmangr/src/frontend/formatter.gr` | `research/workmangr/tests/format_test.gr` |
| Structural and type inlay projection | `research/workmangr/src/cli/lsp/inlay.gr` | `research/workmangr/tests/lsp_inlay_test.gr` |
| LSP transport, documents, caching, graph diagnostics | `research/workmangr/src/cli/lsp/lsp.gr` | `research/workmangr/tests/lsp_crash_repro_test.ts` |
| LSP formatting | `research/workmangr/src/cli/lsp/format.gr` | `research/workmangr/tools/lsp_format.ts` |
| Type queries/display | `research/workmangr/src/cli/lsp/layer1/type_service.gr`, `type_display.gr` | `research/workmangr/tests/lsp_type_service_test.gr`, `lsp_type_display_test.gr` |
| Symbol/definition queries | `research/workmangr/src/cli/lsp/layer1/symbol_service.gr` | `research/workmangr/tests/lsp_symbol_service_test.gr` |
| Semantic node/type index | `research/workmangr/src/core/semantic_index.gr`, `analysis.gr` | type/inlay service tests |
| Module-aware editor analysis | `research/workmangr/src/core/module/module_system.gr`, `module_infer.gr` | dependency cases in `research/workmangr/tests/lsp_crash_repro_test.ts` |
| Manual inlay preview | `research/workmangr/tools/lsp_preview.ts` | renders virtual text and marked preview |
| Edit/hover performance | `research/workmangr/scripts/bench_edit_lsp.ts`, `bench_hover_lsp.ts` | `research/workmangr/tools/inlaytiming.gr` |

Start investigation with `surface_ast.gr`, `parser.gr`, `formatter.gr`, `inlay.gr`,
and `lsp_inlay_test.gr`. Together they show the complete path from a missing source
construct to a fallback/mark, virtual artifact, ordered LSP hint, and rendered
preview.

## Preserve as working behavior

### Explicit recovery marks and fallbacks

`research/workmangr/src/core/surface_ast.gr` models missing expressions, types,
patterns, semicolons, braces, and tokens as marks with repair classes and optional
pair IDs. The parser supplies category-correct fallbacks so every finite buffer has
a valid structural interpretation.

Preserve these rules:

- recovery is syntax data, not an invisible parser side effect;
- missing required slots still contain typed fallback values;
- optional canonical, safe auto-fix, and recovery-only cases remain distinct;
- user-authored and inferred holes remain distinct;
- unexpected concrete text is retained as error/opaque structure;
- recovery makes progress rather than abandoning the program.

Frontend v2 should improve identity and diagnostic bookkeeping, not replace this
model with conventional parse failure.

### Virtual formatter artifacts

`research/workmangr/src/frontend/formatter.gr` has real and virtual modes. Virtual
rendering returns artifacts containing text, offsets, source anchors, reasons,
repair classes, and pair IDs.

The formatter is important reference material even if the first frontend-v2 slice
uses a smaller structural renderer. Preserve observed behavior through tests rather
than assuming a simpler diff-based implementation is equivalent.

### Inlay projection rules

`research/workmangr/src/cli/lsp/inlay.gr` contains learned behavior that should be
treated as established until deliberately superseded:

- filter artifacts in comments;
- maintain structural order for several tokens at one anchor;
- use delimiter-depth information when aligning concrete and virtual tokens;
- keep trailing repairs anchored to the last content line;
- omit whitespace-only hints;
- keep separate syntax tokens as separate hints;
- cache by document version;
- combine structural and type inlays only after both are independently correct.

Port these as tests first. If new behavior differs, document the product decision
rather than silently losing an old structural-editor property.

### Semantic service boundaries

`research/workmangr/src/cli/lsp/layer1/type_service.gr` and
`symbol_service.gr` separate type/symbol queries from protocol handling. Preserve
that separation. In the new system, WM services should consume compiler fact DTOs
plus source maps rather than global TypeScript compiler objects.

### LSP regression corpus

The most directly reusable requirements are:

- `research/workmangr/tests/lsp_inlay_test.gr`;
- `research/workmangr/tests/lsp_type_service_test.gr`;
- `research/workmangr/tests/lsp_type_display_test.gr`;
- `research/workmangr/tests/lsp_symbol_service_test.gr`;
- `research/workmangr/tests/lsp_crash_repro_test.ts`.

Port test intent and expected virtual source, adjusting only for current `wm-mini`
syntax or a documented product change.

### Performance harnesses

`research/workmangr/scripts/bench_edit_lsp.ts`, `bench_hover_lsp.ts`, and
`research/workmangr/tools/inlaytiming.gr` demonstrate the right measurement
categories: edit traces, cached queries, and phase timing. Rebuild equivalents early
so the new implementation does not rediscover performance problems after parity.

## Reuse selectively

### Tolerant parser code shape

`research/workmangr/src/frontend/parser.gr` is working reference code for recovery
points and inferred holes, but it parses a larger/different Workman language and is
several thousand lines. Preserve its invariants and regression behavior without
requiring line-by-line transliteration.

Start frontend v2 from the current `src/grammar.peggy` language forms, while using
the Grain parser to answer how missing and unexpected constructs should remain
structurally valid. Split the new WM parser into coherent files before any
maintained code file exceeds the repository's hard 500-line limit. Markdown is
exempt.

### Module graph and caches

The Grain LSP tracks open documents, module summaries, dependencies, inference
snapshots, line starts, diagnostics fingerprints, and graph epochs. Those concerns
return during current-LSP adoption and the WM LSP rewrite. Add each cache with an
owner, key, invalidation rule, stale-version rule, and benchmark.

### Type layering

The Hazel-inspired layer-1/layer-2 documents explain the old typed-hole behavior,
but `wm-mini` already has its own HM inference and auditable diagnostic model. Feed
the structural document into that model through semantic projection and recovery
provenance. Porting the Grain infection solver is not required.

## Preserve behavior while reconsidering mechanics

These implementation choices are not behavioral requirements:

- hand-built JSON strings throughout LSP feature logic;
- global mutable error buffers shared across requests;
- Grain-specific standard-library and WASI workarounds;
- infection and backend/compiler layers unrelated to structural editing;
- the inlay worker/process split before measurements show it is necessary;
- the large all-in-one `lsp.gr` module.

Transport, workspace state, semantic orchestration, and individual features should
have separate ownership in the WM rewrite. This is a maintainability change, not a
license to change the proven structural behavior.

## Initial behavior-port order

1. `let thing =` becomes virtual `let thing = ?;`.
2. `let =` receives a virtual wildcard, hole, and semicolon.
3. Missing top-level semicolons do not suppress type analysis of later declarations.
4. Missing match-arm commas remain separate artifacts.
5. Missing clause/lambda blocks preserve brace/comma/semicolon order.
6. Artifacts are suppressed in comments and opaque lexical regions.
7. Optional canonical unit parameters remain distinct from error recovery.
8. Type inlays survive structural recovery through the concrete/virtual map.

This list is only the first port slice. The old tests and preview tools remain the
authority for additional structural-editor behavior.
