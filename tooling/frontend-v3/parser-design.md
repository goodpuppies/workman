# Frontend-v3 parser proposal

Scheduled for deletion by [worklist.md](worklist.md). Do not implement or extend this
proposal. Extract concrete grammar facts only during the baseline cleanup.

Design direction superseded by [Parser and structural editor refactor / reimplementation](structural-editor-plan.md),
2026-10-12. That plan establishes canonical marked parsing, virtual expression holes,
AST projection, and source-diff inlays including whitespace. The implementation status
below describes the existing type slice; conflicting recovery restrictions and proposed
implementation sequencing are historical, not the contract for the reimplementation.

Status: first type-parser slice implemented, 2026-10-11. The native lexer baseline is verified.
Contracts below distinguish agreed recovery from questions still open.

## Boundary and ownership

Keep the parser WM-authored under `src/parser/`, using the same constrained ML style
and temporary lowering rules as the lexer. Consume `SubsetUtf16Source.Source` plus
`Token.LexicalDocument`; source spelling is available through spans, never a second
lexer. Produce the structural `SurfaceProgram`. Elaboration later decides binding,
constructor identity, record identity, literal values and types. A pinned name in a
pattern remains a syntactic name here; parsing must not resolve it by capitalization.

Retain authored delimiters, separators, annotations, trivia and parentheses. Do not
lower pipes, desugar applications or erase record spelling in the surface tree.
The current WM implementation and frontend-v2 are references for accepted concrete
syntax. The SML Definition guides categories and semantics; SML's concrete grammar
is not substituted for WM syntax. Record explicit differences and unresolved choices.

## Current evidence and representation gaps

`src/surface/ast.wm` defines the four recursive type/pattern/expression/declaration
families and shared containers. The type-parser slice now consumes its type family. Its imports use
the namespace style of the portable core and compile under WM. Embedded SML declarations
have been removed from the SubsetML WM profile, resolving the `Delimited.open` ambiguity
without changing the authored field. The next native translation probe reaches SubsetML's
intentional R2 restriction: `TypeArguments<T>` and `TypeParameters` both declared `{angles}`.
The agreed temporary convention gives them distinct `argumentAngles`/`parameterAngles`
labels, retaining separate nominal identities. `BlockItem`/`TopPhrase` similarly use
`blockPhrase`/`topPhrase`. The complete AST now translates and passes MLton type checking,
and compiles under WM. The subset rule remains unchanged.

Before claiming complete WM syntax coverage, the tree needs reviewed representations for:

- Template text and interpolations, retaining mode-boundary tokens and nested expressions.
- Dot/member access, pipe stages and their authored grouping. `LongIdentifier` alone
  does not cover all receiver expressions or distinguish the relevant syntax shapes.
- Record declarations and variant constructors with their argument types. `DeclType`
  and `TypeBinding.members` do not currently express all declaration forms explicitly.
- Imports, attributes and host-facing forms that exist in WM. Parsing these forms is
  separate from making the frontend implementation itself depend on a host API.
- Match functions and explicit pattern/binder forms. Check each existing constructor
  against the grammar before adding another constructor or collapsing distinct forms.
- Record spreads. `ExprRecord` currently has only labelled fields; the reusable
  `SpreadTail` used for list tails is not sufficient evidence of record-spread support.

These are schema questions, not permission to report accepted-but-unimplemented syntax
as malformed input. Do not implement an error-island fallback that hides missing grammar.

## Proposed implementation structure

Start with a token cursor and small shared helpers. Keep immutable cursor state and
explicit return values; ordinary records/variants/functions need no new Basis API.
A remaining-token list gives constant-time stepping. Retain the absolute token index
for mates and diagnostics. Avoid repeated indexing into linked lists, repeated source
string conversion, and repeated append to growing lists; collect in reverse and finish
once. If random mate lookup becomes necessary, discuss the actual access pattern
before adding an indexed container or changing Basis requirements.

`src/parser/cursor.wm` now implements that cursor. Its input is a lexer document for
the supplied source, including the final EOF sentinel. `take` returns `TokenTaken`
with an advanced cursor for authored tokens, or `ReachedEnd` at EOF; it never reports
a successful non-advancing step. It introduces no grammatical recovery or mark allocation.
`isWord` compares a complete identifier span against expected UTF-16 units. Fixed ASCII
keyword spellings can use it without converting the source to a host string. Prefixes,
primed names, different capitalization and quoted text do not match accidentally.

Use handwritten recursive descent for type, pattern and declaration forms. Use a
precedence-climbing expression parser with a reviewed table matching WM's fixed
operators. Keep whitespace application, parenthesized calls, receiver/member forms
and pipes explicit in the surface tree. Do not introduce configurable SML fixity.
The exact precedence/application rules need a grammar audit before implementation.

Lexer mates are evidence of lexical pairing, not a completed grammatical construct.
For `([)]`, the parser must respect the recorded crossing/mismatch behavior and its
current enclosing boundary. It cannot skip to a mate indiscriminately or pair tokens
the lexer left unpaired. Every parsing loop must either consume a token, return to
its caller at an owned boundary, or terminate at EOF.

## Recovery contracts and open decisions

A successful parser result must distinguish authored structure, agreed recovery and
unsupported implementation. Recovering a damaged editor buffer is part of the product;
its policies need concrete examples before code.

1. **Missing token representation — decided and implemented.** Store an expectation
   and mark ID, not a synthetic token. `Marks.Slot<T, Expectation>` keeps the shared kernel
   phase-independent. The AST's `TokenSlot` uses `Tokens.Token` for authored slots and
   `TokenExpectation` for missing slots. Expectations distinguish a token kind from an
   exact grammar keyword: the lexer represents keywords as ordinary identifiers.
   The referenced mark supplies the missing location/cause. `MissingToken` and
   `InsertedToken` use the same expectation type; no lexer token or source spelling
   is fabricated. This representation alone approves no insertion/recovery policy.
2. **Mark identity — implemented default, open to review.** The optional ordering question
   had no answer before implementation. The proposed default preserves lexical mark IDs
   and their attachments, allocates syntax IDs immediately after the lexical IDs, and
   exposes combined marks as lexical marks followed by syntax marks in creation order.
   Creation order can differ from source order for nested missing closers. Cause is `None`
   unless a causal link has been established; this slice establishes none. Existing
   lexical evidence and a nearby syntax expectation are both retained. Do not silently
   renumber lexical IDs or infer causality from proximity alone.
3. **Boundary ownership — missing closers decided.** In the first type slice, if an
   expected `)` or `>` is absent at EOF or before a closer owned by an enclosing caller,
   record a missing-token expectation at the current UTF-16 offset and return without
   consuming that token. For `(A -> B` at EOF, record the missing `)` at EOF. For
   `List<(A -> B>`, the inner grouped function records a missing `)` immediately before
   `>`; the outer type-argument parser retains and consumes its own authored `>`.
   Ownership comes from parser nesting, not an unconditional skip to a lexer mate.
   Other unexpected-token, missing-type and missing-separator recovery remains undecided.
4. **Retained tokens.** Every authored token must remain represented once, including
   unexpected runs. Agree on error-island boundaries and separator handling. An error
   island denotes actual source damage, never an unimplemented supported production.
5. **Editor identity.** For the first whole-document parser, IDs can be fresh per parse.
   Stable identities across edits require a separate incremental design; do not promise
   stability merely because the AST has `NodeId`/`DelimiterId` fields.

## First vertical slice

`src/parser/type.wm` now exposes type-only prefix (`parse`/`parseAt`) and complete
(`parseComplete`) entry points. It covers names/type arguments,
grouped function/tuple types and right-associated function types, with authored separators
and a few agreed missing-delimiter cases. This exercises the common cursor, spans,
slots and marks without simultaneously designing every expression ambiguity.
`parseAt` accepts a state and a list of caller-owned closer kinds. `parse` starts at
the document's first token with no enclosing boundaries. `parseComplete` additionally
requires EOF. Other source damage returns `Rejected(Failure)` with an explicit expected
category and stopped state; it does not fabricate holes, mark an implementation gap as
source damage, or claim to produce a recovered program. The caller retains the original
source/document. Type-parameter declarations and other phrase families remain future work.

The current grammar (`src/grammar.peggy`, `TypeExpr` through `TypeParams`) requires:

- Uppercase constructor names, optionally qualified by uppercase names, with optional
  nonempty angle-bracketed arguments. Qualification dots and the opening `<` are directly
  attached: `A . B` and `List <A>` are rejected by current WM. Lowercase identifiers denote
  bare type variables. Ignoring trivia while consuming these tokens would broaden the grammar.
- Right-associated `->`. `(A -> B)` is valid grouping, while `(A)` and `()` are rejected.
- Comma tuples, including `(A,)`, with optional trailing commas.
- `(A, B) -> C` is a function whose single argument has tuple type. The current
  wm-mini parser stores the components in `TFn.params`; that representation is not
  a separate SML type category. SubsetML already reads this as
  `TyArrow(TyTuple([A, B]), C)`. The existing surface representation can retain it as
  `TypeFunction` with a `TypeTuple` domain; no special multiple-argument type is needed.
- Nonempty type-argument and type-parameter lists, with optional trailing commas.
  `List<>` is rejected. The schema's `TypeHole` does not establish `?` as accepted syntax.

The keyword audit found a current-grammar bug: its ordered `Keyword` choice tried `rec`
before `record`, accidentally permitting bare `record` as an identifier. The user chose
to keep `record` reserved and correct the grammar order. The new keyword helper and
reference grammar now agree; prefixes and primed spellings remain identifiers.

Do not broaden the accepted grammar as a side effect of implementing recovery. The
examples above concern missing closers around otherwise supported forms.

Then add patterns, expression/application/operator parsing, blocks and declarations,
and reviewed host/template/member forms. Revisit the sequence if full-program parsing
is the immediate priority. Partial entry points must declare their scope; the program
entry must not claim WM completeness before all accepted productions are implemented.

For each slice, translate the actual WM implementation and its exercised AST closure
through the existing native build pipeline. Compare complete WM/native trees and marks,
retain lossless source ownership, and check termination on damaged prefixes. Use focused
checks rather than a full repository suite at every step. Apply the existing conformance
policy to SubsetML defects; pause for new lowering machinery or missing Basis APIs.

`scripts/check_frontend_v3_types.ts` compares complete type-slice WM/native snapshots,
checks accepted/rejected undamaged types against the current grammar, and independently
checks authored token ownership, node/delimiter IDs, lexical mark preservation and missing
slot references. `adapters/portable/type_document.wm` is a tooling codec for this slice:
future hole, marked-phrase and error-island emission requires extending it explicitly.

## References

- [Lowering plan](subsetml-lowering-plan.md)
- [Lexer contract and source conventions](README.md)
- [Lexical decisions](lexical-design.md)
- [Current surface AST](src/surface/ast.wm)
- [Pattern grammar and representation audit](pattern-design.md)
