# Rust and Zig over IPC

An experiment looking for places where the design fails. `tooling/won/rust/`
is a WON reader, writer, and serde format. Its `ipc-driver` spawns the Zig
peer (`zig/src/peer.zig`) and exchanges typed envelopes over pipes, one
canonical document per line:

```text
{id = 2 body = Echo(Mixed<id = 1>["text\n\"q\" \x00 😀" x"00ff" 1E+5 -0 1.50 {"odd key" = null …}])}
{id = 4 body = Health{run_frame_count = 18446744073709551615 ipc_sessions = 2 uptime = 0.1}}
{id = 8 body = Rename{from = "a"}}
{id = 10 body = Floats[0.1 -0 1 100000000000000000000 1e21 5e-324 1.7976931348623157e308 1e-7 …]}
{id = 13 body = Error{message = "UnknownTag" event = "decode"}}
```

The interop test runs it and passes every transcript line through the WM
implementation's `normalize`. It also checks that Rust agrees with WM and
Zig on the full conformance corpus. `tests/edges.rs` pins how serde features
meet WON.

## What held

- **Four implementations agree.** WM on MLton, WM on JS, Zig, and Rust produce
  byte-identical canonical output for every accepted document and reject
  every invalid one. All 26 IPC lines were already canonical by WM's standard.
- **Typed variants are native.** serde's externally tagged enums and Zig's
  tagged unions both become tags (`Ping`, `SetPose{…}`, `Echo(…)`), with no
  configuration and no `{"type": …}` convention.
- **Wide integers survive.** `u64::MAX`, `u128::MAX`, and `i64::MIN` come
  through exactly, and an untyped `Value` round-trips through both typed
  layers with its spelling, attributes, and quoted keys intact.
- **Float spellings agree** under the mapping rule (shortest round-trip;
  decimal from 1e-6 up to 1e21, scientific otherwise), because Rust and Zig
  both have shortest-digit formatters. A host without one (C's `%.17g`)
  would print different, still valid, spellings. Shared canonical output
  depends on every writer meeting that rule.
- **Line framing works.** Canonical output never contains a raw newline. A
  256 KiB blob made a 524 KiB line (hex doubles it) and round-tripped in
  about 25 ms. Readers need unbounded line reads: PetPlay's 16 KiB native
  packets could not carry such a frame.
- **Absent and present optionals stay distinct:** `Rename{from = "a"}` against
  `Rename{from = "a" to = ""}`.

## Where it failed

1. **serde's buffered path cannot hold tags.** `#[serde(untagged)]`, internally
   tagged enums, and `#[serde(flatten)]` buffer input in serde's `Content`,
   which rejects enum input. JSON never reaches this, because it has no enums.
   Every WON tag under those attributes failed until `deserialize_any` was
   changed to present a tag as a one-entry map `{Name: payload}`, the shape
   serde_json gives enums. With that change, typed data works through all
   three attributes.
2. **Untyped values degrade when buffered.** Under `flatten` or `untagged`, a
   `won::Value` is rebuilt from serde's JSON-shaped data model. The tag
   `Circle{r = 1}` comes back as the record `{Circle = {r = 1}}`, `1.50` becomes
   `1.5`, and `u128` fails because `Content` has no 128-bit case. The direct
   path keeps everything, but only through a private newtype name carrying
   WON text, the same trick serde_json uses for `RawValue`.
3. **Unknown fields depend on the framework.** serde ignores them unless a type
   says `deny_unknown_fields`; Zig's `std.json` style rejects them. The
   mapping guide's "error by default" cannot be met in serde without
   annotating every type, so the guide now defers to each framework's default.
4. **"May accept" diverges.** The Rust reader accepts `AppConfig{port = 80}` for
   a struct named `AppConfig`; the Zig reader does not, and has no stable
   type name to compare against. A document that works with one
   implementation fails with the other. Resolved below.
5. **Confirmed from the Zig experiment:**
   - `Vec<u8>` is a list of numbers unless the field opts in with `serde_bytes`.
   - `Option<Option<T>>` collapses to `None`.
   - Non-string map keys are rejected. serde_json stringifies integer keys;
     WON does not.

## Decisions

- **Struct in a named tag.** A type may declare a WON name, and then reads
  that tag around a record as well as a plain record. The name is stated by
  the type: the serde type name in Rust, a `pub const won_tag` declaration in
  Zig. It is never compared against a host-derived type name, and never
  exposed as a magic field, which would collide with real fields such as
  `AppConfig{tag = X}`. A `Tagged(T)` wrapper keeps an arbitrary tag name
  beside the record. See the [mapping guide](won-mapping.md#structs).
  The Rust reader already behaves this way; the Zig reader does not yet
  support `won_tag` or `Tagged`.
- **Self-describing presentation.** The one-entry map `{Name: payload}` is the
  documented rule for host frameworks that only have a JSON-shaped generic
  model ([mapping guide](won-mapping.md#variants)).

## Not yet tested

- **Zig as the driver**, with Rust as the peer.
- **Streaming,** and documents larger than memory.
- **Concurrency**: interleaved replies with ids out of order.
- **A peer that writes non-canonical but valid WON**, such as comments,
  layout, or commas, over the same framing. That breaks line framing unless
  the protocol requires canonical output.
- **Throughput and allocation** against JSON for control messages.
