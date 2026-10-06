# Lexical design

The baseline is the Revised Definition's [special constants, comments, and
identifiers](../../research/The-Definition-of-Standard-ML-Revised/syncor.tex).
Current WM syntax is described by [the existing grammar](../../src/grammar.peggy);
v3's current implementation is described in [the README](./README.md#lexical-contract).

WM remains an SML subset implementation. Follow the Definition within the shared
fragment; record deliberate restrictions and spelling changes explicitly.

**Decided** describes the intended language, not necessarily implemented behavior.
**Current** describes the implementation. **Open** requires a further decision.
An accepted rule that is missing from the lexer remains unfinished implementation,
not invalid authored syntax.

## Comments

**Decided:** adapt SML's `(* … *)` to `/* … */`, retaining nesting.
**Current:** implemented in v3; the existing compiler grammar still lacks block
comments. `(**)` is simply an empty SML comment; its counterpart is `/**/`.

```sml
val x = (* explanation *) 1
(* outer (* inner *) still outer *)
```

WM spelling:

```wm
let x = /* explanation */ 1;
/* outer /* inner */ still outer */
```

The entire second line is a comment; the inner `*/` closes only the inner comment.
Nesting lets an author comment out code that already contains block comments.
An unclosed comment remains trivia through EOF, with a localized mark for each
unmatched `/*`. This recovery preserves comment contents rather than exposing
them as code after a newline. Each mark covers its opener through EOF.

**Current:** both `// explanation` and `-- explanation` are line comments.
**Decided:** keep both for now; our code convention prefers `//`.
`x--y` currently means `x` followed by a comment, not two minus operators.

## Character literals

**Decided:** adapt SML's `#"c"` to `'c'`, preserving a character constant distinct
from the string `"c"`. Implemented lexically in v3; frontend-v2 also parses and
elaborates these as the distinct equality type `Char`.
The host runtime represents a character as a string containing one Unicode scalar.

| SML | WM spelling | Meaning |
| --- | --- | --- |
| `#"c"` | `'c'` | One character: c |
| `#"\n"` | `'\n'` | One newline character |
| `#"\\"` | `'\\'` | One backslash character |
| `#"'"` | `'\''` | One apostrophe; the new delimiter needs an escape |
| `#""` | `''` | Invalid: no character |
| `#"ab"` | `'ab'` | Invalid: more than one character |

Follow SML's single-character rule over a modern Unicode scalar alphabet. V3 counts
decoded scalars: `'😀'` is valid despite occupying two UTF-16 source units. `'é'`
contains two scalars and is invalid even though it can look like one displayed
character. Lone surrogates are invalid, as are surrogate-valued numeric escapes.
No normalization or grapheme segmentation is performed. Source offsets remain UTF-16.
Escapes follow the policy below; character representation during elaboration remains
separate from lexical validation.

## Strings and escapes

**Current:** the existing compiler supports `\n`, `\t`, `\"`, and `\\`; v3 additionally
recognizes `\a`, `\b`, `\v`, `\f`, and `\r`. V3 accepts raw
Unicode inside them. SML's raw string spelling permits printable ASCII and spaces;
other characters use escapes from its underlying alphabet.

**Decided:** follow SML escapes by default; adapt a rule when a modern interpretation
makes more sense. The escapes below and string gaps are now recognized in v3.

| SML spelling | Meaning | WM direction |
| --- | --- | --- |
| `"\r"` | Carriage return | Keep the escape |
| `"\a"`, `"\b"`, `"\v"`, `"\f"` | Alert, backspace, vertical tab, form feed | Keep |
| `"\^A"` | Control-A, character code 1 | Keep |
| `"\065"` | Character code 65: A; exactly three decimal digits | Keep |
| `"\u0041"` | Character code hexadecimal 0041: A | Keep over the scalar alphabet |

V3 additionally supports braced scalar escapes such as `"\u{1F600}"`: one to six
hex digits, value at most 10FFFF, excluding D800–DFFF. Both quote delimiters can
be escaped. Unlike JavaScript's UTF-16 escape semantics, `\uD83D\uDE00` is two
invalid scalar escapes; use a raw scalar or `\u{1F600}`. These rules explicitly
adapt the Definition's underlying alphabet rather than relying on JS string length.

SML also has **string gaps**: a backslash, one or more formatting characters,
then another backslash contribute no characters to the value.

```sml
"hello\
      \world"
```

This produces `"helloworld"`, without a newline or indentation. Implemented in v3.
It differs from a multiline string that preserves its line breaks.

**Current WM:** backtick strings preserve raw line breaks and support `${…}`
interpolation. **V3:** code, template-text, and interpolation modes are implemented,
including nested templates and exact trivia within interpolation code.
**Decided:** support SML string gaps as well as backtick strings. Gaps omit their
formatting characters; backtick strings preserve authored line breaks.

## Numbers

**Current v3:** decimal and hexadecimal integers, decimal and hexadecimal words,
and decimal reals with a fraction and/or exponent. A leading sign is a separate operator;
the parser must establish negation. SML includes `~` in a negative numeric token.

**Decided:** support hexadecimal integers, words, and exponent notation, with
modernized signs and exponent spelling as illustrated below. Implemented in v3.
Word support belongs to the SML subset; corresponding
basis support is already being developed.

| SML | Meaning | WM spelling |
| --- | --- | --- |
| `~42` | Negative forty-two | Current WM spelling: `-42` |
| `0x2a` | Hexadecimal integer forty-two | `0x2a` |
| `0w42`, `0wx2a` | Word constants, distinct from integer constants | `0w42`, `0wx2a`; no alternative prefix chosen |
| `3.32E5` | Real value 332000 | `3.32e5` |
| `3E~7` | Real value 0.0000003 | `3e-7` |
| `.3`, `4.E5` | Neither is an SML real constant | Current v3 also requires digits before and after a fractional dot |

Literal spelling does not settle numeric types: WM's current default numeric type
is `Number`, rather than SML's overloaded numeric types. Word literals need to be
connected to the corresponding basis types during elaboration. V3 accepts both
`e` and `E`, and optional `+`/`-` exponent signs. Prefixes remain lowercase;
hexadecimal digits accept either case. Word representation is not a lexer decision.

**Decided for now: numeric boundaries.** Under SML's longest-next-item rule, `42foo` is the
integer `42` followed by identifier `foo`. V3 consumes it as one malformed number.
This is a deliberate difference from SML lexical analysis. The same policy applies
to suffixes on hexadecimal integers, words, and reals, such as `0x2ag`, `0w42foo`,
and `12e3foo`. `12e3` itself is valid.
For punctuation, v3 leaves `1..tail` and `1.field` available to the parser rather
than swallowing the dots into a malformed number. A prefix or exponent without
digits (`0x`, `0wx`, `1e-`) is retained with one malformed-number mark. The anchor
identifies where digits were expected; the affected span covers the whole token.

## Identifiers and operators

**Current:** WM permits `_cache` and `value'`; SML permits `value'` but not
`_cache` as an identifier. A lone `_` is a wildcard in both languages' patterns.
SML's `'a` denotes a type variable; WM instead uses names in type parameter lists,
such as `Option<T>`.

**Decided:** apostrophes may continue an identifier (`value'`, `value'next`, `Ctor'`),
but cannot start one. At a word boundary, an apostrophe opens a character literal.
There is no SML `'a` type-variable syntax; keep WM's type parameter spelling.
Implemented in v2 and v3.

**Current:** v3 distinguishes `Some` and `some` lexically. SML determines constructor
status from declarations and scope, not capitalization. **Decided:** WM's case
distinction is a deliberate language difference, not merely token metadata.

SML permits user-defined symbolic identifiers and scoped fixity declarations:

```sml
infix 6 +++
fun x +++ y = x + y
val result = 1 +++ 2
```

Here `+++` is one identifier. **Current WM:** fixed operators; v3 splits `+++`
into `++` and `+`. **Decided:** keep fixed operators; WM does not support custom
symbolic identifiers or fixity declarations. Spellings such as `==`, `!=`, `&&`,
`||`, `:>`, and the hole `?` retain their defined WM roles.

## Keywords and tooling information

**Chosen implementation:** words remain identifier tokens; the parser recognizes
and reserves WM keywords. This changes the phase of recognition, not the meaning
of reserved words. For example, tokenizing `let` as an identifier does not authorize
binding a variable named `let`.

V3 preserves exact trivia, localized source-error marks, and delimiter mates for
the structural editor. The Definition ignores comments and formatting between
items; retaining them adds tooling information without changing their grammatical
role. Error recovery rules still require their own review: the Definition's rules
for valid lexical items do not prescribe our treatment of damaged buffers.
