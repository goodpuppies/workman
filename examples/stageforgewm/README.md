# StageForge-shaped actors in Workman

This zero-TypeScript prototype implements strongly typed actors on top of Workman's `.wm` web
workers. `init.wm` starts a root actor; root creates a counter actor, posts a one-way message, awaits
a typed callback, then posts a reset message.

```powershell
.\wm.bat run examples\stageforgewm\init.wm
```

Expected output, with a different generated root address on each run:

```txt
child actor added 2 from root@<id>
typed callback returned 42
child actor received typed reset from root@<id>
```

## Actor shape

An actor file is both its executable worker and the source of its public protocol. The counter actor
exports its protocol marker, payload types, message/request descriptors, public API record, and
`main` from `actors/counter.wm`.

Its special public functions are grouped in one record:

```wm
record CounterApi = {
  add: (AddPayload, String) => Void,
  double: (Number, String) => Number,
  reset: (ResetPayload, String) => Void,
};

let api = .{
  add = (payload, sender) => { /* one-way handler */ },
  double = (value, _) => { value * 2 },
  reset = (payload, sender) => { /* one-way handler */ },
};
```

The actor pairs those functions with typed descriptors and starts PostMan:

```wm
let serve = (api) => {
  let .{
    add = handleAdd,
    double = handleDouble,
    reset = handleReset,
  } = api;

  PostMan.serve([
    PostMan.route(add, handleAdd),
    PostMan.replyRoute(double, handleDouble),
    PostMan.route(reset, handleReset),
  ])
};
```

`route` checks a one-way handler. `replyRoute` checks the handler's return type;
`replyTaskRoute` is the asynchronous-handler variant.

Callers import the same actor file normally for its typed declarations and through `js.worker` for
its worker artifact:

```wm
from js.worker("./counter.wm") import { url } as CounterWorker;
from "./counter.wm" import { CounterProtocol, add, double, reset };
```

An ordinary import does not invoke the imported actor's `main`.

## Posting and callbacks

One-way messages use `Message<payload, protocol>`:

```wm
PostMan.post(counter, add, .{ amount = 2 });
```

Structured message payloads use `jsonMessage`; no-payload messages can use `unitMessage`. Record
encoders remain explicit because Workman does not automatically turn nominal records into JS
objects.

Callbacks use `Request<payload, reply, protocol>` and return a typed task:

```wm
let double: Request<Number, Number, CounterProtocol> =
  PostMan.request(
    "counter/double",
    PostMan.jsonNumber,
    PostMan.jsonNumber,
  );

let result: Task<Number, ActorError> =
  PostMan.ask(counter, double, 21);
```

`jsonNumber`, `jsonBool`, and `jsonString` represent a scalar on the wire as
`{ value: scalar }`; `jsonUnit` represents an empty side of a request. `jsonRequest` supports
structured request and reply records with explicit encoders.

Requests use UUID correlation, verify the replying actor, decode the reply before resolving, and
fail with `RequestTimedOut` after nine seconds.

## Runtime ownership

- `PostalService` runs on the main thread, owns every physical `Worker`, creates actors, and routes
  post/request/reply envelopes by address.
- `PostMan` runs inside actors and hides worker events, transport, handler dispatch, creation
  correlation, callback correlation, codecs, and timeout cleanup.
- Actor implementations do not call `Worker`, `postMessage`, or `addEventListener` directly.

Check the positive type fixture with:

```powershell
.\wm.bat check examples\stageforgewm\typecheck.wm
```

See [DESIGN.md](./DESIGN.md) for the main type relationships, routing lifecycle, and current
limitations.


## Remote Actor References And Phantom Protocols

Yes: current Workman can express the client-side part of a type-safe remote-actor API using generic
nominal records. The protocol parameter is _phantom_ when it does not occur in a runtime field. It
is still retained by the static type checker, while emitted JavaScript only needs the runtime fields
such as the address, tag, and encoder.

This is the Workman counterpart of the SML design:

```wm
-- Distinct zero-runtime-data protocol markers.
type FileActorProtocol = | FileActorProtocol;
type DatabaseProtocol = | DatabaseProtocol;

-- `protocol` is phantom: it has no corresponding record field.
record ActorRef<protocol> = { address: String };

-- `protocol` connects a descriptor to the actor protocol; `payload` describes its input.
record MsgDesc<payload, protocol> = {
  tag: String,
  encode: (payload) => String,
};

-- The annotations are important. They preserve the nominal ActorRef/MsgDesc relationship;
-- inferring from field access alone would only see structural `address` and `encode` fields.
let post = (actor: ActorRef<protocol>, desc: MsgDesc<payload, protocol>, payload: payload) => {
  let serialized = desc.encode(payload);
  print(actor.address ++ " | " ++ desc.tag ++ " | " ++ serialized)
};

let fn2: MsgDesc<Bool, FileActorProtocol> = .{
  tag = "fn2",
  encode = (value) => { if (value) { "true" } else { "false" } },
};

let fn3: MsgDesc<String, FileActorProtocol> = .{
  tag = "fn3",
  encode = (value) => { value },
};

let fileActor: ActorRef<FileActorProtocol> = .{ address = "192.168.1.50:9000" };
let databaseActor: ActorRef<DatabaseProtocol> = .{ address = "192.168.1.51:9000" };

let sentString = post(fileActor, fn3, "data");
let sentBool = post(fileActor, fn2, false);

-- Rejected: `fn3` expects String, not Bool.
-- let badPayload = post(fileActor, fn3, false);

-- Rejected: FileActorProtocol and DatabaseProtocol do not unify.
-- let wrongActor = post(databaseActor, fn3, "data");
```

`post` is inferred as a polymorphic function whose tuple argument has the shape
`(ActorRef<protocol>, MsgDesc<payload, protocol>, payload)`. The shared `protocol` parameter is what
prevents a descriptor for one actor family from being used with another.

This protects the Workman client program, not the wire by itself. The server must still agree on the
tag and serialization format, and received network data must be decoded and validated before it is
treated as a typed payload.