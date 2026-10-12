# Pattern-parser audit

Reset notice: [worklist.md](worklist.md) requires moving grammar facts and language
decisions to `grammar-audit.md`. The old parser/schema and implementation/recovery
guidance below are not requirements for the reimplementation.

Status: representation preparation, 2026-10-12. The type parser is implemented;
the pattern grammar has been audited but its parser entry is not implemented yet.
Frontend algorithms remain WM-authored in constrained ML style.

## Preserve authored tokens

The user approved extending the AST for literal and record-opening syntax rather than
fabricating tokens or discarding distinctions. `src/surface/ast.wm` now defines:

- `LiteralSyntax`: a simple literal token, an integer token with an optional sign token,
  or a delimited sequence of multiline text-chunk tokens. No values are decoded here.
- `RecordOpening`: a compound `.{` token, separate `.` and `{` tokens, or the plain
  `{` token of a named record. No compound token is split into invented authored tokens.
- `RecordDelimited<T>`: delimiter identity, the actual opening, content and closing slot.
  Its `recordOpening` label distinguishes its complete label set from `Delimited<T>`
  under the temporary SubsetML record-style rule.

`PatternLiteral` and `ExprLiteral` use `LiteralSyntax`. Expression negation remains an
`ExprPrefix`; accepting an optional sign in integer *pattern* syntax does not change
expression precedence. `PatternRecord` and `ExprRecord` use `RecordDelimited` without
an additional redundant dot token. Anonymous records and record patterns use dotted
openings; named record expressions use a plain opening after the retained name.

Multiline literal content can be empty or contain lexer text chunks, with authored
opening/closing backticks retained. Existing string patterns do not accept interpolation.
Expression templates with interpolation need a separately reviewed recursive representation;
a literal token list must not be used to hide an unimplemented expression parser.

Current grammar accepts adjacent negative integers (`-1`, `-0x2a`), not `- 1`, words or
real literals as patterns. Boolean and void patterns retain their identifier tokens.
Character/quoted-string decoding and validation belong to later elaboration; lexer damage
remains attached to authored tokens. Pattern recovery policies beyond the agreed type
closers have not been chosen.

## Grammar contexts are different

The reference is `src/grammar.peggy`: `Pattern`, `LetPattern`, `ParamPattern`,
`CtorPattern`, `ListPatternItem`, their let/parameter variants and record-field rules.
The following results were checked directly with generated PEG start rules:

| Spelling | Match pattern | Let pattern | Parameter pattern |
| --- | --- | --- | --- |
| `x` | reference/pin | binding | binding |
| `(x)` | grouped reference/pin | rejected | rejected |
| `[x]` | list item binding | list item binding | list item binding |
| `[(x)]` | list item reference/pin | rejected | rejected |
| `Ctor(x)` | constructor argument binding | constructor argument binding | rejected |
| `Ctor((x))` | constructor argument reference/pin | rejected | rejected |
| `.{x}` | field-pun binding | field-pun binding | field-pun binding |
| `.{x = x}` | field reference/pin | field binding | field binding |
| `Var(A)` | constructor-shaped fallback | explicit binding of `A` | rejected |

These are concrete WM grammar distinctions, not new SML semantics. The parser must not
resolve a name to a constructor/value symbol or insert type annotations to choose its
meaning. It must also avoid using one unrestricted pattern grammar for all contexts:
that would silently broaden parameter/binding syntax and change pinning behavior.

Decision: record the grammar role (binding, reference/pin, constructor-shaped)
in the surface name node, rather than expecting elaboration to reconstruct every nested
context distinction from its parents. `PatternNameRole` is now an explicit payload of
`PatternName`. Such a role denotes the production recognized,
not a resolved symbol or constructor identity. Explicit `Var(...)` keeps its authored
wrapper. Record punning retains the absence of `=` and a value; elaboration reconstructs
the implied binder without a synthetic authored name token.

## Prefix-guard discrepancy

The previous `CtorPattern` and `LetCtorPattern` used raw `!"Var"` guards. They rejected longer
constructor names such as `Ctor(Variant)` and `Ctor(Variety)`, even though top-level
`Variant` is accepted. This was confirmed directly against the current grammar.

Decision: narrow the guard to the exact word `Var`, preserving the existing
explicit-binder restriction while admitting longer names. The reference grammar now uses
`!("Var" !IdentPart)` in the four affected guards. Regenerate frontend-v2 and retain focused
coverage for both admitted longer names and excluded nested explicit binders.

## Implementation direction

Use a shared immutable parser state and explicit grammar-context variants. Preserve
lists, tuples, record fields, constructor arguments, typed patterns and explicit binders
as authored structure. Keep the lexer document and source authoritative. Qualifying dots
and integer signs must respect the grammar's adjacency rules; ordinary `_` whitespace
productions allow trivia. Constructor/list item rules can select their existing binding
contexts without performing type inference.

The role and prefix-guard questions are now settled. Discuss
missing `]`/`}` recovery before extending the type slice's missing-closer policy to those
forms. Do not introduce missing patterns, error islands or fallback tokens without a
reviewed contract. New lowering machinery or missing Basis APIs require discussion;
supported SubsetML conformance defects follow the SML Definition and reference compilers.

Use focused WM/native checks for actual parser slices, preserving token ownership and
checking semantic structure against the current grammar. Generated SML is disposable;
no additional Basis requirement has been introduced by these schema changes.
