# JSON workarounds in PetPlay and Stageforge

WON is intended to remove representation workarounds from existing applications.
These examples come from the local PetPlay, Stageforge, and Stageforgeman
sources. They distinguish code that exists today from possible WON mappings.
The suggested mappings do not change the running applications.

The BigInt, marker collision, numeric precision, byte-buffer, and comment
cases were verified offline against the actual Stageforge codec and the
compiled WON decoder in October 2026; that comparison script has since been
removed during the redesign.

## BigInt needs custom wrappers in multiple transports

[Stageforge's process codec](/home/ellie/git/petplay/submodules/stageforge/src/lib/webSocketWorkerCodec.ts:1)
uses a JSON replacer/reviver to preserve JS BigInt. Its process transport test
explicitly checks that `3n` survives an ECHO. The actual encoded payload is:

```json
{"count":{"__websocket_worker_bigint__":"3"}}
```

[IrohWorker](/home/ellie/git/petplay/submodules/irohworker/IrohWorker.ts:734)
implements the same general workaround with a different marker, `__bigint__`.
The decimal text is straightforward; the wrappers and revival rules are extra
protocol conventions needed because ordinary JSON.stringify rejects BigInt.

A WON representation could be:

```text
{count = BigInt(3)}
```

The WON decoder represents that as a tag containing an exact
number token. An application adapter would still need to turn that tag into JS
BigInt. `BigInt` is a proposed application convention, not a reserved tag.
A typed counter field could instead use a bare number when its expected type
already supplies the interpretation.

The wrapper also has an observable collision. Passing this ordinary record
through the current Stageforge codec returns the primitive `7n`:

```json
{"__websocket_worker_bigint__":"7"}
```

In WON these are structurally different:

```text
{__websocket_worker_bigint__ = "7"}  // a record
BigInt(7)                           // a tag
```

A tag convention need not reinterpret otherwise ordinary records. The collision
was reproduced offline; it is not a claim that it caused a production bug.

## Native counters meet JavaScript's numeric limits

[The Zig driver state](/home/ellie/git/petplay/submodules/petplay_ovrdriver/src/state.zig:4)
uses u64 counters. [HEALTH replies](/home/ellie/git/petplay/submodules/petplay_ovrdriver/src/actor.zig:103)
emit fields including `runFrameCount` and `ipcSessions`. The JS process codec
uses ordinary JSON.parse for unmarked number tokens.

A synthetic boundary value demonstrates the issue:

```js
JSON.parse('{"runFrameCount":9007199254740993}').runFrameCount
// 9007199254740992
```

WON retains:

```text
{runFrameCount = 9007199254740993}
```

The current generic reader exposes the exact spelling. A consumer can inspect,
forward, or explicitly convert it to BigInt or a checked Zig u64. The float
conversion used for poses can be a different operation.

JSON itself can spell those digits, and a lossless JSON library could preserve
them. The concrete problem is the current JS parsing path. WON makes exact
spelling part of its generic value model rather than relying on a special
parser, string-valued counter convention, or object wrapper. No overflowing
counter was observed; this is a boundary-value reproduction using a real field.

## Pixel bytes become strings or arrays

[frameUpdater's GETFRAME](/home/ellie/git/petplay/petplay/frameUpdater.ts:56)
converts Uint8Array pixels to a base64 string. Its receiving path decodes that
string back to bytes. [displayOverlayHost](/home/ellie/git/petplay/petplay/displayOverlayHost.ts:431)
also branches on whether incoming pixels are base64 or a number array.
[IrohWorker's large-message test](/home/ellie/git/petplay/submodules/irohworker/large_message_test.ts:154)
explicitly base64-encodes binary data for JSON transport.

For four representative bytes, the existing convention looks like:

```json
{"pixels":"AAH+/w==","width":1,"height":1}
```

A WON value can say directly:

```text
{pixels = x"0001feff" width = 1 height = 1}
```

The current WON blob accessor returns those four bytes. An application no
longer needs a string-versus-number-array encoding flag for byte contents.
Transport adapters still need to map Uint8Array to and from Blob.

This is a representation improvement, not a frame-performance claim: text hex
uses two characters per byte and is larger than base64. WON does not provide
zero-copy transfer, shared buffers, GPU resource transport, or a binary format.

## Scene data is wrapped in V8 serialization and base64

[overlaySceneWire](/home/ellie/git/petplay/classes/overlaySceneWire.ts:12)
serializes scene data using node:v8, then wraps it in a base64 string:

```ts
{ format: "petplay-ir-v8-base64-v1", data: serialize(payload).toString("base64") }
```

The stateful version also carries delivery and geometry-asset information
inside that serialized payload. Its geometry uses typed arrays. The record's
shape and values are hidden from a generic reader, and an independent Zig
consumer would need to understand that serialization or add another conversion.

A possible small geometry representation is:

```text
Geometry{
    positions = Float32LE(x"000000000000803f")
    indices = Uint16LE(x"00000100")
}
```

Here the blobs contain `[0, 1]` as little-endian 32-bit floats and 16-bit unsigned
integers, respectively. The tag names and byte order are a proposed application
convention, not built-in typed-array support. A generic reader can still
inspect fields and preserve bytes without constructing those host types.

WON could replace the opaque value representation. It would not replace the
existing asset identity, revision tracking, receipts, caching, or resource
lifetimes. No scene adapter or performance comparison has been implemented.

## Named failures use magic record fields

[Stageforgeman's actor reply code](/home/ellie/git/stageforgeman/src/runtime.ts:96)
detects failures by the presence of `__actorError`. The Zig driver emits the
same convention. An existing failure shape is:

```json
{"__actorError":{"message":"ControllersDisabled","event":"controller-command"}}
```

WON could represent the variant explicitly:

```text
ActorError{message = "ControllersDisabled" event = "controller-command"}
```

This replaces a magic field-name test with a tag test. An ordinary record
containing a field called `__actorError` can remain ordinary data. Error handling
would still be Stageforge's protocol, and both endpoints would have to adopt
the mapping. WON does not automatically throw or assign meaning to ActorError.

## Settings can contain explanations

[PetPlay's settings store](/home/ellie/git/petplay/classes/settings.ts:1)
persists settings.json using JSON.parse/stringify. The settings include values
such as controllerLaser and wristMenuScale. JSON handles those values, but
inline explanations are invalid input for that parser.

WON can express the same values with comments:

```text
{
    controllerLaser = true
    // Smaller menu for this controller setup.
    wristMenuScale = 0.8
}
```

This addresses human editing without a JSONC dialect or a comment-stripping
preprocessor. The current WON parser accepts these comments, but its encoder
reformats the values and discards comments. Comment-preserving edits are not
implemented. This example does not claim the settings store currently contains
a comment workaround.

## Stageforge integration

This is an offline assessment of the local Stageforge, Stageforgeman, and
PetPlay native driver sources. Nothing was modified or started.

### Existing boundaries

- [Stageforgeman's actor interpreter](/home/ellie/git/stageforgeman/src/actor.wm)
  uses `structuredClone` at the erased JS boundary. The ordinary Worker path
  does not encode each message as JSON text.
- [Stageforge's WebSocket codec](/home/ellie/git/petplay/submodules/stageforge/src/lib/webSocketWorkerCodec.ts)
  uses JSON text and the BigInt marker above. IPCWorker selects this transport
  by default. Transport messages wrap actor messages as
  `{kind: "message", data: {address: {fm, to}, type, payload}}`.
- [The native Zig actor](/home/ellie/git/petplay/submodules/petplay_ovrdriver/src/actor.zig)
  parses the same envelope with `std.json.Value`. It implements INIT/LOADED,
  PING, ECHO, HEALTH, controller commands, and actor-error replies.
- [The Unix proxy attachment](/home/ellie/git/petplay/classes/petplayOpenVrDriverProxy.ts)
  already injects encode/decode functions into NativeUnixProxy.
- [The native socket](/home/ellie/git/petplay/submodules/petplay_ovrdriver/src/ipc.zig)
  and [standalone actor host](/home/ellie/git/petplay/submodules/petplay_ovrdriver/src/actor_host.zig)
  use newline-delimited packets bounded to 16 KiB. WebSocketWorker uses text
  messages. These are transport framing decisions.

The grammar represents these envelopes without an extension: records hold
addresses, metadata, and payloads; lists hold vector and tuple arguments;
numbers retain the source needed for checked conversion. Stageforge method
names and routing do not become WON syntax. [The design corpus](../examples/stageforge.won)
contains sample envelopes: ready, initialization, a controller pose, omitted
and null payloads, large health counters, a command error, and termination.
Counter boundary values are synthetic. It is a parsing corpus, not a runnable
actor session or a proposal to batch messages as lists.

### Host mappings still needed

**Numbers.** The Zig motion reader needs f64 and bounded vectors; counters and
handles are u64. Add explicit checked conversions for finite floats,
signed/unsigned ranges, and exact JS integers, rather than converting every
token to JS Number. NaN and infinities are outside the number grammar and
should fail a finite-float conversion rather than silently becoming null.
Host-generated floats such as JS `1e+21` are valid WON as written.

**BigInt.** Stageforge's process test expects JS BigInt to survive an ECHO.
A bare WON number does not distinguish `3` from `3n`. Either the method's type
supplies that distinction, or a convention such as `BigInt(3)` preserves it
for untyped echo. Peers must agree; it is not yet implemented.

**Absence and null.** A missing field and a field containing null are distinct
in WON; JS undefined is not a WON value. Stageforge permits omitted payloads,
void returns, and optional fields. The adapter must define how undefined maps
to an omitted field or null. A generic WON parser must not conflate them.

**Typed WM values.** Stageforgeman's inferred function-record factory relates
caller and handler types; its erased boundary coerces values without
per-method validation, and WON should not add a second handwritten schema to
repeat that agreement. A decoded tree still is not a WM value: a payload such
as `[0 1 2]` needs a method adapter before invoking a three-argument function,
and a field list is not a nominal Position because it has x/y/z keys. Keep
that conversion at the actor-method boundary. Do not transmit bundle-local
constructor IDs. Ordinary Unicode JS strings also need the UTF-8/byte-carrier
conversion at the WON boundary.

**Blobs and framing.** Blobs carry byte contents, not ownership transfer,
shared memory, or GPU resources. Keep high-volume frame data in its existing
transports. The encoder emits one line with text newlines escaped, so its
output fits the native line framing; human-formatted documents with newlines
and comments do not. Hex blobs count against the 16 KiB packet limit at twice
their byte length.

### Next evaluation

After the scanner/structural parser rewrite, use an isolated offline harness
with a small independent Zig WON reader/writer:

1. Exchange the existing Stageforge envelope shapes among WM, JS, and Zig.
2. Check exact large counters, finite pose floats, negative zero, Unicode,
   omitted/null fields, and nested errors with explicit host conversions.
3. Exercise a WM tuple input and nominal record output through method adapters.
4. Decide the BigInt/undefined conventions and test their distinctions.
5. Compare bounded control-message sizes and allocation costs before replacing
   any live JSON transport. Retain framing and actor-routing behavior.

The grammar already covers the control protocol. The missing pieces are small
host mappings at the integration boundary. Merely replacing JSON.parse with
WON decode would not complete a transport migration.
