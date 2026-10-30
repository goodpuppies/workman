# Effect v4 server example

[`examples/effect-ts/effect_server.wm`](./effect_server.wm) imports Effect 4.0.6
and its Node HTTP adapter directly. It uses direct imports without a TypeScript shim.
The adapter runs on Deno's Node compatibility layer.

From the repository root:

```sh
deno task wm run examples/effect-ts/effect_server.wm
```

The server listens on `127.0.0.1:3000`. Stop it with Ctrl-C.

| Route | Behavior |
| --- | --- |
| `/` | Lists the example routes. |
| `/parallel` | Four simulated 200ms jobs, at most two at once; about 400ms total. |
| `/sequential` | The same jobs, one at a time; about 800ms total. |
| `/timeout` | Interrupts a five-second job after 100ms and returns HTTP 504. |
| `/race` | A 100ms job wins against a five-second job; the loser is interrupted. |
| `/disconnect` | Runs a five-second job; closing the client interrupts it. |

```sh
time curl -s http://127.0.0.1:3000/parallel
time curl -s http://127.0.0.1:3000/sequential
curl -i http://127.0.0.1:3000/timeout
curl http://127.0.0.1:3000/race
curl --max-time 0.2 http://127.0.0.1:3000/disconnect
```

The last command intentionally exits with a curl timeout. Watch the server log:
`release disconnect-job` should appear immediately, rather than after five seconds.
Every job attaches a logging finalizer with `Effect.ensuring`; finalizers run on
success and interruption. These jobs simulate asynchronous I/O using `Effect.sleep`;
they do not demonstrate parallel CPU execution or acquire real external resources.

The batch limit is **per request**. Two concurrent `/parallel` requests can run
four jobs at once. A shared semaphore would be needed for a server-wide limit.
Result arrays preserve input order even when jobs run concurrently.

The imports use `unsafe` to call trusted constructors and combinators without
Workman's outer `Result` wrapper. Their TypeScript declarations are still reflected.
Effect retains its own typed failures and interruption behavior. A synchronous
exception outside a running Effect is not caught by Workman at these imports.

Representable generic arguments now survive reflection, including native tuple
callback results. [`examples/effect-ts/effect_sequence.wm`](./effect_sequence.wm)
shows a pipe followed by `Effect|answer, Effect.succeed("hello")|`; `runSync`
produces a native `(Number, String)` tuple without a cast or assertion. The group
uses Effect's existing `andThen` and `map` exports and runs sequentially.
This does not establish support for every Effect type-level operation or a fully
polymorphic Workman carrier library; unreduced TS type algebra remains a separate
FFI boundary question.

The race call supplies `JSON{}` as its third argument to distinguish the data-first
overload from the curried `race(that, options)` overload. The two-argument form
currently typechecks but is emitted with an incorrect function-result adapter.

Useful upstream references: [basic concurrency](https://effect.website/docs/v4/concurrency/basic-concurrency),
[timeouts](https://effect.website/docs/v4/error-management/timing-out), and
[the Node HTTP server](https://effect.website/docs/v4/api/platform-node/NodeHttpServer).
