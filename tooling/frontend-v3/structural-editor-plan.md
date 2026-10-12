# Parser and structural editor refactor / reimplementation

Status: agreed direction and implementation plan, 2026-10-12. This document records
the structural editing model discussed with the user. Read [worklist.md](worklist.md)
for the decided reset, file disposition, and implementation order. Earlier parser
proposals are superseded and scheduled for deletion. No parser reimplementation is
made by this document.

## Product model

Frontend v3 is a structural editor over an ordinary, arbitrarily damaged text buffer.
Its pipeline is:

```text
original source, however broken
  -> lexical document
  -> canonical marked surface AST
  -> formatted and completed projection of that AST
  -> diff against the original source
  -> additions displayed as inlays in the original buffer
```

WM has one canonical structural shape for each construct. The parser records authored
syntax and marks missing structure in that same shape. Formatting reprojects the tree;
spacing and completion emerge from its structure. The diff captures both missing syntax
and missing formatting. The inlay path applies additions only. `wm fmt` can also remove
or replace text as appropriate to its formatting/fix policy.

For example, `let main= => print(thing)` can project to
`let main = () => { print(thing) };`. Inlays expose the absent spaces and structural
syntax while leaving the source buffer untouched. Similarly, `let value =` projects
with a virtual `?` in its missing expression slot.

The Hazel paper supplies the inspiration: localized marks preserve structure and allow
continued reasoning. Its typing totality theorem assumes syntactically well-formed
sketches. WM creatively extends that mechanism into parsing; the paper does not specify
WM's parsing rules or prove this extension correct.

## Decisions

- Missing structural tokens occupy marked slots in the canonical tree. They do not
  become fabricated authored lexer tokens.
- Missing expressions produce virtual expression holes, projected as `?`.
- Authored and virtual `?` retain distinct origins through parsing and elaboration.
- Broken text is retained losslessly as opaque trivia/fragments where it cannot be
  assembled. Existing lexer trivia and surface error-island representations are a
  starting point; audit their coverage before adding another representation.
- The editor entry produces a usable marked document for arbitrary buffers. Ambiguous
  or unassembled regions can remain preserved fragments rather than forcing a guessed
  semantic construct. Implementation failures remain explicit internal failures.
- Completion follows the canonical grammar in the ordinary parsing path. It is not a
  strict parse followed by a recovery parse, a catalogue of special shorthands, or a
  search that ranks possible completed programs.
- The AST projection and source diff are authoritative for the virtual view. Formatter
  artifacts may carry provenance and delimiter relationships, but cannot replace the
  diff: formatting also contributes emergent whitespace.
- Inlays never delete or replace authored text. A non-additive diff operation does not
  mutate the buffer or authorize reinterpreting authored tokens.

### Hole compilation policy

| Mode | Virtual expression `?` | Authored expression `?` |
| --- | --- | --- |
| Dynamic / REPL | Compilation allowed; `todopanic` when reached | Compilation allowed; `todopanic` when reached |
| Development (default) | Compile error | Compilation allowed; `todopanic` when reached |
| Production | Compile error | Compile error |

For now, permitted virtual holes execute exactly like regular holes. A special runtime
mechanism can be added later. These permissions concern expression holes; they do not
automatically make opaque syntax damage executable. Production rejects all authored
and virtual uses of the hole form; review any additional hole categories when introduced.

Compilation eligibility is separate from editor parsing and semantic services.
Materializing a virtual `?` is an explicit source edit that changes its origin and thus
its default compilation eligibility. Ordinary formatting must not silently perform
that conversion. Keep formatting, structural fixes, and TODO acceptance distinguishable.

## Current implementation and references

V3 already has lossless UTF-16 source indexing, tokens/trivia, lexical marks, delimiter
mates, an immutable cursor, authored/missing token slots, and a partial surface AST.
The old type-parser slice recognizes current concrete syntax and recovers a few missing
closers; most other damaged forms return `Rejected`. It is scheduled for deletion with
its state, codec, driver, and checks. Salvage only neutral cursor/keyword primitives and
grammar facts as specified by the worklist; do not extend the old parser.
The lexer and verified native portability baseline need not be restarted.

Workmangr demonstrates the user experience, with several implementation generations:

- `research/workmangr/src/cli/cli.gr`: `inlay` dispatches to `Inlay.previewForSource`.
- `research/workmangr/src/cli/lsp/inlay.gr`: preview overlay, shared-position ordering,
  token/gap diff, scan projection, and LSP hint conversion.
- `research/workmangr/src/frontend/formatter.gr`: real/fix/virtual modes and virtual
  artifacts with source anchors, rendered positions, repair classes, and pair IDs.
- `research/workmangr/tests/lsp_inlay_test.gr` and `tests/format_test.gr`: behavioral
  cases for shared anchors, inferred holes, bare bodies, comments, and broken source.
- `research/workman-old/plans/workmanhazeltypeplan/hazelpaper.md`: conceptual source.
- `markdown/issues/frontend-v2-is-not-yet-single-pass-structural-parsing.md`: canonical
  slot model and commitment problems. Its claim that a missing expression must fail
  parsing is superseded by the virtual-expression-hole decision above.

In the inspected Workmangr checkout, active hints consume formatter artifacts and filter
whitespace-only labels. `space()` writes layout to formatted output without creating an
artifact. A probe of `let x=1` produced virtual text `let x = 1;`, an artifact only for
`;`, and CLI preview `let x=1*;*`. V3 must implement the agreed full projection/diff
behavior, not accidentally inherit that current path's omission of virtual spacing.

## Milestone 1: projection diff and CLI inlay preview

Port the behavior before rebuilding the parser. Initially consume explicit original
source and projected text fixtures, with optional provenance metadata. This exercises
the rendering machinery independently; fixture projections are never represented as
actual parser output.

1. Define a structured diff and inlay model. Use UTF-16 source offsets and zero-based
   LSP positions at the adapter boundary. Keep source positions distinct from projected
   positions. Each insertion has ordered text and an optional link to structural marks.
2. Port the useful token/gap alignment behavior from Workmangr. Audit the older diff and
   scan paths instead of copying them wholesale. Preserve exact token spelling and
   opaque regions; repeated equal tokens must not align into unrelated constructs.
   Prefer known authored-token provenance from projection when available, and retain
   a defined alignment path for standalone text fixtures.
3. Derive missing spaces and indentation as well as missing structural symbols from
   the projection. Do not filter whitespace-only additions out of the core result.
   Keep layout additions distinct from marked syntax for inspection and fixes.
4. Retain the complete diff for inspection and formatting consumers; derive an additive
   inlay view without applying deletions/replacements. For changed gaps, preserve authored
   whitespace and display only representable additions. An additive preview need not be
   identical to the canonical projection when source contains excess whitespace.
5. Port the CLI overlay behavior: apply positions against the original buffer, preserve
   backend order for shared anchors, and support plain and visibly marked insertions.
   Expose structured output so whitespace and provenance are inspectable unambiguously.
6. Define line-ending and label behavior explicitly. Preserve UTF-16 units, CRLF, lone
   CR, surrogate pairs, and lone surrogates. Workmangr strips CR in preview and renders
   hint newlines as `[LF]`; review those choices rather than silently inheriting them.
   A newline label cannot introduce a real editor line through an ordinary inline hint.
7. Add a v3-local CLI/tool entry that accepts source plus supplied projection/hints.
   Keep it independent of the existing production parser and LSP. Once v3 parsing and
   projection exist, the same preview entry consumes their real results.

Acceptance fixtures include:

- `let x=1;` versus `let x = 1;`: two missing spaces, despite no missing syntax.
- `let x=1` versus `let x = 1;`: layout and structural insertions together.
- Missing expression: virtual `?` precedes `;` at a shared source anchor.
- Bare lambda body: paired braces surround the correct authored expression.
- Match arm end: `}` precedes `,`, and adjacent tokens remain individually inspectable.
- Excess source whitespace: additive preview preserves it; full diff records removal.
- Comments, repeated names/punctuation, EOF, indentation, CRLF, Unicode, and opaque
  fragments: no source loss, wrong-region alignment, or shifted insertion positions.

The preview is a model of inline hint placement, not an emulation of VS Code font
metrics or wrapping. Any browser preview should consume the same ordered inlay data.

## Milestone 2: canonical marked representation and projection

Audit the surface schema against the pipeline before rewriting parser functions.

- Every required structural slot can be authored or missing, including separators,
  opening delimiters, closing delimiters, and grammar keywords where appropriate.
- Expression holes distinguish authored `?` from missing expressions. A virtual hole
  has no authored question token and refers to its missing-expression mark.
- Retained trivia/fragments preserve their exact source spelling and ownership,
  including between list items and at EOF. Do not rebuild damaged text by joining
  token names or decoded values.
- Delimiter pairs derive from their containing structure, including pairs where only
  one delimiter is missing. Marks keep identities and diagnostic locations.
- The representation covers actual WM syntax, including templates, member/pipe forms,
  records/spreads, declarations, and imports. An unimplemented supported production
  is an implementation gap, not a source error to conceal in an opaque island.

Implement a shared canonical projector. It emits formatted/completed text plus enough
source correspondence and mark metadata for reliable diffing. Authored literal spelling
and opaque fragments stay exact. Formatting determines layout; the parser determines
structural ownership. The projector must not rediscover the construct from raw source.

Verify small hand-constructed trees through projection, diff, and preview before parser
integration. These are explicit renderer fixtures, not a substitute parser.

## Milestone 3: parser reimplementation through the complete editor path

Start with a small whole-program slice: bindings, names/literals, expression holes,
lambdas, applications, and blocks. Exercise omitted parentheses/braces/terminators and
missing expression content from the beginning. Build new canonical assembly helpers;
then expand type and pattern parsing and the remaining
accepted language forms.

For each production, specify how authored evidence determines the canonical construct,
which boundaries belong to its caller, and how absent slots or retained fragments are
represented. Delimiter mates are evidence, not permission to skip enclosing boundaries.
Every loop must consume input, return at an owned boundary, or terminate at EOF.

The editor document remains available even when no unique semantic assembly is supported
for a region. Preserve and mark that region while continuing where boundaries allow.
Avoid choosing a different semantic production merely because punctuation can be inserted.
For example, missing delimiters around an authored `=>` can belong to a lambda; `() x`
does not establish a lambda just because virtual braces would fit.

Each slice must produce its actual marked tree, canonical projection, diff, and preview
together. Do not retain the old type slice's `Rejected` API as a recognition helper or
compatibility facade; the worklist specifies a parser reset.

## Milestone 4: consumers, compilation modes, and formatting

- Feed actual v3 inlay data to the explorer, CLI, and LSP adapters. Show authored text,
  marked structure, projected text, full diff, and additive preview for diagnosis.
- Share parsed documents and projection results between consumers rather than repeatedly
  parsing or deriving competing recovery interpretations.
- Carry hole origin through elaboration and enforce the three compilation policies.
  In allowed modes, verify that reaching either hole invokes the existing TODO panic.
- Implement `wm fmt` over the same structural authority. Unlike inlays, formatting can
  remove/replace layout. Define structural materialization policy separately; never
  implicitly accept a virtual expression TODO during ordinary formatting.
- Preserve stable order of insertions across adapters. Whole-parse identities are initially
  sufficient; stable identities across edits require a later incremental design.

## Validation and completion criteria

Use focused regression cases at each milestone. Assert exact whitespace and insertion
positions, not merely equality after stripping whitespace. Check source preservation,
mark references, delimiter relationships, shared-anchor order, termination on damaged
prefixes, and preservation of later declarations after an incomplete earlier declaration.

Where completing marked syntax is meaningful, reparsing its materialized projection should
produce the same canonical structure and semantics. Hole origin changes deliberately when
a virtual `?` is authored. Canonical formatting should be idempotent under the chosen
materialization policy. Additive preview equality to projection is required only when the
full diff can be expressed entirely as additions.

Keep portable frontend logic WM-authored within the existing SubsetML/native baseline;
host transport, JSON handling, and terminal/browser presentation belong in adapters/tools.
Validate exercised WM/native results through the existing build/check pipeline. Audit diff
complexity before using the old quadratic token LCS on every keystroke; first establish
correctness, then measure representative editing buffers to select an appropriate approach.

This plan authorizes no commits, publication, production frontend switch, or removal of
working lexer/compatibility implementations. The worklist decides which speculative
parser files to delete and which neutral infrastructure to retain.
