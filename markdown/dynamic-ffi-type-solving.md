# Dynamic FFI Type Solving

`wm-mini` wants JavaScript interop to feel native without turning the ML typechecker into a
JavaScript typechecker. The hard case is not direct JS calls. It is indirection through ordinary
functional code.

Example:

```wm
-- http.wm
from js.global import type { Request };

record Route = {
  method: String,
  path: String,
  handler: (Request) => Js.Object
};

let dispatch = (routes) => {
  (req, info) => {
    let method = match(req.method) {
      Ok(value) => { value },
      Err(_) => { "" },
    };
    ...
  }
};

-- server.wm
serve(dispatch(routes));
```

The compiler should ideally infer that `req` is a JavaScript `Request` without requiring
`req: Request` on the lambda parameter.

## Core Problem

TypeScript can answer local JS questions:

```txt
Given TS type Request, what is property method?
Given TS value Deno.serve, what overloads are available?
Given TS type ChildProcess, what is stdout.on("data", callback)?
```

Hindley-Milner can answer global Workman questions:

```txt
h comes from Route.handler
Route.handler has type Request -> Js.Object
h(req) therefore constrains req to Request
dispatch(routes) is passed to serve
imports and exports preserve these types across modules
```

Neither system should replace the other.

The issue with the current pre-HM FFI elaboration is order. When the pass first sees:

```wm
req.method
```

it may not yet know that `req : Request`. That fact can be discovered later by HM from ordinary
Workman constraints such as:

```wm
Some(h) => { h(req) }
```

If FFI elaboration happens too early, it must either:

- require a manual `req: Request` annotation, or
- fall back to dynamic property access, losing TypeScript precision.

## Separation Principle

The design should keep the authority boundary clear:

```txt
HM/module inference:
  owns Workman program flow, imports, exports, polymorphism, records, ADTs, and function types

TypeScript reflection:
  owns local facts about JavaScript values, overloads, constructors, properties, and callback shapes

FFI resolver:
  translates between HM foreign types and TypeScript refs at explicit JS interop operations
```

TypeScript should not understand the Workman program. HM should not understand JavaScript property
semantics.

## Foreign Types

Type-only JS imports should create nominal foreign types in HM:

```wm
from js.global import type { Request, Response };
```

This should not elaborate to aliases like:

```wm
type Request = Js.Object;
```

Instead, the compiler should create abstract nominal HM types:

```txt
foreign type Request
foreign type Response
```

and keep side metadata:

```txt
HM type Request  <->  TS ref Request
HM type Response <->  TS ref Response
```

In normal Workman typing, `Request` is not equal to `Js.Object`. At JS FFI boundaries, foreign
object types are representation-compatible with `Js.Object`.

This avoids general subtyping while still letting foreign values pass through JS calls.

## Proposed Pipeline

The useful loop is:

```txt
parse
  -> FFI discovery seed
  -> HM inference
  -> TS FFI resolution
  -> HM verification
  -> Core
```

More explicitly:

```txt
surface AST
  -> discover foreign types and reflected imports
  -> keep unresolved JS projections/calls as typed placeholders
  -> infer HM types across the module graph
  -> resolve unresolved FFI operations using inferred HM types and TS refs
  -> rerun/check HM with concrete resolved FFI operations
  -> lower to Core
```

This is `hm -> ts -> hm`, with a small discovery step before HM to seed the environment.

## Unresolved FFI Projections

When early elaboration cannot reflect a dotted JS property immediately, it should not eagerly choose
dynamic lookup. It should create an internal unresolved node:

```txt
FfiGet(receiver, ["method"])
```

Surface:

```wm
req.method
```

Early internal form:

```txt
FfiGet(req, "method")
```

First HM pass gives it placeholder types:

```txt
req : 'receiver
FfiGet(req, "method") : Result<'value, Js.Error>
```

However, `'value` should not be "just" an unconstrained fresh type. Creating an unresolved FFI
projection should also create an internal FFI constraint:

```txt
constraint:
  FfiGet {
    receiver: 'receiver,
    property: "method",
    value: 'value,
    wrapping: Result<_, Js.Error>
  }
```

The expression can appear to ordinary HM as:

```txt
Result<'value, Js.Error>
```

but the compiler must remember that `'value` is attached to an unresolved JavaScript property
obligation. That obligation must be solved before final codegen.

This prevents accidental over-generalization. A binding whose type contains a variable attached to
an unsolved FFI constraint is not truly principal yet; it still depends on resolving the foreign
operation.

Then ordinary Workman constraints may refine the receiver:

```txt
h : Request -> Js.Object
h(req)
therefore req : Request
```

After HM, the FFI resolver sees:

```txt
receiver type: Request
foreign metadata: Request -> TS Request
projection: method
```

It asks TypeScript:

```txt
Request.method : string
```

and rewrites the unresolved projection to an ordinary generated JS receiver import/call:

```txt
__ffi_Request_method(req) : Result<String, Js.Error>
```

The final HM verification pass checks that this concrete result type agrees with the surrounding
program.

## Unresolved FFI Calls

The same idea can extend to method calls:

```wm
stream.on("data", (chunk) => { ... })
```

Early internal form:

```txt
FfiCall(FfiGet(stream, "on"), ["data", callback])
```

After HM identifies `stream` as a foreign type with a TS ref, the FFI resolver can ask TypeScript
for the selected method overload and callback parameter types.

This is important because JavaScript APIs commonly encode meaning in:

- prototype methods
- string-literal event names
- overloaded functions
- callbacks with contextual parameter types
- optional arguments

## Direct Reflection Still Works

When TS context is syntactically local, the compiler can still resolve immediately:

```wm
serve((req, info) => {
  req.url
})
```

Here `serve` reflection directly provides callback parameter refs. The delayed mechanism is for
cases where ordinary Workman indirection hides the context until HM connects the program.

## Dynamic Fallback

Dynamic lookup can still exist, but it should be a fallback, not the main path:

```wm
let getSomething = (x: Js.Object) => {
  x.someProperty
};
```

If the receiver type is only `Js.Object` and has no TS ref, then:

```txt
x.someProperty : Result<'a, Js.Error>
```

That is useful for quick interop, but precise reflected types should win whenever the receiver is a
foreign nominal type.

## Cross-Module Story

HM should own cross-module flow.

For:

```wm
-- http.wm
let dispatch = (routes) => { ... };

-- server.wm
serve(dispatch(routes));
```

The module graph and HM inference should determine the Workman type of `dispatch` and how it is
used. The FFI resolver should not need to analyze module imports itself beyond reading HM results
and foreign metadata.

The bridge data needed across modules is:

```txt
type id Request has TS ref Request
value/type inference results for exported bindings
unresolved FFI operations and their source nodes
```

The TS reflection query remains local:

```txt
Given TS Request, resolve property method.
```

It is not:

```txt
Ask TypeScript to understand dispatch(routes).
```

## Whole-Program First HM Pass

The first HM pass should be global over the loaded module graph, not a file-local precheck. That is
what makes downstream-only constraints usable without making TypeScript understand Workman modules.

For example:

```wm
-- http.wm
let dispatch = (routes) => {
  (req, info) => {
    req.method
  }
};

-- server.wm
serve(dispatch(routes));
```

If `http.wm` is considered alone, there may be no local reason to know that `req : Request`.
However, a whole-program HM pass can see the importing module and infer the instantiated use:

```txt
Deno.serve expects a handler
dispatch(routes) is passed to Deno.serve
therefore this instantiation of dispatch(routes) is a handler
therefore the returned function receives Request
```

After that first global HM pass, the TypeScript resolver's view is effectively already
module-flattened in the only way it needs:

```txt
unresolved projection: req.method
HM-inferred receiver type at this program use: Request
foreign metadata for Request: TS ref Request
```

Then TS reflection can stay local:

```txt
Given TS Request, resolve method.
```

The TS pass does not need to follow imports, evaluate `dispatch(routes)`, or understand the Workman
module graph. HM has already done that global work.

So the intended architecture is:

```txt
HM(global module graph, with unresolved FFI placeholders)
  -> TS(local reflection using HM's global solution)
  -> HM(global verification after FFI rewrite)
```

This is different from the current pipeline:

```txt
TS(local early rewrite)
  -> HM(global)
```

The current order forces TS reflection to guess before HM has connected the program. The proposed
order lets HM first establish where foreign types flow, then lets TS answer only the local
JavaScript questions attached to those inferred foreign types.

## Boundary Representation Compatibility

The FFI should avoid requiring explicit wrapper code when a Workman value and a JavaScript value
have the same simple runtime shape. This is an FFI boundary rule, not an HM rule.

For example, if a JavaScript function expects a plain options object, a Workman record with matching
fields should be able to cross the JS boundary without the programmer writing a manual
record-to-object conversion:

```wm
record SpawnOptions = {
  stdio: Js.Value,
  env: Js.Value
};

let opts = SpawnOptions {
  stdio = JSON["ignore", "pipe", "inherit"],
  env = JSON{ "USER_AGENT": "Workman-FFI" }
};

spawn("curl", args, opts)
```

At the JS boundary, `opts` can be passed as a plain JS object:

```js
{ stdio: ..., env: ... }
```

Likewise, fixed Workman tuples may be useful for JS APIs that expect tuple-like values, small arrays,
or argument-list-shaped data. The important distinction is:

```txt
Inside HM:
  records are Workman records
  tuples are Workman tuples
  neither becomes a JS object/array type by subtyping

At JS FFI boundaries:
  records may adapt to plain JS objects when field shapes are compatible
  tuples may adapt to JS tuple-like arrays or argument lists when the target shape is known
```

This keeps the SML model intact while reducing interop noise. The user should not need to write
`recordToObject` or `tupleToArray` every time the shapes already match.

The end goal is to avoid a split programming style where ordinary Workman data looks structurally
identical to JavaScript data, but still cannot cross the boundary without forcing the programmer into
a separate "JS-style Workman" layer. If a record-shaped Workman value and a plain JS options object
have the same practical shape, interop should feel like passing the value, not like switching into a
different mini-language of wrapper objects and conversion helpers.

That split can be forced in several different ways:

- ergonomics: ordinary code becomes a pile of `toJsObject`, `fromJsArray`, and adapter calls;
- representability: a natural Workman value cannot express the shape a JS API expects;
- annotation pressure: the program works only after extreme manual type annotations;
- workaround pressure: code becomes verbose or obscure just to satisfy the FFI layer;
- surprising incompatibility: `thing_wm` and `thing_js` look identical but are not actually usable
  in the same place;
- performance: identical-looking shapes still require allocation-heavy conversion at every
  boundary.

This is an ergonomics goal, not an immediate runtime-layout commitment. The compiler can preserve
ML semantics first and decide later which representations are safe and cheap enough to pass through
directly.

The reverse direction should be more conservative:

```txt
Workman record -> JS object:
  lightweight outgoing conversion/adaptation

JS object -> Workman record:
  reflected construction or explicit fallible decode/check

Workman tuple -> JS tuple-like array:
  boundary adaptation when the target expects that shape

JS array -> Workman tuple:
  explicit fallible arity/type decode
```

Typed arrays should remain foreign JS objects, not Workman tuples. A `Uint8Array` is mutable indexed
JS memory; an SML tuple is a fixed product value. Converting between them should be an explicit
helper or reflected API operation, not an implicit type equivalence.

This also has a performance motivation. If the generated JavaScript representation for a Workman
record or tuple is already compatible with the target JS shape, the boundary should be able to pass
it through or adapt it cheaply. The compiler should still treat that as representation
compatibility, not semantic identity. The invariant is:

```txt
same runtime shape may allow cheap FFI passing
same runtime shape does not imply same Workman type meaning
```

## Soundness Boundaries

This is an FFI extension to the ML core, not a new general type-system feature.

Rules:

- Foreign types are nominal HM types.
- Foreign types are not equal to `Js.Object` in ordinary Workman code.
- Foreign types are representation-compatible with JS imports and JS-generated receiver calls.
- Workman records and tuples may be representation-compatible with JS object/tuple-like shapes only
  at JS FFI boundaries.
- JS property access is not an HM rule; it is an unresolved FFI operation resolved outside HM.
- Type annotations and future `expr as Type` assertions are compile-time-only HM checks. They must
  not act as dynamic casts from unknown JS/JSON data to a Workman type.
- Final rewritten code must pass HM verification.

This keeps the ML implementation honest while allowing JavaScript interop to remain ergonomic.

## Dynamic JSON Shape Validation

Dynamic JSON values are different from reflected JavaScript API values. TypeScript can reflect the
shape of `Request.text()` or `Response.json()` callbacks, but a value returned by `JSON.parse` has no
schema unless the program supplies one.

Workman should not grow gradual per-property JSON typing as a language feature. Code like this is a
runtime claim, not a compile-time type fact:

```wm
let id: String = commit :> .id :> try;
let commits: Js.Object = payload :> .commits :> try;
```

Those annotations should not be treated as casts. If the receiver is only dynamic JSON, then a
program needs an explicit runtime validation step before it can enter ordinary typed Workman code.
The preferred direction is whole-shape validation:

```wm
record Commit = { id: String, message: String };
record Repository = { full_name: String };
record Pusher = { name: String };
record PushPayload = {
  repository: Repository,
  pusher: Pusher,
  commits: Js.Array<Commit>,
};

let payload: PushPayload = Json.assert(JSON.parse(bodyText)) :> try;
let commits = payload.commits;
```

That assertion makes `payload.repository`, `payload.pusher`, and `payload.commits` typed values.
It does not make later annotations on dynamic receiver results into casts; those should still be
rejected unless there is another explicit assertion at that boundary.

The exact implementation of `Json.assert` is future work. Since Workman is ML-shaped and does not
have magic generic type application, the validator may need to be generated, derived, or supplied as
an ordinary value-level function. The important rule is that it validates the whole expected shape at
the dynamic boundary. It should not encourage interleaving lots of `Json.expectString`-style
property checks through normal FP code.

## Implementation Checklist

- Add internal unresolved FFI expression nodes, likely `FfiGet` and later `FfiCall`.
- Preserve source spans on unresolved nodes for diagnostics and hover.
- In early FFI elaboration, produce unresolved nodes when receiver TS refs are not yet known.
- Extend first HM pass to type unresolved FFI operations with placeholder result types plus explicit
  unsolved FFI constraints.
- Record receiver expression type and result type for each unresolved operation.
- Prevent generalization from forgetting unsolved FFI constraints attached to type variables.
- Keep foreign type metadata keyed by HM type identity, not only by surface name.
- Add a post-HM FFI resolver that:
  - prunes receiver types
  - finds foreign TS refs
  - reflects property or method from TypeScript
  - generates concrete JS import variants
  - rewrites unresolved nodes to ordinary calls
- Run a final HM verification pass on the rewritten module graph.
- Keep dynamic `Js.Object` fallback available only when no foreign TS ref exists.
- Update LSP diagnostics/hover to point at unresolved projections and final resolved types.

## Open Questions

- Should unresolved FFI projection placeholders initially infer `Result<'a, Js.Error>` or a custom
  constraint that is only materialized after resolution?
- Should failed TS resolution be an error immediately, or should it fall back to dynamic lookup for
  `Js.Object`-compatible values?
- How should unsafe imports interact with delayed projections: should `unsafe` suppress `Result`
  wrapping for projections derived from that import context, or only for explicit imported members?
- Do we need explicit syntax for opting into dynamic lookup when a foreign TS type is known but the
  user intentionally wants arbitrary property access?
- How should module-level caching of TS reflection results be keyed to avoid slow repeated queries?
