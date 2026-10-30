# Effect.race selects a function-result adapter for a two-argument call

Observed while expanding `examples/effect-ts/effect_server.wm` with Effect 4.0.6.

```wm
from js.module("npm:effect@4.0.6/Effect") import unsafe * as Effect;
let winner = Effect.race(job("fast", 100), job("slow", 5000));
```

Here `job` returns an Effect, as in the example. `wm check` succeeds, but the
generated race binding uses a function-result adapter:

```js
__wm_js_apply(member, args, ["id", "id"],
  { kind: "fn", params: ["id"], result: "id" }, false)
```

The data-first call should return an Effect value. In the server, mapping the
adapted result and serving it at `/race` hangs without even starting either job.
Other routes continue to work.

The TypeScript API has both `race(that, options?) => self => Effect` and
`race(self, that, options?) => Effect` signatures. The emitted adapter appears to
come from the curried signature; the precise reflection failure needs investigation.

Workaround used in the example:

```wm
let winner = Effect.race(job("fast", 100), job("slow", 5000), JSON{});
```

With explicit third-argument options, the HTTP smoke check returned `winner: fast`
in about 103ms and logged finalizers for both jobs, including the interrupted loser.
No compiler changes were made for this experiment.
