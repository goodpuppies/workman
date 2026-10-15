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

## Layout

```text
src/
  source/    source coordinates and shared recovery marks
  lexer/     tokens, character classification, reader, lexeme readers and pairing
  syntax/    neutral authored-token cursor and keyword lookup
  surface/   canonical marked schema for the initial program slice
  parser/    canonical assembly of the first binding/expression/lambda/block slice
  editor/    full projection diff, additive inlays, ordered preview and inline labels
examples/    authored input samples
tools/       debug and native file consumers, outside the frontend dependency graph
adapters/    host-facing entry points; JS string conversion lives here
lib/         generated SubsetML Basis snapshot, with license notices
explorer/    React/Deno inspection client and transport boundary
```

The lexer entry is [`src/lexer/lexer.wm`](src/lexer/lexer.wm). Its source reader
is [`src/lexer/reader.wm`](src/lexer/reader.wm), operating on the SubsetML Basis's lossless
UTF-16 source index. The core entry accepts a `SubsetUtf16Source.Source`; the JS string entry
lives in `adapters/js/lexer.wm`. Trivia spelling is a shared source view; the explorer reconstructs
its displayed strings at the transport boundary. Debug source previews
live in `tools/reader_debug.wm`, so printing is not a lexer dependency.

The [structural editor reimplementation plan](structural-editor-plan.md) establishes
the parser's intended model: canonical marked structure, formatted AST projection,
and a source diff displayed as additive inlays, including missing whitespace. Its first
milestone ports the diff and CLI preview machinery before rebuilding the parser.
Read [worklist.md](worklist.md) for decided delete/refactor/keep actions and progress.
The agent-started type parser, its state/schema, codec, driver and checks were removed.
The neutral token cursor and keyword lookup now live in `src/syntax/`.
The [grammar audit](grammar-audit.md) preserves concrete language facts for the new
canonical marked representation. The first program parser slice is implemented;
complete WM coverage and production frontend replacement remain pending.

The new `src/surface/ast.wm` describes the initial binding/expression/lambda/block slice.
`src/editor/project.wm` formats its tree and records exact authored correspondence plus
virtual mark ranges. `src/editor/view.wm` runs that projection through diff and preview,
attributing structural insertions to syntax marks and delimiter IDs. Direct fixtures and
actual parser-generated trees exercise this path. Richer language forms remain pending.
`adapters/portable/surface_document.wm` encodes the complete currently exercised schema,
including authored/virtual hole origin and damaged-versus-unimplemented fragment status.

WM execution and completion of the frontend are the primary path. SubsetML/MLton
remains a target, checked at useful checkpoints; compatibility blockers are recorded
without stalling independent editor work.

[Native portability](native-portability.md) records the current blockers and the next design
choices. The [lowering plan](subsetml-lowering-plan.md) records the temporary source
constraints, implementation sequence and future compiler-integrated lowering direction.
The separate [SubsetML decision record](../../../SubsetML/docs/frontend-v3-native.md)
contains the existing lowering agreements.

## Basis snapshot

Frontend algorithms remain WM-authored. `lib/subsetml/` is generated from the authoritative
SubsetML `.sml` sources and includes their existing WM text-host adapter. Runtime use needs
only this repository; a sibling checkout is required to refresh the snapshot:

```sh
deno run -A scripts/sync_frontend_v3_basis.ts ../SubsetML
```

The script runs from the repository root, selects the `SubsetUtf16Source`, `SubsetNatural` and `SubsetProcess` dependency closures,
copies their original SML sources for future native builds, and records source/output hashes in `lib/subsetml/manifest.json`. Do not hand-edit those WM
files. Native build integration must select the SubsetML native text adapter; a vendored JS
adapter is not itself translated into a new host primitive.

## Code conventions

- Prefer inference. Omit type annotations unless they are needed for inference,
  disambiguation, or a constraint the implementation would otherwise lose.
- Record updates must name their nominal record type, for example
  `Token.Token { ..token, marks = marks }`. Do not use anonymous `.{ ..token, ... }`
  updates. The SubsetML translator needs the declared record layout to reconstruct the
  record without inferring the spread operand's type. Anonymous literals without spread
  remain allowed.
- Distinct nominal record declarations must have distinct complete field-label sets,
  including records in imported modules. Shared individual labels such as `node` or `span`
  are allowed; identical sets are not. Use meaningful distinguishing labels, for example
  `argumentAngles` versus `parameterAngles` for one-field wrappers. This temporary rule
  accommodates SubsetML R2; future compiler-informed lowering can reconsider it without
  making it a permanent WM restriction.
- Record projections need a complete receiver type established within the helper
  definition for SubsetML translation. Add a receiver parameter or binding type
  constraint when other local constraints do not establish it; later callers cannot
  resolve an already checked helper. This temporary portability rule is explained
  in the [lowering plan](subsetml-lowering-plan.md).
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


## Inlay preview harness

Inspect actual v3 parsing and the full editor path from the repository root:

```sh
deno run -A scripts/frontend_v3_editor.ts --marked tooling/frontend-v3/examples/structural-slice.wm
deno run -A scripts/frontend_v3_editor.ts --projected tooling/frontend-v3/examples/structural-slice.wm
deno run -A scripts/frontend_v3_editor.ts --json tooling/frontend-v3/examples/structural-slice.wm
wm test tooling/frontend-v3/tests
```

The first slice handles plain name/wildcard bindings, simple literals/names/holes,
groups/tuples, calls, simple lambdas and blocks. Other productions have explicit
unimplemented-fragment status; they are preserved, not hidden as malformed source.
No semantic compilation or production parser switch is exposed by this tool yet.

The WM core in `src/editor/preview.wm` overlays ordered additions on unchanged authored
source. It retains whitespace-only hints, preserves shared-anchor input order, rejects
invalid anchors, and reports original UTF-16 positions and rendered spans. The JS adapter
only bootstraps the WM module and transports its values.

Run a supplied-insertion fixture from the repository root:

```sh
deno run -A scripts/frontend_v3_inlay_preview.ts --marked tooling/frontend-v3/examples/inlay-preview.json
deno run -A scripts/frontend_v3_inlay_preview.ts --json tooling/frontend-v3/examples/inlay-preview.json
deno run -A scripts/frontend_v3_inlay_preview.ts --marked tooling/frontend-v3/examples/projection-preview.json
deno test --allow-read --allow-write --allow-env --allow-run tests/frontend_v3_preview_test.ts
```

Fixtures contain `source` and either `projected` text or an array of `{anchor, text, id?}`
insertions. Projected text runs through the WM diff and additive-view pipeline. Anchors
refer to the original buffer; IDs do not determine order. `--marked` surrounds each
inserted label with `*`. Structured output includes exact UTF-16 units, so lone surrogates
and whitespace can be inspected without relying on terminal appearance.

The supplied JSON fixture tool is a renderer/diff harness, not parser output or a
formatter; the editor CLI above is the actual parser pipeline. `src/editor/diff.wm`
produces full Keep/Insert/Delete operations; the additive view omits deletions. Adjacent
insertions are split at projected lexeme/trivia boundaries. It uses a bounded Myers
search rather than Workmangr's full token-LCS matrix. Default edit-distance limit is 256;
fixtures can set `limit` up to 4096. Exceeding it reports an explicit computation error.
The core's `compareAnchored` entry accepts exact source correspondence so repeated tokens
and opaque regions cannot match another authored occurrence; it searches each gap
separately. The canonical View uses this path and attributes inserted syntax to mark/pair
metadata. Supplied projection fixtures remain independent of parser construction.

Raw CLI previews render labels literally, including newlines. Structured `hints` contain
inline-safe labels: CRLF/LF become `[LF]`, lone CR becomes `[CR]`, explicit spaces/tabs
survive, and both padding flags are false. Original line endings are preserved exactly.
The diff/additive/preview closure translates through SubsetML and MLton-typechecks;
native runtime parity remains a later checkpoint.

Core behavior is also tested directly in WM with testman:

```sh
wm test tooling/frontend-v3/tests
# Repository-local equivalent:
deno run -A src/main.ts test tooling/frontend-v3/tests
```

New core parser/projector/diff tests should live in `.test.wm` suites here. TypeScript
checks remain useful for JS transport and native parity. Testman currently runs on the
WM/JS target; its Task/host runner is not part of the portable frontend dependency graph.
Its generic equality limitation on some user-declared types is avoided by asserting
primitive projections (UTF-16 unit lists, positions and IDs).

## Native lexer

Build the WM-authored lexer with a built sibling SubsetML compiler and MLton:

```sh
python3 scripts/build_frontend_v3_native.py
_scratch/frontend-v3-native/native-lex path/to/source.wm
_scratch/frontend-v3-native/native-lex --utf16le path/to/raw-units.bin
```

Run these commands from the wm-mini root. `--subsetml PATH` selects another SubsetML
checkout; `--output PATH` selects the disposable build directory. The build stages the source
Basis checker declarations, discovers the entry's canonical import graph and selects the
existing native adapters through the generated MLB. The lexer build is independent of
editor/parser modules. Its owned staged source directory is rebuilt to remove stale
files from previous graphs. Authored WM remains the source of truth.

Default input is strict UTF-8; malformed byte sequences fail before lexing. `--utf16le` reads
raw little-endian 16-bit units, preserving lone surrogates and NUL; odd byte lengths fail.
BOMs remain ordinary source units. Output is one ASCII JSON document: `[tokens, marks]`.
Tokens contain kind, UTF-16 span/line/column, mate, attached marks and leading trivia;
trivia includes exact UTF-16 units. Marks include identity, problem, recovery, anchor,
affected span and causal identity. The portable encoder lives in
`adapters/portable/document.wm`, separate from the lexer core.

Compare complete WM/native documents, including damaged buffers and encoding failures:

```sh
deno run -A scripts/check_frontend_v3_native.ts
```

This builds once, compares raw-unit and UTF-8 paths, and checks the shared encoder against
an independent JS normalization of the WM lexer result.


The shared marking kernel retains `Slot<T, Expectation>` and `Marked<T>` as neutral
building blocks. The rebuilt canonical schema uses authored/missing structural slots;
no old parser recovery policy is implied by these types. The new projector's WM tests
pass, but its SubsetML generic inference blocker is recorded in native-portability.md.
