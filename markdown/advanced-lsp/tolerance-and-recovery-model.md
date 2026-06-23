# Tolerance, marks, fallbacks, and diagnostics

## Purpose

This document defines the tolerant frontend model for frontend v2. It is intended
to prevent a recurring implementation mistake: treating tolerance as “catch a
parse error and keep going,” or treating a mark as either only an AST node or only
a diagnostic.

The recovery path is:

```text
required syntax is absent or unusable
  -> create a structured recovery mark
  -> create a category-correct fallback
  -> place the fallback into the continuing tree
  -> retain the mark in the structural result
  -> derive a rich diagnostic/explanation from the same recovery event
  -> optionally project the mark into a virtual token/inlay or concrete repair
```

This sits inside the broader structural-editor model in
[`structural-editor-model.md`](./structural-editor-model.md). The parse remains
structurally total for ordinary incomplete editor states. Later
phases receive explicit fallback structure rather than `null`, a thrown parse
exception, or an arbitrary neighboring node.

## Verification against the Grain implementation

See [`grain-inventory.md`](./grain-inventory.md) for the complete implementation,
test, preview, and benchmark map. The files cited below are working predecessor
code, not only design notes.

The statement “marks are both part of the AST and diagnostics, and every missing
thing has a fallback” accurately describes the Grain implementation's design
direction, with three qualifications.

### What Grain actually does

In `research/workmangr/src/core/surface_ast.gr`, `Mark` is a syntax-domain record:

- it has its own node ID and span;
- `MarkKind` distinguishes missing tokens, expressions, patterns, types, blocks,
  semicolons/braces, unexpected tokens, and formatting mismatches;
- `ExpectedKind` records the syntactic category;
- `RepairClass` separates auto-fixable, canonical, and recovery-only cases;
- paired repairs can share `repairPairId`.

Marks can occur directly in the structural tree as `TopItem.Mark` and
`BlockItem.MarkItem`. The parser also creates marks while synthesizing values that
fill required typed positions:

- missing expression -> inferred expression hole;
- missing type -> inferred type hole;
- missing pattern -> wildcard pattern;
- missing name -> synthetic name/token;
- missing punctuation -> synthetic token or explicit mark item;
- unsupported pattern conversion -> marked Core pattern containing a wildcard;
- unrecognized top-level material -> opaque trivia so the parser can retain it and
  continue.

`research/workmangr/src/core/error.gr` then pairs a mark with a `CompilerError` in
`MarkedError`. `createMarkedError` stores the ordinary diagnostic and the
mark/diagnostic pair while returning the supplied recovery value. This is the key
control-flow pattern:

```text
createMarkedError(mark, diagnostic fields, recoveryValue)
  records diagnostic(mark)
  returns recoveryValue
```

The parser therefore continues with a value of the type its caller requires.

### Qualification 1: a mark is not always an AST child

Some recovery sites insert `MarkItem(mark)` or `TopItem.Mark(mark)` directly. Other
sites put only the fallback in that AST slot—for example an inferred `HoleExpr`—and
retain the mark through the marked-diagnostic side channel. It is more accurate to
say:

> Every recovery event has syntax identity and diagnostic identity; its mark may be
> embedded in the tree or associated with the fallback through the parse result.

Frontend v2 should make that association explicit rather than depending on global
diagnostic buffers.

### Qualification 2: the fallback invariant is broad, not perfectly universal

The Grain parser usually provides a fallback for a missing required result, and it
has `ensureProgress` as a last-resort skip-token recovery. However, unknown
top-level lines can become opaque trivia without a corresponding marked diagnostic,
and recovery coverage varies by production. This is prototype unevenness, not a
principle to preserve.

Frontend v2 should adopt the stronger invariant:

> Every failed required parse slot returns a fallback of that slot's category and a
> recovery mark. Every consumed but unclassified concrete region returns an
> error/opaque node and a recovery mark. No recovery is invisible.

### Qualification 3: Grain diagnostics are intentionally minimal

The Grain `CompilerError` carries stage, severity, message, span, and a flat list of
expected/received/incomplete/note/hint clues. It is enough for LSP publication, but
it does not explain the grammar rule, failed premise, recovery action, fallback,
evidence, or why an offered repair is valid.

Frontend v2 should retain the successful mark/fallback mechanics while generating
diagnostics in wm-mini's richer auditable form.

## Normative frontend-v2 invariants

### 1. Total structural result

For any finite source string, parsing returns a valid `StructuralParseResult`. It
may contain diagnostics, missing nodes, error nodes, or opaque regions, but user
syntax never prevents construction of a well-formed structural document.

Host failures and violated internal invariants may still throw. User syntax does
not.

Validity here is structural, not batch-semantic acceptance. An `ErrorExpr` or
`OpaqueItem` is a valid structural node even when it prevents executable semantic
projection.

### 2. Typed fallback for every required slot

Every parser function returns the category promised by its type. Failure to parse
that category creates a fallback of the same category.

| Required category | Structural fallback | Initial semantic projection |
| --- | --- | --- |
| token | zero-width synthetic/missing token | omitted or materialized virtually |
| name | `MissingName` with stable ID | unresolved synthetic identity, never a normal user name |
| expression | inferred `HoleExpr` or bounded `ErrorExpr` | hole/error expression accepted by recovery-aware inference |
| pattern | `HolePattern` or wildcard only when wildcard semantics are intended | error pattern or wildcard with recovery provenance |
| type | `HoleType`/`ErrorType` | recovery type variable or `ErrorTy` |
| block | block containing marks and a hole body as needed | recoverable block expression |
| declaration | `ErrorDecl` retaining its source | skipped transactionally by elaboration |
| top-level item | marked `OpaqueItem`/`ErrorItem` | not elaborated, but never discarded |
| list element/arm/field | marked missing element of the correct category | omitted only with explicit recovery evidence |

Do not use a magic textual name such as `_missing` as if it were authored source.
If JavaScript/TypeScript adaptation temporarily requires a string name, keep its
recovery identity separately and guarantee that it cannot resolve to a user binding.

### 3. One recovery event, one stable mark

A recovery event receives one stable `RecoveryId`. Multiple projections may refer
to it:

- the fallback node;
- a structural mark item;
- a diagnostic;
- a virtual artifact/inlay;
- a code action or materialized edit;
- a downstream diagnostic dependency.

Do not emit two diagnostics merely because a helper returns both a name string and
a token. Both values should reference the same recovery event.

### 4. Concrete text is never silently lost

Inserted fallbacks are zero-width. Unexpected concrete tokens are either attached
to an error node, retained as opaque syntax, or deliberately skipped by a recovery
step that records their exact span and text. Concrete rendering must reproduce the
input exactly.

### 5. Recovery always makes progress

Each recovery step must do at least one of:

- consume concrete input;
- move to a later synchronization boundary;
- insert a fallback and return to a caller that consumes or terminates;
- terminate at EOF.

The parser should assert this property around loops. A last-resort single-token
`SkipUnexpected` recovery is preferable to an infinite loop, but it must preserve
the skipped token in an error node and diagnostic evidence.

### 6. Recovery provenance survives semantic analysis

When semantic analysis continues through a fallback, facts derived from it are
tainted by the recovery ID. Diagnostics caused only by that fallback should depend
on the structural diagnostic or be suppressed as redundant. Diagnostics involving
independent authored facts may still be useful.

### 7. Marks have graded seriousness

Grain makes this explicit through two independent classifications:

- diagnostic severity (`Warning` versus `SError` in the implementation); and
- `RepairClass` (`AutoFix`, `OptionalCanonical`, or `RecoveryOnly`).

For example, missing statement/top-level semicolons are `AutoFix` marks reported as
warnings. Recovering a bare expression as a braced block creates paired `AutoFix`
brace marks reported as warnings. Missing required expressions, patterns, or types
are normally `RecoveryOnly` errors. The formatter can emit
`OptionalCanonical` virtual text such as an inferred unit parameter without a
parser error.

Therefore flexible shorthand is still marked as structurally incomplete “in a
way”; it is not equivalent to fully explicit canonical text. The editor keeps it
usable by maintaining an explicit structural interpretation and showing the
difference through inlays. Frontend v2 should preserve this grading rather than
collapsing all omissions into either “valid” or “broken.”

Suggested policy:

| Class | Meaning | Diagnostic publication | Inlay | Automatic materialization |
| --- | --- | --- | --- | --- |
| `OptionalCanonical` | Unambiguous omitted canonical form | hint or hidden by policy | yes | only on request |
| `AutoFix` | Required structure with one safe completion | warning/hint | yes | safe code action |
| `RecoveryOnly` | Parser chose a fallback but cannot claim a unique edit | error | when useful | no |

Every class still has a structured explanation object. “Hidden by policy” means it
need not occupy the Problems panel; it does not mean the structural event vanished.

### 8. Marks are not edits

A mark records what failed and how parsing continued. A concrete repair is one
possible projection. Some marks are safe insertions; some are recovery-only and
must not claim an automatic fix.

## Proposed recovery mark

The exact WM syntax may evolve, but the information model should be equivalent to:

```text
RecoveryMark {
  id
  code
  phase
  severity

  anchor
  rule
  rulePath
  subject

  expectation
  observation
  recovery
  fallback

  repairClass
  repair
  pairId
  order
  dependsOn
}
```

### Identity and classification

- `id`: stable within one parse result and reused by all projections.
- `code`: stable machine-readable code such as
  `parse.let.missing-expression`.
- `phase`: lexing, parsing, structural rendering, or semantic projection.
- `severity`: error, warning, information, or hint. Severity is policy; it does not
  change whether a fallback exists.

### Source and rule context

- `anchor`: zero-width insertion position or concrete offending range.
- `rule`: exact grammar/recovery rule being applied.
- `rulePath`: structural call path such as
  `ParseModule -> ParseLetDecl -> ParseBinding -> RequireExpression`.
- `subject`: stable ID of the declaration/node/slot under construction.

### Failed premise

- `expectation`: required token/category and its role, not only printable text.
- `observation`: current token, EOF, malformed region, or failed subparse that did
  not satisfy the expectation.

### Continuation

- `recovery`: action such as `Insert`, `SynthesizeHole`, `WrapAsBlock`,
  `SkipUnexpected`, `ConsumeOpaqueUntil`, or `CloseAtBoundary`.
- `fallback`: ID and category of the value placed in the continuing tree.

### Repair projection

- `repairClass`: safe automatic fix, suggested/canonical fix, or recovery-only.
- `repair`: optional concrete edit with range/text plus the premise it makes true.
- `pairId`: groups paired `{`/`}` or other coordinated insertions.
- `order`: deterministic order when several zero-width artifacts share an anchor.
- `dependsOn`: earlier recovery IDs required to understand this mark.

The mark should contain structured facts, not a pre-rendered essay. Human messages
are rendered from those facts, with optional authored profiles for especially
important diagnostics.

## Fallback versus repair

These concepts must remain separate.

```text
fallback
  internal syntax/semantic value that lets the pipeline continue

repair
  optional user-facing change that would satisfy the failed premise
```

For `let thing =`:

- failed premise: a let binding requires an expression after `=`;
- observation: declaration boundary or EOF;
- fallback: inferred expression hole;
- repair candidate: insert `?` at the zero-width anchor;
- virtual artifact: `?`;
- a separate missing-semicolon recovery may insert `;` at the same anchor with a
  later structural order.

For an unexpected token in a damaged expression:

- fallback: `ErrorExpr` retaining the token region;
- recovery: consume until a statement boundary;
- repair: possibly none, because deletion or replacement is not uniquely justified.

The frontend must never label a fallback as a safe fix merely because the fallback
made the parser continue.

## How this maps to wm-mini diagnostics

wm-mini's diagnostic thesis is already stronger than Grain's:

```text
A diagnostic is a failed compiler premise plus the evidence needed to replay that failure.
```

The intended object model has:

- an exact rule frame and rule path;
- a failed premise and predicate;
- an observed violation;
- source/recovery anchors;
- a support graph with recovery evidence;
- justified repairs;
- dependencies for cascading failures.

This is a natural fit. A recovery mark is the parser's durable record of the failed
premise and continuation. The structural diagnostic is a projection of that mark
into the general diagnostic model.

### Important current-state distinction

The design document in `markdown/diagnostics/diagnostic-object-model.md` is ahead of
the currently implemented TypeScript types in `src/diagnostic_writer.ts`.

The current implementation already has:

- diagnostic/rule/premise/evidence IDs;
- rule frames and paths;
- source/generated anchors;
- contradicted and unsatisfied violations;
- claims, constraints, substitutions, collisions, and notes;
- support edges/roots and type snapshots;
- dependency lists.

It does not yet implement the full recovery design:

- `SourceAnchor` has only `source` and `generated`, not `recovery`;
- predicates are currently type equality only;
- support entries have no recovery variant;
- `repairs` is typed as an always-empty tuple/list;
- parser failures still arrive mainly as one thrown Peggy error and are converted
  through a generic diagnostic path.

Frontend v2 should extend this model rather than introduce a parallel
`ParserDiagnostic` format that the LSP later has to translate.

## Structural diagnostic mapping

For each mark, construct one auditable explanation object as follows. Publish it as
an LSP diagnostic according to its severity/repair policy; optional canonical marks
may remain visible only as inlays unless the user asks for explanations.

```text
mark.rule, mark.rulePath, mark.subject
  -> diagnostic.failure.frame

mark.expectation
  -> diagnostic.failure.premise

mark.observation
  -> diagnostic.failure.violation

mark.anchor
  -> diagnostic.primary

mark.recovery + mark.fallback
  -> diagnostic.support RecoveryEntry

mark.repair, when justified
  -> diagnostic.repairs

mark.dependsOn
  -> diagnostic.dependsOn
```

### Required diagnostic-model extensions

Add syntax-capable predicates without making diagnostics parser-specific. Suitable
variants include:

```text
Present(subject, syntaxCategory)
TokenIs(subject, tokenKind)
WellFormed(subject, syntaxCategory)
Delimited(subject, openKind, closeKind)
Separated(items, separatorKind)
```

Add violations that preserve the immediate counterexample:

```text
Missing(observedBoundary)
Unexpected(observedToken, expectedSet)
Malformed(observedRange)
Unclosed(openToken, observedBoundary)
```

Add a recovery support entry:

```text
RecoveryEntry {
  id
  action
  anchor
  consumedRange
  insertedText
  fallbackNode
  fallbackCategory
  repairClass
}
```

Add real repairs:

```text
Repair {
  id
  description
  edits
  makesTrue
  requires
  applicability
}
```

`applicability` should distinguish a mechanically safe insertion from a suggestion
that needs user judgment. A repair references the failed premise and recovery
evidence that justify it.

### Example: missing let expression

Source:

```wm
let thing =
```

Diagnostic structure:

```text
code: parse.let.missing-expression

failure.frame:
  rule: ParseLetBinding
  subject: binding thing
  path: ParseModule -> ParseLetDecl -> ParseBinding -> RequireExpression

failure.premise:
  role: let-binding-must-have-value
  predicate: Present(binding.value, Expression)

failure.violation:
  Missing(EOF)

support:
  authored '=' token
  observed EOF boundary
  recovery: SynthesizeHoleExpr
  fallback: HoleExpr#42, origin Recovery#17

repair:
  insert '?' after '='
  makesTrue: let-binding-must-have-value
```

The missing-semicolon diagnostic is a separate recovery event because it satisfies
a different premise. Its repair may share the same anchor but has a later `order`.

### Example: missing closing brace

Source:

```wm
let main = () => {
  print("hello")
```

Diagnostic structure should identify:

- the opening brace and block node as support;
- the rule requiring the matching close;
- EOF as the observed boundary;
- a zero-width synthetic `}` fallback;
- the relationship to any paired/opening repair;
- whether inserting `}` is safe at this boundary;
- downstream diagnostics that depended on treating the block as closed.

“Expected `}`” alone is not sufficient for wm-mini's quality target.

## Semantic continuation and diagnostic cascades

Fallbacks exist to preserve useful analysis, not to generate noise.

### Recovery-aware semantic values

The TypeScript inference engine will eventually need explicit recovery forms or
provenance:

- `HoleExpr` receives a fresh type variable and can accumulate expected-type facts;
- `ErrorExpr` can use `ErrorTy` or a tainted fresh variable;
- `HolePattern` can bind nothing unless its recovery rule explicitly synthesized a
  binder;
- `ErrorDecl` does not mutate the environment;
- a missing delimiter changes structure but should not itself poison contained
  expressions;
- an opaque region contributes no invented semantic bindings.

### Dependency policy

If a type error exists only because a recovery fallback was invented, either:

- suppress it as redundant; or
- publish it with `dependsOn` pointing to the structural diagnostic and render it as
  secondary.

If authored code on both sides independently contradicts, publish the semantic
diagnostic even when recovery was also present. The support graph should show which
facts were authored and which came from recovery.

Examples:

- Missing RHS followed by “hole has unknown type”: suppress; it adds nothing.
- Missing semicolon between two otherwise valid declarations: continue and report
  semantic errors in the second declaration normally.
- Inferred hole is required to be both `Number` and `String`: report an unfillable
  hole diagnostic depending on the original recovery mark, because the conflict is
  useful and supported by authored contexts.

## Parse-result ownership

Do not reproduce Grain's global mutable diagnostic buffers. Frontend v2 should
return all products together:

```text
StructuralParseResult {
  schemaVersion
  sourceLength
  tokens
  tree
  marks
  diagnostics
  repairs
  virtualArtifacts
  sourceMap
}
```

Recommended identity relations:

- every mark ID appears exactly once in `marks`;
- every fallback created by recovery references one mark ID;
- every structural diagnostic references one primary mark ID;
- every virtual artifact references one mark ID;
- zero or one automatic repair references a mark ID initially;
- tree mark items reference entries in `marks`, not copied divergent records.

Diagnostics may be rendered lazily from marks, but the TypeScript ABI should expose
the structured diagnostic result so all consumers see the same rule/premise data.

## Recovery taxonomy

Use a small explicit taxonomy so implementations and tests agree.

### Insert missing syntax

No concrete input is consumed. A zero-width token or node is introduced at a safe
anchor.

Examples: `;`, `}`, `)`, `=`, expression hole.

### Substitute a category fallback

The current token cannot begin the required category. Produce `HolePattern`,
`ErrorType`, `MissingName`, and so on. Consume input only if it becomes part of the
error node.

### Wrap existing syntax

Existing concrete syntax is retained but virtual surrounding structure is added.

Example: a bare lambda body is wrapped by paired virtual `{` and `}` marks.

### Skip unexpected syntax

Consume at least one unexpected token and preserve it in an error node. Use this as
a bounded progress recovery, not the first response to every mismatch.

### Synchronize at boundary

Consume an opaque/error region until a context-specific boundary, preserving its
full concrete span. Boundaries must be supplied by the grammar context rather than
a single global token set.

### Close at boundary

When a known opener reaches a boundary that cannot belong inside it, synthesize the
matching closer without consuming the boundary. Record opener, boundary, and pair
identity.

## Inlays and formatting

Structural inlays consume marks/virtual artifacts; they do not discover missing
syntax independently.

```text
parser recovery mark
  -> virtual renderer artifact
  -> range/comment/policy filtering
  -> LSP inlay hint
```

Formatting also consumes the same structural tree. It must not reconstruct repairs
by diffing formatted text against source when the parser already knows the missing
syntax. Diff/alignment may remain a validation fallback, but a formatting mismatch
then creates its own marked recovery event.

`repairClass` governs projections:

- safe auto-fix: may become an inlay and code action;
- suggested/canonical: may become an inlay or non-preferred code action;
- recovery-only: visible through diagnostics/debugging, not automatically inserted.

User-authored `?` is a hole but not a recovery mark. An inferred `?` has both a hole
node and recovery provenance. This distinction must survive rendering and semantic
analysis.

## Tests and acceptance criteria

### Structural invariants

- every finite input terminates with a valid structural document;
- every recovery loop makes progress;
- concrete render equals input exactly;
- every synthesized node/token references one recovery mark;
- every recovery mark identifies its fallback or consumed error region;
- fully explicit canonical source produces no missing-syntax recovery marks;
- flexible valid source produces only the expected optional/auto-fix marks;
- marks and diagnostics have stable codes and deterministic ordering;
- no concrete token disappears from the tree or an error/opaque node.

### Diagnostic invariants

- every structural diagnostic names an exact rule and premise;
- expected and observed syntax are structured values;
- every offered edit references the premise it makes true;
- recovery action and fallback are present in support evidence;
- dependent semantic diagnostics identify recovery dependencies;
- one recovery event does not produce duplicate primary diagnostics;
- LSP rendering is a projection of the same diagnostic object used by CLI output.

### Required examples

- missing expression after `=`;
- missing binding pattern;
- missing type annotation RHS;
- missing separator in a match arm/list/record;
- missing and paired delimiters;
- bare lambda/clause body requiring virtual block wrapping;
- unexpected token requiring one-token progress recovery;
- unknown top-level region retained as marked opaque syntax;
- user-authored hole versus inferred recovery hole;
- several virtual tokens at one anchor with deterministic order;
- semantic error independent of a nearby recovery;
- semantic error caused solely by a fallback and therefore suppressed/dependent.

## Implementation sequence

1. Define recovery IDs, mark records, structural expectations/observations, fallback
   references, and repair classes in frontend v2.
2. Extend wm-mini's diagnostic object model implementation with syntax predicates,
   recovery anchors/evidence, violations, and actual repairs.
3. Implement lossless lexing and error/opaque token retention.
4. Implement required-slot helpers that always return `(fallback, mark)` on failure.
5. Return marks and diagnostics in `StructuralParseResult`; do not use globals.
6. Implement virtual rendering entirely from tree/mark data.
7. Add semantic projection with recovery provenance and dependency suppression.
8. Expose the same structured objects through the TypeScript adapter, CLI, current
   LSP, and later WM LSP.

The result should preserve the Grain prototype's strongest idea—total typed
recovery—while giving every recovery the same auditable explanation quality as
wm-mini's semantic diagnostics.
