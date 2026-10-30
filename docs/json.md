# Portable JSON

`std/json.wm` provides a source-built JSON tree, encoder and checked traversal API.
It uses the SubsetML Basis for bytes, Unicode, lists and checked integers, with no
JSON-specific host primitive, JS object representation or native JSON parser.
The maintained sources are WM; they are also checked and compiled through
SubsetML to native SML.

```wm
from "std/json.wm" import * as Json;
from "basis/result.wm" import * as R;

let decodeRelease = (found) => {
  R.andThen(Json.get(found, "name") :> Json.text, (name) => {
    Json.get(found, "count") :> Json.integer
      :> R.map((count) => { (name, count) })
  })
};

let releases = Json.read(source)
  :> Json.get("releases")
  :> Json.items(decodeRelease);
```

The result is checked once at the end. Each accessor propagates an earlier error.
A mismatch can report `$["releases"][0]["count"]: expected I32 integer` instead of
losing the field or array position.

## Input, values and output

| Operation | Result |
| --- | --- |
| `decode(source)` | A JSON value, or a syntax/Unicode error. Input is host text. |
| `decodeBytes(bytes)` | The same from strict UTF-8 `List<Char>` input. |
| `decodeWithLimit(source, limit)` | Decode with an explicit maximum number of nested containers. |
| `read(source)` / `readBytes(bytes)` | A checked root node for accessor chains. Syntax errors become `Malformed`. |
| `root(value)` | A checked root node for an already built value. |
| `encode(value)` / `encodeBytes(value)` | Compact JSON as host text or UTF-8 bytes; invalid constructed values return errors. |

`JsonValue.Value`, declared in `std/json_value.wm`, has `Null`, `Boolean`, `Number`,
`Text`, `Array`, and `Object` cases. Strings and object keys hold strict UTF-8 byte
lists, arrays hold value lists, and objects hold ordered key/value pairs. Use the
shared text conversion functions when constructing Unicode payloads manually.
`Json.Value` aliases that type; it is separate from WON's value type.

Numbers retain their exact spelling. For example, `9007199254740993`, `-0`,
`1e400` and `1.2300E+004` can be decoded and encoded without floating-point
conversion, rounding or I32 overflow. Encoding validates number spelling rather
than inserting arbitrary text from a hand-built `Number` case.

## Checked access

| Operation | Behavior |
| --- | --- |
| `get(found, key)` | Find an object field; the key is host text. Last duplicate wins. |
| `at(found, index)` / `index(found, index)` | Select an array element using an I32 index. |
| `text(found)` | Return a native Unicode string. |
| `number(found)` | Return the number's original spelling. |
| `integer(found)` | Decode a literal integer in the signed I32 range; fractions, exponents and overflow are mismatches. |
| `boolean(found)` | Return the boolean. |
| `isNull(found)` | Test null without treating it as missing. |
| `items(found, decodeItem)` | Decode each array element from left to right, preserving its path; stop on the first error. |
| `nodes(found)` | Return array nodes directly. |
| `entries(found)` / `fields(found)` | Return ordered `(native key, node)` pairs, including duplicate fields. |
| `keys(found)` | Return unique keys in first-appearance order. Numeric-looking keys are not reordered. |
| `value(found)` | Extract the underlying JSON value. |
| `optional(found)` | Turn missing access into `Ok(None)`; present null remains `Ok(Some(node))`. Other errors propagate. |
| `problemText(problem)` | Format a syntax, missing-field or mismatch diagnostic. |

Decode/encode errors have `byteOffset: I32` and `message: String`. Access problems
are `Malformed`, `Missing`, or `Mismatch` in `JsonValue`. Paths use quoted bracket
notation so dots, brackets, escaped characters and Unicode names remain clear.

## Grammar and resource policy

The parser follows the [JSON grammar in RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html),
with a strict Unicode interoperability profile: raw input must be valid UTF-8;
`\uXXXX` surrogate pairs are combined, and lone surrogate escapes are rejected.
This intentionally differs from JS `JSON.parse`, which can construct lone UTF-16
surrogates. A leading BOM is rejected. Whitespace is exactly space, tab, LF and
CR. Comments, trailing commas, leading plus signs, leading-zero integers, and
incomplete fractions/exponents are rejected.

Duplicate fields are retained in the value tree and in encoded output. Lookup
selects the last field; enumeration order is the input order. String escape
spelling and whitespace are not preserved; number spelling is preserved.

The default parser and encoder limit is 128 nested containers. Container width
and string length do not consume that nesting budget. Flat-container and string
loops use constant call-stack space. The implementation allocates ordinary
linked-list trees; it is not SIMD or an on-demand parser. Object lookup is linear,
and unique-key enumeration currently uses a linear seen-key list. Allocation
failure remains a runtime resource failure. Syntax offsets count UTF-8 bytes;
an ill-formed host string rejected before encoding uses the existing text
adapter's input offset convention.

## Pakman integration and compatibility

`pakman/finders.wm` supplies `fetchDocument(url)`, returning a Task containing a
portable JSON node. Built-in GitHub release/tag/commit and GitLab tag readers use
that path and explicit source decoders. Their provider-neutral `Release`, `Tag`
and `Candidate` outputs are unchanged.

`fetchJson`, `jsonField`, `jsonKeys` and `jsonTextOr` remain legacy JS-value
adapters because existing recipes use them together with compiler `Json.assert`.
That host assertion remains available alongside the source `Json` API; it is not
part of the portable parser. Migrate those recipes explicitly rather than
passing portable JSON nodes to `Json.assert`.

Store manifests and repository bookkeeping are unchanged by this library patch.
They can separately migrate to WON or to explicit portable JSON decoding.

## Verification

```sh
deno test -A tests/json_test.ts
python3 scripts/check_json_native.py
deno run -A src/main.ts test tooling/pakman/tests
```

The native check requires a built `subm/SubsetML/bin/subsetml` and MLton. It
translates the maintained WM sources, checks the generated JSON modules with
`check-portable` against Basis checker declarations, then builds and executes
the native graph with only the existing text representation adapter.
