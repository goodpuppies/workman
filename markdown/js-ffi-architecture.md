# JS FFI Architecture Notes

The JS FFI goal is an 80/20 split:

- common JS code should port with reflected types, receiver calls, callback parameter refs, and
  promise shapes handled automatically;
- genuinely dynamic or structurally unclear JS should require explicit Workman code, usually through
  a whole-value assertion such as `Json.assert` or a small user helper.

The compiler should not grow an ad hoc model of every awkward JS pattern. If a case cannot be solved
from real reflection metadata or ordinary HM constraints, prefer a clear escape hatch over a clever
partial inference rule.

## The FFI Is A Semantic Boundary

The purpose of the FFI is not to make Workman capable of expressing every programming model found
in a foreign library. It should translate foreign APIs into interfaces that remain natural in
Workman. Reflection automates the common cases, but the shape of the host language is not the target
shape of Workman itself.

This distinction matters when reflection rejects an API. Rejection is not by itself evidence that
the compiler needs foreign subtyping or another TypeScript concept. Adding direct support for each
host feature makes those features contagious: they affect syntax, inference, diagnostics, tooling,
and eventually the style of native Workman libraries. An FFI that continually absorbs its host's
programming model stops being a boundary.

For an API whose interaction model is fundamentally incompatible with Workman, the intended answer
is a small, type-checked TypeScript shim. The shim terminates the mismatch at the boundary and
exports the values and operations the Workman program actually needs in an FP-shaped form. This
encourages capability-oriented interfaces rather than mechanically reproducing a foreign object
model.

This division remains type-safe and explicit. TypeScript checks the interaction with the foreign
library, Workman checks the constrained interface used by the program, and the shim defines the
translation between them. Foreign values may remain nominal and opaque without becoming untyped:
their identities and the types of operations crossing the boundary are still checked, while their
representation and host-specific protocols remain outside Workman's type system.

The limitation is therefore architectural, not merely an unimplemented convenience. The cheapest
way to handle a genuinely incompatible API should be to adapt it outside Workman, not to expand
Workman until ordinary program code can impersonate TypeScript.

## Checks, Boundary Declarations, And Assertions Are Different

Do not group every authored type into one notion of "FFI explicitness". Workman has three different
mechanisms with different authority:

- an ordinary annotation checks the HM type inferred for a Workman expression;
- a manually typed JS import declares a trusted foreign boundary signature;
- `Json.assert` performs an explicit checked conversion from a genuinely dynamic value into an
  expected Workman shape.

An ordinary annotation is not input to FFI solving. It must not select an overload, manufacture a
`JsTypeRef`, refine `Js.Object`/`Js.Value`, or cause reflection to return a different type. This is
the normal HM rule: annotations verify inference rather than directing it. Code that only works
after annotating an FFI receiver is evidence that the compiler lost type/reflection information.

`Json.assert` is deliberately different because the operation itself asks for expected shape
evidence and checks the dynamic value. An ascription may provide that expected shape, but the
ascription has not become a general-purpose cast.

A manually typed import is also deliberately different. It is a declaration at the foreign
boundary, analogous to writing an external signature, and therefore may describe an operation that
reflection cannot expose. It remains safe by default: manual typing does not imply `unsafe`.

## Concrete Calls Belong To TypeScript

The declaration-level reflection of an overloaded or generic JavaScript function is only a seed.
It is not necessarily the type of a concrete Workman call. After HM has identified the argument
types—especially nominal foreign types with stored TS refs—the resolver should construct the actual
TypeScript call and ask TypeScript for its selected, instantiated signature.

For example, given a reflected argument whose exact TS identity is
`IterableIterator<WalkEntry>`, TypeScript can determine:

```ts
Array.from(iterator) // WalkEntry[]
```

The Workman boundary should therefore become:

```txt
IterableIterator -> Result<Js.Array<WalkEntry>, Js.Error>
```

No type-only import, handwritten `Array.from` signature, `Json.assert`, or shim is justified here.
The fact that `Array.from` is overloaded and generic is precisely why TypeScript should own the
call selection. A manual boundary is appropriate only if the concrete call remains ambiguous, the
selected TS type cannot be represented honestly, or reflection cannot see the relevant declaration.

Composed reflection sources must be hygienic, and concrete container results must retain refs for
nested foreign types. Keeping only the text `WalkEntry` while losing its module/call-derived TS
identity is not sufficient; later member access would incorrectly look for a global type of that
name.

## Opaque Types Are Not Reflection Recovery

`Js.Object` and `Js.Value` have semantic meaning: they represent values which are genuinely dynamic
at the Workman boundary. They are not fallback answers for a reflection query which found a static
TypeScript type that the mapper failed to understand.

Replacing an unsupported static type with an opaque type erases evidence. HM cannot reconstruct the
lost fields, tuple positions, nominal identity, or call signature; annotations are intentionally not
casts; and later receiver access or destructuring cannot make the original reflection result more
precise. The apparent recovery therefore tends to become a downstream deadlock with a less accurate
diagnostic.

When TypeScript provides a static type, reflection must either map that type honestly or leave the
FFI obligation unresolved with a diagnostic naming the unsupported shape. Use `Js.Object` or
`Js.Value` only when the declaration is itself dynamic (`any`, `unknown`, or an intentionally coarse
dynamic API), or when the programmer explicitly chooses a dynamic boundary. Such values remain
opaque until an assertion or another checked operation gives Workman usable evidence.

## Current File Layout

`src/ffi` is organized around three phases:

```txt
src/ffi/
  elab.ts              # pre-HM FFI elaboration entry point
  imports.ts           # JS import collection and generated import declarations
  shared.ts            # generated binding and overload-selection helpers
  type_expr.ts         # small TypeExpr constructors

  reflect/
    host.ts            # TypeScript reflection host/program setup
    types.ts           # reflection queries for globals, modules, refs, members, calls
    type_mapping.ts    # TypeScript type -> Workman TypeExpr mapping
    type_refs.ts       # JS reflection metadata shapes

  receiver/
    receiver.ts        # receiver refs and object access state
    rewrite_expr.ts    # pre-HM expression rewrite for reflected receivers
    rewrite_blocks.ts  # block/match rewrite helpers with local ref scopes
    rewrite_decl.ts    # declaration rewrite helper

  delayed/
    delayed.ts         # post-HM delayed receiver resolution entry point
    annotations.ts     # rejects callback annotations used as dynamic casts
    bindings.ts        # generated import insertion and foreign decl helpers
    materialize.ts     # turns delayed receiver access into generated FFI calls
    receiver_models.ts # built-in Js.Array/Js.Promise/foreign receiver models
    types.ts           # delayed resolver options
```

## Reflection Metadata

`JsTypeRef` is the compiler's handle on real TypeScript reflection information. It carries:

- the reflected source needed to ask TypeScript more questions later;
- an expression name for the reflected value;
- optionally, the Workman type we already mapped.

Refs are most valuable for coarse opaque values: DOM objects, responses, requests, crypto keys,
headers, promises, arrays, and imported nominal JS types. Primitive values do not need much ref
machinery because their receiver surfaces are small and can be modeled directly.

The current model deliberately does not propagate refs through arbitrary expressions. This does not
mean that the compiler has no TS refs, or even that no ref ever enters a local scope. It means that
there is no second, hidden type system which follows the runtime identity of every Workman value.

There are four legitimate uses of refs:

- **declaration refs** identify imported JS values, namespaces, constructors, and callable targets;
- **nominal type refs** map an HM foreign type identity back to the corresponding TS type;
- **operation-local refs** describe a reflected call's result, nested container elements, and
  contextually typed callback parameters;
- **reconstructed refs** model a receiver from an already inferred HM primitive, `Js.Array<T>`, or
  `Js.Promise<T>` type when the small built-in receiver model is sufficient.

The limited `valueRefs` map is glue for the first and third cases. It contains directly imported
values and the parameters of an inline callback while resolving the reflected call which introduces
them. Receiver lookup from this map only recognizes a variable. It is not general provenance
tracking through lets, function returns, pipes, matches, or arbitrary expressions.

Earlier versions did attempt that broader tracking. The elaboration carried `expressionRefs`,
`resultRefs`, `passThroughRefs`, and `namedCallbackRefs`; it recognized calls and pipes through
particular `Ok`-payload helpers, block-local lets, and matches which returned the bound `Ok` value.
That made the webhook port easier in the short term, but it was a large expression-shape-sensitive
mechanism duplicating facts HM should own. It was removed in favor of nominal foreign identities and
local reflection at explicit FFI operations.

The supported sources of JS reflection metadata are now narrower:

- imported JS values and namespaces before HM;
- type-only JS imports such as `Request`, `Response`, `URL`, or `AbortController`;
- values whose inferred HM type genuinely comes from an explicit dynamic boundary such as a
  manually declared `Js.Object` import or `Json.assert`;
- inline callback parameters while elaborating the reflected call that introduces them;
- delayed receiver resolution after HM constrains a receiver to a known foreign, array, promise, or
  primitive type.

Consequently, preserving an exact `Entry` ref inside the reflected result of `Array.from(iterator)`
is not a return to expression ref threading. The call records that TS proved an `Entry[]` result, HM
stores `Entry` as a nominal foreign identity inside `Js.Array<Entry>`, and the resolver recovers the
ref only at a later explicit member operation. Ordinary Workman functions may pass that HM type
around without carrying expression-side TS metadata.

Some pre-HM receiver-rewrite code still seeds `ObjectAccess` from parameter and let annotations.
That is legacy implementation behavior, not part of the intended model: annotations are checks and
must not create reflection evidence. Code which depends on that path should be migrated to delayed
post-HM resolution or an actual boundary declaration, then the annotation-derived path should be
removed.

If a constructor or JS call returns a coarse `Js.Object`, binding it with a foreign-type annotation
must not refine it. Use `Json.assert` when the value is intentionally dynamic data with a checkable
Workman shape. For a nominal host object, fix or manually declare the boundary, or use a typed shim.
The compiler should not keep hidden expression-side state—or treat an annotation as that hidden
state—to recover a type that HM itself has lost.

## Dynamic Receivers

Dynamic `Js.Object` receiver calls currently exist as an escape hatch for code like:

```wm
object :> .method(arg)
object :> .property
```

when no concrete reflected receiver is known. This solves a real ergonomic problem, but the current
model is risky because dynamic calls can manufacture fresh generic-looking result types. That is too
close to the old fake-cast problem: the compiler appears to know something precise even though it
only knows "some JS happened".

Refactor direction:

- keep reflected receiver calls precise when a real `JsTypeRef` exists;
- keep delayed receiver resolution when HM later constrains the receiver to a reflected/foreign
  type;
- stop giving arbitrary dynamic `Js.Object` members fresh precise type variables;
- use a coarse result such as `Result<Js.Value, Js.Error>` or `Result<Js.Object, Js.Error>` until
  the user performs an explicit assertion/check;
- for JSON, prefer one whole-shape assertion over gradual property digging.

## JS Error Values

`Js.Error` is the error channel for safe FFI calls. It is not the raw JavaScript thrown value. The
generated JS boundary catches arbitrary throws and normalizes them into a small Workman basis ADT
before constructing `Err`.

Initial shape:

```txt
Js.Error(String)
Js.Unknown
```

`Js.Error(message)` covers ordinary `Error` instances, thrown strings, and object-like thrown values
with a readable `message` property. `Js.Unknown` covers everything else, such as `throw null`,
`throw 3`, and message getters that themselves fail.

Workman code can match this value normally:

```wm
match(result) {
  Ok(value) => { value },
  Err(Js.Error(message)) => { Panic(message) },
  Err(Js.Unknown) => { Panic("unknown JS error") },
}
```

Do not make `Js.Error` implicitly coerce to `String`. That would make `Err(error)` look more useful
while hiding the boundary where arbitrary JavaScript throws are being collapsed into text. Domain
errors should still be produced explicitly with `Result.mapErr` or `Task.mapErr`.

## TypeScript Mapping Policy

`reflect/type_mapping.ts` should stay pragmatic:

- primitives map to Workman primitives;
- arrays and typed arrays map to `Js.Array<T>` when the element is reasonably knowable;
- promises map to `Js.Promise<T>`;
- nullish returns map to `Option<T>`;
- genuinely dynamic object-like results map to `Js.Object`;
- declared `unknown` and `any` map to `Js.Value`;
- unsupported static objects and unions remain unresolved rather than being recovered as opaque.

Unions are a permanent risk area. The mapper should support common DOM/JS cases, but it should not
try to encode TypeScript's full union logic in Workman. If a statically declared union cannot be
mapped honestly, reject it and require the user to provide an explicit dynamic boundary or a typed
shim. Do not silently collapse it to `Js.Value`.

Reflection diagnostics should preserve the distinction between absence and representation failure.
If TypeScript finds `iterator.next` but Workman cannot represent a signature such as a rest-union
call returning `IteratorResult<T, any>`, report that the member exists and show the unsupported TS
signature. If TypeScript selects a simple compatible type but Workman loses it during source
composition, call materialization, mapping, or nested-ref registration, that is a compiler bug—not
an unsupported API and not a request for user annotations.

## Promise And Array Models

`delayed/receiver_models.ts` currently has small built-in models for:

- `Js.Promise<T>.then`
- `Js.Promise<T>.catch`
- `Js.Array<T>.map`
- `Js.Array<T>.join`
- `Js.Array<T>.length`

Promise support is part of the 80% path for JS interop and should stay. Array support is useful for
ported JS examples, but it should remain a small common subset. Avoid growing this into a full JS
standard-library model inside the compiler.

## Refactor Candidates

Highest value:

1. Replace dynamic receiver fresh type variables with coarse dynamic results plus explicit
   assertions.
2. Keep moving policy decisions out of the recursive rewrite functions and into small modules with
   clear names.

Lower value:

- modeling more JS array/string/object methods by hand;
- expanding TypeScript union mapping beyond common DOM/web APIs;
- making JSON property-level checks part of the language;
- adding more special cases for callback annotations instead of improving reflection or requiring an
  explicit user assertion.
