# Mapping WON to host languages

How implementations represent WON values in a host language, so independent
implementations agree. The [specification](won.md) defines the format; this
guide defines conventions above it. It draws on the
[Zig experiment](won-zig.md) and the serialization frameworks surveyed in
[accessing WON data](won-access.md).

There are two layers. Every implementation provides the untyped tree. Typed
conversion plugs WON into a language's existing serialization framework
(serde, `Codable`, kotlinx, `@typeInfo`, a WM compiler feature) as a format.
It is not a WON-specific mechanism.

## Untyped values

| WON | Representation | Notes |
|---|---|---|
| `null` | a null or unit case | distinct from an absent field |
| `true`/`false` | host boolean | |
| number | the exact spelling | offer conversions; never convert eagerly |
| text | host string, or UTF-8 bytes | always valid UTF-8 |
| blob | host byte array | never a string |
| list | ordered sequence | |
| record | ordered key/value entries | keep order; look up by key; keys unique |
| tag | name, attribute entries, payload | payload is `null` when absent |

Host-specific choices:

- **JS:** numbers stay strings. Records must not become plain objects, because
  objects reorder integer-like keys. Use entries or a `Map`. Tags are a small
  class or object with `name`, `attributes`, and `payload`.
- **Python:** `int` for integer spellings and `decimal.Decimal` for others are
  lossless, since `Decimal("1.0")` keeps its exponent. Records map to `dict`,
  which keeps insertion order. Tags need a small class. Use `bytes` for blobs.
- **Zig:** a tagged union with `.get(key)` on records, in the style of
  `std.json.Value`.
- **SML/WM:** a datatype with the eight cases, and access by pattern matching
  or [access chains](won-access.md). Text is its UTF-8 bytes, like a blob's bytes but
  validated; `textString` converts it to a host string, as a caller converts a number spelling.

Untyped access reports a missing field separately from a present `null`
(`Missing` against `Some(Null)` in WM; `optional()` returning `undefined` in JS).

## Typed conversion

These rules apply when a framework maps WON to and from host types. A type
with no rule here is unsupported unless an application maps it explicitly.

### Scalars

- **Booleans** map to `true`/`false`.
- **Integers** read integer spellings only: an optional `-` and digits. `1.0`,
  `1e3`, and out-of-range values are errors; integral exponents are not
  evaluated. Writing produces plain decimal digits.
- **Floats** read any number spelling and reject a non-finite result such as
  `1e400`. Writing produces the shortest digits that round-trip: decimal
  notation for magnitudes from 1e-6 up to 1e21, scientific otherwise, and `-0`
  for negative zero. NaN and infinities cannot be written. Rust and Zig produce
  identical spellings under this rule; a writer without a shortest-digit
  formatter would not.
- **Strings** map to text. Writing a string that is not valid UTF-8 is an error.
- **Bytes** map to blobs, and must be opt-in where the host spells bytes and
  strings alike (Zig `[]const u8`, Rust `Vec<u8>`; compare `serde_bytes`).
  Text never decodes into bytes, nor a blob into a string.
- **A single character** is text containing one code point.
- **Unit and void** map to `null`.

### Collections

- **Sequences, fixed-size arrays, and tuples** map to lists. Reading a
  fixed-size array or tuple requires the exact length.
- **Maps with string keys** map to records. Non-string keys are unsupported
  by default; an application may use a list of `[key value]` lists.
- **Sets** map to lists. Order is the host's iteration order; readers do not
  require any order.

### Structs

- **Structs** map to records whose keys are the field names, subject to the
  framework's renaming.
- **A missing field** takes its declared default. Otherwise a missing optional
  is none, and any other missing field is an error.
- **Unknown fields** follow the host framework's default: serde ignores them
  unless a type uses `deny_unknown_fields`, while `std.json`-style readers
  reject them. The format does not decide.
- **Structs read from records.** A type may also declare a WON name. It then
  reads that tag around a record as well, and rejects other tag names:
  `AppConfig{port = 80}` and `{port = 80}` both read as `AppConfig`, and
  `Other{port = 80}` is an error. The name is stated by the type, never
  derived from host naming rules:
  - Rust: the serde type name, changeable with `#[serde(rename)]`.
  - Zig: a declaration, `pub const won_tag = "AppConfig";`. It is a
    compile-time constant, not a field, so it takes no runtime slot.
  - Other languages use their framework's equivalent, such as an annotation
    or an attribute.

  A type without a declared name reads records only. Structs are written
  untagged unless the type declares a name, in which case writing it as
  `Name{…}` is allowed but not required.
- **The tag name is never a field.** A reader must not expose it through a
  magic field such as `__tag`. That would share the record's namespace:
  `AppConfig{tag = X port = 80}` has its own `tag` field, which must stay
  ordinary data. A program that needs the document's tag name, whatever it
  is, uses a wrapper that keeps the name beside the record:

  ```text
  Tagged(T) = { name, value: T }
  AppConfig{tag = X port = 80} → { name = "AppConfig", value = { tag = X, port = 80 } }
  ```

  An enum or union is for a fixed set of names the reader checks; `Tagged(T)`
  is for any name the program inspects itself.

### Options

- **In a struct field,** none is written by omitting the field. Both an absent
  field and `null` read as none.
- **Elsewhere,** such as in a list element or a variant payload, none is
  written as `null`. A variant whose payload is none is written as a bare tag.
- **Nested options** (`Option<Option<T>>`) cannot be represented. Use an
  untyped value where the difference between absent and `null` matters.

### Variants

Enums and sum types map to tags named after the variant:

| Host variant | WON |
|---|---|
| no payload (`Ready`, a plain enum member) | `Ready` |
| one scalar payload | `Count(42)`, `Name("x")`, `Raw(x"00")` |
| one list or tuple payload, or several positional fields | `Point[1 2]` |
| struct payload or named fields | `Pose{hand = left x = 1}` |

Reading matches the tag name against variant names and decodes the payload by
the variant's type. Frameworks that buffer self-describing input in a
JSON-shaped model (serde's `untagged`, `flatten`, and internally tagged enums)
cannot hold tags. Their generic view must present a tag as a one-entry map
`{Name: payload}`. Untyped values buffered that way lose tags and number
spellings ([IPC findings](won-ipc.md)). An unknown name is an error. A tag with attributes is an
error, because typed frameworks have nowhere to put them. Variant names that
are not WON identifiers cannot be represented.

### Attributes

Attributes have no typed counterpart. They exist for markup: UI trees, HTML,
and mixed content are handled as untyped trees or through a markup-specific
mapping in which attributes become properties. A typed reader rejects them
instead of silently dropping them.

## Application conventions

No tag or field name is reserved. Applications that agree on a meaning may
use ordinary tags, for example `BigInt(3)`, `Date("2026-10-23")`,
`Float32LE(x"…")`, or `ActorError{…}`. A generic reader preserves them as tags.

## Conformance

The interop test's documents and rejections, and the corpora in
`tooling/won/examples/`, form the current conformance set. An implementation
should produce the same canonical output for every accepted document and
reject every invalid one. Typed conversion has no shared corpus yet; the
Zig tests in `typed.zig` are the first reference.
