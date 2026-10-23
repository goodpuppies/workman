# WON implementation notes

The observable format is specified in [won.md](won.md). These
notes describe implementation choices and planned work, not extra language rules.

## Agreed design

Keep one format with tags, attributes (for markup such as UI trees), blobs,
lists, records, scalar values, `//` comments, and nested `/* ... */` comments.
Keep attachment by adjacency.
The gap information needed for attachment is also needed to check separation
between neighboring entries.

Keep strict spellings: bare identifier keys, quoted non-identifier keys,
lowercase hex, fixed escapes, and the three tag payload shapes. Empty
attributes and explicit null payloads add no information and remain invalid.

Number values preserve their spelling. Number tokens follow JSON's grammar,
including `E` and a signed exponent; every spelling is retained exactly. The
parser uses the same required-digit reader for fractions and exponents.
Commas are ordinary whitespace in the trivia reader, so the parser needs no
separator logic beyond the existing gap check. Nested comments
have a small, isolated reader and remain useful for editing configuration.

## Scanner/parser contract to implement

The current parser still reads byte cursors directly. The proposed scanner
reads one token at a time. Each token carries its kind and contents, starting
byte offset, and whether whitespace or comments preceded it.

Token kinds are name, number, text, blob, punctuation, and end of input. Keep
`null`, `true`, and `false` as name tokens: value parsing interprets them, while
key parsing can accept them without an extra keyword-token exception. Recognize
`x"..."` as a blob token before scanning a bare `x` name.

The scanner owns token spelling, escapes, UTF-8 checks, and trivia. It does not
build records or attach payloads. It preserves number spelling. The parser owns
nesting, fields, delimiters, tag attachment, required separation, and the single
document value. Leading-gap metadata distinguishes `Node[1]` from `Node [1]`.
Separation is required between entries, not every token: `{key=1}` is valid.

Express allowed shapes directly in the parser. In particular, parentheses read
an atomic value rather than reading any value and rejecting runtime variants
afterward. Attributes read a nonempty field list. These structural changes are
planned, not yet implemented.

Duplicate-key validation belongs to building a record or attribute list. It
should not make the generic list reader aware of preceding fields. Preserve key
locations if validation is deferred so errors can identify the second key.

One-token lookahead is sufficient; neither whole-input tokenization nor a
parser framework is required. Other implementations may parse bytes directly.

Judge simplification across the complete implementation, including the scanner
and syntax helpers. Moving code or introducing combinators alone does not make
the language easier to implement.
