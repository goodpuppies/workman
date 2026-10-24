# Accessing WON data

How programs read decoded WON, based on a survey of JSON access in other
languages (October 2026). There are two layers: untyped access to the value
tree, implemented now, and typed conversion into WM values, a design direction
that needs compiler support.

## What other ecosystems do

Typed languages mostly decode straight into their own types: Zig
`std.json.parseFromSlice(T, …)` by comptime reflection, Rust serde derive,
Go struct tags, Swift `Codable`, Kotlin `@Serializable`, .NET `JsonSerializer`,
Nim `to`. The type is the schema; nobody writes a second description. Elm and
Gleam, lacking reflection, use handwritten decoders (`decode.field`,
`optional_field`, `at`), the shape WON's removed codec layer had.

Untyped trees differ mainly in what a missing key returns:

| Missing key gives | Examples | Missing ≠ null |
|---|---|---|
| a null that keeps chaining | serde `v["a"]["b"]`, Yojson `member`, Nim `{}` | no |
| a missing marker that keeps chaining | Jackson `path()` / `MissingNode` | yes |
| an option | Zig `ObjectMap.get`, serde `get`, Kotlin `obj["a"]?` | yes |
| an exception | nlohmann `at`, .NET `GetProperty`, Gleam `field` | yes |
| an error carried along the chain | simdjson `doc["a"]["b"].get(x)`, gjson `Exists()` | yes |

Zig's standard library offers no lookup helpers at all: callers `switch` on
the `Value` union, and projects write small `field`/`optionalField`/`text`
helpers (as the PetPlay driver does). Its `number_string` case keeps the digits
of numbers that overflow, the same escape hatch WON makes the default.

The best-liked untyped APIs let a whole lookup chain run and report failure
once (serde indexing, Jackson `path`, simdjson, gjson). Checking every step is
the common complaint. Conflating missing with null is the most common
shortcut; libraries that care had to add the distinction later.

## Untyped access: chains checked once

WON follows the simdjson shape. Each WM step takes and returns
`Result<Node, Problem>`; a `Node` carries its path. `:>` passes the result as
the first argument, so a chain reads left to right and the error appears at
the end:

```wm
let port = Won.read(source) :> Won.get("server") :> Won.get("port") :> Won.number;
// Ok("8080"), or Err(Missing("server.port")), Err(Mismatch("server", "record")),
// or Err(Malformed(error)) for a syntax error. Won.problemText formats any of them.
```

- Steps: `read`, `root`, `get`, `index`, `attribute`, `payload`.
- Reads: `text` (UTF-8 bytes), `textString` (host text), `number`, `boolean`, `blob`, `tagName`, `value`, `items`, `entries`.
- `optional` ends a chain and turns `Missing` anywhere along it into `None`.
  A present `null` stays `Some(Null)`; a mismatch stays an error.
- Paths use WON spelling: `server.port`, `items[1]`, `view<id>`, `"odd key"`;
  a payload keeps its tag's path.

`Problem` contains an `Error` with a real offset, so SML does not allow `==` on
problems; compare `problemText` strings instead.

Pattern matching on `Value` remains equally valid. The accessors are
conveniences, not the only way in.

The JS helpers mirror this: `bind(won)` returns `parse` and `stringify`.
Steps never throw; the final read throws `WonAccessError` with the same path,
and `parse` throws `WonSyntaxError` with a byte offset. There is deliberately
no `toJS()` into plain objects: tags would need a magic key, integer-like keys
reorder, and numbers would lose either precision or their kind.

## Typed conversion: trusted, not checked

Typed reading should come from a shared type, not from validation code.
Stageforgeman shows the model. `Actor.define(mode, name, implementation)`
uses one inferred function for both the local handler and the forwarded call,
so ordinary inference makes caller and handler types agree. Its transport
`encode`/`decode` are unchecked polymorphic casts (`value -> Js.Value` and
back via `structuredClone`). WM's `Json.assert` is similarly a trusted
`'a`: today it only rejects null/undefined. Protobuf reaches the same trust
through a shared generated schema; Stageforgeman needs nothing beyond the
shared inferred type.

A WON equivalent would be unchecked `'a -> Won.Value` and `Won.Value -> 'a`,
with trust supplied by the layer that relates both ends. That cannot be an
ordinary portable library function:

- **Variants.** The JS backend matches constructors by bundle-local `ctor` id,
  and nullary constructors by object identity (`=== Dot_ctor_0`). A WON tag
  name cannot be turned back into a WM constructor without knowing the type.
- **Tuples and lists.** Tuples are JS arrays and lists are `Cons` chains. Both
  naturally become a WON list, and decoding cannot tell which was meant.
- **SML.** MLton has no runtime reflection, so even encoding needs per-type code.

The conversion therefore has to be type-directed: the compiler sees the
inferred type at the call site, the way `Json.assert` receives its `'a`, and
emits conversion code for it. Generating ordinary WM keeps both backends
working. Trusting the type means no shape checks: a peer that breaks the
shared contract produces wrong values or failures later, as with
`structuredClone` today.

The [language mapping guide](won-mapping.md) fixes the general rules any
typed framework follows. Open questions specific to WM:

- Exact numbers: a `Won.Number` type in a WM record could keep the spelling
  where precision matters.
- Whether WON's typed path and `Json.assert` should share one compiler mechanism.
