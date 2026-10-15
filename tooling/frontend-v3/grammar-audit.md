# Concrete WM grammar audit

These facts were retained from the removed parser/pattern proposals and type checks.
They describe current concrete grammar and previously recorded language decisions,
not damaged-buffer rejection requirements or an approved surface schema. The new
canonical marked parser follows [structural-editor-plan.md](structural-editor-plan.md).
Its completion policies must preserve meaning and authored text while representing
missing structure/content. The reference grammar is `src/grammar.peggy`.

## Type syntax

- Lowercase identifiers denote bare variables; uppercase names denote constructors.
  Qualification uses uppercase names. Exact reserved words remain unavailable as names;
  prefixes, primed spellings and differently capitalized names are distinct.
- Qualification dots and type argument openings attach directly: `Result.Item` and
  `List<A>` are current spellings; `A . B` and `List <A>` do not match the concrete grammar.
- Arrows associate right: `A -> B -> C` means `A -> (B -> C)`.
- Parentheses group function types, such as `(A -> B)`. Current grammar rejects `(A)`,
  `()`, and extra grouping around tuples/grouped arrows without another arrow/comma.
- Comma tuples admit `(A, B)`, `(A,)` and trailing commas. Type arguments are nonempty
  and admit trailing commas: `Map<A, B,>`; `List<>` has no undamaged production.
- `(A, B) -> C` has a tuple domain. The production parser's `TFn.params` array is a
  representation detail, not a separate multi-argument type category. Its `(A,) -> C`
  semantic representation collapses the single tuple component; review this discrepancy
  during elaboration instead of copying it into canonical surface structure.
- A type `?` is not an existing accepted concrete type production. Expression holes are
  decided by the new plan; do not silently generalize them to type-hole syntax.

Useful accepted inputs: `a`, `_`, `a'`, `A'`, `let'`, `Let`, `One.Two.Three`,
`List<List<a>>`, `Pair<List<A>, B -> C>`, `((A, B) -> C) -> D`, and types with comments
or CRLF at ordinary whitespace sites. Former strict rejection probes include `A.b`,
`a<B>`, `A.`, `A B`, `A ->`, `List<A,,B>`, and `(A;B)`. Damaged examples such as the
last three need marked representation rather than inheriting the removed `Rejected` API.

Former missing-closer probes are useful source fixtures, not an exhaustive recovery
allowlist: `List<A`, `List<A,`, `(A -> B`, `(A,B`, `List<(A -> B>`, `List<List<A`,
`(A, List<B)`, and a complete type followed by an unterminated block comment.

## Pattern contexts

Recorded results from `Pattern`, `LetPattern`, `ParamPattern`, constructor/list item,
and record-field productions:

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

Keep grammar context/role explicit; parsing does not resolve constructor identity from
capitalization, symbol lookup, or types. The recorded decision is to retain the grammar
role in surface name nodes. Explicit `Var(...)` retains its wrapper. Field punning keeps
its absent `=`/value as a language feature, rather than inventing an authored binder.

`Var` guards were narrowed to the exact word, admitting `Variant` and `Variety` without
changing nested explicit-binder restrictions. Reserved `record` was corrected in the
ordered keyword grammar. Those shared grammar fixes are retained by this reset.

## Literal and record spelling

- Preserve exact literal spelling and lexer marks; decode values during elaboration.
- Negative integer patterns require adjacent sign/digits (`-1`, `-0x2a`), not `- 1`,
  words or reals. Expression negation is a prefix operation.
- Boolean/void patterns retain their identifier spelling.
- Multiline literal text is zero or more lexer chunks, with boundary tokens. String
  patterns do not accept interpolation; expression templates need recursive expressions.
- Compound `.{`, separated `. {`, and the plain `{` after a named record are different
  authored openings. Preserve them without manufacturing/splitting authored tokens.

These facts constrain spelling/provenance and semantics. The deleted schema constructor
names and old closer-only recovery guidance are deliberately not carried forward.
