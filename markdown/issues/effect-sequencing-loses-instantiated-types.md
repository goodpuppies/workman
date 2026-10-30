# Effect sequencing loses instantiated types at the JS boundary

Status: implemented for representable nominal generic arguments; verified
2026-10-30 with the local Box fixtures and Effect 4.0.6. The investigation below
records the original failures.

## Implemented resolution

Foreign declarations now carry arity, and ordinary HM type arguments distinguish
`Box<Number>` from `Box<String>`. The nominal TS constructor ref is shared;
the resolver reconstructs a concrete TS instance from the inferred HM arguments
at an explicit operation. It does not track expression provenance or add a TS
subtyping/union solver to HM.

Namespace imports retain call refs for concrete specialization. Callback input
types are supplied before resolving an inline callback body; unknown callback
results remain delayed rather than being finalized as `Js.Value`. Literal call
arguments remain literals for TS overload selection. Concrete call compatibility
is checked before accepting an instantiated signature.

`scripts/probe_ffi_generic_identity.ts --assert-expected` now passes all six cases.
`tests/ffi_generic_identity_test.ts` covers import order, generic scalar/tuple
results and runtime adapters, type-only arity, incompatible arguments, literal
overloads, callback captures, safe imports, and module interfaces. The two raw
reflection controls remain covered.

`examples/effect-ts/effect_sequence.wm` runs with the original Effect namespace and prints
`42` and `hello` from a native tuple. The advanced server's concurrency, timeout,
race, and disconnect-cleanup behavior was also verified over localhost.

This is not a claim that arbitrary TS type arguments or all Effect APIs are
representable. TypeScript still owns concrete overload selection and type algebra;
unsupported static shapes must not be silently erased to make an example work.

Classification: the concrete-call precision loss is a general FFI implementation
gap under the documented design goals, not evidence that Effect's complete
TypeScript programming model must be supported. The implementation strategy for
preserving concrete foreign instantiations remains open.

## Follow-up: a shared nominal name can produce the wrong static type

The local fixture now lives at `tests/fixtures/ffi_generic_box.ts`. It also
exports monomorphic factories `numberBox(): Box<number>` and
`stringBox(): Box<string>`.

```wm
from js.module("./tests/fixtures/ffi_generic_box.ts") import unsafe {
  numberBox, stringBox
};
let boxed = numberBox();
let value = boxed :> .value;
```

Observed `value` type: **`Result<String, Js.Error>`**, although the numeric factory
returns `{ value: 42 }`. No call to `stringBox` is necessary.

| Import clause | Inferred numeric field type |
| --- | --- |
| `unsafe { numberBox }` | `Result<Number, Js.Error>` |
| `unsafe { numberBox, stringBox }` | `Result<String, Js.Error>` |
| `unsafe { stringBox, numberBox }` | `Result<Number, Js.Error>` |
| `unsafe * as Box` | `Result<String, Js.Error>` |

This is more than a loss of convenience or a conservative unsupported-type
rejection: an unused import changes an existing expression's inferred type.
It is independent of generic call inference, tuple syntax, and Effect.

### Where the identity is lost

An elaboration trace of the two named imports shows:

1. Each factory has its own correct `resultRef`, describing
   `ReturnType<typeof numberBox>` or `ReturnType<typeof stringBox>`.
2. Both mapped signatures return the same zero-argument `TName("Box")`.
3. `collectForeignTypeNames` in `src/ffi/elab.ts` stores an explicit ref using
   `foreignTypeRefs.set(type.name, typeRef)`. The second factory's ref replaces
   the first under the shared key `Box`.
4. The generated foreign declaration therefore points `Box` at the string
   factory's return ref. `foreignReceiver` in
   `src/ffi/delayed/receiver_models.ts` recovers that ref from the inferred nominal
   type when resolving either factory's fields.

Keeping the first ref instead would merely reverse which factory is mistyped.
The two instantiated types need distinct identities, or the boundary must reject
the unsupported distinction explicitly. A last-writer/first-writer policy is not
a sound fix.

### Local reflection itself can answer the required queries

`tests/ffi_generic_identity_test.ts` exercises the lower-level reflection API:

- Reflect `succeed(20)` and `succeed("hello")`, keep both exact result refs, then
  reflect `run` on each: the answers are correctly `Number` and `String`.
- Supply an inferred `(Number, String)` callback result hint to `map` on a numeric
  box, then reflect `run` on the result: the tuple survives, and the callback
  parameter ref is correctly `Number`.

Both control tests pass with the existing compiler. They establish that neither
the TypeScript checker nor fixed-tuple mapping inherently requires an Effect shim.
At discovery time, these controls did not establish that the compiler passed the
required evidence along; the compiler-level regressions now cover that path too.

Run the compiler-level reproduction separately:

```sh
deno test -A tests/ffi_generic_identity_test.ts
deno run -A scripts/probe_ffi_generic_identity.ts
deno run -A scripts/probe_ffi_generic_identity.ts --assert-expected
```

Before the fix, the probe reported four discrepancies across six cases. It now
reports zero. `--assert-expected` exits with status 1 if a discrepancy recurs.

### Original implementation split

First fix the monomorphic-factory collision: distinguish concrete instantiated
foreign identities in the HM/nominal-ref representation, including across ordinary
bindings and module interfaces. Identical TS instantiations must remain compatible;
different instantiations must not acquire each other's fields or callback types.
Do not identify an instantiation merely by its producer call: two factories may
return the same TS type.

Then address concrete generic call and callback specialization. The tuple callback
still has a separate early-materialization problem; fixing the nominal registry
alone is not evidence that callback hints reach the final query. Reuse the current
finite HM/TS stages and prove the Box cases before extending the Effect example.
No Effect-specific compiler model, arbitrary expression-ref tracking, or full TS
type-algebra implementation is warranted by these reproductions.

## Scope assessment against the FFI design

The governing writeups distinguish concrete reflection from reproducing TS:

- `ffi-principles.md`, rules 10 and 12: generics/overloads alone do not justify an
  escape hatch. Ask TS to instantiate a concrete call; losing a compatible result
  in the compiler pipeline is a bug.
- `ffi-principles.md`, rules 6 and 7: adapt incompatible programming models with a
  typed shim, and report unsupported static types rather than erasing them to
  `Js.Value`.
- `js-ffi-architecture.md`, "Concrete Calls Belong To TypeScript": declaration
  signatures are only seeds. Preserve exact nominal TS identities for subsequent
  local operations; `Array.from(iterator)` is the documented analogous case.
- `js-ffi-architecture.md`, "Reflection Metadata", and
  `dynamic-ffi-type-solving.md`, "TS Refs Are Boundary Evidence": do not restore
  the removed expression-side tracking through lets, pipes, matches, or helper
  shapes. The inferred HM foreign type must carry usable identity.
- `defer-global-ffi-materialization.md` already documents early call selection
  baking broad parameter types into HM before useful argument evidence arrives.
  It is relevant prior analysis, not proof that this reproduction has only one
  cause or that every proposed phase has been implemented.

For the examples here, success payloads are numbers, strings, and a fixed tuple;
errors and service requirements are both `never`. Those are concrete shapes,
not arbitrary error unions, mapped records, or conditional requirement subtraction.
The equivalent TS Effect program passed `deno check`, including an explicit check
that the composed type is `Effect<readonly [number, string], never, never>`.

This does **not** promise that all Effect APIs or a fully polymorphic carrier
library fit current WM. Unreduced TS unions/conditionals, arbitrary service-set
algebra, generator protocols, and foreign tagged unions becoming native WM ADTs
are separate boundary/representation questions. If TS resolves a concrete call to
a shape WM genuinely cannot represent, a precise unsupported-type diagnostic and
typed adapter are within scope. Implementing TS's type algebra inside HM, or
inventing hidden provenance to recover erased types, is outside the stated goals.

In particular, a foreign type being nominal/opaque is intentional. The bug is not
that its displayed name omits generic arguments; it is that later concrete calls
cannot recover the statically established payload type. This investigation does
not mandate exposing `Effect<A, E, R>` directly as a new HM type constructor.

## Control: the same failure without Effect or advanced TS

A local TS fixture with only ordinary rank-1 generics reproduces both the payload
erasure and the tuple-callback rejection:

```ts
export interface Box<A> { readonly value: A }
export function succeed<A>(value: A): Box<A> { return { value }; }
export function map<A, B>(self: Box<A>, f: (value: A) => B): Box<B> {
  return { value: f(self.value) };
}
export function flatMap<A, B>(self: Box<A>, f: (value: A) => Box<B>): Box<B> {
  return f(self.value);
}
export function run<A>(self: Box<A>): A { return self.value; }
```

WM infers both `Box.succeed(20)` and `Box.succeed("hello")` as `Box`, and `Box.run`
of each as `Js.Value`. Replacing `Effect` with `Box` in the nested sequencing
reproduction below gives the same `Js.Value` versus `(T, Js.Value)` collision.
This control contains no overloads, unions, conditionals, variance annotations,
generator machinery, or Effect-specific internals.

## Reproduction without carrier aliases

```wm
from js.module("npm:effect@4.0.6/Effect") import unsafe * as Effect;

let grouped = Effect.flatMap(Effect.succeed(1), (number) => {
  Effect.map(Effect.succeed("hello"), (text) => { (number, text) })
});
```

`wm check` rejects the tuple returned by the inner callback:

```text
type.call-argument-mismatch
__ffi_Effect_map_map_1 can't be both:
  - Js.Value
  - (T, Js.Value)
```

This is the same sequencing shape that a two-element carrier tuple lowers to,
using Effect's own `flatMap` term. It fails without carrier syntax or an adapter,
so the tuple-lift lowering is not the source of the type loss.

## A simpler precision probe

```wm
from js.module("npm:effect@4.0.6/Effect") import unsafe * as Effect;
let numberEffect = Effect.succeed(20);
let stringEffect = Effect.succeed("hello");
let numberValue = Effect.runSync(numberEffect);
let stringValue = Effect.runSync(stringEffect);
```

Observed with `checkSource` and `show` on the resulting environment:

```text
numberEffect: Effect
stringEffect: Effect
numberValue: Js.Value
stringValue: Js.Value
```

These static TS calls should retain enough information to distinguish the success
types. Merely accepting a tuple as `Js.Value` would make execution possible without
restoring useful inference for the tuple's consumers.

## Relevant implementation paths

- `src/ffi/reflect/type_mapping.ts`: `typeExprFromTsType` maps an unconstrained TS
  type parameter to `Js.Value`. Nominal result objects are mapped to their name
  without their generic arguments, so an Effect result is represented as `Effect`.
- `src/ffi/receiver/receiver.ts`: `reflectedFunctionCallCandidate` can select a
  concrete-call-looking signature before HM knows callback return types. It uses
  syntax/ref hints; a lambda's tuple body is not represented in those hints.
- `src/ffi/reflect/call_signature.ts`: `syntheticCallbackTypeFromArg` falls back
  to `Js.Value` when the synthetic callback body has no known result type.
- `src/ffi/delayed/materialize.ts`: `specializeReflectedBindingCall` uses basic
  `callArgHint` rather than the richer inferred callback hints. However, changing
  that fallback alone did **not** fix the reproduction: the early selected call
  already rejects the callback tuple. That trial change was removed.
- Before this change, foreign type declarations and ref lookup used a zero-argument named
  foreign type plus a side table; they do not directly express `Effect<A, E, R>`.
  An investigation must establish how distinct concrete instantiations retain
  their exact TS refs rather than assuming a single name is sufficient.

The last point is a design constraint, not a proposal to reimplement TypeScript's
union, conditional, or requirement-subtraction logic in HM. TypeScript should
continue selecting and instantiating concrete calls.

## Carrier syntax uses existing Effect names

`projectTupleLift` in `src/frontend_v2_surface_semantic.ts` explicitly lowers
`Carrier|a,b|` through members named `andThen` and `map`. Effect 4.0.6 exports
**both** `flatMap` and `andThen`; `andThen` includes the data-first callback form
`(Effect<A,E,R>, A -> Effect<B,E2,R2>) -> Effect<B,E|E2,R|R2>`. There is no naming
mismatch for a two-element group. An earlier investigation incorrectly claimed
Effect had no `andThen`.

The original, unmodified import also reproduces the callback tuple failure:

```wm
from js.module("npm:effect@4.0.6/Effect") import unsafe * as Effect;
let grouped = Effect|Effect.succeed(1), Effect.succeed("hello")|;
```

Keep the upstream namespace `Effect`. No `Fx` alias or renamed sequencing operation
is needed for this reproduction. `Monad.via Effect` is a separate question: the
bare module-as-carrier convention expects a WM carrier record, which the TS
namespace does not automatically supply.

## Acceptance criteria for a fix

1. The alias-free nested `flatMap`/`map` reproduction compiles and executes to
   `(1, "hello")`.
2. The successful payload retains its tuple shape and element types; consuming
   the number as text or the text as a number is rejected without annotations.
3. Separate number and string Effect values retain their different instantiated
   types through ordinary bindings and sequencing.
4. Concrete callback information reaches TypeScript before final call selection
   without ordinary annotations becoming casts or new fixed-point inference.
5. Coverage uses a small local generic TS fixture as well as an opt-in Effect
   example, so routine compiler tests do not depend on downloading Effect.
6. Test the direct `Effect|...|` reproduction as well as explicit sequencing,
   using Effect's actual `andThen` and `map` exports. Test reusable `Monad.via`
   adapters separately from these concrete calls.

The historical reproductions above are now regression/acceptance cases for the
implemented generic-argument preservation. Broader Effect type-model support
remains outside this issue's verified scope.
