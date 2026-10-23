# WON format

WON represents null, booleans, exact number spellings, UTF-8 text, byte blobs,
lists, records, and tags. A tag contains a name, attribute fields, and a payload.
This specifies the experimental textual format; it does not prescribe a parser
architecture or IPC framing.

WON is deliberately JSON-like: a simple data format addressing concrete
representation limitations. Codecs and validation live outside the format.
See [why WON exists](won-design.md) for the design principles. JSON
compatibility is not a goal, but every JSON number token is a valid WON number
with the same spelling.

## Grammar

EBNF: `[...]` is optional and `{...}` repeats. Quoted punctuation is literal.
`gap` may be empty; `separator` contains at least one whitespace character,
comma, or comment.

```text
document   = gap value gap EOF
value      = "null" | atomic | list | record
atomic     = "true" | "false" | number | text | blob | tag
list       = "[" gap [values gap] "]"
record     = "{" gap [fields gap] "}"
values     = value {separator value}
fields     = field {separator field}
field      = key gap "=" gap value
key        = name | quoted-key
tag        = tag-name [attributes] [payload]
attributes = "<" gap fields gap ">"
payload    = "(" gap atomic gap ")" | list | record

name       = [A-Za-z_][A-Za-z0-9_]*
number     = -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
blob       = 'x"' {hex-pair} '"'
hex-pair   = [0-9a-f][0-9a-f]
```

Names and numbers consume their complete token, not a shorter matching prefix.
`x"` always begins a blob, so a tag named `x` cannot be followed directly by
text. A tag name is a name other than `null`, `true`, or `false`. These reserved
values remain valid bare field keys. A quoted key is text whose decoded
contents do not match `name`: identifier keys must be bare. Record keys and
attribute keys must be unique after decoding; field order is retained.

Absent payloads mean null; absent attributes mean no fields. Parentheses
contain exactly one atomic value. Lists and records supply their own
delimiters. `Tag()`, `Tag(null)`, `Tag([1])`, `Tag({})`, and `Tag<>` are
errors. Mixed content is an ordinary list of text and tagged values.

## Tag attachment is whitespace-sensitive

Attribute and payload opening delimiters must touch the preceding tag name
or `>`. This is the only place where the presence of whitespace changes the
meaning of a document:

```text
[Ready [1 2]]   // two values: a bare tag, then a list
[Ready[1 2]]    // one value: a tag whose payload is a list
[Ready,[1 2]]   // two values: a comma is whitespace
```

Comments and commas are separation too, so they also detach a payload.

## Text, numbers, and comments

Text uses double quotes and strict UTF-8. Quote, backslash, LF, CR, and TAB
must use `\"`, `\\`, `\n`, `\r`, and `\t`, respectively. Other ASCII control
bytes (0–31 and 127) must use `\xhh` with two lowercase hex digits. All other
characters appear literally. Literal controls, alternative escapes, and invalid
UTF-8 are errors. There are no Unicode escapes or raw/multiline strings. Blobs
contain only pairs of lowercase hex digits, with no spaces or escapes.

Numbers use JSON's number grammar and retain their exact token spelling,
without host numeric conversion or mathematical normalization. `1`, `1.0`,
`1e0`, `1E+0`, and `1e00` are distinct number values, not alternative encodings
of one WON value. Leading zeros in the integer part, a leading `+` or `.`, and
missing fraction or exponent digits are errors.

Whitespace is ASCII space, TAB, CR, LF, or comma. Commas carry no meaning:
they are optional, may repeat, and may trail, so `[1, 2,]`, `[1 2]`, and
`[1,,2]` are the same list. `//` comments run to CR, LF, or end of input.
`/* ... */` comments may nest. Comments count as separation; they cannot split
a token or attach a tag suffix across a gap. Newlines otherwise behave like
spaces. A document contains exactly one value.

Only whitespace, commas, and comments vary freely. There are no alternate key,
hex, escape, or tag-payload spellings. Number spelling and field order are
preserved, so this is not a mathematical canonicalization or a canonical
encoding for signing.
