# Weather Stress Test

This document records stress points found while porting `examples/weather.ts` to Workman.

The goal is not a one-to-one translation. The useful test is whether a developer could port a
realistic Deno weather CLI to `wm-mini` in a natural Workman style, using FFI escape hatches only
where the current compiler or interop surface makes them necessary.

## Source Scenario

The TypeScript example exercises:

- `fetch` and response validation.
- `encodeURIComponent` path interpolation.
- JSON parsing and shape assertions for nested API data.
- Deno file IO for a TTL cache.
- Object-as-dictionary dynamic string keys.
- CLI args from `Deno.args`, including filtering flags from city names.
- Stringly numeric data converted through `Number`.
- `Date`, `toLocaleDateString`, and formatting option objects.
- JavaScript array operations: `filter`, `includes`, `push`, `map`, `reduce`, `concat`, and `join`.
- Promise orchestration with `Promise.all`.
- Per-city error recovery so one failed request does not reject the whole run.

## Current Port Shape

Work in progress. Update this section once `examples/weather.wm` settles.

## Stress Points

This section is intentionally appended to as issues are found during the port.

### Mixed-Case JSON Field Names Cannot Be Record Labels

First compile attempt failed while declaring the wttr.in response records:

```wm
record CurrentCondition = {
  FeelsLikeC: String,
};
```

Compiler output:

```txt
error[C:\Git\wm-mini\examples\weather.wm:30:2]: Expected "--", "//", "}", [ \t\r\n], or [a-z_] but "F" found.
```

Why it matters:

The source API uses keys such as `FeelsLikeC`, `FeelsLikeF`, `areaName`, `maxtempC`, `mintempF`, and
`current_condition`. A natural TypeScript port would model these as record/interface fields. Workman
currently only accepts lowercase-style record labels, so realistic JSON API shapes cannot always be
declared directly.

Current workaround:

Use `Js.Object` for affected nested values and read exact API keys through dynamic receiver access:

```wm
let text: String = cur :> .FeelsLikeC :> try :> Json.assert :> try;
```

What should remove it:

Either allow JS/JSON-facing record labels that match common TypeScript property names, including
mixed-case names, or provide first-class quoted record labels such as `{ "FeelsLikeC": String }`.

### Helper Parameters Need Explicit JS Receiver Types

After switching mixed-case JSON fields to dynamic helpers, the next compile failed on:

```wm
let firstValue = (items, fallback) => {
  let maybeItem = items :> .at(0) :> try;
  ...
};
```

Compiler output:

```txt
cannot resolve JS FFI method at for receiver type unknown
```

Why it matters:

The helper is called with `Js.Array<Js.Object>` values later, but the receiver-method solver does not
use those later call sites to solve the helper parameter before resolving `.at(0)`.

Tempting workaround:

Annotate helper parameters at the JS boundary, for example:

```wm
let firstValue = (items: Js.Array<Js.Object>, fallback: String) => { ... };
```

Task decision:

Do not use this workaround in `examples/weather.wm`. For this experiment, annotations should appear
only where they are explicit `Json.assert` shape targets. In Workman, an annotation is an ML-style
constraint, not a TypeScript-style developer hint, so scattering them through the port hides the
stress point.

What should remove it:

Delayed FFI solving should be able to keep receiver accesses pending until ordinary HM constraints
from call sites have identified the receiver type.

### `Js.Array<T>` Has No Indexed Access / `.at`

Even after annotating `items: Js.Array<Js.Object>`, this failed:

```wm
items :> .at(0) :> try
```

Compiler output:

```txt
cannot resolve JS FFI method at for receiver type unknown
```

Why it matters:

The source uses normal JavaScript array indexing (`data.nearest_area[0]`, `items?.[0]`). The current
documented array receiver surface includes `.map`, `.join`, and `.length`, but not bracket indexing
or `.at`.

Current state:

Do not use `Reflect` as the workaround. The port now leaves array indexing as an explicit dummy
helper:

```wm
let firstObject = (items) => {
  -- Missing feature: typed Js.Array<T>.at/index access.
  None
};
```

What should remove it:

Add typed support for `Js.Array<T>` index access, either through syntax (`xs[0]`) or reflected
methods such as `.at(0): Option<T>`.

### Root `fetch` Needed a Manual Type / Promise Annotation

The first `fetch` helper used a reflected root global import:

```wm
from js.global import unsafe { fetch };
let responsePromise = fetch(url);
responsePromise :> .then(...)
```

Compile failed at `.then`:

```txt
cannot resolve JS FFI method then for receiver type unknown
```

Why it matters:

The source script naturally relies on `fetch` returning a promise. Without a reflected return type,
the promise receiver cannot expose `.then`.

Tempting workaround:

Declare `fetch` manually and/or annotate the intermediate promise value:

```wm
from js.global import unsafe { fetch: (String) => Js.Object };
let responsePromise: Js.Object = fetch(url);
```

Task decision:

Do not use this workaround for the current port unless progress becomes impossible and the stress log
calls it out explicitly. The desired developer experience is for the reflected FFI and delayed solver
to discover enough promise shape without ordinary Workman annotations.

What should remove it:

Root global reflection should discover `fetch` and its promise return type reliably. Promise-heavy
ports should not need `Js.Object` annotations between every async step.

### Misleading Later Error After Recovered Import Diagnostic

Running:

```sh
deno task wm type-debug examples/weather.wm
```

showed that the apparent `.then` receiver failure was not the first problem. The new debug command
stops at:

```txt
phase: initial partial inference
diagnostics:
  error error: unknown JS import Deno.args @ 10:0
```

The environment at that point contains generated imports such as:

```txt
__ffi_fetch_fetch_0: (Js.Value) => Js.Promise<Response>
```

but none of the later weather helper bindings. If normal analysis continues past this recovered
diagnostic, delayed FFI resolution eventually reports:

```txt
cannot resolve JS FFI method then for receiver type unknown
```

Why it matters:

The later error points at `responsePromise.then`, but the useful root cause is earlier:
`from js.global("Deno") import unsafe { args, ... }` cannot reflect `Deno.args`. Because partial
inference recovered by recording a diagnostic and stopping early, downstream delayed FFI resolution
ran with an incomplete environment.

Current workaround:

Use the new debug command to inspect the first failing phase:

```sh
deno task wm type-debug examples/weather.wm
```

Follow-up fix made during this experiment:

Regular `check` now stops when partial inference produced an error diagnostic, before delayed FFI
resolution can report a secondary symptom. The normal checker now reports:

```txt
error[C:\Git\wm-mini\examples\weather.wm:10:0]: unknown JS import Deno.args
```

What should remove it:

`Deno.args` should be readable as a reflected property or through an ergonomic global/property import
form.

### Non-Callable JS Properties Are Not Importable Values

The `Deno.args` failure is distinct from `Deno.readTextFile` and `Deno.writeTextFile`.

Why the other Deno imports worked:

`readTextFile` and `writeTextFile` are functions. The current named JS import reflection path asks
TypeScript for call signatures and creates FFI bindings from those signatures.

Why `args` failed:

`Deno.args` is a property value, roughly `string[]`, not a callable member. The current
`js.global("Deno")` named import path treats imported members as callable members, so
`jsMemberTypeFromTsType` returns `undefined` when the member has no call signatures.

Current workaround:

Hardcode the property type in the import so the port can continue:

```wm
from js.global("Deno") import unsafe {
  args: Js.Array<String>,
  readTextFile,
  writeTextFile,
};
```

What should remove it:

Named JS imports should support non-callable value properties, not only functions. `Deno.args` should
reflect as `Js.Array<String>` without a manual type.

### `Reflect.get` Does Not Reflect as Optional

After hardcoding `Deno.args`, the next failure was:

```txt
error[C:\Git\wm-mini\examples\weather.wm:59:2]: type mismatch "Js.Value" vs "Option<'a>"
    match(getValue(items, "0")) {
```

Why it matters:

The port uses `Reflect.get` as a temporary replacement for JavaScript bracket access such as
`array[0]` and `cache[key]`. A natural Workman wrapper wants to treat missing values as `None`.
Reflected `Reflect.get` currently comes through as a plain `Js.Value`, so it cannot be matched as an
`Option`.

Rejected workaround:

Hardcoding `Reflect.get` can keep the port moving, but it obscures the actual missing language/FFI
surface. The port no longer imports `Reflect`.

What should remove it:

The language probably needs direct dynamic/indexed access helpers rather than relying on
`Reflect.get`. If `Reflect.get` stays as a workaround, there should be a clear story for whether
missing JS properties map to `None` or remain raw `undefined` inside `Js.Value`.

Follow-up:

Hardcoding `getValue` as `(Js.Value, String) => Option<Js.Value>` made `firstObject` infer as
`(Js.Value) => Option<Js.Object>`, but callers passed `Js.Array<Js.Object>`. This confirmed that the
`Reflect` path was both too generic and too ad hoc. The port now uses a dummy `firstObject` instead
and leaves array indexing as an explicit missing feature.

### Promise Combinators Reflect Too Broadly

The cached-city branch returned:

```wm
promiseResolve(renderReport(data, fahrenheit, unit) ++ "\n  (cached)")
```

while the fetch branch returned a promise whose callback resolves to `String`. The checker reported a
`Js.Value` vs `String` mismatch at the surrounding `if`.

Why it matters:

`Promise.resolve` and `Promise.all` are generic/overloaded TypeScript APIs. The current reflected
shape is too broad for this port, for example:

```txt
promiseResolve: (Js.Value) => Js.Promise<Js.Value>
```

That loses the fact that this CLI is building promises of report strings.

Current workaround:

Hardcode the string-specialized shapes used by this script:

```wm
from js.global("Promise") import unsafe {
  all as promiseAll: (Js.Array<Js.Promise<String>>) => Js.Promise<Js.Array<String>>,
  resolve as promiseResolve: (String) => Js.Promise<String>,
};
```

What should remove it:

Reflection for generic JS functions should preserve enough type relationship between arguments and
returns for common combinators such as `Promise.resolve` and `Promise.all`, or Workman needs a small
basis wrapper for promise combinators.

### `Js.Object` Is Not Accepted Where `Js.Value` Is Expected

The next failure was:

```txt
type mismatch expected "Js.Value", got "Js.Object"
```

at:

```wm
JSON.stringify(cache)
```

Why it matters:

For JavaScript interop, a `Js.Object` is also a JavaScript value. The current type compatibility path
does not let `Js.Object` flow into a `Js.Value` parameter, so broad APIs such as `JSON.stringify`
become awkward.

Current workaround:

Hardcode the JSON functions for the shapes used in this script:

```wm
from js.global("JSON") import unsafe {
  parse: (String) => Js.Object,
  stringify: (Js.Object) => String,
} as JSON;
```

What should remove it:

The FFI boundary should treat `Js.Object`, `Js.Array<T>`, and primitive Workman values as acceptable
inputs to `Js.Value` parameters where JavaScript can represent them directly.

### `Js.Array<T>.filter` / `includes` Are Missing

After JSON narrowing, the checker reached CLI flag parsing and reported:

```txt
top-level free type variable in flagsFromArgs: (Js.Array<String>) => ?ffi#13:filter
```

Why it matters:

The TypeScript script partitions `Deno.args` with:

```ts
const flags = Deno.args.filter((a) => a.startsWith("--"));
const cities = Deno.args.filter((a) => !a.startsWith("--"));
const fahrenheit = flags.includes("--f");
```

The current Workman `Js.Array<T>` receiver model does not include `filter` or `includes`, so the
receiver access stays unresolved.

Current workaround:

Temporarily simplify CLI parsing:

- treat all args as cities;
- default to `Oulu` if no args are supplied;
- set `fahrenheit = false` and `refresh = false`.

What should remove it:

Add typed `Js.Array<T>` receiver support for common non-mutating array methods such as `filter`,
`includes`, and probably `reduce`.

Follow-up fix made during this experiment:

The `reduce` case specifically was worse than just “method missing.” During callback
contextualization, the initial accumulator literal `0` was passed to TypeScript reflection as an
unknown argument. TypeScript therefore selected a broad overload where the accumulator parameter was
`Js.Value`, even though later LSP hovers could show `best: Number` in another pass.

The reflection hint layer now carries numeric literals as number arguments. That lets
`array.reduce((best, slot, index, array) => ..., 0)` contextualize `best` as `Number`.

### Returning `Response.json()` Directly Leaks an Unresolved FFI Type

After removing `filter`, the checker reported:

```txt
unresolved JS FFI type in fetchJson: (String) => Js.Promise<?ffi#2:json>
```

Why it matters:

The TypeScript helper returns `await res.json() as T`. The first Workman port returned the promise
from `res.json()` directly inside a `.then` callback. The reflected result element stayed as an
unresolved FFI receiver-call type.

Current workaround:

Add a nested `.then` and assert the JSON body to `Js.Object` at the boundary:

```wm
let bodyPromise = res :> .json() :> try;
bodyPromise :> .then((body) => {
  let data: Js.Object = body :> Json.assert :> try;
  data
}) :> try
```

What should remove it:

`Response.json()` should reflect to a usable `Js.Promise<Js.Value>` or similar, and explicit
`Json.assert` should be enough to solve the promise element without extra nesting.

### Helper Declaration Order Matters

After the `Reflect.get` workaround, the checker reported:

```txt
unknown name getString
```

at `firstValue`, because `firstValue` appeared before the helper it called.

Why it matters:

A TypeScript port can freely order function declarations. Workman `let` bindings are sequential
unless explicitly recursive, so helpers need to be ordered by dependency.

Current workaround:

Move `firstValue` after `getString`.

What should remove it:

Nothing necessarily needs to remove it. This is consistent with the ML-shaped language model, but it
is worth recording as a porting difference from TypeScript function declarations.

### Broad `fetch` Parameter Type Conflicts With Later String Use

The next checker error was:

```txt
type mismatch "String" vs "Js.Value"
```

at the error-message string:

```wm
Panic("HTTP " ++ jsString(status) ++ " fetching " ++ url)
```

Why it matters:

Reflected `fetch` currently appears as:

```txt
__ffi_fetch_fetch_0: (Js.Value) => Js.Promise<Response>
```

Passing `url` to `fetch(url)` pushes the parameter toward `Js.Value`. The same `url` is then used in
string concatenation, where Workman correctly needs `String`.

Current workaround:

Force a local string value before calling `fetch`:

```wm
let requestUrl = url ++ "";
let responsePromise = fetch(requestUrl);
```

What should remove it:

The FFI argument compatibility path should allow primitive `String` values to satisfy broad
JS-boundary `Js.Value` parameters without rewriting the source variable's ordinary Workman type to
`Js.Value`.

### Global JS Coercion Constructors Reflect Too Broadly

The next failure was:

```txt
type mismatch expected "Js.Value", got "String"
```

at:

```wm
jsNumber(text)
```

Why it matters:

The TypeScript type for global `Number` is intentionally broad, so reflection imports it as something
like:

```txt
Number: (Js.Value) => Number
```

The weather script uses `Number(...)` in the narrow and common JavaScript-port sense of coercing
stringly API fields into numbers. Passing a `String` to a reflected `Js.Value` parameter currently
does not work ergonomically.

Current workaround:

Hardcode the narrow coercion used by this port:

```wm
Number as jsNumber: (String) => Number
```

For numeric display strings, prefer number receiver methods such as `.toString()` rather than the
global `String(...)` constructor.

What should remove it:

Primitive Workman values should be accepted at `Js.Value` FFI parameters where the JS boundary can
represent them directly, without changing the Workman-side variable type to `Js.Value`.
