# Frontend-v2 generator contract

This directory is the Phase 0 boundary between the authoritative Peggy grammar and generated
Workman frontend modules. The current handwritten files in `tooling/frontend-v2` are behavioral
references only and are not inputs to generation.

## Inputs

1. `src/grammar.peggy`, parsed with Peggy's `output: "ast"` API.
2. The normalized, versioned grammar IR in `scripts/frontend_v2_grammar_ir.ts`.
3. An action binding table. Every Peggy action is classified exactly once as either a supported
   portable expression or a named Workman semantic function. Portable expressions admit only
   variables, strings, booleans, arrays/spreads, records/spreads, member access, calls, logical
   negation, nullish defaulting, and strict equality. No statements, callbacks, assignments, or
   arbitrary operators cross the boundary.
4. An explicit inventory of initializer state and named Workman helper functions. Initializer
   JavaScript is retained for audit only and is not compiled.
5. Recovery annotations for committed missing `;`, `{`, and `}` slots. Each annotation identifies
   one Peggy rule/literal pair plus its commitment description and synchronization boundaries.
   Generation rejects duplicate sites, unknown rules, and literals that are not required by the
   annotated rule.
6. At most eight named grammar/lexical exceptions. Each exception names its Peggy rule, Workman
   function, reason, and focused fixture.

The generator must reject unknown Peggy nodes, unresolved rule references, duplicate action
bindings, unknown sidecar rule/action names, an incomplete exception, or a ninth exception.
Embedded JavaScript action text is inventory data; it is never translated or evaluated by the
generator.

## Generated layout

Generation writes reproducible modules under `tooling/frontend-v2/generated`:

- `surface_types_*.wm`: grammar-complete Surface constructors and the generic marked-value carrier;
- `surface_rule_metadata.wm`: mechanically emitted token/list/trivia/transparent rule classes;
- `lexer_*.wm`: precise lossless token kinds, trivia gaps, UTF-16 spans, and malformed-token islands;
- `compiled_probe_rules_*.wm`: direct Peggy-AST-to-WM parser functions with private captures;
- `compiled_probe_types.wm`: shared generated character-class types;
- `compiled_probe_dispatch.wm`: the generated recursive rule dispatcher and capture entry point;
- `parser_*.wm`: committed completion, bounded recovery, and Surface construction;
- `semantic_actions_*.wm`: calls to the named native semantic action inventory;
- `dto_*.wm`: JavaScript-native structural, semantic, and formatter DTO projections;
- `generation_report.json`: every rule, action, recovery annotation, and exception classification.

Files are partitioned on rule boundaries and must remain at or below 500 lines. Generated headers
contain the IR version, source grammar path, source rule names, and a content hash. The output is
written to a temporary directory, checked for a complete manifest, then atomically replaces the
previous generated directory.

## Runtime ABI

The first generated library exports:

```text
parseStructural(source) -> StructuralParseDto
projectSemantic(source) -> SemanticProjectionDto
formatDocument(source, "real" | "real-fix") -> FormatResultDto
```

`parseStructural` is total for finite input. `formatDocument` parses once and formats the same
marked Surface tree. The initial formatter result contains `schemaVersion`, `text`, `changed`,
ordered provenance `pieces`, and `projectedRecoveryIds`.

The generated Surface root owns structured syntax, ordered trivia gaps, exact islands, and a
canonical recovery table. Semantic lowering, diagnostics, formatting, and later inlays project this
same root. DTO schema changes require an explicit version change and strict loader validation.

## Checkpoints

Run the grammar inventory with:

```sh
deno task frontend-v2:grammar-report
```

The Phase 1 checkpoint order is grammar-IR goldens, lexer generation, recognizer parity, Surface
ownership, semantic projection parity, and loader integration. The fixtures in `fixtures.ts` are
the initial narrow corpus; repository-wide Peggy/semantic parity supplies breadth.
