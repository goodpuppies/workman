# Issue: `Js.Object` is silently accepted as any foreign object type

Status: open

## Summary

A value of type `Js.Object` can be passed to a parameter whose type is a
specific foreign object type such as `Request` or `Response`, without a cast,
an assertion, or any diagnostic.

The checker treats this as a widening coercion and adopts the expected type:

```ts
if (isForeignObjectType(expectedType, typeEnv) && isJsObjectType(actualType, typeEnv)) {
  return expectedType;
}
```

This is an implicit downcast in the wrong direction. `Js.Object` is the less
informative type; `Request` is the more informative one. Adopting the expected
type asserts a fact about the value that nothing established.

## Minimal reproduction

```wm
from js.global import type { Request };
from js.global import unsafe {
  structuredClone as makeObj: String -> Js.Object,
};
from js.global("Deno") import { serve: Request -> Js.Value };

let main = () => { serve(makeObj("x")) };
```

This compiles and runs. `makeObj` is declared to return `Js.Object`, i.e. an
opaque foreign value with no known members. `serve` is declared to take a
`Request`, which has a known nominal foreign identity and a known member set.
The compiler accepts the call and hands a value it knows nothing about to a
function that will call methods on it.

Verified with the current compiler at `_scratch/sml-diff/jsobj17.wm`.

The failure is delayed, not immediate. When the receiving function actually
projects a member, the mismatch surfaces as an unrelated error far from the
call site, or as a runtime `TypeError`:

```wm
let useReq = (req: Request) => {
  req :> .log(req.url)     -- req.url is not a number or string
};
```

Note that `Js.Object` is not even nameable in expression position today
(`Js.Object` is reported as `unknown name`), so the only ways to produce one are
an unsafe import declaration or a reflection failure. That makes the coercion
harder to hit accidentally, but it also means it is not reachable through any
checked or obvious spelling, which is itself a sign the rule is not load-bearing
in the way it looks.

## Why it matters

This is the one place where the dynamic boundary silently pretends to be typed.
The other escape hatches are at least visible at the use site:

- `Json.assert` is a named call, and the compiler explicitly refuses to let an
  annotation do the same job
  (`src/infer/decl_binding.ts:215-219`).
- `unsafe` imports are spelled `unsafe`.
- `Js.Value` requires the caller to name the type explicitly.

This rule requires none of that. A value of unknown shape silently acquires a
specific nominal foreign type because of where it was passed. That is the
outcome the dynamic-boundary design is trying to make the user ask for.

It also undercuts the nominal foreign type system. Once `Js.Object` satisfies
any `Request` parameter, `Request` in a parameter position is no longer a
guarantee, and a caller cannot rely on a type error to catch a wrong argument at
a boundary they did not intend to make dynamic.

## Current cause

`src/infer/expr_call.ts:255-257`, inside `jsImportActualArg`:

```ts
if (isForeignObjectType(expectedType, typeEnv) && isJsObjectType(actualType, typeEnv)) {
  return expectedType;
}
```

The surrounding coercions in the same function are all widening, which is the
normal direction for a subtyping relation:

- `Js.Array` accepts `Js.Value` and `Js.ObjectLike` (`:239-244`)
- `Js.Object` accepts any object-like (`:245-249`) and any `Js.Value` (`:250-254`)
- `Js.Value` accepts object-like, primitive, and function types (`:258-266`)

Line 255 is the only one that goes from a top type to a specific type.

The function is reached only for direct JS import callees, gated at
`src/infer/expr_call.ts:70-77`:

```ts
const isJsImport = expr.callee.kind === "Var" && env.get(expr.callee.name)?.jsImport;
const actualArg = isJsImport
  ? jsImportActualArg(calleeFn.params[0], arg, typeEnv, () => { jsBoundaryVar = true; })
  : arg;
```

Ordinary Workman function calls do not go through `jsImportActualArg`, which is
why passing a `Js.Object` to a locally defined `Request` parameter is correctly
rejected. The unsoundness is confined to the JS import boundary, but that
boundary is where foreign identity is introduced in the first place.

`docs/jsffi.md:196-199` states the intended policy directly:

> `Js.Object` and `Js.Value` are reserved for genuinely dynamic declarations or
> an explicitly chosen dynamic boundary. They are not fallback types for failed
> reflection.

The coercion contradicts this.

## Expected behavior

Passing a `Js.Object` where a specific foreign object type is expected should
be a type error, with a message pointing at the dynamic-boundary escape hatches
the user can actually choose from.

## Proposed resolution

1. Remove the `isForeignObjectType && isJsObjectType` rule at
   `src/infer/expr_call.ts:255-257`.
2. If some reflected signatures genuinely need to accept an opaque object, make
   that explicit in the reflection result rather than inferring it at every call
   boundary. A reflected signature that declares `Js.Object` as a parameter type
   already works through the widening rule at `:245-249`.
3. When the diagnostic fires, name the available options: `Json.assert`, an
   `unsafe` import, or a shim with the real foreign type.

Note that removing this rule may surface failures in code that depends on it,
which is the point: those sites are currently passing unverified values to typed
foreign APIs. Each one needs an explicit decision.

## Related

- `markdown/issues/boolean-operators-are-eager-not-short-circuiting.md` is a
  separate behavioral divergence found alongside this one.
- `docs/jsffi.md:42-48` already documents type-only JS imports as "useful in
  trusted boundary" positions, which is the category this coercion is currently
  serving without that trust being expressed.

## Regression coverage

Add tests proving that:

1. a `Js.Object` argument is rejected at a foreign-object parameter;
2. the same call succeeds when the parameter is declared `Js.Object`;
3. the same call succeeds when the argument is a genuine `Request`;
4. widening coercions (`Js.Value` to `Js.Object`, primitives to `Js.Value`) are
   unaffected;
5. the diagnostic names an available escape hatch.
