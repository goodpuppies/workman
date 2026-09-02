# StageForge-shaped Workman actor design

This prototype follows StageForge's `PostalService`/`PostMan` split while using Workman's nominal
types, `Result`/`Task` carriers, and `.wm` web workers.

## Topology

`init.wm` is bootstrap code, not an actor. PostalService creates the root worker once. Root and all
other actors request later actors through `PostMan.create`; actors never construct physical workers
themselves.

```txt
init / PostalService (main thread; owns address -> Worker)
  ├─ root actor
  └─ counter actor created at root's request

actor -- create/post/request/reply --> PostalService --> actor
```

All workers are physical children of the main thread. PostalService associates each worker listener
with its trusted actor address and stamps that address onto forwarded messages and replies. The
`parent` in the initialization envelope is a logical actor relationship.

## Actors publish their protocols

As in StageForge, the actor file is the public protocol source. `actors/counter.wm` contains:

- `CounterProtocol`, the protocol type index;
- payload records such as `AddPayload` and `ResetPayload`;
- the `add`, `double`, and `reset` descriptors;
- `CounterApi`, the public implementation record;
- the public `api` value and executable `main`.

A caller imports declarations and the worker artifact from that same file:

```wm
from js.worker("./counter.wm") import { url } as CounterWorker;
from "./counter.wm" import { CounterProtocol, add, double, reset };
```

The ordinary import does not invoke the actor's `main`; `js.worker` separately compiles it as a
worker entrypoint.

## Core types

```wm
record ActorRef<protocol> = {
  address: String,
  protocol: protocol,
};

record Message<payload, protocol> = {
  tag: String,
  encode: (payload) => Js.Value,
  decode: (Js.Value) => Result<payload, String>,
};

record Request<payload, reply, protocol> = {
  tag: String,
  encode: (payload) => Js.Value,
  decode: (Js.Value) => Result<payload, String>,
  encodeReply: (reply) => Js.Value,
  decodeReply: (Js.Value) => Result<reply, String>,
};
```

`PostMan.post` requires the same `protocol` on its actor reference and message descriptor, and the
same `payload` on its descriptor and value. `PostMan.ask` additionally carries `reply` into its
`Task<reply, ActorError>` result.

The protocol constructor stored in `ActorRef` and `ActorSpec` is a small runtime witness needed to
keep generic creation polymorphic across Workman's current module/FFI staging. Actor references do
not contain a `Worker` or transport object.

## Public API records and routes

Public actor methods remain grouped in a nominal record:

```wm
record CounterApi = {
  add: (AddPayload, String) => Void,
  double: (Number, String) => Number,
  reset: (ResetPayload, String) => Void,
};
```

Workman has no TypeScript-style `keyof`, mapped types, or heterogeneous record reflection. The actor
therefore supplies a short static mapping:

```wm
PostMan.serve([
  PostMan.route(add, handleAdd),
  PostMan.replyRoute(double, handleDouble),
  PostMan.route(reset, handleReset),
]);
```

Each route checks its descriptor and handler before erasing the payload type into a uniform `Route`
used during installation. `replyTaskRoute` performs the same check for a handler returning
`Task<reply, ActorError>`. Actor logic receives decoded payloads and a trusted sender address, not
event objects, envelopes, tags, or `Js.Value`.

## Codecs

`jsonMessage(tag, encode)` derives structured-message decoding from the surrounding `Message`
annotation. `unitMessage` handles `Void` messages.

Requests compose reusable `Codec<value>` records:

```wm
let double: Request<Number, Number, CounterProtocol> =
  PostMan.request("counter/double", PostMan.jsonNumber, PostMan.jsonNumber);
```

`jsonNumber`, `jsonBool`, and `jsonString` use `{ value: scalar }` on the wire. `jsonUnit` handles an
empty request or reply side. `jsonRequest` remains available for structured request/reply records.

## Request/reply lifecycle

StageForge decorates a message type with its signal UUID. This implementation instead carries
`requestId` as an explicit envelope field:

1. `PostMan.ask` creates a UUID and registers a pending promise resolver.
2. PostalService stamps and forwards the request to the destination actor.
3. A reply route decodes the payload, runs the synchronous or asynchronous handler, encodes its
   reply, and posts it to the original sender.
4. PostalService stamps and forwards the reply.
5. The caller verifies the sender, decodes the reply, removes the pending entry, and resolves the
   typed task.

Pending requests are removed after successful delivery, a send failure, or a nine-second timeout.
A remote handler failure is currently logged by the serving actor; because error replies are not yet
part of the wire protocol, the caller observes that case as a timeout.

## Implemented and remaining

Implemented end to end:

- zero-TypeScript worker compilation and round trips;
- main-thread worker ownership, creation, and address routing;
- actor-as-protocol modules and public API records;
- protocol-indexed references and typed one-way posting;
- typed synchronous/asynchronous reply routes and `PostMan.ask`;
- JSON codecs, UUID correlation, sender verification, and timeout cleanup;
- linear root orchestration using lifted `Task` procedures.

Not implemented yet:

- initialized actor state exposing `self`, `parent`, and contacts;
- PostalService registry cleanup when actors exit;
- structured remote error replies;
- StageForge-style topics or contacts;
- transport beyond local web workers.
