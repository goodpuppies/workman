# Frontend v2 bootstrap

This package contains the WM-native tolerant structural frontend. Phase 0 proved the model; Phase B
added the generated lexer ABI; Phase C is replacing the initial special case with reusable recovery
and rendering foundations. Its maintained modules are:

- `types.wm`: the authoritative `SurfaceProgram` editor state, lossless tokens, concrete-or-missing
  syntax slots, initial structured expressions, recovery marks, and virtual artifact types;
- `lexer.wm`: lossless current-grammar tokenization, UTF-16 spans, and line maps;
- `dto.wm`: conversion from internal WM lists and ADTs to schema-versioned lexical/structural
  JavaScript data;
- `semantic_dto.wm`: schema-versioned semantic projection DTOs over the structural document;
- `frontend.wm`: the stable generated-library entry module;
- `parser.wm`: top-level structural dispatch and opaque declaration recovery;
- `parser_support.wm`: immutable parser state, canonical marks/artifacts, paired recovery IDs, and
  progress accounting;
- `parser_let.wm`, `parser_expr.wm`, and `parser_pattern.wm`: tolerant let bindings, structured
  literal/long-identifier expressions, explicit opaque expression islands, and reusable
  expression/pattern tail boundaries;
- `surface_parser.wm`: the bounded recursive Surface AST slice for SML-shaped unary application,
  tuple arguments/patterns, unary lambdas, currying, and complete expression blocks;
- `surface_dto.wm`: a flat identity-preserving DTO projection of recursive expression and pattern
  nodes for tests, lowering, and editor consumers;
- `parser_delimiter.wm`: ordered missing-closer recovery for incomplete expressions;
- `parser_import.wm`: shallow required-slot and clause recovery for Workman and JavaScript imports;
- `parser_type.wm`: shallow required-slot and delimiter recovery for type and record declarations;
- `parser_lambda.wm`, `parser_if.wm`, and `parser_match.wm`: shallow block, lambda, branch,
  match-arm, and ordered-token recovery;
- `renderer.wm`: concrete/virtual rendering and bidirectional piece maps;
- `structural.wm`: the stable WM facade over parsing and rendering;
- `self_check.wm`: executable assertions and preview output.

Run the proof from the repository root:

```sh
deno task wm check tooling/frontend-v2/self_check.wm
deno task wm run tooling/frontend-v2/self_check.wm
```

The expected final preview line is:

```text
let thing =<virtual:?><virtual:;>
```

## Performance profiling

Run a timing-only corpus pass with:

```sh
deno task profile:frontend-v2
```

Generate a V8 CPU profile, Markdown hot-function report, and interactive SVG flamegraph with:

```sh
deno task profile:frontend-v2:cpu
```

The harness also accepts `raw-structural`, `structural`, or `semantic` followed by an iteration
count. The raw mode separates generated-WM parser cost from TypeScript DTO validation.

The July 2026 baseline investigation found a quadratic match-recovery look-ahead: every possible new
arm repeatedly scanned the remaining token tail. A single-pass pending-arm state reduced one raw
58-file corpus pass from about 79.6 seconds to 5.7 seconds. Replacing the emitted tuple runtime's
`Object.assign` tagging with direct symbol assignment then reduced two passes to about 1.5 seconds.
Keep these corpus modes available as the recursive Surface AST expands.

## Importable library emission

Build the importable frontend library with:

```sh
deno task frontend-v2:build
```

This writes the ignored, reproducible artifact `tooling/frontend-v2/frontend-v2.generated.mjs`. The
generated ES module exports the schema-versioned `lexRoundTrip(source)`, `parseStructural(source)`,
and `projectSemantic(source)` boundaries and does not invoke `main`. Bindings imported by the entry
file stay internal. Tests rebuild the artifact in a temporary directory and import it exclusively
through `src/frontend_v2_loader.ts`. `src/frontend_v2_diagnostics.ts` projects canonical recovery
marks into wm-mini's shared auditable diagnostic model; it does not define a parallel parser-only
diagnostic format.

The frontend ABI will expose JavaScript-native DTO values deliberately:

- WM records already cross this boundary as plain JavaScript objects;
- DTO arrays will be constructed as `Js.Array`/`JSON[]`, not exported as WM `List`;
- optional DTO fields will use nullable values or explicit discriminated records, not the tagged
  internal WM `Option` runtime representation;
- internal ADTs remain private and are converted by the exported boundary function.

## Bootstrap findings

- Workman string receiver operations are safe FFI calls. The lexer gives source and offset
  parameters explicit types and deliberately handles their `Result` values rather than treating
  JavaScript string operations as pure.
- Current WM string literals do not accept a `\r` escape, and string ordering operators are
  numeric-only. The lexer therefore classifies JavaScript UTF-16 code units through safe
  `charCodeAt` calls. It handles CR, LF, and CRLF line starts explicitly and retains non-grammar
  Unicode as opaque concrete tokens; valid surrogate pairs stay together in one token.
- General function return annotations are not currently available. Nominal record values are
  contextually typed at construction sites instead.
- `examples/exercises/tree.wm`, one onboarding example named by `how-to-workman.md`, no longer
  parses with the current compiler. The current `std/list.wm` and `examples/aoc_depths.wm` examples
  do check successfully and were used as the module/recursion references for this slice.
- The self-check uses one unsafe `Deno.exit` import solely to make failed assertions produce a
  nonzero process status. No frontend behavior crosses that boundary.
