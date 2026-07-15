# Preserve WebGPU receiver evidence through Task and Option callbacks

## Status

Open compiler issue discovered while building `examples/webgpu_compute.wm`.

## Problem

Workman can reflect Deno's WebGPU declaration for:

```workman
from js.global("navigator.gpu") import { requestAdapter };
let adapter = requestAdapter();
```

The inferred type is correctly:

```text
Task<Option<GPUAdapter>, Js.Error>
```

However, destructuring that `Option` inside `Task.andThen` or `Monad.lift Task` does not preserve
the `GPUAdapter` foreign receiver reference on the callback binding. Consequently this ordinary
continuation remains unresolved:

```workman
requestAdapter()
  :> Task.andThen((adapterOption) => {
    match(adapterOption) {
      Some(adapter) => { adapter.requestDevice() },
      None => { Panic("no adapter") }
    }
  })
```

The delayed FFI diagnostic reports `adapter.requestDevice()` with a type-variable receiver rather
than the reflected `GPUAdapter` receiver.

The same underlying weakness appears when nominal receiver values are threaded through several
carrier-lifted helper functions: the eventual concrete foreign reference does not always propagate
back into an earlier generic helper's receiver obligation.

## Expected behavior

- Foreign references nested under `Task`, `Result`, `Option`, tuples, records, and ADTs survive
  contextual callback typing.
- Matching `Some(adapter)` retains the `GPUAdapter` reference.
- `adapter.requestDevice()` resolves from that evidence without an annotation or unsafe cast.
- Mapping only the carrier error type does not erase foreign evidence from its value parameter.

## Current workaround

`examples/webgpu_device.ts` acquires the device and supplies narrow mechanical method bridges.
`examples/webgpu_compute.wm` still owns all WebGPU descriptors and operation ordering. Do not make a
user annotation count as receiver evidence to work around this issue; that would weaken the FFI
safety model documented in `docs/js-errors.md`.

## Regression coverage

Add a focused inference test for the snippet above, followed by a carrier-heavy test that creates a
buffer from the resulting device and passes it through a lifted `Result` continuation. The direct
WebGPU example should then be simplified by deleting bridge functions rather than changing its
semantics.
