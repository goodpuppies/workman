# Frontend-v2 formatter: shipping plan

## Primary first goal

The first shipping milestone is deliberately narrow:

1. **Peggy-derived recognition parity.** The generator covers the complete Peggy grammar with no
   unknown or unemitted rule, and frontend-v2 matches the frozen Peggy-derived acceptance set for
   every `.wm` file under `examples`.
   There is no hand-selected grammar subset. Small positive/negative cases may test individual
   generator combinators, but they do not define parity. Targeted tolerant recovery is tested
   separately. This checkpoint does not require reproducing Peggy's semantic AST or desugarings;
   the semantic/span golden is additional evidence for the later compiler-parser migration.
2. **Canonical whitespace formatting.** The parity-complete syntax tree can regenerate valid source
   with the initial canonical spacing, indentation, and line-break rules.
3. **Three targeted recovery marks.** At committed grammar positions, missing `;`, `{`, and `}`
   produce marks. Ordinary formatting omits their fallbacks; fix formatting materializes them.

The milestone does not require a fully lossless or fully total parser for arbitrary malformed input.
General error islands, complete comment/trivia ownership, generalized continuation analysis,
category holes, other missing tokens, structural inlays, broad malformed-source round-trip laws,
semantic lowering parity, typechecking/runtime equivalence, LSP integration, and making frontend-v2
the default parser come later unless one is strictly needed to demonstrate this first slice.

Work is eligible for the first milestone only when it directly supports:

- grammar generation or valid-source recognition parity;
- the syntax ownership required by canonical whitespace formatting;
- committed recovery and formatting for missing `;`, `{`, or `}`;
- the smallest executable API or CLI path needed to exercise those behaviors;
- focused correctness and performance checks for those behaviors.

When a broader architectural improvement is useful but not necessary for this milestone, record it
as follow-up work rather than placing it on the critical path.

## Parser direction

Frontend-v2 is intended to become Workman's runtime parser, not remain a formatter-only sidecar.
After the first formatter slice, generally keep pushing the generated parser forward: parser fixes,
new syntax, diagnostics, recovery, losslessness, totality, and performance work should make
frontend-v2 more capable. Do not introduce a second Workman runtime path or behavior that exists
only in a parallel parser.

Frontend-v2 is the only Workman runtime parser, and the executable Workman Peggy parser has been
deleted. Peggy remains only as build-time infrastructure that supplies the grammar AST to the
frontend-v2 generator; it also generates the separate WMSML parser. The original 99-file Peggy
recognition and normalized semantic/span result is retained as a checked-in golden. This longer
migration did not expand the first formatter slice's shipping gate.

The migration order is: project the generated Surface tree to the compiler AST, prove compatible
compiler behavior and source locations, retain useful generated failure provenance, move diagnostics
to the same tree, soak it as the default runtime frontend, then delete Peggy runtime parsing and the
transitional handwritten parser. Equivalent implementation details are not required when the
observable compiler result is the same.

Current migration state: the generated parser is packaged and is the default compiler, CLI, REPL,
and sole LSP frontend; the transitional handwritten parser and explicit compiler `v1` path are
removed. The LSP and VS Code extension no longer expose frontend selection, and production compiler
`compare` mode is replaced by grammar-IR, semantic-golden, and generated-parser conformance tests.
The executable Workman Peggy parser and artifact are deleted. Ordinary compiler, Core, inference,
FFI, module, binding-fact, directive, and wmslang tests parse through frontend-v2. The tracked
frontend-v2 artifact is stage 0 for its byte-identical self-hosted rebuild, so normal frontend
regeneration does not parse Workman through Peggy. Generated matcher wrappers are evaluated without
retaining inert JavaScript frames, so the runtime parses its own deeply nested generated rule
modules within the normal stack and keeps those modules in the repository-wide golden corpus. The
complete default-frontend repository release soak passes all 856 tests.

Ongoing parser work follows four rules:

1. Change the grammar and generator so frontend-v2 receives each syntax fix directly.
2. Keep the exact repository corpus and semantic/span golden synchronized through explicit reviewed
   snapshot changes.
3. Improve recovery, diagnostics, losslessness, totality, and performance incrementally; they are
   not all gates on the first formatter release.
4. Do not reintroduce an executable Workman parser beside frontend-v2.

The first post-release parser slice moves the existing 26 missing-`;`/brace sites out of
emitter-internal rule lists and into the validated recovery-annotation inventory. The report and
generated manifest now expose those sites, and regeneration remains byte-identical. Next, derive
conservative continuation/FIRST evidence and use it for one additional committed exact-token family,
starting with closing `)`. General islands and arbitrary malformed-input totality remain independent
later work.

## Outcome

Ship the generated frontend-v2 parser as Workman's default parser together with one useful
formatter: canonical whitespace/layout for the complete valid grammar, plus conservative repair of
missing `;`, `{`, and `}`. It is implemented in WM as a projection of frontend-v2's unified marked
Surface AST and exposed through `wm fmt` and LSP document formatting.

The first release exposes two projections:

```text
renderSurface: (SurfaceProgram, Mode) -> FormatResult

Mode = Real | RealFix
```

- `Real` canonically formats authored syntax without materializing marked fallbacks;
- `RealFix` uses the same traversal and additionally materializes marked missing `;`, `{`, and `}`;
- error/opaque islands and comments retain their exact text in both modes.

This makes the immediate workflow work:

```workman
let main=()=>print "hello world"
```

`Real` canonicalizes the authored projection but leaves the missing braces and semicolon absent.
`RealFix` produces:

```workman
let main = () => {
  print "hello world"
};
```

Workman lambda bodies are blocks or parenthesized sequences; there is no braceless lambda form. In
this input, `=>` plus the non-parenthesized body commits recovery to a missing braced block, and the
top-level declaration separately has a missing `;`.

The target architecture retains a third `Virtual` projection for structural inlays, but it is a
post-first-release generalization of the same traversal, not part of the initial shipping gate.

The formatter itself is small handwritten code. Most cases literally print a Surface constructor's
owned tokens and recursively print its children. A few shared rules own whitespace, block
indentation, comments, and islands; exceptional human-authored layout rules are added only where the
literal projection is not good enough.

Formatting does not decide whether parsing succeeded. Total parsing has already produced the program
that formatting renders.

## The model

Hazel's total type-error localization supplies the discipline, not a parsing algorithm:

```text
failed judgment
  -> local mark
  -> category-correct neutral fallback
  -> later judgments continue
```

Frontend-v2 applies that discipline to parsing:

```text
finite source buffer
  -> tolerant parsing
  -> unified marked Surface AST
       -> canonical formatting
       -> diagnostics and explanations
       -> structural inlays and edits
       -> semantic lowering
```

A parse failure and a later type failure can share recovery identity, provenance, dependency, and
projection infrastructure without pretending to be the same failed judgment.

There are two important syntax-recovery cases in the target architecture:

1. A required slot admits exactly one token. A block with no closing brace contains a mark whose
   token fallback is `}`. `Virtual` projects it for an inlay, and `RealFix` may materialize it;
   `Real` formats the authored projection without adding it.
2. The missing content is open program structure. A missing expression contains a marked
   expression-hole fallback. `Virtual` projects `?`; ordinary `Real` and `RealFix` do not turn a
   recovery-only hole into source text. Inference can later constrain the hole, but formatting never
   invents its contents.

The first release synthesizes only missing `;`, `{`, and `}` at committed grammar positions. An
opening `{` is inserted only when authored context has already committed to a brace-delimited
production; it never wraps an expression where a braced and unbraced interpretation are both valid.
Missing expressions/categories and other exact terminals such as `)`, `]`, `=`, and `else` are
deferred even when a future continuation analysis could prove them unique.

Every other failure retains the authored region as an error/opaque island and inserts nothing.
Formatting remains total by projecting that island exactly.

General missing-operator obligations, fragment multiplicity, sort transitions, and ambiguity
resolution are deferred. The formatter does not reinterpret `2 3` as `2 ? 3`.

## Non-negotiable invariants

1. **One authority.** Formatting, diagnostics, inlays, edits, and lowering consume the same
   `SurfaceProgram`.
2. **Total parsing, total formatting.** Every finite buffer has a structural result, and every
   structural result has a complete projection.
3. **AST-only structure.** Formatting never reparses stored text, rescans tokens to discover
   delimiter ownership, or uses a source/rendered diff to infer recovery.
4. **Whole-document ownership.** Every meaningful concrete region belongs to structured syntax,
   attached trivia, or an exact opaque/error island.
5. **No silent loss.** Comments, literal spelling, unknown text, malformed tokens, and unexpected
   fragments cannot disappear.
6. **Local recovery identity.** Every synthesized slot references one `RecoveryMark`; every mark
   reaches its fallback or retained error region.
7. **Projection, not reinterpretation.** Rendering a fallback never creates a new parse decision.
8. **Stability and preservation.** Each implemented mode's emitted text is idempotent. Formatting
   valid source preserves its semantic projection.
9. **The grammar and compatibility golden are authoritative.** `grammar.peggy` decides generated
   syntax structure, while the frozen Peggy-derived semantic/span golden guards the retired
   frontend's observable contract. Current tests, examples, and language documentation resolve
   intentional changes.
10. **No semantic formatting.** Formatting never consults inferred types, module resolution, or
    binding identity.
11. **Bounded modules.** Maintained code remains at or below the repository's 500-line limit.

The only formatter failure is an internal invariant violation: for example, an AST constructor with
no renderer or an unowned concrete span. Malformed user syntax is data, not failure.

## Current state and prerequisites

Frontend-v2 already has:

- lossless UTF-16 lexing;
- explicit delimiter pairs, recovery marks/classes, and recovery IDs;
- recursive nodes for literals, long identifiers, unary application, tuples, parentheses, unary
  lambdas, a limited block form, and a small pattern/type slice;
- a concrete source renderer;
- a source-plus-virtual-artifact renderer with mapping pieces;
- a generated JavaScript ABI, loader, structural diagnostics, inlays, and an LSP parse cache.

Those renderers are not the formatter:

- `renderDocumentConcrete` reproduces authored tokens;
- `renderVirtual` splices parser artifacts into authored source;
- `renderSurface` traverses the marked Surface AST and regenerates canonical layout.

The current AST is not yet a total formatter input:

- `AtomExpr(text, span)` is used as an opaque shortcut, but does not always retain the full owned
  concrete region;
- import, type, and record declarations are shallow;
- let bindings retain `annotationText` and `groupTailText`;
- several meaningful tokens and required slots are not owned directly by structured nodes;
- blocks with terminated items fall back to `AtomExpr`;
- comments survive in the token stream but have no structural ownership;
- the public DTO is an interim flat expression view rather than a complete program tree.

Fix these by making opaque/error nodes and comments real Surface AST constructors with exact text.
Do not handle the gap by making formatting reject those documents.

### Compatibility audit of the current Surface AST

The current representation is conceptually compatible at its center, but not compatible as the
generator's final schema.

Keep:

- UTF-16 `Span` and parse-local node/recovery identities;
- the invariant that every required position contains either an authored value or a mark with a
  category-correct fallback;
- explicit `DelimiterPair` and pair identity;
- structured long identifiers;
- unary `ApplyExpr`, tuple versus parenthesized expressions, and unary lambda/pattern shape;
- authored versus inferred holes;
- `RecoveryMark`, `RepairClass`, dependencies, anchors, and pair IDs;
- `SurfaceProgram` as the editor authority.

Reshape:

- derive precise token kinds and lexical rules from the grammar instead of keeping coarse `Keyword`,
  `Punctuation`, and `Operator` buckets;
- replace the token-specific `ConcreteToken | MissingToken` encoding with one generic marked-value
  carrier used by token, expression, pattern, type, name, and other required positions;
- make identifiers, literals, patterns, types, blocks, imports, and declarations fully recursive;
- replace `SurfaceTypeAnnotation` containing only a named type with the complete type grammar;
- represent block items as declarations/expressions plus owned terminators and a result;
- make marks point to typed fallback references rather than string categories and loosely related
  numeric fields;
- make comments and exact opaque/error islands ordered Surface AST nodes;
- generate the DTO projections actually consumed by diagnostics, inlays, and formatting. Do not make
  a hand-written serialization of every Surface constructor a formatter prerequisite.

Drop:

- `AtomExpr`;
- `annotationText` and `groupTailText`;
- shallow `ImportItem`, `TypeItem`, and `RecordItem`;
- parser-produced `VirtualArtifact` state stored beside the tree;
- parser logic that creates diagnostics/inlays at recovery time rather than projecting them from
  marks;
- the hand-written `lexer.wm`, `parser*.wm`, `surface_parser.wm`, delimiter scanners, and their
  shallow compatibility tests once generator equivalents land.

`LiteralExpr`, `NameExpr`, `ApplyExpr`, `TupleExpr`, `ParenExpr`, `LambdaExpr`, `BlockExpr`, the
pattern constructors, and the recovery carrier are useful design evidence. Recreate or migrate them
into the generated grammar-complete schema rather than preserving their current positional ADTs at
all costs.

Build the renderer in a few rule-sized slices:

```text
literal token/child projection
  -> whitespace and delimiter spacing
  -> top-level and block indentation
  -> comments and exact islands
  -> observed exceptional syntax
```

## Grammar-directed frontend bootstrap

The current Peggy frontend removes most of the apparent subset problem. Treat `src/grammar.peggy` as
an executable grammar specification during migration and compile its grammar AST into WM parser
source.

Local inventory of the current grammar:

- the repository's Peggy 5.1 dependency supports `output: "ast"` directly;
- 566 lines and 123 rules;
- 49 ordered choices and 192 sequences;
- 222 semantic actions totaling 288 lines;
- only seven actions longer than three lines;
- one 158-line initializer containing 26 helpers, including semantic desugarings for lists, lifted
  tuples, long names, and implicit results;
- most actions are constructors, list/option assembly, or precedence folds.

This is small enough for a purpose-built compiler over exactly the Peggy constructs Workman uses. Do
not translate Peggy's generated JavaScript parser or parsing VM.

```text
src/grammar.peggy
  -> Peggy output:"ast"
  -> normalized Workman grammar IR
  -> generated WM recognizer/parser modules
  + native WM surface actions
  + native WM recovery annotations
  -> total marked Surface AST
```

### Generator boundary

Generate the mechanical operations:

- literals, character classes, sequences, ordered choices, labels, and rule references;
- optional, zero-or-more, and one-or-more;
- positive/negative predicates;
- spans, captures, and progress checks;
- standard list and precedence-fold patterns;
- typed Surface constructors/alternatives and the DTO projections selected by the public boundary.

Do not compile arbitrary embedded JavaScript. Move semantic work into named WM action functions
keyed by rule/alternative, or a small portable action IR for constructors, records, lists, options,
spans, and folds.

The non-template actions and initializer helpers—such as type-declaration classification, list/lift
desugaring, match-function desugaring, lambda assembly, and pipe folding—should become an explicit
inventory of named WM functions. This is clearer than building a JavaScript compiler into the
generator. The inventory prevents the short inline actions from hiding the initializer porting work.

Generated source is reproducible and split by grammar ownership so each WM file stays below 500
lines. It retains originating Peggy rule names and remains readable enough to debug.

The generator has an explicit escape-hatch table for isolated Peggy rules or lexical cases that are
not worth generalizing:

```text
GeneratorException {
  peggyRule
  alternative?
  kind: Grammar | Lexical
  wmFunction
  reason
}
```

Each exception calls one named WM function, has source-rule traceability, and has a focused parity
fixture. Lexical/recovery exceptions also need malformed-input progress and losslessness fixtures.
The first release permits at most eight grammar/lexical exceptions. A ninth requires an explicit
plan change: either generalize a repeated construct or review and raise the cap.

Named semantic-action functions and deliberate recovery annotations do not count against this cap;
they are designed extension points rather than generator failures.

The generation report classifies every Peggy rule/action as mechanical, named semantic action,
recovery annotation, or recorded exception. Shipping requires no unknown or unclassified entry—not
zero exceptions.

### Recognition before recovery

PEG ordered choice is prioritized. Recovery must not make the first alternative succeed on every
input. Each generated rule therefore has two conceptual stages:

```text
recognize/probe
  consumes only authored input
  chooses an alternative using PEG order and real evidence

complete
  after commitment, parses the chosen production
  installs marked fallbacks in failed required slots
```

Commitment comes from authored discriminators such as `let`, `type`, `record`, `from`, `if`,
`match`, opening delimiters, or an expression FIRST set. Synthesized recovery never counts as the
evidence used to select an alternative.

Where FIRST-set commitment is insufficient, use a small sidecar annotation:

```text
commit after "let"
required token "="
required category Expr
synchronize at ";" or TopPhraseStart
```

The grammar says what valid source looks like; annotations say when a damaged production owns the
buffer and how it continues.

### Conservative determinacy rule

This is the post-first-release generalization. The initial `;`/`{`/`}` slice uses explicit generated
required-slot metadata plus a few commit/synchronization annotations; it does not wait for general
continuation-set analysis.

The Peggy AST supplies most of the information needed to decide whether recovery is unique:

- literals and character classes identify exact terminals;
- rule references identify possible grammatical categories;
- sequences identify the active required slot and its continuation;
- ordered choices identify competing alternatives;
- repetition and option nodes identify whether the slot is actually required;
- lexical FIRST sets and authored discriminators eliminate alternatives that cannot begin here.

At a failed required slot, collect the viable continuations after consuming only authored input and
normalize their next requirements. Viability is computed at the current committed grammar
position—not from every production that could recognize the remaining text in isolation. The
parser's rule/sequence stack acts as a grammar zipper and supplies the surrounding context.

```text
all candidates require "}"
  -> Mark(fallback = Token("}"))

all candidates require Expr
  -> HoleExpr

candidates require Expr or Pattern
  -> no synthesized fallback
  -> retain an error/opaque island

candidates imply group, tuple, or lambda
  -> no synthesized fallback until authored evidence commits one
```

For example, standalone `(x` may still be compatible with grouping, a tuple/sequence prefix, or a
lambda parameter list. In `if (x`, however, authored `if` has committed to:

```text
"if" "(" Expr ")" Block "else" Block
```

The active slots are therefore determinate. After parsing `x` as the condition, recovery can project
the unique `)`, the required then-block category, `else`, and the required else-block category.
Those recoveries are justified by the committed `IfExpr` production, not merely by the token `(`.

Peggy does not provide this answer as one ready-made flag. FIRST/continuation analysis can derive
the common cases, while semantic predicates, scannerless lexical rules, and language-specific
synchronization sometimes require annotations. The implementation must be conservative: failure to
prove uniqueness means no insertion.

This criterion applies in the parser. The formatter never rechecks uniqueness; it renders the mark,
fallback, or island already stored in the Surface AST.

### Recovery progress and bounds

Total recovery must also be operationally bounded:

- a recovery step must consume authored input, advance to a later finite slot in the committed
  production, or consume at least one token into an island;
- repetition rejects any branch that succeeds without input or slot progress;
- the same `(rule, sourceOffset, slot)` cannot synthesize the same fallback twice;
- synchronization scans each concrete token at most a bounded number of times;
- a per-production recovery budget stops cascades by retaining the remaining owned region as one
  island.

The budget is not a parse-failure escape hatch: it chooses a coarser but still lossless Surface AST.
Fuzz tests assert termination, bounded mark growth, and linear or measured-near-linear behavior on
long malformed buffers.

### Lexer boundary

Peggy is scannerless, but the generated WM frontend should still have a distinct lossless lexer.
Classify Peggy's lexical rules and generate token recognizers/kinds from them before generating
syntactic rules over tokens.

Peggy's skip rules discard whitespace/comments, so the generator needs a lossless ownership overlay:

- emit whitespace spans for source mapping but keep ordinary whitespace out of structural identity;
- emit exact comment tokens for later structural attachment;
- give each generated sequence/repetition explicit trivia gaps before, between, and after its
  children, so comments have deterministic ownership without a separate attachment heuristic;
- emit marked malformed literal/token forms;
- retain unmatched concrete text as opaque tokens/islands;
- use UTF-16 offsets and preserve CR, LF, and CRLF line starts.

The existing hand-written lexer is a behavioral test reference, not retained implementation.

### Migration authority

For valid source:

```text
Peggy semantic AST ~= frontend-v2 semantic projection
Peggy acceptance    == frontend-v2 acceptance
```

For invalid source:

```text
Peggy may reject
frontend-v2 returns a total marked Surface AST
```

This is one automated differential test, not a handwritten semantic golden for every source:

1. run Peggy and frontend-v2 over the existing valid grammar fixtures and repository `.wm` corpus;
2. project frontend-v2's Surface tree to the current semantic DTO;
3. recursively erase parse-local IDs and normalize only cross-runtime option/record encoding;
4. compare constructor tags, fields, list order, literal values, and source spans.

The corpus is finite evidence of compatibility, not a proof over all valid programs. A mismatch is a
generator/lowering bug unless it is an intentional grammar change with one recorded regression
fixture.

Peggy is the migration oracle and generator input, not a permanent runtime frontend. The initial
retirement target keeps `src/grammar.peggy` as the maintained grammar and generates the WM parser
from it, while removing Peggy parsing from compiler, CLI, REPL, and LSP execution. Replacing Peggy
as the grammar source can be a later independent decision.

## Internal architecture

### Structural ownership

Constructor tags encode grammar, while one generic carrier represents authored and recovered values:

```text
SurfaceValue<a>
  = Authored(a)
  | Mark(recoveryId, fallback: a)
```

The canonical recovery table stores the failure, rule, anchor, dependencies, and repair
classification. A marked tree position stores only the recovery identity and category-correct
fallback needed to keep traversal total. There is no separate `MissingToken` constructor duplicating
the mark.

```text
SurfaceLetDecl {
  letToken
  recToken?
  bindings: NonEmpty<SurfaceBinding>
  andTokens
  terminator: SurfaceValue<Token<";">>
}

SurfaceBinding {
  pattern
  annotation?
  equals: SurfaceValue<Token<"=">>
  value
}

SurfaceBlock {
  braces: DelimiterPair<"{", "}">
  items: List<Terminated<BlockItem>>
  result
}
```

The formatter uses token kind for canonical punctuation. Concrete text remains available for
validation, diagnostics, meaningful spelling, and provenance.

The total carrier also needs:

```text
SurfaceTrivia
  LineComment(exactText)

SurfaceIsland
  Opaque(exactText, span)
  Error(exactText, span, recoveryId)
```

An island is not discarded or parsed again. Its formatter rule is the identity projection of its
exact text, placed at its structural position. Recognized siblings still receive canonical layout.

For comments, `exactText` means the comment delimiter and contents. Surrounding whitespace and
indentation belong to the generated trivia gap and may be canonicalized. Island text, by contrast,
is byte-for-byte content within its owned span. Comments do not need to be reassigned to semantic
nodes before formatting.

Authored grouping remains structural in the first release. Formatting must not erase parentheses or
turn whitespace application into parenthesized application if that erases a Surface AST distinction.

### Direct structural writer

Do not port WorkmanGR's 3,500-line formatter, but do not introduce a general document algebra
either. Write one small recursive Surface AST printer by hand.

Most constructor cases are literal:

```text
print owned keyword/punctuation
print child
print owned separator
print next child
```

They are ordinary exhaustive pattern matches, not individually designed layouts. The small number of
actual formatting policies is shared across those cases.

The generic writer operations are deliberately small:

```text
text(value, origin)
space()
newline()
withIndent(amount, render)
separated(items, separator, renderItem)
delimited(openSlot, closeSlot, renderBody)
```

The initial policies are deliberately few:

- canonical token adjacency and spaces;
- no padding immediately inside delimiters;
- top-level phrase separation;
- two-space indentation for block contents;
- canonical placement of comments;
- exact projection of opaque/error islands.

Lists and delimited forms use the writer helpers directly. Infix chains, application, or another
construct get a human-authored special rule only when literal printing plus the core spacing policy
does not produce the intended result. No formatter source is generated from the Peggy grammar.

```text
Origin
  = Authored(nodeId, sourceSpan)
  | Recovery(recoveryId, sourceAnchor)
  | Generated(nodeId)
  | Island(nodeId, sourceSpan)
```

The writer returns text and ordered provenance pieces directly. Mapping is produced during
rendering, never reconstructed afterward by aligning token streams.

The first release has no general width-sensitive flattening. A constructor may have a simple local
rule such as “atomic items stay on one line; compound items use one item per line.” If experience
later shows that column-aware wrapping is valuable, add a bounded local `flatOrMultiline` helper.
That does not require converting the formatter to an intermediate `Doc` tree.

Suggested modules:

- `formatter_types.wm` — results, origins, pieces, and invariant failures;
- `formatter_writer.wm` — direct text, indentation, separators, and provenance;
- `formatter_render.wm` — handwritten literal Surface traversal and the small core policy set;
- small bounded companions only if exceptional rules would push `formatter_render.wm` over the
  repository limit;
- `formatter_validate.wm` — ownership and recovery invariants;
- `formatter.wm` — orchestration;
- generated `formatter_dto_*.wm` — stable JavaScript conversion.

### Validation is not eligibility

Before layout, validate:

- every reachable constructor has a rendering rule;
- every significant concrete token or source region has one structural owner;
- every missing slot has one reachable mark and matching fallback;
- every island contains its exact owned text;
- comment attachments are ordered and non-duplicated;
- delimiter pairs and repair-pair ordering are consistent.

Failure means frontend-v2 violated its own representation invariant. It is a compiler bug, not an
unsupported user document. The public boundary may return a structured `InternalError`, but it must
never use this path for ordinary incomplete syntax.

Whitespace tokens need no structural owner. EOF belongs to the document boundary.

### Recovery projection

The target writer traverses the tree once. Mode dispatch happens when it reaches a marked leaf:

| Surface value                             | `Real`                  | `RealFix`               | `Virtual`                         |
| ----------------------------------------- | ----------------------- | ----------------------- | --------------------------------- |
| `Authored(value)`                         | render value            | render value            | render value                      |
| `Mark(id, exactToken)`, `AutoFix`         | omit fallback           | render recovery piece   | render virtual piece and artifact |
| `Mark(id, categoryHole)`, `RecoveryOnly`  | omit fallback           | omit fallback           | render `?` and artifact           |
| `Mark(id, fallback)`, `OptionalCanonical` | omit fallback initially | omit fallback initially | render virtual piece and artifact |
| comment or opaque/error island            | retain exact text       | retain exact text       | retain exact text                 |

“Omit” means omit the fallback, not the surrounding constructor or authored input. The formatter
therefore remains total in every mode.

`RepairClass` governs which projection may become a source edit:

- `AutoFix` is eligible for `RealFix` and a code action;
- `OptionalCanonical` records an accepted shorthand normalization, but is not materialized in the
  first release;
- `RecoveryOnly` is visible in `Virtual` but is never an unsolicited source edit.

The initial `RealFix` policy covers only marked missing `;`, `{`, and `}`. Broadening it is a policy
change, not a new formatter implementation.

`Virtual` is the inlay renderer: it returns the virtually completed text plus artifacts mapping each
virtual piece to its mark and authored anchor. It is the same structural traversal as `Real` and
`RealFix`, not a second renderer. It is implemented after the first formatter/default-parser
release.

### Structural round-trip laws are hardening, not the shipping gate

For valid source, round-trip checking is simple: parse before and after formatting and compare the
existing normalized semantic DTO. That is a shipping gate.

For malformed source, the analogous structural laws are more expensive. `Real` may reconstruct
equivalent recovery with different mark/island topology, `RealFix` satisfies only an eligible subset
of marks, and `Virtual` turns displayed fallbacks into authored syntax. A complete oracle therefore
needs a generated structural normalizer plus mode-specific expected projections.

The intended laws can still guide the representation:

Define normalization in WM:

- erase parse-local node, pair, and recovery IDs;
- erase spans and concrete/virtual origin;
- erase formatter-owned whitespace;
- retain constructors, meaningful spellings, list order, comment ownership, and island text.

Define three projections:

- `authoredProjection(program)` retains authored values, marks, and islands but omits marked
  fallback text;
- `materializeAutoFix(program)` replaces only `RealFix`-eligible exact-token marks and erases the
  satisfied marks;
- `materializeVirtual(program)` replaces every displayed fallback, including category holes
  projected as `?`, and erases the displayed marks;
- preserve opaque/error islands and their retained text;

If those helpers are generated later, property-test:

```text
normalize(parse(renderSurface(program, Real).text).program)
  == normalize(authoredProjection(program))

normalize(parse(renderSurface(program, RealFix).text).program)
  == normalize(materializeAutoFix(program))

normalize(parse(renderSurface(program, Virtual).text).program)
  == normalize(materializeVirtual(program))
```

If an error island necessarily reparses with fresh recovery, compare its normalized island content
and structural position rather than its parse-local recovery identity.

This replaces WorkmanGR's `canonicalNonWs` check with the actual structural law. These
malformed-source equivalence properties are useful hardening and debugging tools, but the first
release does not implement their oracle merely to satisfy a release gate.

## Canonical style

Freeze style in fixtures:

- two-space indentation;
- LF output and exactly one final newline for non-empty modules;
- no semantic reordering;
- one top-level terminator per phrase;
- terminated block items end in `;`; the result expression does not;
- spaces around binary operators, `=`, `=>`, and annotation `:`;
- no padding immediately inside delimiters;
- canonical comma/separator spelling for list constructors;
- no trailing comma in single-line forms and one in explicitly multiline forms where grammar accepts
  it;
- preserve literal spelling initially;
- preserve authored grouping;
- retain the currently accepted function-type arrow until its coordinated language migration;
- preserve exact comment contents and island text.

Tuple application and currying stay visible:

```workman
f(a, b)
f a b
```

Do not add configurable style before the canonical rules stabilize.

## Public API

Internal WM:

```text
formatStructural(document, mode) -> FormatResult
```

Generated library:

```text
formatDocument(source, mode) -> FormatResultDto
```

Result:

```text
FormatResult {
  schemaVersion
  text
  changed
  pieces
  projectedRecoveryIds
}
```

There is no initial style-options object or user-syntax `Unsupported` result. `Mode` is a projection
policy over one renderer, not separate implementations. Adding `Virtual` and `virtualArtifacts` is a
later schema-versioned API extension.

`formatDocument` parses once. WM callers holding a `StructuralDocument` use `formatStructural`. The
current TypeScript cache holds only a DTO, so the first LSP integration may cache the formatting
result by URI and source version. Do not rebuild a private AST from the DTO merely to claim cache
reuse.

An incompatible DTO change requires a schema-version decision and strict loader validation.

## Delivery sequence

### Phase 0 — specify the generator boundary

Deliver:

- declare the stable Peggy frontend the authority for valid-source grammar and semantics;
- define the normalized grammar IR, action boundary, recovery annotations, and generated-file
  layout;
- define the named generator-exception ABI and the release cap of eight grammar/lexical exceptions;
- define the generated marked Surface schema, frontend ABI, required DTO projections, and formatter
  mode extension point, with only `Real` and `RealFix` in the first API;
- use every `.wm` file under `examples` as the recognition-parity corpus, plus small generator
  combinator smoke cases and initial whitespace/block formatter examples.

Exit gate:

- the PEG-to-WM generator has an implementable input, output, and test contract;
- no compatibility promise is made for the incomplete manual frontend-v2 experiment;
- git history is sufficient reference for anything removed in Phase 1.

### Phase 1 — intentionally break frontend-v2 and bootstrap generation

Remove the hand-written frontend-v2 lexer/parser path rather than maintaining two implementations:

- delete or disconnect `lexer.wm`, `parser*.wm`, `surface_parser.wm`, `surface_pairs.wm`, and
  parser-specific virtual-artifact construction at the start of the phase; there is no live fallback
  path;
- remove the interim positional `types.wm`; replace it with the grammar-generated Surface schema
  plus a small hand-authored recovery/provenance core;
- compile Peggy lexical rules into generated lossless WM lexer modules;
- compile Peggy syntax rules into generated WM recognizer/parser modules;
- route isolated non-mechanical grammar/lexical cases through the recorded named exception hooks;
- generate the Surface schema and required DTO codecs from the same IR;
- port common semantic-action templates and every inventoried initializer/non-template action into
  named WM functions;
- generate the full valid-source Surface AST, not a new manually chosen subset;
- generate modules below 500 lines with source-rule traceability;
- rewire `frontend.wm`, DTO conversion, and the loader only after the generated boundary exists.

It is acceptable for frontend-v2 tests and mode integration to be deliberately red inside this
phase. Do not keep the manual parser alive merely to preserve a green transitional mode.

Keep the broken integration period observable through standalone checkpoints: Peggy-AST-to-IR
goldens, generated lexer tests, generated recognizer parity, Surface-tree ownership checks, semantic
projection parity, and finally loader integration. “Intentionally broken” does not mean one
unverifiable generator rewrite.

Exit gate:

- the generator reports every Peggy rule as emitted with no unknown grammar construct;
- the generated lexer/parser matches Peggy recognition for every `.wm` file under `examples`;
- the generated parser constructs the complete planned Surface AST;
- every hand-written grammar/lexical hook is named, reported, fixture-backed, and within the cap of
  eight;
- the generation report contains no unknown or unclassified Peggy construct;
- grammar changes regenerate WM source reproducibly.

### Phase 2 — ship the useful formatter slice

Extend the generated valid-source frontend without reintroducing hand-written productions:

1. keep valid-source recognition grammar-complete and add a tolerant path only at explicitly
   committed recovery sites;
2. add required-slot recovery only for missing `;`, `{`, and `}`;
3. preserve comments exercised by valid/recoverable syntax without requiring general malformed
   lexical islands;
4. implement the direct structural writer with `Real` and `RealFix`;
5. make `RealFix` materialize only the three initial repair token kinds;
6. emit recovery provenance pieces directly from those marks;
7. re-establish semantic lowering and the generated frontend ABI over total results.

Do not implement general continuation-set analysis, category-hole synthesis, `Virtual`, or repair of
other exact tokens in this phase.

Do not create a hand-authored test matrix for every generated constructor. Instead:

- test each generator combinator independently from formatting;
- add focused goldens for literal printing, spacing, blocks, comments/islands, and each exceptional
  human-authored layout rule;
- run Peggy parity, valid-source semantic preservation, and textual idempotence across the corpus;
- use generated cases or fuzzing for missing required slots, trivia/island adjacency, and
  later-sibling preservation;
- add a regression fixture whenever a corpus or fuzz case exposes a distinct failure.

Valid grammar coverage receives canonical layout. Damage outside the three repair token kinds may
still reject; it must never be accepted by silently dropping authored text. Exact islands and total
malformed-input rendering are Phase 4 work and do not delay the formatter.

Exit gate:

- valid repository syntax is fully structured rather than hidden in islands;
- each accepted targeted-recovery input retains all authored content and produces the declared
  marks;
- the repository corpus formats deterministically;
- emitted text is idempotent in `Real` and `RealFix`;
- formatting valid corpus input preserves its normalized semantic DTO;
- `RealFix` inserts only marked `;`, `{`, and `}`, while `Real` inserts none of them;
- irregular whitespace around the `let main = () => print "hello world"` example formats
  canonically, and `RealFix` supplies its block braces and top-level semicolon;
- no formatter module reparses text or consults semantics.

### Phase 3 — make it the product default

Parser:

- complete the Surface-to-current-semantic-AST projection, including existing desugarings;
- use differential AST and compiler-result tests while Peggy remains the migration oracle;
- move compiler, CLI, generated libraries, REPL, and LSP onto frontend-v2;
- remove the generated Peggy JavaScript parser and Peggy runtime path after the soak gate;
- keep grammar changes single-source: edit `src/grammar.peggy`, then regenerate frontend-v2.

CLI:

```text
wm fmt file.wm ...
wm fmt --fix file.wm ...
wm fmt --check file.wm ...
wm fmt --stdin
```

Plain `wm fmt` uses `Real`; `--fix` uses `RealFix`; `--check` performs no writes and returns nonzero
when `Real` output differs. Writes are atomic. Batch mode reports internal invariant failures
without writing affected files. `--fix` is documented narrowly as missing-semicolon/brace repair.

LSP:

- switch LSP parsing to frontend-v2 by default after parity and soak gates pass;
- advertise `documentFormattingProvider`;
- use the open document source/version;
- use `Real` for document formatting and return one full-document edit when output changed and `[]`
  otherwise;
- expose brace/semicolon `RealFix` through an explicit fix command or `RepairClass`-filtered code
  action;
- retain cancellation and document-version checks;
- keep source-fixing actions separate from ordinary Format Document.

Rollout:

1. parser differential tests, formatter corpus tests, and performance baseline;
2. opt-in frontend-v2/default-parser and formatter flag;
3. one reviewed repository-format change;
4. real incomplete-buffer traces focused on missing `;`, `{`, and `}`;
5. short performance and correctness soak;
6. make frontend-v2 the default parser and enable formatting by default.

Frontend-v1 deletion remains a separate cleanup gate; it is not the default after this phase.

### Phase 4 — generalize after shipping

Add independently, based on observed editor value:

- progress-bounded exact islands and lossless/total projections for arbitrary finite buffers;
- `Virtual` mode and virtual-artifact DTOs for structural inlays;
- generated continuation/FIRST-set analysis;
- other uniquely determined exact tokens such as `)`, `]`, `=`, or `else`;
- inferred expression, pattern, type, name, and block holes;
- paired recovery ordering and multiple virtual projections at one anchor;
- richer synchronization that preserves later declarations after arbitrary damage.

Each addition reuses the same marks, Surface traversal, writer, and provenance pieces. None is a
prerequisite for the default parser, whitespace formatter, or `;`/`{`/`}` repair release.

## Test matrix

Focused fixture families:

- generator constructs: sequence, choice, repetition, option, predicate, lexical rule, and action;
- formatter core: literal printing, spacing, delimiters, block indentation, top-level phrases,
  comments, and islands;
- every recorded generator exception;
- every human-authored exceptional layout rule and recovery annotation;
- representative comments, islands, grouping, precedence, and malformed-token cases.

The valid repository corpus supplies breadth across generated constructors. Initial mutation tests
remove `;`, `{`, and `}` from selected corpus inputs; fuzzing verifies that arbitrary other damage
is retained safely as islands. Phase 4 can generate broader required-slot mutations. This avoids
multiplying handwritten examples by constructor × recovery slot × mode.

Global properties:

- parse and format determinism;
- formatting the emitted text again produces the same text for each implemented mode;
- formatting valid input preserves its normalized semantic DTO;
- no concrete region lost or duplicated;
- every recovery piece references one mark;
- `Real` and `RealFix` share traversal and constructor layout fixtures;
- arbitrary finite buffers never crash or hang;
- output reparses within a bounded time;
- Unicode and CR/LF/CRLF input with canonical LF output.

Integration tests:

- generated-library export and strict loader;
- LSP capability gating, document versions, UTF-16 ranges, and unchanged output;
- CLI atomic writes, `--check`, stdin, batches, and exit codes;
- VS Code Format Document smoke test.

## Performance gates

Measure:

- parse-only frontend-v2 corpus;
- parse plus validation and formatting;
- second-format idempotence pass;
- incomplete-buffer edit traces;
- generated-library serialization separately from WM execution.

Set numeric thresholds after Phase 1 establishes a generated-parser baseline on a named machine/CI
runner and fixed corpus. Do not make guessed ratios into release blockers. The required gates are:

- validation and direct rendering are linear in AST/output size;
- parse-only, parse-plus-format, and incomplete-edit p50/p95 stay within the recorded rollout
  budget;
- generated-library load/serialization cost is reported separately rather than blamed on rendering;
- any material regression against the accepted baseline is investigated and either fixed or
  explicitly accepted;
- no repeated tail scans like the earlier match-recovery regression.

## Reuse and rejection from WorkmanGR

Reuse:

- Surface AST traversal patterns;
- block item versus result distinction;
- two-space indentation experience;
- the `Real | RealFix | Virtual` product model over one shared traversal;
- marks, repair classes, pair IDs, artifacts, and recovery regressions;
- timing harness and LSP full-document edit experience.

Do not port:

- obsolete grammar or export state;
- global diagnostic buffers;
- formatter token scans for missing punctuation;
- source/formatted token alignment and opaque fallback;
- `canonicalNonWs` as the correctness oracle;
- mode-specific duplicate traversals, token-alignment pipelines, and post-render repair discovery;
- the monolithic stateful renderer;
- semantic lookup during formatting.

WorkmanGR proves broad rendering and the three projections are feasible. Its AST traversal is mostly
shared, but `RealFix` later diverges into repeated rendering, source/formatted token alignment,
broken-span detection, and semicolon projection. Frontend-v2 keeps the modes and eliminates that
post-render machinery by putting recoverable slots in the marked Surface AST.

## Definition of shipped

The formatter is shipped when:

- it is implemented in WM inside frontend-v2;
- frontend-v2 is Workman's default parser;
- every finite buffer has a lossless marked Surface AST and a total canonical projection;
- `Real` and `RealFix` are total projections of one structural traversal;
- `RealFix` repairs marked missing `;`, `{`, and `}`, and no other syntax;
- comments and opaque/error islands retain exact meaningful text;
- common current-Workman syntax is structured and canonically laid out;
- `wm fmt`, `wm fmt --fix`, `wm fmt --check`, and frontend-v2 LSP formatting are integrated;
- formatting is deterministic, textually idempotent, semantics-preserving on valid source, and
  corpus-tested;
- performance meets measured budgets;
- there is no formatter-private parser, token-alignment recovery, or semantic dependency.

Future configuration, range formatting, incrementality, and richer maps may extend this renderer.
They may not introduce a second structural authority or make ordinary malformed syntax unrenderable.
