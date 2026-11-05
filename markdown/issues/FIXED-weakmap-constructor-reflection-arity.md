# WeakMap.new() fails with "WeakMap expects 0 type arguments"

Status: fixed 2026-11-05. Reproduced 2026-11-05 with WM 0.6.0 and Deno 2.9.8.

## Reproduction

```wm
from js.global import { WeakMap };
let identities = WeakMap.new() :> Result.debug;
```

`wm check repro.wm` fails:

```text
error[error repro.wm]: WeakMap expects 0 type arguments
```

The support location is `generated: unknown`. `wm err repro.wm` should help expose the constructor's reflected type arguments and declared arity.

Expected: construction of a valid empty WeakMap, or a useful diagnostic identifying what information the caller must provide. The constructor is valid JavaScript and was used by atview's existing image-identity cache.

## Workaround in atview

The identity-cache host boundary already treats maps as opaque values and invokes prototype methods through Reflect. Importing the constructor as an opaque Js.Value and using safe reflected `Reflect.construct(constructor, JSON[])` preserves that design and avoids this constructor reflection failure. `tui/identity-probe.wm` validates stable/distinct object keys and shared-content identities.

Potentially related to the imported `Ptr` arity issue, but no shared cause is established.
