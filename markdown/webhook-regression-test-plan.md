# Webhook Regression Test Plan

This plan captures the regressions we should add after the delayed JS FFI refactor. The focus is not
to snapshot the whole webhook fixture. The useful tests are small examples that protect the new
architecture:

```txt
HM creates unresolved FFI placeholders
TS reflection solves those placeholders at the selected JS member
unresolved FFI never escapes as a fake generic
bindings whose bodies depend on FFI are not generalized past downstream constraints
```

## Current Baseline

`examples/webhook.wm` now typechecks without the old annotation escape hatches:

- no `req: Request` on `handleRequest`;
- no `info: Js.Object` on `handleRequest`;
- no `encoder: TextEncoder`;
- no `byte: Number`;
- no `status: Number`;
- no intermediate `Js.Object` promise/array annotations;
- no promise callback parameter annotations.

The remaining explicit escape hatches are intentional for now:

- `Json.assert` for dynamic JSON shape claims;
- local `try` for panic-style `Result` unwrapping;
- `unsafe` imports and a few manual import signatures for APIs whose reflection/ergonomics are not
  clean yet.

## High Priority Tests

### Reflected FFI Placeholders Are Solved In Place

Target file: `tests/compiler_js_reflection_test.ts`

Add a regression where a reflected method result is immediately used through a local binding:

```wm
from js.global import type { Request };

let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("ffi") },
  }
};

let handle = (req) => {
  let textPromise = req :> .text() :> try;
  textPromise :> .then((text) => {
    text :> .slice(0, 1) :> try
  }) :> try
};

let use = (req: Request) => {
  handle(req)
};
```

Expected:

- `handle` is not generalized as `('a) => ...`;
- the receiver for `.then` is solved as `Js.Promise<String>`, not `?ffi:text`;
- `text` in the callback behaves as `String`.

This protects the bug where `Request.text()` reflected correctly but the `?ffi:text` placeholder was
not discharged before resolving `.then`.

### FFI Placeholders Are Not Cloned During Instantiation

Target file: `tests/compiler_js_reflection_test.ts`

Add a focused let-binding test:

```wm
from js.global import type { Request };

let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("ffi") },
  }
};

let getTextPromise = (req) => {
  req :> .text() :> try
};

let handle = (req: Request) => {
  let p = getTextPromise(req);
  p :> .then((text) => {
    text
  }) :> try
};
```

Expected:

- `getTextPromise` resolves to `(Request) => Js.Promise<String>` once constrained;
- using `p.then(...)` does not fail with `cannot resolve JS FFI method then for receiver type ?ffi`.

This protects the `instantiate` change: unresolved FFI placeholders are obligations and must stay
identity-stable until solved.

### FFI-Involved Bindings Stay Monomorphic Across Downstream Constraints

Target file: `tests/compiler_js_reflection_test.ts`

Add a reduced version of the `handleRequest`/`serve` shape:

```wm
from js.global import type { Request };
from js.global("Deno") import unsafe {
  serve: (Js.Value, (Request, Js.Value) => Js.Promise<Js.Value>) => Js.Value
};
from js.global("Promise") import unsafe { resolve as promiseResolve };

let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("ffi") },
  }
};

let handler = (req, info) => {
  let textPromise = req :> .text() :> try;
  textPromise :> .then((text) => {
    promiseResolve(text)
  }) :> try
};

let server = serve(JSON{}, handler);
```

Expected:

- `handler` infers as `((Request, Js.Value)) => Js.Promise<Js.Value>`, not
  `(('a, 'b)) => Js.Promise<Js.Value>`;
- `server` typechecks.

This protects the rule that a binding whose body crosses an FFI boundary cannot be generalized before
downstream constraints have settled.

### LSP Hover Shows Final Solved Binding Types

Target file: `tests/lsp_test.ts`

Use a temp file with the reduced `handler`/`serve` source above and assert hovers:

- hover at the `handler` definition shows `((Request, Js.Value)) => Js.Promise<Js.Value>`;
- hover at the `serve(JSON{}, handler)` use shows the same type.

This protects the exact webhook mismatch:

```txt
definition: (('a, 'b)) => Js.Promise<Js.Value>
use site:    ((Request, Js.Value)) => Js.Promise<Js.Value>
```

### Webhook Fixture Checks

Target file: `tests/nontrivial_fixture_test.ts` or `tests/cli_js_test.ts`

Add or update a fixture check that runs:

```txt
wm check examples/webhook.wm
```

Expected:

- no diagnostics;
- the test should not require running the webhook simulation.

This is a broad guard only. It should not replace the smaller tests above.

## Annotation Removal Regressions

These can live in `tests/compiler_js_reflection_test.ts` as small positive tests.

### `TextEncoder.encode` Infers Receiver And Argument

Source:

```wm
from js.global import unsafe { TextEncoder };

let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("ffi") },
  }
};

let encodeText = (encoder, text) => {
  encoder :> .encode(text) :> try
};

let main = () => {
  encodeText(TextEncoder.new(), "hello")
};
```

Expected:

- `encodeText` infers as `(TextEncoder, String) => Uint8Array` or the current reflected byte-array
  type;
- no `encoder: TextEncoder` annotation is required.

### `Array.from(...).map(...)` Infers Callback Parameter

Source:

```wm
from js.global import unsafe { Uint8Array };
from js.global("Array") import unsafe { from as arrayFrom };

let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("ffi") },
  }
};

let hexByte = (byte, index, array) => {
  let text = byte :> .toString(16) :> try;
  text :> .padStart(2, "0") :> try
};

let hexFromBuffer = (buffer) => {
  let bytes = Uint8Array.new(buffer);
  arrayFrom(bytes) :> .map(hexByte) :> try :> .join("") :> try
};
```

Expected:

- `hexByte` infers as `((Number, Number, Js.Array<Number>)) => String`;
- no `byte: Number`, `array: Js.Object`, or `hexParts: Js.Object` annotation is required.

### JSON Literal Variables Can Settle Later

This may already exist in `tests/compiler_js_dynamic_test.ts`. Keep or update it.

Source:

```wm
from js.global import unsafe { Response };

let response = (body, status) => {
  Response.new(body, JSON{ status: status })
};

let ok = response("OK", 200);
```

Expected:

- no `status: Number` annotation is required;
- `ok` has the reflected `Response` type.

## Negative Tests

### Unresolved FFI Still Cannot Escape

Target file: `tests/compiler_js_reflection_test.ts`

Keep and strengthen tests that reject:

```wm
let f = (x) => {
  x.anything
};
```

Expected:

- diagnostic includes `unresolved JS FFI access is not a generic value`;
- no final type like `('a) => Result<'b, Js.Error>` is accepted.

### Handwritten Generic JS FFI Signatures Are Rejected

Target file: `tests/compiler_js_import_test.ts`

Source:

```wm
from js.global import unsafe {
  id: ('a) => 'a
};
```

Expected:

- reject with `FFI signatures must be explicit`;
- applies to safe and unsafe imports.

This protects the removal of `TVar` support from handwritten FFI signatures.

### Dynamic Callback Annotations Remain Rejected

Target file: `tests/compiler_js_dynamic_test.ts`

Keep the existing dynamic callback annotation rejection. It should still fail when the receiver is
only dynamic JSON/`Js.Object` and there is no reflected callback context.

## Medium Priority Tests

### Reflected Promise Callback Type

Target file: `tests/compiler_js_reflection_test.ts`

Check that:

```wm
req :> .json() :> try :> .then((body) => { ... })
```

gives `body: Js.Value` or the currently reflected JSON value type, while:

```wm
req :> .text() :> try :> .then((text) => { ... })
```

gives `text: String`.

This should use hover or a body expression that only typechecks for the expected type.

### Derived Handler Argument Flow Across Function Calls

Target file: `tests/compiler_js_reflection_test.ts`

Reduced webhook shape:

```wm
let handleMock = (req) => {
  req :> .json() :> try
};

let handle = (req, info) => {
  handleMock(req)
};

let server = serve(JSON{}, handle);
```

Expected:

- `handleMock` receives `Request` from downstream `serve(..., handle)`;
- this protects the path where the receiver is constrained through another local function call, not
  directly by annotation.

## Lower Priority / Future Tests

These are useful but should wait until the relevant design work is done:

- root global reflection for `fetch` and `setTimeout` without manual signatures;
- WebCrypto `importKey` overload selection with algorithm dictionaries;
- keyword member syntax for `Array.from(...)`;
- optional JS argument ergonomics so `Some(16)` is not required where TS has `radix?: number`;
- replacing local `try` with a basis `Result` helper;
- async/promise control-flow semantics beyond nested `.then(...)`.

## Suggested Order

1. Add the small positive tests for placeholder solving, monomorphic FFI bindings, and LSP hover.
2. Add the negative tests for unresolved FFI escape and generic handwritten FFI signatures.
3. Update existing stale expectations around webhook annotations.
4. Add the broad `examples/webhook.wm` check.
5. Only after those pass, consider running and repairing the full test suite.
