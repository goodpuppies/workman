# Int32Array.new(SharedArrayBuffer) selects an ArrayBuffer-only signature

Status: open. Reproduced 2026-11-05 with WM 0.6.0 while testing a Workman-only synchronous worker bridge for atview.

## Reproduction

```wm
from js.global import { SharedArrayBuffer, Int32Array };
let main = () => {
  let shared = SharedArrayBuffer.new(8) :> Result.debug;
  Int32Array.new(shared)
};
```

`wm check repro.wm` fails with `type.call-argument-mismatch`:

```text
Int32Array.new(shared) ... can't be both:
- ArrayBuffer
- SharedArrayBuffer
```

The conflicting constructor signature is shown as ArrayBuffer, while the input comes directly from SharedArrayBuffer.new. JavaScript's `new Int32Array(shared)` is valid. This is a concrete constructor call, not a request for arbitrary TypeScript union inference.

## Verified workaround / impact

Use safe reflected Reflect.construct with an opaque imported Int32Array constructor and JSON[shared], then Json.assert the result as the foreign Int32Array type. The type-only Int32Array import currently expects zero type arguments.

Atview's `util/shared-cells.wm` implements that narrow boundary. `wm run util/sync-worker-probe.wm` then passes: a WM worker completes an ordinary asynchronous fetch Task using a data URL while the parent waits with Atomics.wait; the worker stores 42 and notifies, and the parent reads 42 and terminates the worker. Atomics.wait/load/store/notify themselves work through safe reflected imports.

The direct constructor should work without this dynamic construction boundary. Check constructor overload/generic instantiation before erasing or widening the caller's concrete SharedArrayBuffer type.

## Retest after d4e418c (2026-11-05)

The small direct-constructor reproduction above now checks. Individual Atomics.wait/load/store/notify calls and a simple wait/load composition also check in isolation.

The full atview worker-parent graph still fails. Starting from atview's util/sync-worker-probe.wm, replace the sharedCells helper import/use with a direct import of Int32Array and Int32Array.new(shared), leaving the worker unchanged. The constructor call is rejected with ArrayBuffer versus SharedArrayBuffer, citing an ArrayBuffer-only reflected signature. This was reproduced again in a temporary parent entrypoint using the existing worker artifact. No worker request is sent because the graph does not check.

The Reflect.construct/Json.assert helper still lets that complete graph run and return 42 from the worker's ordinary async Task. Retain it until the graph-level case is fixed. The original simplified symptom is no longer sufficient to demonstrate the remaining failure; the exact root cause is still unconfirmed.

