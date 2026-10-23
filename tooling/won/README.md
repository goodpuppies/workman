# WON — Workman Object Notation

A small, experimental data notation for human-edited files and IPC. The library
is the SubsetML Basis module `SubsetWon`: it compiles natively with MLton, and its
generated WM is compiled by the WM JS backend. This is a prototype, not a frozen format.

WON is deliberately a "dumb", JSON-like data format. It addresses concrete
obstacles (comments, bytes, exact numbers, named variants, and markup) without
requiring schemas or a particular runtime model. Validation and typed
conversion belong to applications. See [why WON exists](markdown/won-design.md),
[host language mapping](markdown/won-mapping.md),
[the specification](markdown/won.md), and
[concrete JSON workarounds](markdown/won-use-cases.md).

```text
Request<id = 42>{
    method = "save"
    data = x"00ff1020"
    view = Paragraph[
        "Click " Strong("Save") " to continue."
    ]
}
```

The goal is a value model that is easy to implement in SML, Zig, JS, WM, or a
small language runtime. [Nota](https://www.crockford.com/nota.html) is a design
reference for a small language-independent model and first-class blobs. WON's
initial implementation is textual UTF-8 with byte blobs; it does not implement
Nota's wire encoding.

## Value model and API

WON is part of the SubsetML Basis, written in SubsetML (`../SubsetML/src/subset_won*.sml`).
WM programs import it as `"basis/won_value.wm"` for values and constructors and
`"basis/won.wm"` for encoding, decoding, and access (generated into `subml-basis/`).
Values are ordinary datatypes:

```text
Null
Boolean(bool)
Number(spelling)
Text(utf8Bytes)
Blob(bytes)
List(values)
Record([(key, value), ...])
Tag(name, attributes, payload)
```

Decoded data can be matched directly, or read through access chains that
report a problem once, at the end. See [accessing WON data](markdown/won-access.md):

```wm
let port = Won.read(source) :> Won.get("server") :> Won.get("port") :> Won.number;
// Ok("8080") | Err(Missing("server.port")) | Err(Mismatch(path, kind)) | Err(Malformed(error))
```

`decode(source)` returns `Ok(value)` or `Err(Error(byteOffset, message))`. Offsets are
zero-based bytes, typed `I32` (SML `int`). The Basis's Result is WM's built-in `Result`, so
`Result.map`, `via` and pipes work on it directly.

`encode(value)` returns `Ok(source)` or `Err(message)`.
It checks that the supplied value is representable, including duplicate keys,
names, number spelling, and UTF-8. Output uses bare identifier keys, quoted
non-identifier keys, single spaces, escaped text, and lowercase hex blobs.
Comments, commas, and original layout are lost; field order and number
spelling are retained. This does not normalize mathematical equality between
number spellings or reorder record fields, and is not a canonical encoding for
signing.

```wm
from "basis/won_value.wm" import * as W;
from "basis/won.wm" import * as Won;

let message = W.Tag("Reply", [("id", W.Number("42"))],
  W.Record([("ok", W.Boolean(true)), ("data", W.Blob(['\u0000', 'ÿ']))]));
let encoded = Won.encode(message);
```

Number tokens follow JSON's grammar and are retained exactly, without
rounding, host numeric conversion, or a bignum library: `1`, `1.0`, and `1E+0`
are distinct values. Application code performs checked conversion to its
chosen numeric type. Numeric arithmetic, normalization, IEEE special values,
and typed conversion helpers are not implemented.

Text and keys contain valid UTF-8. Blobs are arbitrary byte-character lists;
NUL and non-UTF-8 bytes are supported. **WM/JS strings at this API boundary are
Latin-1 carriers for bytes**, matching native SML byte strings. Convert ordinary
JS Unicode strings through `TextEncoder` / `TextDecoder`; do not pass a JS
Unicode string directly as a wire buffer. The JS probe runner demonstrates
byte-preserving I/O with `Buffer`. This follows the existing portable SubsetML
Basis boundary rather than introducing another host-string convention.

## Source layout

- SubsetML `SubsetWonValue`: value datatype, error record, and access `Node`/`Problem`.
- SubsetML `SubsetWon`: `encode`, `decode`, and access-chain operations.
- SubsetML `SubsetWonParser` and `SubsetWonSyntax`: the parser and shared byte helpers.
- SubsetML `tests/basis/won_probe.sml`: the conformance probe, built natively and as JS.
- `interop.ts`: JS `parse`/`stringify`, access chains, and list/result/byte translations.
- `zig/`: a Zig 0.16 reader, writer, typed conversion, and IPC peer.
- `rust/`: a Rust reader, writer, serde format, and IPC driver ([findings](markdown/won-ipc.md)).
- `examples/`: an HTML-style app configuration and a Stageforge envelope corpus.
- `markdown/`: specification, design, use cases, and implementation notes.

Construct and match values through `subset_won_value.wm`; WM imports do not re-export
constructors. Callers do not need the parser and syntax modules. Edit the SubsetML source
and resync the snapshot; the generated `.wm` files are overwritten.

## Format summary

See [the WON specification](markdown/won.md) for the complete grammar,
strict token spellings, tag attachment, and comment rules.

Each shape has one spelling: `Ready`, `Items[]`, and `Person{}`; alternatives
such as `Ready(null)`, `Items([])`, `Person({})`, and `Ready<>` are errors.
Identifier keys are bare, other keys are quoted, and hex is lowercase. Commas
are whitespace. Tag attachment is the one whitespace-sensitive rule:

```text
[Ready [1 2]]       // two values: a bare tag followed by a list
[Ready[1 2]]        // one tagged list
Button<id = 1>("Save")
```

Parser architecture and development decisions live in
[the implementation notes](markdown/won-grammar.md).

## Build and evaluate

Requires the sibling `../SubsetML/bin/subsetml`, MLton, Python 3, Deno, Zig 0.16, and Cargo
(offline, with serde and serde_bytes in the local crate cache).
The WM sources follow the procedure/transform pattern with `SubsetResult.via`
and syntax-based function pipes. If its binary predates function-pipe support,
rebuild it with `make -C ../SubsetML`. Receiver pipes and JS reflection are not
used by the portable library. The exchange runs entirely locally.
Run from the repository root:

```sh
python3 tooling/won/tests/test_interop.py
```

The test compiles the same WM sources to native SML/MLton and JS, constructs
semantic fixtures independently on both backends, and sends requests/replies
in both directions. The recipient checks the decoded tree against its own
fixture. Coverage includes all 256 byte values, non-ASCII UTF-8, precise large
numbers, JSON exponent spellings, commas, tags/attributes, mixed content,
quoted keys, nested comments, malformed input, duplicate keys, and bounded
nesting. Generated tree cases also check repeated formatting across both
backends. The [Zig](markdown/won-zig.md) and Rust implementations must produce the
same canonical output for every accepted document and reject every invalid one,
and a Rust/Zig [IPC exchange](markdown/won-ipc.md) must write only canonical lines.

For inspectable build artifacts:

```sh
python3 tooling/won/scripts/build.py tooling/won/.build

tooling/won/.build/won-native emit |
  deno run --allow-read tooling/won/scripts/run-js.mjs \
    tooling/won/.build/probe.mjs reply |
  tooling/won/.build/won-native check

# Format a human-edited document with either backend:
tooling/won/.build/won-native normalize < tooling/won/examples/app-config.won
deno run --allow-read tooling/won/scripts/run-js.mjs \
  tooling/won/.build/probe.mjs normalize < tooling/won/examples/app-config.won
```

`won.mjs` is the core library and `probe.mjs` adds the test request/reply and
formatting functions. `native/` contains generated SML and its MLB project.
The build stages a private source graph to substitute the existing native
text adapter for the JS primitive; it does not edit the shared Basis snapshot.
`examples/app-config.won` is copied from the root `won.wm` design sample.

## JS / TypeScript access

[interop.ts](interop.ts) wraps the compiled WM library with JSON-like entry
points. There is no separate TypeScript parser.

```ts
import * as Won from "./interop.ts";
const WON = Won.bind(await import("./.build/won.mjs"));

const doc = WON.parse(source);                 // string or Uint8Array; throws WonSyntaxError
doc.get("server").get("port").number();        // "8080"; throws WonAccessError "server.port: missing"
doc.get("debug").optional()?.boolean();        // undefined when absent
WON.stringify(doc);
```

Steps never throw; the final read does, with the same paths as the WM
accessors. Records are not converted to JS objects, numbers stay exact strings,
and blobs become `Uint8Array`. `listToArray`, `resultToJS`, `bytesToString`,
`stringToBytes`, and `decodeText` remain available for the raw WM values. The
adapter relies on constructor names and payloads, not bundle-local constructor
IDs, and its tests use a freshly compiled WM library.

## Limits

Container procedures compose through Result. The JS backend specializes known
procedure adapters to expose self tail calls, so the recursive `via` pipeline
can process long containers without growing the JS stack.

The parser permits at most 128 nested levels, uses whole-input byte lists,
and has no configurable message-size limit or incremental streaming API.
Duplicate-key checks scan preceding fields. Encoding renders and reparses the
value for validation, adding allocations; it is intended for prototyping, not
measured high-throughput IPC. Programmatically constructed values should also
respect the nesting limit; the renderer itself is recursive.

IPC framing, binary encoding, typed host-value adapters, numeric conversions,
pretty printing, performance and allocation measurements, and independent
implementations are not included. See the
[roadmap](markdown/won-design.md#roadmap).
