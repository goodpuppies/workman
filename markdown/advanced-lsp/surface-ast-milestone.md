# Surface AST ownership milestone

## Outcome

Frontend v2 owns one representative current-Workman program from lexing through typechecking by way
of a recursive Surface AST. The Surface AST is the user-facing program representation used for
recovery, diagnostics, canonical formatting, structural inlays, navigation spans, and semantic
lowering.

Following Hazel's model and the WorkmanGR inspiration, "representation" here is stronger than a
reprojection artifact: the Surface AST **is the semantic state of the user's editor**. The buffer,
diagnostics, formatted view, lowering input, hover state, and repair suggestions are projections of
that state. No parser-only or text-only shadow model may become a competing authority.

This milestone replaces the shallow source-region path for its supported forms. TypeScript may
translate the generated WM DTO and continue to own module loading and type inference, but it must
not parse expression, pattern, type, import, or block text for this slice.

The milestone is intentionally narrow. Its purpose is to prove the final ownership model before
expanding across the rest of the grammar.

## Structural-losslessness contract

The milestone targets Surface-AST losslessness, not byte-identical buffer reconstruction.

The Surface AST must retain:

- every meaningful authored token in the supported syntax;
- comments and bounded opaque/error islands;
- authored versus inferred holes;
- concrete and missing delimiters;
- recovery marks and typed fallbacks;
- enough source provenance for diagnostics, hover, definitions, inlays, edits, and lowering.

The Surface AST does not need to retain the user's original spaces, indentation, or newline
placement. Those are produced by the canonical formatter. Formatting is emergent from the tree: for
a non-error Surface AST there is one legal rendered Workman shape.

The existing exact token renderer remains useful for debugging during migration, but it is not the
canonical formatter and is not the acceptance oracle for this milestone.

## Current-Workman boundary

WorkmanGR is the implementation and behavioral reference for Surface AST structure, marks,
fallbacks, delimiter pairing, formatter-driven rendering, and editor tests. It is not the grammar
definition for this milestone.

Where current Workman overlaps Standard ML, the Revised Definition and
[`docs/smlparallels.md`](../../docs/smlparallels.md) are the semantic anchor. Surface sugar such as
braces, `let`, angle-bracket type application, and JavaScript-style file imports must not turn the
Surface AST into a JavaScript-like language model. In particular:

- `Lib.printer` is a qualified/long identifier;
- a lambda abstracts over one pattern;
- `(x, y) => body` abstracts over one tuple pattern rather than two parameters;
- currying is nested abstraction and nested application;
- `f(a, b)` applies `f` to one tuple value, while `f(a)(b)` is curried application;
- a Workman block is surface syntax for an SML-shaped local declaration/sequencing expression with a
  result, augmented with explicit brace and terminator syntax.

The eventual WMSML/SML subset path is primarily verification machinery for the same language model,
not a separate user-facing frontend mode. The Surface AST should make that verification possible by
preserving SML structure before lowering Workman-specific surface sugar.

Current Workman's deliberate differences—most notably nominal rather than flexible structural
records, file imports instead of the full SML module system, pinned bare names in match patterns,
Workman delimiters/type spelling, and JavaScript FFI—must be explicit adaptations around that SML
center rather than reasons to adopt a different expression/function model.

The completed slice decisions are recorded in
[`surface-ast-slice-inventory.md`](./surface-ast-slice-inventory.md). Current Workman documentation,
examples, and tests are authoritative when that inventory is extended.

Known required differences include:

- current Workman declarations export by default;
- the old `export` keyword and corresponding Surface AST form must not be restored;
- import, annotation, application, lambda, block, carrier, and FFI forms must use current Workman
  spelling and semantics;
- obsolete WorkmanGR/Grain declarations must not be retained merely to simplify a port.

## Representative program

The primary fixture is a small multi-file program. Its exact names are unimportant, but it must
exercise a namespace import, an annotated lambda, an authored block, qualified lookup, and
whitespace application.

```wm
from "./lib.wm" import * as Lib;

let main = (x: String) => {
  Lib.printer x
}
```

The missing final declaration semicolon is intentional. Frontend v2 must construct the same
program-shaped Surface AST it would have constructed with an authored semicolon, while attaching a
missing-semicolon mark and virtual token.

The imported fixture should be structurally simple:

```wm
let printer = (x: String) => {
  print x
};
```

The program must resolve and typecheck in actual frontend-v2 mode without Peggy or a TypeScript
syntax parser supplying the supported nodes.

## Surface AST slice

The initial recursive Surface AST must represent these forms as structured nodes rather than raw
source strings.

### Program and declarations

- program/root;
- Workman module import;
- namespace import clause;
- top-level let declaration;
- declaration terminator, concrete or missing;
- comments and opaque/error top-level regions.

### Patterns and types

- variable pattern;
- wildcard pattern;
- void/unit pattern;
- tuple pattern;
- typed pattern/annotation on a lambda or binding pattern;
- missing/error pattern fallback;
- named type;
- qualified named type if current syntax permits it here;
- missing/error type fallback;

### Expressions

- variable and qualified variable;
- string, number, boolean, and `void` literals as required by fixtures/tests;
- application, including whitespace application;
- tuple argument/application structure;
- parenthesized expression where needed for unambiguous structure;
- function abstraction over one pattern;
- nested abstraction/application proving currying;
- braced block;
- block result expression;
- authored expression hole;
- inferred expression hole;
- bounded error expression.

The schema does not need to copy WorkmanGR constructor names, but it must express equivalent
structural facts without `AtomExpr(text)`, regex parsing, or reparsing source slices.

## Braces and paired delimiters

Brace handling is a first-class part of this milestone. Braces are paired structural elements, not
two unrelated punctuation tokens.

### Required representation

For each supported block, the structural result must identify:

- its opening brace, concrete or missing;
- its closing brace, concrete or missing;
- the pairing/mate identity connecting them;
- the block contents and result expression;
- source spans for concrete delimiters;
- insertion anchors and recovery identities for missing delimiters.

The exact schema is an implementation choice. It may use token mate IDs, a paired-delimiter record,
or another explicit structure, provided consumers never need to rediscover the pairing by scanning
raw source.

### Required recovery cases

- An authored `{` and authored `}` form one pair.
- An authored `{` with no closing brace receives a missing `}` fallback and mark.
- A lambda body lacking both braces may receive missing `{` and `}` fallbacks when that
  interpretation is locally justified.
- Paired inserted braces use distinct recovery marks when they represent two failed token slots, and
  share a repair-pair identity so formatting, inlays, and materialization keep them together.
- A stray `}` is retained as a marked unexpected/error surface item; it is never silently dropped.
- Nested authored and recovered blocks pair deterministically.
- Braces inside strings, comments, and opaque islands do not participate in structural pairing.
- Recovery at a following declaration or EOF does not swallow that declaration.
- When a missing `}` and missing `;` share an anchor, formatter/inlay order is structural: `}` is
  emitted before `;`.

### Formatter behavior

The formatter renders braces from the Surface AST pair. It does not infer them again from source
text and does not diff raw text to decide whether an inlay exists.

For a complete non-error block it owns:

- brace placement;
- indentation;
- line breaks;
- placement of the result expression;
- spacing relative to the lambda arrow and declaration terminator.

Missing braces remain distinguishable from authored braces in provenance even when both appear in
the rendered canonical view.

## Marks, fallbacks, and diagnostics

Every failed required slot creates one stable recovery event.

For this slice, marks must cover at least:

- missing top-level semicolon;
- missing opening brace;
- missing closing brace;
- missing expression;
- missing pattern or lambda binder;
- malformed/unterminated lexical material used by the fixtures;
- unexpected closing brace.

A mark is Surface AST recovery state and the shared source for:

- the typed fallback;
- formatter/virtual token output;
- structural inlay;
- diagnostic and explanation;
- safe repair, when justified;
- recovery dependencies on later semantic diagnostics.

Marks may appear as explicit surface items or be referenced by fallback/delimiter nodes. In either
case, every mark must be reachable from the structural result and must identify its fallback or
retained error region. Do not introduce global mutable diagnostic buffers.

## Canonical formatter and mapping

The formatter consumes the Surface AST and emits a canonical structural rendering with provenance.
It must produce:

- formatted text;
- ordered authored/virtual output pieces;
- source-to-surface and surface-to-rendered position mapping sufficient for the slice;
- recovery IDs on virtual pieces;
- delimiter pair/repair-pair identity where applicable.

Structural inlays are filtered projections of this output. They must not independently discover
missing braces or semicolons.

For supported non-error syntax:

```text
parse(format(surface)) ~= surface
```

Equivalence ignores regenerated parse-local IDs and formatter-owned whitespace/newlines, but it does
not ignore syntax constructors, names, literals, delimiter pairing, comments, or recovery meaning.

## Semantic lowering

The generated WM frontend must lower/project the supported Surface AST nodes into the existing
compiler `Module` shape.

The lowering path must:

- consume structured import, declaration, pattern, type, expression, lambda, application, and block
  nodes;
- preserve the unary SML function/application model: tuple syntax lowers to one tuple
  pattern/argument and currying lowers as nested functions/applications;
- preserve source spans and structural IDs needed by hover and diagnostics;
- preserve recovery provenance;
- lower a missing declaration semicolon without rejecting an otherwise complete declaration;
- lower inferred holes into an explicit recovery-aware semantic representation;
- never parse a stored expression/type/import string.

After the slice is adopted, the corresponding paths in `frontend_v2_expr_adapter.ts` and the
TypeScript import/type text parsers must be deleted or made unreachable for the supported forms.

## Editor proof

The current TypeScript LSP remains the host for this milestone. In frontend-v2 mode it must use one
cached WM Surface AST result for:

- structural diagnostics;
- brace and semicolon inlays;
- semantic lowering/typechecking;
- hover spans for the representative bindings and uses;
- definition lookup for the supported local/imported names.

Editing, deleting, and restoring either brace must invalidate the cached result and publish a
version-current interpretation. No request may fall back to Peggy merely because the block is
incomplete.

## Implementation sequence

1. Complete the WorkmanGR/current-Workman `adopt`/`adapt`/`drop` inventory for the slice.
2. Define the minimal recursive Surface AST, delimiter pair, token, mark, and fallback types.
3. Extend the lexer with the current token kinds and brace mate/pair support needed by the slice.
4. Parse imports, let declarations, typed/tuple patterns, applications, unary abstractions, and
   blocks into structured nodes.
5. Implement brace, expression-hole, and declaration-terminator recovery through shared marks.
6. Implement canonical formatting and provenance maps from the Surface AST.
7. Implement direct semantic lowering and remove secondary parsing for supported nodes.
8. Route the existing compiler/LSP v2 path through the new result.
9. Port WorkmanGR brace/formatter/inlay regressions and add current-Workman fixtures.
10. Measure parse, format, DTO, lowering, typecheck, and edit-to-LSP latency separately.

## Acceptance tests

- [ ] Complete primary and imported fixtures produce recursive Surface AST goldens with no opaque
      shortcut nodes for supported syntax.
- [x] `(x, y) => { ... }` contains one tuple-pattern function rule, not a two-parameter function.
- [x] `f(a, b)` contains one tuple argument, while `f(a)(b)` contains two nested applications.
- [x] `(x) => { (y) => { ... } }` contains nested abstractions and demonstrates currying.
- [x] Qualified `Lib.printer` is represented as a long identifier, not a postfix projection.
- [ ] The primary fixture missing only its final semicolon still resolves and typechecks.
- [ ] `let main =` produces an inferred expression hole linked to one recovery mark.
- [x] Authored `{` and `}` have one explicit mate/pair identity for supported complete blocks.
- [ ] Missing `}` produces a paired missing delimiter without consuming the next declaration.
- [ ] A bare lambda body produces paired virtual braces only when the documented recovery policy
      justifies that interpretation.
- [ ] Paired virtual braces have separate recovery IDs and one shared repair-pair ID.
- [ ] A stray `}` survives as a marked error surface node.
- [ ] Nested complete and incomplete braces pair deterministically.
- [ ] Braces inside strings/comments do not affect pairing.
- [ ] A shared-anchor missing `}` renders before a missing `;`.
- [ ] Formatter output is canonical regardless of authored whitespace/newline layout.
- [ ] Comments and opaque islands survive Surface-AST formatting.
- [ ] `parse -> format -> parse` preserves the supported Surface AST modulo documented
      normalization.
- [ ] Every fallback references one mark; every mark identifies a fallback or retained error region.
- [ ] Structural diagnostics and inlays reference the same recovery IDs.
- [ ] V1/v2 normalized semantic comparison passes for the complete supported fixtures.
- [ ] TypeScript syntax adapters are not invoked for any supported milestone fixture.
- [ ] VS Code frontend-v2 mode publishes brace/semicolon inlays and continues semantic features
      through the incomplete fixtures.
- [ ] Edit-trace tests reject stale results while braces are deleted and restored.

## Explicit non-goals

- Full current-Workman grammar coverage.
- Porting obsolete WorkmanGR syntax.
- Preserving authored spaces, indentation, or newline placement.
- Replacing the TypeScript typechecker, module loader, or LSP transport.
- Incremental parsing or subtree reuse before whole-document edit traces justify it.
- A general formatting command beyond what is required to prove canonical Surface-AST rendering.
- Removing Peggy for sources outside the milestone-supported subset.

## Definition of done

The milestone is complete when the representative multi-file program and its brace/semicolon/hole
edit states are owned from lexing through typechecking by the WM Surface AST; canonical formatting,
inlays, diagnostics, hover spans, and supported definition lookup are projections of that same
structural result; and no TypeScript syntax parser reconstructs supported nodes from source text.
