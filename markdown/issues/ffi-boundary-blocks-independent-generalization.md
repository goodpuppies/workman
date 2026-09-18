# Issue: FFI boundary blocks generalization of unrelated type variables

Status: open

Discovered while implementing the typed actor runtime in
`stageforgeman/prior-experiments/actor_system/stageforge/postman.wm`.

## Summary

A non-expansive function binding becomes entirely monomorphic when its body contains any JavaScript
FFI boundary. This includes type variables which cannot reach that boundary.

The restriction is more conservative than SML's value restriction and can force unrelated library
clients to share one monotype. In the actor runtime, importing a child actor's real API as a typing
witness caused `PostMan.serve` to be fixed to the child's nominal API record. Serving the root
actor then failed because it had a different nominal API record.

## Minimal reproduction

```wm
-- runtime.wm
from js.global("console") import { log };

let pass = (value) => {
  log("pass");
  value
};
```

```wm
-- main.wm
from "./runtime.wm" import * as Runtime;

let number = Runtime.pass(1);
let text = Runtime.pass("hello");

let main ==> {
  void
};
```

Observed:

```text
Runtime.pass can't be both:
- Number
- String
```

Removing the unrelated `log` call gives `pass` the expected polymorphic type. Moving the call into
a concrete monomorphic helper also restores generalization in this small reproduction:

```wm
let announce = => {
  log("pass")
};

let pass = (value) => {
  announce();
  value
};
```

## Expected behavior

`pass` should have type:

```text
'a -> 'a
```

The lambda is non-expansive. Calling it may perform an effect, but constructing the closure does
not. More importantly, its type variable is absent from the FFI receiver, arguments, and result.

This does not imply that unresolved foreign receivers should become polymorphic. For example, the
receiver in this function must remain monomorphic until downstream HM constraints identify it:

```wm
let pollOnce = (sdl, eventPtr) => {
  sdl :> .symbols.SDL_PollEvent(eventPtr)
};
```

## Current cause

`generalizeBinding` in `src/infer/decl_binding.ts` has an all-or-nothing guard:

```ts
if (containsUnresolvedFfi(type) || containsFfiBoundary(value, env)) {
  return { vars: [], type, constraints: [], status: "value" };
}
```

`containsFfiBoundary` recursively enters lambda bodies. Once it finds one boundary, every free type
variable in the binding is left monomorphic, regardless of whether that variable participates in
the foreign operation.

The ordinary `generalize` implementation already excludes variables carrying `jsConstraint`, but
that is not currently enough to preserve all delayed receiver and argument obligations.

## Naive fix experiment

Removing only `containsFfiBoundary(value, env)` makes the independent `pass` reproduction compile,
but breaks existing delayed-FFI regression tests. Failures include:

- JSON object fields which must settle from downstream calls;
- dynamic receiver calls whose receiver is identified downstream;
- reflected method placeholders used by a parent receiver call;
- callback handlers constrained by a later foreign call;
- recursive foreign receiver helpers;
- unannotated encoder helpers resolved from their callers.

Those failures occur because boundary-connected variables are generalized and instantiated before
the delayed FFI solver receives the downstream evidence it needs. The blanket guard cannot simply
be deleted.

## Proposed resolution

Generalize selectively:

1. Collect the type variables participating in FFI facts inside the binding. At minimum this must
   cover the receiver, supplied arguments, callback types, placeholder, and resolved/instantiated
   result where present.
2. Keep those variables monomorphic so downstream constraints continue to reach the original FFI
   obligation.
3. Generalize the binding's remaining free variables using the ordinary non-expansive rule.
4. Preserve the selected monomorphic variables through recursive binding groups, module imports,
   and staged whole-graph reinference.

`TypeFacts.ffi` already records most of the required receiver, argument, placeholder, and
instantiated types. The main implementation question is associating the relevant facts with a
binding and excluding their free variables during generalization without losing identity during a
later inference wave.

## Actor-system manifestation and workaround

The desired actor entrypoint is:

```wm
let main ==> {
  PostMan.serve(.{
    state = initialState,
    __INIT__ = __INIT__,
    api = api,
  })
};
```

`serve` must erase the heterogeneous state, lifecycle, and API-factory fields before its concrete
dispatcher runtime can use them. Because that erasure is an explicit dynamic boundary, a generic
`serve` wrapper is still made monomorphic.

The current workaround makes `PostMan.serve` accept only the concrete raw definition and performs
the assertion at each actor entrypoint:

```wm
.{
  state = initialState,
  __INIT__ = __INIT__,
  api = api,
}
  :> Json.assert
  :> Result.debug
  :> PostMan.serve
```

This keeps the actual actor implementation and its Worker entrypoint in one file, and avoids a
second `sub_worker.wm` wrapper. Once selective generalization is implemented, the assertion can move
back behind the public `PostMan.serve` API.

## Regression coverage

Add tests proving that:

1. an FFI-independent variable such as `pass` remains polymorphic;
2. a binding can keep one FFI-connected variable monomorphic while generalizing another variable;
3. unresolved receiver, method, JSON-field, callback, and recursive-helper cases continue to settle
   from downstream constraints;
4. imported monomorphic obligations remain shared across one coherent module inference wave;
5. the actor-shaped `serve` function can be used with two distinct nominal API records in one graph.

## Non-goals

- Generalizing unresolved FFI placeholders.
- Cloning one unresolved foreign obligation independently for every use site.
- Treating Workman annotations as dynamic casts.
- Making arbitrary Workman values acceptable to `Js.Value` parameters.
- Adding rank-N polymorphism or polymorphic record fields.
