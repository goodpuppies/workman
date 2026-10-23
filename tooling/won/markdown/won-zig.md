# Zig experiment

`tooling/won/zig/` is a WON implementation for Zig 0.16, written from
[the specification](won.md) to find edges in the design. It has a reader,
canonical writer, value validation, and typed conversion in the style of
`std.json`. The interop test builds it, runs its unit tests, and requires
it to agree with the WM implementation on every round trip and rejection.

Caveat on independence: the author had read the WM parser earlier, so
the error messages follow WM's. The agreement shows that the specification
and implementations are consistent, not that a blind reimplementation would
match on the first try.

## Size

About 400 lines for the reader, writer, and validator (`won.zig` without
tests) and about 200 for typed conversion (`typed.zig` without tests).
One-token lookahead over bytes was enough; no tokenizer pass was needed.

- **Commas:** treating them as whitespace was one character in the skip loop.
- **Tag attachment:** whitespace-sensitive attachment is a check that the next
  byte is `<`, `[`, `{`, or `(` immediately after the name.
- **Separators:** the rule that entries need separation is one comparison of
  positions before and after skipping trivia.
- **Validation:** checking programmatic values before writing is a direct walk,
  not the render-and-reparse that WM's `encode` uses.

## Typed conversion

`typed.parseFromSlice(T, arena, source, &diagnostic)` and
`typed.stringify(arena, value)` follow `std.json`'s shape. Stageforge-style
commands come out as:

```text
[Ready Pose{hand = left position = [0.1 -0 1.5] rotation = [0 0 0 1]}
 Count(18446744073709551615) ActorError{message = "ControllersDisabled" event = "controller-command"}]
```

Tagged unions and enums map onto tags with no convention. `std.json` needs a
single-key object such as `{"Pose": {...}}` for the same data. `u64` values
survive exactly, and an envelope can keep its payload as an untyped `won.Value`
to decode later by message type.

## Edges found

These need a decision in a language-mapping guide; none needs a grammar change.

1. **Text and blobs share a host type.** Zig spells both `[]const u8`, so plain
   slices map to text and blobs need a `typed.Blob` wrapper. Rust has the same
   issue: serde serializes `Vec<u8>` as a sequence unless `serde_bytes` is used.
   Typed frameworks need blobs to be opt-in.
2. **Optional fields: absent or null.** `?T` cannot distinguish them. The
   experiment reads both as `null` and writes `null` by omitting the field.
   The mapping guide should make this the rule. Where the distinction
   matters, an application keeps a `won.Value`.
3. **Integer spelling.** `std.fmt.parseInt` rejects `1e3` and `1.0` for integer
   types. That is the simple, predictable choice; accepting integral exponents
   would need decimal arithmetic in every implementation.
4. **Float spelling.** Shortest round-trip digits, written in decimal for
   magnitudes from 1e-6 up to 1e21 (as JS does) and scientific otherwise.
   Results such as `-0` and `1e21` are valid WON as produced. NaN and
   infinities are rejected when writing and reading.
5. **Attributes have no typed counterpart.** Decoding a tag with attributes
   into an enum or union is an error (`UnexpectedAttributes`). Attributes stay
   in the untyped tree, for markup.
6. **Unknown fields are rejected** by default, as in `std.json`. That choice
   belongs to the reader, not the format.
7. **Union payload `null`.** A variant whose payload is a null optional is
   written as a bare tag and reads back as null: consistent, but the payload's
   absence and a null value again collapse together.

## Next

- These decisions are now the [language mapping guide](won-mapping.md).
- Exchange typed Stageforge envelopes between Zig and WM in the interop test,
  once WM has typed conversion or a hand-mapped probe.
