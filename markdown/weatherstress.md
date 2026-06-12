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

`examples/weather.wm` was rewritten from scratch at behavioral parity with `examples/weather.ts`:
real `fetch` with `res.ok`/`res.status` handling, a single `WttrResponse` assertion at the fetch
boundary, a TTL file cache stored as `Js.Dict<CacheEntry>`, `--f`/`--refresh` flag parsing via
`filter`/`includes`/`startsWith`, location formatting with empty-part filtering, per-day rain
chance via `reduce` + `Math.max`, per-city error recovery, and `Promise.all` orchestration.

The rewrite dropped the workaround-era one-line helpers (`toNumber`/`numberText`/`paddedLeft`/
`paddedRight`/`tempForCurrent`/`highForDay`/…): unit selection is inline `if` expressions feeding
the typed `Number` import, flag partitioning is inline `filter` calls in `main`, and `getWeather`
asserts the wire shape once so `cityReport` receives `Js.Promise<WttrResponse>` directly. The
remaining helpers (`try`, `firstValue`, `pad3`, `getWeather`, `loadCache`, `saveCache`,
`formatDay`, `renderReport`, `cityReport`) each carry real structure.

Remaining explicitness (consistent with the 80/20 principle):

- hardcoded import types for `Promise.resolve`/`Promise.all`, `JSON.parse`/`JSON.stringify`,
  `Number`, and `Deno.args` (generic/overloaded or non-callable reflection targets);
- `Json.assert` shape targets (`WttrResponse`, `Js.Dict<CacheEntry>`, `Js.Array<String>`).

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
unresolved JS FFI obligation in flagsFromArgs: (Js.Array<String>) => ?ffi#13:filter
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
unresolved JS FFI obligation in fetchJson: (String) => Js.Promise<?ffi#2:json>
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

### Unresolved FFI Placeholders Must Not Become Ordinary Type Variables

While debugging typed array access, this expression exposed a severe type-system issue:

```wm
items :> .at(0) :> try
```

The partial type state showed:

```txt
items :> .at(0): Result<?ffi#...:at, Js.Error>
items :> .at(0) :> try: Option<'a>
```

Why it matters:

`try` expects a `Result<'a, 'b>` and a later `match` expected an `Option<_>`. The generic unifier was
allowed to set the unresolved FFI placeholder to `Option<'a>`. That made an unresolved JS member look
like a normal HM generic result. This is unsafe: a delayed FFI placeholder is an obligation to
resolve a JS member, not a unification variable that arbitrary Workman constraints may instantiate.

Current compiler change:

- ordinary `unify(?ffi, T)` no longer installs `T` as the placeholder instance;
- ordinary constraints are recorded as obligations on the placeholder;
- delayed reflection/materialization is the only path that can solve the placeholder;
- when materialization solves it, recorded hard obligations are checked against the reflected type;
- broad `Js.Object` JS-boundary compatibility is not recorded as a hard FFI result obligation.

This keeps the existing bounded phase model: partial inference, callback contextualization, a second
partial inference, one delayed FFI resolution pass, then final inference. There is no fixed-point
reflection loop.

Diagnostic lesson:

When delayed resolution fails on an unconstrained receiver, regular checking should prefer the
earlier top-level FFI leak diagnostic if one exists. Otherwise a lower-level message such as
`cannot resolve JS FFI method toString for receiver type 'a` can hide the more important fact that a
top-level binding escaped as something like:

```txt
hexByte: (('a, 'b, 'c)) => ?ffi#...:padStart
```

`type-debug` should still show the lower-level resolver failure and nearby expression types, because
that is useful while debugging the delayed pass.

### `Response.json()` Return Type Does Not Feed Promise Reflection Yet

After fixing the placeholder leak and adding typed `Js.Array<T>.at(Number) => Option<T>`, the weather
port now stops here:

```wm
res :> .json() :> try :> .then((body) => {
  let data: Js.Object = body :> Json.assert :> try;
  data
})
```

Current debug output:

```txt
cannot resolve JS FFI method then for receiver type ?ffi#...:json
```

Why it matters:

`res` is known as `Response`, but `Response.json()` is still an unresolved FFI placeholder at the
point where `.then(...)` is resolved. The delayed pass can solve some parent receiver calls when the
receiver has a reflected or already-known promise type, but this nested shape needs better propagation
from the reflected `json()` result into the following receiver call.

Current workaround:

`fetchJson` is currently stubbed with `promiseResolve("{}")`, so the weather port can continue
checking later code paths. This keeps the missing feature visible without adding a `Reflect`
workaround or broad type annotation in the weather port.

### Concrete Wttr Shapes Need JS-Style Record Field Names

The original weather port used broad fields such as:

```wm
nearest_area: Js.Array<Js.Object>
```

That made `firstObject(data.nearest_area)` produce only `Js.Object`, so `formatLocation(value)` had
to recover shape through dynamic property reads. That goes against the desired style: shape should be
asserted at the JSON boundary, then ordinary record access should carry it through the program.

Parser update made during this experiment:

Record and JSON object field syntax now accepts JavaScript-style property names such as
`FeelsLikeC`, `maxtempF`, and `windspeedKmph`. Shorthand record fields still use ordinary lowercase
identifiers, so uppercase JS property names must be written explicitly where they bind values.

Weather port update:

The wttr response now has concrete records for `WttrValue`, `NearestArea`, `CurrentCondition`,
`HourlyForecast`, `WeatherDay`, and `WttrResponse`. Array element access is done directly at typed
array call sites rather than through a pretend-polymorphic `firstObject` helper.

Related principle:

Opaque `Js.Object` should not expose typed array operations. `object :> .at(0)` is now rejected with
an error asking the developer to assert a `Js.Array<T>` shape first.

### Typed Array Methods Must Constrain Fresh Receivers

The weather helper:

```wm
let firstValue = (items, fallback) => {
  match(items :> .at(0) :> try) {
    Some(item) => { item.value },
    None => { fallback },
  }
};
```

initially showed this in the LSP:

```txt
items: Js.Array<WttrValue>
.at(0): ?ffi#...:at
try: (Result<?ffi#...:at, Js.Error>) => ?ffi#...:at
```

and without `try`:

```txt
items: 'a
.at(0): Result<?ffi#...:at, Js.Error>
```

Why it matters:

Inside an unannotated helper, `items` is unknown when `.at(0)` is first inferred. The array member
path only handled receivers already known to be `Js.Array<T>`, so it fell back to delayed FFI and
lost the intended element type. Built-in JS array methods should be able to constrain a fresh
receiver to `Js.Array<T>`, the same way numeric operators constrain fresh values to `Number`.

Current compiler change:

Known typed array methods (`at`, `join`, `map`, `reduce`) now constrain a fresh receiver to
`Js.Array<element>` during inference. `at(Number)` returns `Option<element>`, so `firstValue` now
infers as:

```txt
((Js.Array<WttrValue>, String)) => String
```

The eager dynamic-object receiver rewrite also leaves `.at` as a typed FFI call instead of lowering
it to broad `Js.Object -> Js.Value`, so `Js.Object.at(0)` can be rejected unless the value is first
asserted as a `Js.Array<T>`.

### Typed Array Callback Bodies Still Need Context Before Inference

After `.at` was fixed, the port hit two callback-context issues:

```wm
resolvedReports :> .map((report, index, array) => {
  log(report)
}) :> try
```

and:

```wm
day.hourly :> .reduce((best, slot, index, array) => {
  mathMax(best, toNumber(slot.chanceofrain))
}, 0) :> try
```

Why it matters:

The lambda body is inferred before the array method has supplied contextual parameter types.
`log(report)` pushes `report` toward `Js.Value`, then the later `map` context tries to make it
`String`. In the `reduce` case, `slot.chanceofrain` is read before `slot` is known to be
`HourlyForecast`, so the field access goes through the dynamic JS path instead of record access.

Current workaround in `weather.wm`:

- use Workman `print(report)` instead of JS `log(report)`;
- return a dummy `0` from `rainChance`.

What should remove it:

Array callback parameters need contextual typing before the callback body is inferred, at least for
the built-in typed JS array methods. This should be local to known typed array helpers, not an
unbounded reflection/fixed-point loop.

### Primitive JS Methods Should Also Constrain Fresh Receivers

The weather port had helpers like:

```wm
let numberText = (n) => {
  n :> .toString() :> try
};

let paddedRight = (text, width) => {
  text :> .padEnd(width, " ") :> try
};
```

Before the primitive receiver update, these escaped as unresolved FFI obligations:

```txt
numberText: (Number) => ?ffi#...:toString
paddedRight: ((String, Number)) => ?ffi#...:padEnd
```

Why it matters:

These are ordinary JavaScript primitive methods we want to treat as known Workman-side affordances,
not as reflection problems. If the receiver is fresh, the method name can constrain it locally:
`toString` and `toFixed` imply `Number`; `slice`, `padStart`, and `padEnd` imply `String`.

Current compiler change:

Known primitive methods now constrain fresh receivers during inference. This mirrors the typed array
method behavior and avoids delayed FFI obligations for common string/number formatting helpers.

### Record-Field Receivers Must Not Be Flattened Into Dynamic Paths

The port hit this error after `fetchJson` was stubbed:

```txt
type mismatch "Js.Value" vs "Option<NearestArea>"
```

The debug output showed unresolved paths like:

```txt
data.nearest_area :> .at(0) :> try: ?ffi#...:nearest_area.at
```

Why it matters:

`data.nearest_area` is a record-field projection with type `Js.Array<NearestArea>`. The receiver
rewrite was flattening `data.nearest_area :> .at(0)` into a dynamic receiver call on `data` with path
`nearest_area.at`. That bypassed record inference and made the result look like broad `Js.Value`,
which then conflicted with the expected `Option<NearestArea>`.

Current compiler change:

When a FFI call receiver is a dotted variable whose first path segment is a known record field, the
receiver rewrite now leaves it alone. Ordinary record-field inference can then type the receiver, and
the typed array method rule handles `.at`, `.map`, and `.join` normally.

## Resolution Round: Removing the Port Stubs

This round removed every `-- Missing feature` stub from `examples/weather.wm`. The fixes, in
compiler terms:

### Typed `Js.Array<T>.filter` / `.includes` and `String.startsWith`

`filter`, `includes` joined the typed array member model (`src/infer/expr.ts`), and
`startsWith`/`endsWith` joined the primitive string members. Both constrain fresh receivers, so
`flagsOf`/`citiesOf` infer as `(Js.Array<String>) => Js.Array<String>` without annotations. CLI
flag parsing and location-part filtering now match the TypeScript source.

### Eager Callback Parameter Context for Known Typed Methods

`FfiCall` inference now derives callback parameter types from the receiver before inferring a
lambda argument body: `map`/`filter`/`reduce` on `Js.Array<T>` supply
`(element, Number, Js.Array<element>)` (plus the accumulator for `reduce`, taken from the
already-inferred initial argument), and `then`/`catch` on `Js.Promise<T>` supply the element. This
fixed the `day.hourly :> .reduce(...)` case where `slot.chanceofrain` was read before `slot` was
known to be `HourlyForecast`. The reflected-annotation contextualization pass now skips these
members when the receiver type was inferred, so broad TS overloads no longer fight the eager
constraints.

### Chained Receiver Calls Through Solved Placeholders

The delayed pass resolves a receiver expression before reading its type, and reflected member
rewrites inside callback arguments now solve the original expression's FFI placeholder (the same
way materialization does). Together with nested-promise flattening in `prune`
(`Js.Promise<Js.Promise<X>>` is unobservable in JS), this made the natural `fetchJson` shape work
unannotated:

```wm
fetch(requestUrl) :> .then((res) => {
  let ok = res :> .ok :> try;
  if (!ok) {
    let status = res :> .status :> try;
    Panic("HTTP " ++ (status :> .toString() :> try) ++ " fetching " ++ requestUrl)
  } else {
    res :> .json() :> try
  }
}) :> try :> .then((body) => {
  let data: Js.Object = body :> Json.assert :> try;
  data
}) :> try
```

`fetchJson` infers as `(String) => Js.Promise<Js.Object>`.

### Local Promise Member Model Preserves Workman Element Types

The synthetic promise reflection path round-tripped element types through TypeScript, which cannot
represent Workman records or `Js.Dict`, so `.then`/`.catch` results collapsed to `Js.Value`. The
delayed pass now prefers the local `jsPromiseMember` model for those members (keeping reflected
callback param refs), so `loadCache` keeps `Js.Promise<Js.Dict<CacheEntry>>` through its
`.then`/`.catch` chain.

### `Js.Dict<T>` for Object-as-Dictionary

The TypeScript `Record<string, CacheEntry>` cache is modeled as the new basis type `Js.Dict<T>`
with two basis functions:

```txt
Dict.get: ((Js.Dict<'v>, String)) => Option<'v>
Dict.set: ((Js.Dict<'v>, String, 'v)) => Void
```

Missing keys (and inherited prototype properties) read as `None`. `Js.Dict` is accepted at
`Js.Value` JS-import parameters and inside JSON contexts, so `JSON.stringify(cache)` works. The
cache is asserted once at the boundary (`Js.Dict<CacheEntry>` with `CacheEntry.data: WttrResponse`)
and ordinary record access carries shape from there.

### Hover Keeps Resolved Types After a Failing Phase

LSP hover's fallback previously ran only the first partial inference, so any failure showed raw
`?ffi#…` placeholders. It now runs contextualization, the second partial inference, and delayed
resolution best-effort (for their placeholder-solving side effects) while keeping pre-rewrite
modules for position targeting. Receiver variables rebuilt by the eager rewrite also keep their
source nodes, so hovering `byte` in `byte :> .unknownJs(16)` answers `byte: 'a` instead of falling
back to the enclosing pipe expression.

### Broad `Js.Value` Parameters Must Not Collapse Caller Types

The first parity port annotated `saveCache`:

```wm
let saveCache = (cache: Js.Dict<CacheEntry>) => {
  writeTextFile(cacheFile, JSON.stringify(cache))
};
```

Without the annotation, the checker bound `cache` to opaque `Js.Value` at the `JSON.stringify`
call inside the helper, then reported the call site as
`type mismatch expected "Js.Value", got "Js.Dict<CacheEntry>"` — the error itself named the type
the compiler should have used. The annotation changing the outcome meant the constraint solver
was collapsing too eagerly: `Js.Value` is an opaque foreign unknown, not a type Workman values
should unify with.

Current compiler change:

When a Workman value flows into a broad `Js.Value` JS-import parameter and its type is still an
unbound variable, the variable is left monomorphic and pending instead of being bound to
`Js.Value`. Ordinary HM constraints from the program's call sites instantiate it with one
concrete shape, which is checked for JS representability when it happens (so
`save(Ok("x"))` still fails with `cannot pass "Result<String, 'a>" to JS FFI call`). The
`stringify` use inside `saveCache` is then typed `(Js.Dict<CacheEntry>) => String` at that call
site, and `saveCache` infers as `(Js.Dict<CacheEntry>) => Js.Promise<Void>` with no annotation;
adding the annotation is a no-op, as it should be.

Variance matters: this only applies where the Workman side supplies the value. Parameters of a
Workman callback passed *to* JS (for example `serve`'s handler `info` argument) are values the
JS side supplies, so they remain genuinely opaque `Js.Value`.

If no call site ever determines the type, the checker refuses to guess:

```txt
unsolved JS boundary type in save: ('a) => String; a broad Js.Value JS parameter leaves this
type undetermined and no call site determines it; annotate it with the concrete JS shape
```
