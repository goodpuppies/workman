# Type Inspection Facts

`wm-mini` needs one shared way to answer type inspection questions for both editor tooling and
compiler debugging. Hover should not rediscover type meaning from whatever maps happen to be nearby,
and `type-debug` should not require ad hoc instrumentation every time inference has a subtle bug.

The target is a type fact layer produced by inference and consumed by:

- LSP hover.
- CLI `type-debug`.
- Future diagnostics and trace views.

The fact layer observes inference. It must not repair missing types, invent fallback schemes, or
change typechecking behavior.

## Problem

There are two useful types for many pieces of syntax:

```txt
instantiated type:
  the type at this exact use site after local constraints

general type:
  the reusable polymorphic scheme from the definition site
```

Example:

```wm
List.map
```

At one use site this may be:

```txt
type:    (String => Number) => List<String> => List<Number>
general: ('a => 'b) => List<'a> => List<'b>
```

The current implementation has the raw ingredients but not the explicit relationship:

- `Scheme` in `src/types.ts` stores generalized binding types.
- `instantiate(scheme)` creates use-site types.
- `InferResult.types` records expression types.
- Hover currently chooses between `InferResult.types` and the final environment.
- `type-debug` prints environment and nearby expression types, but does not know why a type exists.

This loses the link from a use-site expression to the definition-site scheme, and it forces each
tool to guess.

## Proposed Data Model

Add an inference-owned fact map to `InferResult`.

```ts
export type TypeFacts = {
  expressions: Map<Expr, TypeFact>;
  patterns: Map<Pattern, TypeFact>;
  bindings: Map<string, TypeFact[]>;
  ffi: Map<number, FfiFact>;
};

export type TypeFact = {
  instantiated?: Ty;
  general?: Scheme;
  subject: TypeFactSubject;
  origin?: TypeFactOrigin;
  notes?: TypeFactNote[];
};

export type TypeFactSubject =
  | "expr"
  | "pattern"
  | "binding"
  | "constructor"
  | "ffi-obligation"
  | "ffi-reflected"
  | "synthetic";

export type TypeFactOrigin = {
  name?: string;
  source:
    | "local"
    | "import"
    | "basis"
    | "js-import"
    | "reflected-ffi"
    | "synthetic";
};

export type TypeFactNote = {
  kind: "info" | "warning";
  message: string;
};
```

The exact structure can change during implementation, but the important part is the semantic split:

- `instantiated` is the current use-site type.
- `general` exists only when there is a real reusable scheme.
- `origin` explains where the fact came from.
- FFI obligations are explicit facts, not generalized values.

## Recording Facts

Inference should record facts at the point of knowledge.

### Variable Uses

In the `Var` case of `inferExpr`:

1. Look up the scheme.
2. Instantiate it.
3. Store both values in the expression fact.

```txt
expr: Var "id"
type: instantiated scheme
general: original scheme
origin: local/import/basis/js-import
```

This gives hover and debug output a direct link between the use site and the generalized source.

### Let Bindings

After `generalizeBinding(...)`, record a binding fact for each bound name:

```txt
binding: name
type: generalized scheme type
general: generalized scheme
origin: local
```

Pattern bindings should also get pattern facts so hover on `let x = ...` does not need to recover
`x` by walking the initializer expression.

### Calls

Calls are where instantiated and general types most often diverge.

The call inference path should record:

- the callee use-site type after specialization,
- the callee general scheme when the callee is a variable,
- the call result type.

There is already a JS-boundary special case that writes a specialized callee type into
`InferResult.types`. That should become an explicit fact update instead of overloading the raw
expression type map.

### Pipes

Pipe inference should record the right-hand callee as a use-site application fact.

For:

```wm
cur.windspeedKmph :> toNumber
```

the pipe expression's instantiated type is the final result of the whole pipe. The pipe token itself
is not a value and should not have hover. The right-hand callee should show the specialized function
type for that pipe application, with the general scheme shown separately if available.

### Constructors

Constructors already live in the value environment as schemes with `status: "constructor"`.

Facts should preserve that status so hover/debug can say the origin is a constructor instead of an
ordinary value.

## FFI Rules

FFI is the main reason this should be explicit rather than inferred later by tooling.

### Unresolved `#ffi` Obligations

An unresolved FFI placeholder is not a polymorphic value. It has no honest general type.

For unresolved FFI, the fact should look like:

```txt
type: ?ffi#12:method
ffi: unresolved method obligation
receiver: <current receiver type>
constraints: <non-broad collected constraints>
```

Hover can render:

```txt
type: ?ffi#12:method
ffi: unresolved method obligation
```

Do not synthesize `general` by generalizing the current placeholder type.

### Reflected FFI

If TypeScript reflection resolves an import, property, or method to a real signature, then a general
type may exist.

Example:

```txt
type:    String => Task<Response, Js.Error>
general: String => Task<Response, Js.Error>
origin:  reflected JS import
```

For reflected overloads or contextual callbacks, the general type should be the reflected signature
or selected overload when that is the real source of truth.

### Synthetic JS Receiver Rules

Some JS behavior is modeled by local compiler rules, such as string, array, and promise receiver
members.

These facts should use `origin.source = "synthetic"` unless the operation has been modeled as a real
basis scheme. Synthetic facts may have an instantiated type, but should not claim a reusable general
scheme unless one actually exists.

### Broad JS Boundaries

Broad `Js.Object` and `Js.Value` constraints are boundary compatibility facts, not principal type
evidence.

The fact layer must not turn these into a general type. If a type remains unresolved because only a
broad JS boundary touched it, the debug output should show that directly. This keeps the behavior in
line with the FFI principle: remove vague fallbacks and fail when the type is not actually known.

## Hover Rendering

Hover should consume facts first and keep current `types/env` lookup as a temporary transition
fallback.

Suggested rendering:

```txt
id
type:    Number => Number
general: 'a => 'a
```

If the instantiated and general types are textually identical, hover can show only:

```txt
id: Number => Number
```

For FFI:

```txt
req.method
type: Result<String, Js.Error>
origin: reflected FFI property
```

or:

```txt
req.method
type: ?ffi#7:method
ffi: unresolved property obligation
```

The LSP should not hover pipe operator tokens. It should hover the pipe expression or the right-hand
callee according to the syntax target under the cursor.

## Type Debug Output

`type-debug` should print facts near the failing span before falling back to raw expression types.

Example:

```txt
nearby type facts:
  12:8 Var "map"
    type:    (String => Number) => List<String> => List<Number>
    general: ('a => 'b) => List<'a> => List<'b>
    origin: basis

  18:13 FfiGet "cur.windspeedKmph"
    type: Result<String, Js.Error>
    origin: reflected FFI property
```

For unresolved FFI:

```txt
ffi obligations:
  ?ffi#4:windspeedKmph
    node: 18:13 "cur.windspeedKmph"
    receiver: CurrentWeather
    constraints:
      Result<String, Js.Error>
```

This should make common inference bugs visible without adding temporary `console.log` calls inside
the solver.

## Implementation Plan

1. Add `TypeFacts`, `TypeFact`, and `FfiFact` types.
2. Add `facts` to `InferResult`.
3. Thread `facts` through inference next to `types` and `provenance`.
4. Record facts for variable uses, let bindings, pattern binders, constructors, calls, and pipes.
5. Record FFI obligation facts when creating `freshFfi`.
6. Update facts when delayed FFI reflection solves an obligation.
7. Move LSP hover to read facts first.
8. Extend `type-debug` with nearby facts and FFI obligation sections.
9. Remove transitional hover fallbacks once tests cover the fact layer.

## Tests

Add focused tests for:

- Polymorphic basis function hover shows instantiated and general type.
- Local `let` pattern hover shows the binding type.
- Monomorphic values do not redundantly show identical `general`.
- Pipe callee hover shows the specialized callee type, while pipe token hover stays null.
- Reflected JS import hover records `origin: reflected-ffi`.
- Unresolved FFI hover/debug shows an obligation instead of a fake general type.
- JS boundary specialization shows the call-site type without mutating the definition scheme.

## Non-Goals

- Do not add subtyping.
- Do not infer TypeScript semantics in HM.
- Do not re-generalize arbitrary use-site types to invent `general`.
- Do not use `Js.Object` or `Js.Value` fallback behavior to make incomplete facts look complete.
- Do not make facts affect inference.
