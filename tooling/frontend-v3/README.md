# Frontend v3

A handwritten Workman frontend for a structural editor over ordinary text buffers.
The Revised Definition of Standard ML (`research/The-Definition-of-Standard-ML-Revised`)
guides the language categories and semantics; WM's syntax and documented subset
are the concrete language being recognized. Implementation choices need not copy SML.

[Lexical design](./lexical-design.md) compares SML rules with current WM behavior,
records accepted adaptations, and gives examples for decisions still open. Accepted
syntax may still require implementation; the note distinguishes both statuses.

The [explorer](./explorer/README.md) exposes the current lexer's tokens, trivia,
and marks with source selection, mate navigation, and a field inspector.

## Code conventions

- Prefer inference. Omit type annotations unless they are needed for inference,
  disambiguation, or a constraint the implementation would otherwise lose.
- Record updates must name their nominal record type, for example
  `Token.Token { ..token, marks = marks }`. Do not use anonymous `.{ ..token, ... }`
  updates. The SubsetML translator needs the declared record layout to reconstruct the
  record without inferring the spread operand's type. Anonymous literals without spread
  remain allowed.
- Make a helper local to its sole caller. Nest it within the function that uses it
  so the dependency structure is visible. Keep it top-level when several functions
  use it, or when nesting would make the owning function massive.
- Group many similar functions with `//#region` and `//#endregion`.
- Use `//` for comments.
- Prefer visibly unfinished code over a subpar implementation. Use `?` for an
  unresolved case and `Result.debug` for an unhandled `Result`. Do not disguise
  unfinished work as `None`, an empty list, a default value, or invented recovery.
- Use `Panic("unreachable")` for a case excluded by an established invariant.
  Explain the invariant when it is not obvious. Use `?` when the behavior or
  invariant is still unresolved; an unreachable assertion must not hide missing work.
- A fallback must have a defined meaning. For example, `None` can mean that a
  spelling is absent from a symbol lookup; it must not also mean that recognizing
  that spelling has not been implemented. Explain non-obvious fallback semantics
  at the branch. Enumerate cases of closed types when a wildcard would conceal a
  missing implementation or cause future additions to inherit unrelated behavior.
- Comment catch-all match branches such as `_ =>` or `Some(_) =>`: state which
  remaining cases they match and why those cases share the branch's behavior.
  For example, a symbol lookup's `_ => {None}` matches spellings absent from the
  fixed symbol table. Place the explanation at the branch; do not merely restate
  that it is a fallback. This also applies to unfinished and unreachable branches.

These conventions apply to new work and revisions. Existing recovery choices still
need review; passing tests alone does not settle whether a fallback is appropriate.

## Required fallback audit

Visible incompleteness is an acceptable outcome. Unjustified behavior is a review
failure. Every fallback must express established behavior: if its meaning is
unresolved, use `?`; if handling a `Result` is unresolved, use `Result.debug`.
Implement the correct behavior when it is clear. Never invent successful behavior
to finish a function.

Every change requires a fallback audit:

- Inspect wildcard branches, `None`, empty/default values, ignored errors, and
  recovery paths introduced or affected by the change.
- Establish what each fallback means and what justifies that meaning, such as a
  language rule or an agreed contract. A comment alone is not justification.
- Enumerate closed-type cases when different cases require different behavior.
- Keep supported-but-unimplemented syntax visibly unfinished. A source-error mark
  describes damaged authored input; it must not conceal missing implementation.
- Test established contracts and boundaries. Tests written around an invented
  fallback do not establish its correctness.
- Report unresolved holes, uses of `Result.debug`, and any new recovery policies
  in the change summary. Review may require leaving code unfinished.

For example, `None` from a complete fixed-symbol lookup means the spelling is not
in that table. Treating an unimplemented backtick string as an unknown character
does not satisfy the audit.

Future lint rules can flag closed-type catch-alls, swallowed `Err` branches, and
single-caller top-level helpers for review. Those checks supplement this audit;
they cannot decide whether a recovery policy preserves user intent.

## Lexical contract

- Words remain identifiers. The parser recognizes keywords and enforces reservation.
- Each reader returns one token and its end position. Templates use explicit
  mode-boundary tokens and text chunks rather than a single literal token.
- Tokens address their spelling through source spans. Their leading trivia includes
  exact whitespace and comments; EOF owns any trailing trivia.
- Spans are half-open UTF-16 offsets. Lines and columns are zero-based; LF, CR,
  and CRLF each advance one line.
- Damaged lexemes remain tokens or trivia with localized marks. The document exposes the
  same mark values in encounter order with document-local consecutive IDs.
- Matching delimiter mates are reciprocal token indices. Unmatched delimiters
  remain unpaired with an `UnmatchedDelimiter(group, side)` mark on the authored
  token. Grammatical completion belongs to the structural parser.
- The forward pairing stack and backward stamping stack take linear time.

Ordinary punctuation pairs only the matching stack top. A mismatched closer remains unpaired
without popping an opener. For example, `([)]` pairs `[` with `]` and marks `(`
and `)` as unmatched. A lone `{` is retained with `NoMate` and a brace-opening
mark; its affected span is the authored `{`, not an invented closing position.
Recovery is `RetainedUnpairedDelimiter`; no delimiter is inserted by the lexer.

Template and interpolation markers have distinct pair groups. A lexical mode closer
pairs with its own opener, releasing any unmatched ordinary brackets within that
scope; those brackets retain their marks and cannot pair with subsequent outside
code. Brace depth determines which `}` closes an interpolation. Quotes, comments,
and nested templates inside interpolation do not contribute to that depth.
At EOF, unclosed template/interpolation openers carry their specific unterminated
marks, anchored at the opener and covering it through EOF.

After pairing, finalization attaches unmatched-delimiter marks and assigns IDs
to all marks in trivia/token encounter order. Reader-local IDs are provisional;
only the finalized document is exposed. Token/trivia attachments and the document
list share the finalized mark values. Lexer marks currently have no causal links;
introducing those requires remapping IDs during finalization.

Numbers support decimal and hexadecimal integers (`42`, `0x2a`), decimal and
hexadecimal words (`0w42`, `0wx2a`), and reals (`3.14`, `3e-7`, `3.32E+5`).
Prefixes use lowercase `x`/`w`; hexadecimal digits accept either case. Exponents
use `e` or `E` and an optional `+` or `-` followed by decimal digits. Leading signs
remain operators. A decimal point starts a fraction only when followed by a digit.
Missing prefix/exponent digits and identifier suffixes retain one malformed number
with a mark anchored at the missing digits or suffix. Punctuation remains available
to the parser (`1..tail`, `1.field`); only exponent signs belong to the number.
The lexer preserves spelling without evaluating values or checking numeric ranges.
Quoted strings and character literals share SML escapes: `\n`, `\t`, `\"`, `\\`,
`\a`, `\b`, `\v`, `\f`, `\r`, control escapes (`\^A`), exactly three decimal digits
(`\065`), and exactly four hexadecimal digits (`\u0041`). Both quote characters
can be escaped. The modern addition `\u{1F600}` accepts one to six hex digits.
Raw literal text and numeric escapes must denote Unicode scalars; lone surrogates
and surrogate-valued escapes are marked invalid. Character literals must contain
exactly one decoded scalar; gaps contribute none. Existing escape damage suppresses
a secondary character-length mark. No numeric or string value is emitted here.

String gaps are a backslash, one or more formatting characters, then a backslash.
They can span lines and contribute no characters. Missing gap closers leave the
first non-formatting character available to the literal body. Partial numeric/control
escapes stop before the first invalid character, preserving a closing quote or
mode boundary. Malformed braced escapes retain excess hex digits without evaluating
an unbounded number. Missing quotes recover at an unescaped line boundary or EOF.

Both `//` and `--` introduce line comments. `/* … */` block comments nest and
remain one trivia item. An unclosed block comment consumes through EOF, preserving
its text as comment trivia. Each unmatched opener has a mark anchored at its `/*`,
with an affected span from that opener through EOF. Marks attach to the trivia;
the document includes them before any following token marks, using the same IDs
and mark values. Closing a comment introduces no synthetic source text.

Backticks preserve raw line breaks, recognize the shared escapes and gaps, and
add escapes for backtick and dollar. `${…}` switches to code lexing until its
brace closes; interpolations may contain nested templates. Literal text, including
comment-looking text and brackets, stays text. No empty text-chunk tokens or
synthetic mode closers are emitted. These accepted literal forms no longer reach
implementation holes. Numeric identifier suffixes remain malformed by the current
language decision in the design note. Literal elaboration and structural parsing
are still pending.

Whitespace reaching lexeme dispatch, unexpected character classes, inconsistent
quote classification, and inconsistent mate bookkeeping violate established lexer
invariants and use `Panic("unreachable")`. Ordinary unpaired delimiters stay authored.

Run the lexer regression tests with:

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/frontend_v3_lexer_test.ts
```
