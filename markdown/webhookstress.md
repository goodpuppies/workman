# Webhook Stress Test

This document records the stress points found while trying to port
`examples/webhook.ts` to `examples/webhook.wm`.

The goal is not to make a byte-for-byte translation. The useful test is:

```txt
Could a developer port a realistic Deno webhook example to wm-mini without writing a large
manual binding layer?
```

The current answer is: not yet, but the attempt produced clear, useful compiler/FFI work items.

## Source Scenario

The TypeScript example exercises:

- Deno HTTP serving with `Deno.serve`.
- `Request`/`Response`/`URL` web platform objects.
- `Request.text()` and `Request.json()` promise-returning methods.
- `Headers.get`, which maps nullish JS values to `Option<String>`.
- Web Crypto HMAC signing through `crypto.subtle.importKey` and `crypto.subtle.sign`.
- `TextEncoder`, `Uint8Array`, `Array.from`, `map`, `join`, and number/string methods.
- Untyped JSON payload parsing and nested property reads.
- Fire-and-forget `fetch(...).catch(...)`.
- `AbortController` and server shutdown.

That makes it a good compact test for the JS interop direction.

## Current Port Shape

`examples/webhook.wm` currently uses:

```wm
from js.global import unsafe { AbortController, Response, TextEncoder, Uint8Array };
from js.global("Array") import unsafe { from as arrayFrom };
from js.global("crypto.subtle") import unsafe { importKey, sign } as subtle;
from js.global("Deno") import unsafe { serve };
```

Some imports still need manual wrappers:

```wm
from js.global import unsafe {
  fetch: (String, Js.Value) => Js.Object,
  setTimeout: ((Void) => Void, Number) => Js.Value,
};
```

That is useful signal: root global reflection is not yet good enough for common callable browser/Deno
globals like `fetch` and `setTimeout`.

The current port also defines a local escape hatch:

```wm
let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("JS FFI call failed") },
  }
};
```

This is intentionally not a final ergonomics design. It is a stress-test tool: unwrap safe FFI
results aggressively so the port can keep moving and expose the next compiler boundary.

## Current Required Hacks and Annotations

This section tracks each distinct workaround currently present in `examples/webhook.wm`. The goal is
to drive this list toward zero.

### Manual Root Global Wrappers

Current code:

```wm
from js.global import unsafe {
  fetch: (String, Js.Value) => Js.Object,
  setTimeout: ((Void) => Void, Number) => Js.Value,
};
```

Why it is needed:

Root global reflection does not yet reliably discover common web/Deno globals like `fetch` and
`setTimeout` from the active TypeScript host.

What should remove it:

```wm
from js.global import { fetch, setTimeout };
```

should reflect the available overloads directly. This may require better global lib discovery and
root namespace enumeration.

### Manual WebCrypto `importKey` Wrapper

Current code:

```wm
from js.global("crypto.subtle") import unsafe {
  importKey: (String, Js.Value, Js.Value, Bool, Js.Value) => Js.Object,
  sign,
} as subtle;
```

Why it is needed:

Reflection selected or mapped a narrower `importKey` shape where the algorithm parameter looked like
`String`. The real WebCrypto example needs an algorithm object:

```wm
JSON{ name: "HMAC", hash: "SHA-256" }
```

What should remove it:

The TS reflection layer should handle DOM/WebCrypto union and dictionary types well enough to accept
the object algorithm argument without a manual wrapper.

### Unsafe Imports

Current code uses `unsafe` on most JS imports:

```wm
from js.global("Deno") import unsafe { serve };
from js.global("JSON") import unsafe { ... } as JSON;
from js.global("console") import unsafe { error, log };
```

Why it is needed:

Safe FFI wraps throw-capable JS calls in `Result<_, Js.Error>`. The explicit `Result` path is the
right shape; the remaining problem was that raw JavaScript throws needed a Workman-side error shape.

What should remove it:

Normalize caught JS throws into a small matchable `Js.Error` basis value. Unsafe imports can remain
as an escape hatch, but the normal path should preserve a useful failure category without forcing
every handler to discard it.

### Local Panic Unwrap Helper

Current code:

```wm
let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("JS FFI call failed") },
  }
};
```

Why it is needed:

Dynamic property reads and receiver calls are correctly fallible. The local helper discards the
normalized `Js.Error`, which makes the stress port easy to move but loses the useful failure
payload.

What should remove it:

Ordinary matching on `Js.Error(message)` and `Js.Unknown`, plus domain-specific `Result.mapErr` /
`Task.mapErr` use where the caller wants a local error type. The compiler should not silently unwrap
or stringify JS failures.

### `Request` Annotation on `handleRequest`

Current code:

```wm
let handleRequest = (req: Request, info: Js.Object) => { ... };
```

Why it is needed:

`req` is a foreign web-platform object, and the body uses reflected properties such as `req.method`,
`req.url`, `req.headers.get(...)`, and `req.text()`.

What should remove it:

Whole-graph HM plus delayed FFI solving should infer the handler argument type from:

```wm
serve(..., handleRequest)
```

Then the TS resolver can solve `req.method` from the inferred `Request` type.

### `info: Js.Object` Handler Annotation

Current code:

```wm
let handleRequest = (req: Request, info: Js.Object) => { ... };
```

Why it is needed:

The handler receives a second Deno info object, but this example does not inspect it. `Js.Object`
keeps the parameter JS-compatible without importing a precise type.

What should remove it:

Reflected `Deno.serve` callback parameter refs should provide the precise second parameter type when
the handler is passed to `serve`.

### Dynamic Promise Result Annotations

Current code:

```wm
let keyPromise: Js.Object = subtle.importKey(...);
let bodyPromise: Js.Object = try(req.json());
let textPromise: Js.Object = try(req.text());
let requestPromise: Js.Object = fetch(...);
let responsePromise: Js.Object = try(res.json());
```

Why it is needed:

Promise-returning JS calls frequently degrade to `Js.Object`, and the current FFI layer does not
preserve enough `Promise<T>`-like information for `.then(...)` callbacks.

What should remove it:

A reflected `Promise<T>` story or enough side metadata to preserve callback parameter refs through
promise methods without making `Promise` a full HM effect system.

### Promise Callback Parameter Annotations

Current code:

```wm
try(bodyPromise.then((body: Js.Object) => { ... }))
try(textPromise.then((bodyText: String) => { ... }))
try(requestPromise.then((res: Js.Object) => { ... }))
try(responsePromise.then((responseBody: Js.Object) => { ... }))
```

Why it is needed:

Once a promise is only known as `Js.Object`, `.then` callback parameters have no precise TS context.
The callback payload otherwise becomes an unconstrained type variable, and JS property access such
as `body.content` cannot resolve.

What should remove it:

Preserving promise result refs through `req.text()`, `req.json()`, `fetch(...)`, `Response.json()`,
and dynamic `.then(...)`.

### Collection/Buffer Annotations

Current code:

```wm
let array: Js.Object = arrayFrom(bytes);
let hexParts: Js.Object = try(array.map(hexByte));
```

Why it is needed:

`Array.from` and `array.map(...)` currently lose precise collection element/result refs. The port
falls back to treating the values as dynamic JS objects.

What should remove it:

Better preservation of reflected result refs through collection constructors and prototype methods,
especially `Array.from`, `Array.prototype.map`, and `Array.prototype.join`.

### `byte: Number` Callback Annotation

Current code:

```wm
let hexByte = (byte: Number, index, array) => {
  try(byte.toString(Some(16)))
};
```

Why it is needed:

`Array.map` does not yet provide enough callback context for the compiler to infer the element type
of the `Uint8Array`-derived array.

What should remove it:

TypeScript callback parameter refs from `Array.from(new Uint8Array(buffer)).map(...)` should flow
into the Workman callback.

### `Some(16)` for Optional JS Arguments

Current code:

```wm
byte.toString(Some(16))
```

Why it is needed:

TS optional parameters currently map to `Option<T>`, so `radix?: number` becomes
`Option<Number>`.

What should remove it:

Optional-argument elaboration should accept a supplied plain `Number` where TS has an optional
`number`, while still allowing explicit `None`/`Some(...)` where that is useful.

### Dynamic JSON Payload Annotation

Current code:

```wm
let handlePushPayload = (req, payload: Js.Object) => { ... };
```

Why it is needed:

`JSON.parse` returns dynamic JSON data. The port uses property reads such as
`payload.repository.full_name`, `payload.pusher.name`, and `payload.commits`.

What should remove it:

Either reflected JSON helpers or a small basis API such as:

```txt
Json.getString(payload, ["repository", "full_name"], "Unknown Repo")
```

This should not become general structural record typing in HM.

### `status: Number` Annotation

Current code:

```wm
let response = (body, status: Number) => {
  Response.new(body, JSON{ status: status })
};
```

Why it is needed:

Variables inside `JSON{}` literals can be pushed toward `Js.Value` before later primitive
constraints settle.

What should remove it:

JSON literal compatibility should allow unconstrained variables to remain primitive-compatible until
ordinary HM constraints decide whether they are `Number`, `String`, `Bool`, or `Void`.

### Semantic Async/Crypto Shortcut

Current code:

```wm
let verifyGithubSignature = (signature, bodyText) => {
  ...
  keyPromise.then((key) => { ... });
  true
};
```

Why it is needed:

The port does not yet have ergonomic promise-returning control flow. The function starts async
verification work but returns `true` before the promise chain settles.

What should remove it:

A real promise/async FFI story. This is the largest semantic compromise in the file and the main
reason the current example should be treated as a stress fixture rather than a correct webhook
implementation.

## Stress Points Found

### 1. Async/Promise Ergonomics

wm-mini has no `async`/`await` surface syntax. The generated JS runtime can await `main`, and JS
promises can be used through reflected `.then(...)` and `.catch(...)`, but the port becomes deeply
nested:

```wm
req.text().then((bodyText) => {
  verifyGithubSignature(signature, bodyText).then((authorized) => {
    ...
  })
})
```

This is semantically acceptable for now because promises are just foreign JS objects. Ergonomically,
real webhook/server code wants one of:

- promise combinator helpers in the basis,
- a small `Promise<T>` foreign type story,
- or eventual async syntax that elaborates outside the SML core.

Any async syntax should be an FFI/effect elaboration, not an HM feature.

### 2. Root Global Reflection

These did not reflect cleanly from `from js.global import unsafe { ... }`:

- `fetch`
- `setTimeout`

Manual type wrappers were required. This cuts against the “Zig cinterop style” goal. The likely
issue is that root global namespace enumeration does not expose every callable global in the current
reflection host, especially DOM/web globals.

Desired behavior:

```wm
from js.global import { fetch, setTimeout };
```

should discover overloads from the active TypeScript lib/Deno global declarations.

### 3. Reserved JS Member Names

`Array.from(bytes)` initially failed to parse because `from` is a Workman keyword.

This is a syntax/grammar issue, not a type-system issue. A keyword should remain reserved in leading
syntax positions but be allowed after a dot as a JS/property member name.

Good target:

```wm
Array.from(bytes)
```

or:

```wm
from js.global("Array") import { from as arrayFrom };
```

The second form works around the issue, but the first form is what a JS developer expects.

COMMENT:
maybe we do something like?
let handleRequest = (req) => {
  req.text()
    :> Promise.flatMap((text) => verifyGithubSignature(sig, text))
    :> Promise.map((authorized) => { ... })
}
Result.andThen?

### 4. Fluent Call Chains

The grammar currently supports call postfixes, but not arbitrary member access on the result of a
call:

```wm
byte.toString(16).padStart(2, "0")
Array.from(bytes).map(hexByte).join("")
```

The port had to split these into intermediate bindings:

```wm
let bytes = Uint8Array.new(buffer);
let array = arrayFrom(bytes);
let hexParts = array.map(hexByte);
hexParts.join("")
```

This is workable but not JS-port-friendly. A future surface form should support member access on any
expression:

```txt
expr.member
expr.member(args)
```

and elaborate it to the same FFI receiver machinery we already use for named receivers.

COMMENT: we should use workmans pipe operator ":>" 

### 5. Fallible Dynamic Property Reads

Dynamic property/method reads return `Result<_, Js.Error>`, so a chained call like this is invalid:

```wm
let text = byte.toString(16);
text.padStart(2, "0")
```

because `text` is really:

```txt
Result<'a, Js.Error>
```

The explicit version is:

```wm
let text = match(byte.toString(16)) {
  Ok(value) => { value },
  Err(_) => { "" },
};
```

This is correct control flow. The weak part is the `Err(_)` branch: user code routes or replaces
the failure without looking at the normalized `Js.Error`.

Possible directions:

- match `Js.Error(message)` when the message is enough,
- match `Js.Unknown` for arbitrary thrown values that do not normalize cleanly,
- add more constructors later only if they carry meaning beyond the same `String` payload.

Continued-port finding: a tiny local `try` helper makes the file much easier to advance, but it
also makes failure semantics coarse:

```txt
any JS throw / failed dynamic access -> Panic("JS FFI call failed")
```

That is acceptable for a stress fixture. It suggests the basis eventually needs named helpers such
as:

```txt
Js.Error(message)
Js.Unknown
```

The compiler should not make `Js.Error` implicitly behave like `String`.

### 6. Primitive JS Methods on HM Strings

After unwrapping `byte.toString(16)`, the local value has ordinary HM type `String`. Then:

```wm
text.padStart(2, "0")
```

failed with:

```txt
type String has no field padStart
```

This is an important distinction:

- TypeScript-reflected callback parameters can carry TS refs.
- Ordinary HM `String` values do not currently carry a TS `string` ref.

For JS interop ergonomics, primitive Workman types may need JS receiver reflection at FFI syntax
sites:

```txt
String  <-> TS string receiver for JS property/method lookup
Number  <-> TS number receiver
Bool    <-> TS boolean receiver
```

This should still live in FFI elaboration, not in the HM core. HM should not gain structural
properties for strings.

### 7. JS Callback Return Compatibility

The port hit this error around `Array.map(hexByte)`:

```txt
type mismatch expected "(Js.Object, (('a, Number, Js.Value)) => Js.Value)",
got "(Js.Object, (('a, Number, Js.Value)) => String)"
```

The callback returns `String`, while TypeScript reflection expects a JS value. At a JS call boundary,
primitive Workman values are valid JS values. The compatibility adapter currently handles object-like
values better than primitive returns in callbacks.

Desired boundary rule:

```txt
String, Number, Bool, Void <: JS-boundary Js.Value
```

This is not general subtyping inside HM. It is argument/result adaptation only when passing a value
to a JS FFI call.

Status: partially addressed in the compiler. Primitive Workman values can now flow to
JS-boundary `Js.Value` positions, including nested callback returns. This moved the webhook port
past the `Array.map(hexByte)` blocker.

### 8. Promise Type Precision

Promise-returning methods like:

```wm
req.text()
req.json()
fetch(...).then(...)
crypto.subtle.sign(...)
```

currently tend to become `Js.Object`/`Js.Value` unless TS callback context is preserved well enough.

What we want:

```txt
Request.text : Request -> Promise<String>
Request.json : Request -> Promise<Js.Value>
fetch : (...) -> Promise<Response>
subtle.sign : (...) -> Promise<ArrayBuffer>
```

We do not necessarily need an HM-native `Promise<T>` yet, but FFI reflection needs to preserve enough
callback parameter refs so `.then((value) => ...)` gets useful contextual types.

Additional finding from the continued port: promise `.then` and `.catch` are currently reflected as
ordinary fallible JS receiver calls. That means:

```txt
promise.then(callback) : Result<Js.Object, Js.Error>
```

rather than a convenient promise-like result. This is correct under safe FFI, but it causes branch
type mismatches when one branch returns a raw `Response` and another returns a fallible `.then(...)`
result.

Example active blocker:

```txt
type mismatch "Result<Js.Object, Js.Error>" vs "Js.Object"
```

at the `handleMockDiscord` match:

```wm
match(req.json()) {
  Ok(bodyPromise) => {
    bodyPromise.then(...)
  },
  Err(_) => {
    response("Bad Request", 400)
  },
}
```

This is mainly an ergonomics/design problem. We need a clearer story for promise-returning handlers:

- use `unsafe` promise methods in quick ports,
- add `Promise` helpers that normalize the return shape,
- or make HTTP handlers explicitly return promise-compatible JS objects.

### 9. JSON Payload Access

The source uses dynamic JS JSON:

```ts
payload.repository?.full_name ?? "Unknown Repo"
payload.commits ?? []
payload.pusher?.name ?? "Someone"
commits.length
```

The Workman port currently uses dynamic property reads with `Result`:

```wm
let repoName = match(payload.repository.full_name) {
  Ok(value) => { value },
  Err(_) => { "Unknown Repo" },
};
```

That is accurate for untyped JS data, but noisy. This suggests a need for JSON-specific helpers:

```txt
Json.getString(payload, ["repository", "full_name"], "Unknown Repo")
Json.getArray(payload, ["commits"], JSON[])
Json.getNumber(payload, ["commits", "length"], 0)
```

Those helpers would be ordinary basis functions over `Js.Value`, not HM structural typing.

### 10. Web Crypto Hex Encoding

The TypeScript code:

```ts
Array.from(new Uint8Array(buffer))
  .map(b => b.toString(16).padStart(2, "0"))
  .join("")
```

is a concentrated stress case:

- constructor reflection: `Uint8Array.new(buffer)`
- static function: `Array.from`
- prototype call: `.map`
- callback parameter typing
- number method: `.toString(16)`
- string method: `.padStart(2, "0")`
- array method: `.join("")`

The port currently gets partway through this but is blocked by callback parameter/ref propagation
and primitive method ergonomics.

Current active failure:

```txt
cannot resolve JS FFI method toString for receiver type 'a
```

at:

```wm
let hexByte = (byte, index, array) => {
  try(byte.toString(16))
};
```

This indicates that `Array.map` is not giving the callback parameter enough contextual information
for the TS resolver to know that `byte` is a number-like JS value. Even if annotating `byte: Number`
moves this forward, the broader issue remains: callback parameters from reflected JS methods need
stable TS refs when TypeScript has them, and primitive HM types need receiver reflection at JS
method-access sites.

Status: partially addressed. Annotated primitive receivers now elaborate through the JS receiver
path:

```wm
let hexByte = (byte: Number, index, array) => {
  try(byte.toString(Some(16)))
};
```

This keeps `Number.toString` in the FFI layer instead of adding fields to the HM `Number` type.
The remaining ergonomic issue is optional arguments: TS `radix?: number` currently requires
`Some(16)` rather than accepting plain `16`.

For later testing, this chain should become a dedicated regression fixture.

### 11. Safe vs Unsafe FFI

The webhook example uses many `unsafe` imports, but `Result` itself is no longer the design problem.

That is useful for prototyping, but it shows the remaining `Js.Error` problem clearly:

- Safe FFI is semantically better.
- `Result<_, Js.Error>` preserves the throw boundary.
- `Js.Error` should give handlers a small normal Workman value to inspect.
- Unsafe FFI erases the explicit throw boundary.

The path forward is probably not “make everything unsafe.” It is a small normalized `Js.Error` ADT,
with unsafe imports reserved for code that deliberately opts out of the boundary.

Continued-port finding: even when imports are marked `unsafe`, receiver calls on reflected objects
may still be generated as safe/fallible calls if the receiver access goes through dynamic or
reflected receiver machinery. This is theoretically defensible, but it means “unsafe import” does
not currently mean “unsafe everything derived from this foreign value.”

Open design question:

```txt
Should unsafe-ness propagate through receiver calls derived from an unsafe imported value?
```

For quick JS ports, propagation would hide more failures. For rigorous safe interop, explicit
`Result` handling with matchable `Js.Error` values is better.

### 12. Optional Parameter Mapping

`TextEncoder.encode` is typed by TypeScript as accepting an optional string:

```txt
TextEncoder.encode(input?: string)
```

Reflection maps that to:

```txt
(Option<String>) => Result<Js.Object, Js.Error>
```

So the port had to write:

```wm
encoder.encode(Some(text))
```

That is accurate but less natural than the JS source:

```ts
encoder.encode(text)
```

This is similar to optional JS arguments elsewhere. For full ergonomics, overload elaboration should
probably accept both:

```txt
encode()             -- no JS argument
encode("text")       -- one JS string argument
encode(Some("text")) -- explicit option form, if desired
```

without making HM itself variadic or optional-argument-aware.

### 13. JSON Literal Variables

The port hit a mismatch in:

```wm
let response = (body, status) => {
  Response.new(body, JSON{ status: status })
};
```

Because `status` was unconstrained inside a `JSON{}` literal, JSON compatibility pushed it toward
`Js.Value`, while callers passed `Number`.

The workaround was:

```wm
let response = (body, status: Number) => {
  Response.new(body, JSON{ status: status })
};
```

This points to a JSON-literal inference issue. A variable used in `JSON{}` should be allowed to stay
at a primitive HM type when later constrained to `Number`, `String`, `Bool`, or `Void`, because those
are JSON/JS-compatible. The literal should enforce JS compatibility without prematurely forcing
unconstrained variables to exactly `Js.Value`.

### 14. Dynamic Methods on Annotated `Js.Object`

The port hit a gap on:

```wm
let sent: Js.Object = fetch(...);
sent.catch((err) => { ... })
```

Property reads on annotated `Js.Object` already worked, but method calls on annotated `Js.Object`
did not. This has now been partially addressed by generating dynamic receiver method calls for
annotated `Js.Object` receivers.

The result is still fallible:

```txt
sent.catch(callback) : Result<'a, Js.Error>
```

which feeds back into the broader safe-FFI ergonomics problem.

### 15. TS Ref Loss After Unwraps and Dynamic Boundaries

Several intermediate values now need explicit `Js.Object` annotations:

```wm
let keyPromise: Js.Object = subtle.importKey(...);
let array: Js.Object = arrayFrom(bytes);
let hexParts: Js.Object = try(array.map(hexByte));
let bodyPromise: Js.Object = try(req.json());
let textPromise: Js.Object = try(req.text());
let requestPromise: Js.Object = fetch(...);
let responsePromise: Js.Object = try(res.json());
```

This is progress compared with writing full manual bindings, but it shows where TS precision is
currently lost:

- after an unsafe manually typed import returns `Js.Object`,
- after `try` unwraps a fallible dynamic receiver call,
- after promise `.then(...)` returns an opaque object,
- after JSON parsing returns a dynamic object.

The long-term fix is not to make HM structurally typed. The FFI layer needs to carry foreign refs
through more generated operations where TypeScript can prove the result, especially promise and
collection methods.

### 16. Callback Arity and Tuple Semantics

Workman/SML function application is unary; multi-argument-looking calls are tuple calls. JS callback
APIs are different: `Array.prototype.map` invokes callbacks as `(value, index, array)`.

The stress port currently has to write the callback in a shape compatible with reflected JS:

```wm
let hexByte = (byte, index, array) => { ... };
```

This is fine if the compiler elaborates it as one Workman function taking a tuple payload. The
important part is that diagnostics and reflection should continue to respect the SML rule:

```txt
(byte, index, array) is one tuple argument in Workman/HM
```

Any JS callback adaptation must happen at the FFI boundary, not by changing core function
application semantics.

### 17. Semantic Gap in the Current Crypto Port

The current `verifyGithubSignature` shape is not semantically equivalent to the TypeScript source
yet. It starts Web Crypto promise chains but returns `true` from the outer function before those
promises settle.

That is a deliberate temporary compromise to keep exposing type/reflection issues. A real port needs
one of:

- explicit promise-returning handler types,
- promise combinators that preserve result types,
- or async surface syntax that elaborates outside the HM core.

Until then, the webhook file should be treated as a compiler stress fixture, not a correct webhook
implementation.

### 18. WebCrypto Overload Mapping

The TypeScript source uses WebCrypto algorithm objects:

```ts
crypto.subtle.importKey(
  "raw",
  secretBytes,
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
)
```

Reflection selected or mapped an overload that expected a string algorithm in the third position:

```txt
type mismatch expected "(String, Js.Value, String, Js.Value, Js.Value)",
got "(String, Js.Value, Js.Value, Bool, Js.Value)"
```

The stress port now uses a manual wrapper:

```wm
from js.global("crypto.subtle") import unsafe {
  importKey: (String, Js.Value, Js.Value, Bool, Js.Value) => Js.Object,
  sign,
} as subtle;
```

This confirms the underlying JS call works, but also marks a TS reflection gap:

- union/interface-heavy DOM algorithm types need better mapping,
- `Bool` should adapt cleanly to a JS-boundary parameter,
- overload selection should not prefer a narrower string-only shape when an object algorithm is
  supplied.

### 19. Manual Root Global Codegen

Manual root globals exposed a codegen bug:

```wm
from js.global import unsafe {
  fetch: (String, Js.Value) => Js.Object,
};
```

was emitted as:

```js
__wm_js_member(".fetch")
```

instead of:

```js
__wm_js_member("fetch")
```

Status: fixed, with regression coverage. This matters because manual wrappers are still needed for
some root globals until root global reflection is stronger.

## Things That Worked

- Type-only JS imports for `Request`.
- Reflected constructors such as `Response.new`, `TextEncoder.new`, `AbortController.new`.
- Reflected `Request` properties like `method`, `url`, and `headers.get`.
- JSON literals with nested JS objects and arrays.
- Deno server shape using `serve(init, handler)`.
- Event/callback ref distinctness work from the fs stream stress test appears relevant here too.
- Annotated primitive receiver methods such as `Number.toString`.
- Manual root-global wrappers after the root target codegen fix.
- The current webhook stress fixture runs end-to-end through the simulated request.

## Current Status

At the time this document was created, `examples/webhook.wm` did not typecheck because of JS
callback return compatibility:

```txt
expected callback result Js.Value, got String
```

This appears in the HMAC hex conversion path around array mapping.

After continuing the port, that specific blocker was fixed. The current blocker is now a safe-FFI
branch mismatch around promise `.then(...)`:

```txt
type mismatch "Result<Js.Object, Js.Error>" vs "Js.Object"
```

The compiler is correctly saying the `.then(...)` path is fallible while the fallback response path
is not. The unresolved design question is how promise-heavy code should preserve, inspect, or map
`Js.Error` values when a branch crosses the FFI boundary.

After adding the local `try` helper, that branch-shape issue was worked around for the stress port.
The current active blocker is now:

```txt
cannot resolve JS FFI method toString for receiver type 'a
```

around `hexByte` in the HMAC hex conversion path. This points at callback contextual typing and
primitive receiver reflection rather than general HM inference.

After adding annotated primitive receiver reflection and a few explicit `Js.Object`/`String`
callback annotations, the file now typechecks:

```txt
wm check examples/webhook.wm
ok
```

It also runs through the local simulation:

```txt
Server started on http://localhost:8080
Simulating incoming GitHub Webhook...
[Simulation] Server responded with: { received: true }
[Discord Mock] Received message:
 alice pushed commits to my-org/my-compiler
Shutting down server...
```

This is still a stress fixture, not a clean final example. It depends on:

- unsafe manual wrappers for `fetch`, `setTimeout`, and `crypto.subtle.importKey`,
- local `try` panic unwrapping,
- explicit `Js.Object` annotations after dynamic/promise boundaries,
- an async crypto verification shape that is not semantically equivalent to the TypeScript source.

## Suggested Work Queue

1. Add JS-boundary primitive-to-`Js.Value` compatibility for callback returns and nested function
   positions. Status: partially done.
2. Allow JS member access/calls on arbitrary expressions, not only dotted variable names.
3. Support keyword member names after dots and in JS import specs.
4. Improve root global reflection for DOM/Deno globals like `fetch` and `setTimeout`.
5. Add primitive receiver reflection for `String`, `Number`, and `Bool` at FFI access sites.
   Status: partially done for annotated primitive receivers.
6. Add `Result` basis helpers for common FFI chains.
7. Decide whether `Promise<T>` should be represented explicitly or remain an opaque reflected object
   with callback refs.
8. Add JSON access helpers for dynamic payloads.
9. Promote the Web Crypto hex encoding path into a regression test.
10. Revisit safe/unsafe import ergonomics after the `Result` helper story is better.
11. Decide whether unsafe imports should propagate unsafe behavior to derived receiver calls.
12. Improve optional parameter elaboration so `T` can be accepted where reflected TS currently asks
   for `Option<T>` when an argument is explicitly supplied.
13. Change JSON literal compatibility so unconstrained variables are not prematurely forced to
   exactly `Js.Value` when primitive constraints are still possible.
14. Add regression coverage for dynamic method calls on annotated `Js.Object`.
15. Preserve TS refs through common promise/collection methods where reflection can identify the
    result.
16. Add or document a basis-level `Result` panic unwrap helper for stress/prototyping code.
17. Keep JS callback adaptation explicit in the FFI layer so tuple/unary SML semantics stay intact.
18. Improve WebCrypto/DOM overload mapping for object algorithm parameters.
19. Keep regression coverage for manual root-global wrappers targeting `fetch`/`setTimeout`-style
    names without a leading dot.

## Design Boundary

None of these findings require changing HM into a JavaScript type system.

The clean boundary remains:

```txt
HM:
  ordinary Workman flow, functions, ADTs, records, modules, and value restriction

FFI elaboration:
  JS member syntax, overload resolution, primitive receiver reflection, Promise callback refs,
  JS-boundary compatibility

Runtime/codegen:
  actual JS calls, Result wrapping, option/nullish conversion, and value conversion
```

The webhook stress test is valuable precisely because it pressures that boundary without requiring
the SML core to become structurally typed or effect-polymorphic.
