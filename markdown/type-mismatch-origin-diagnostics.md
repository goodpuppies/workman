# Type Mismatch Origin Diagnostics

## Problem

Current nested type mismatch errors can identify the structural type slot that differs, but they do
not reliably tell the programmer where each conflicting constraint came from.

For example, `examples/portscan.wm` currently reports a mismatch like:

```txt
at parameter 1 -> tuple item 2 -> result -> Task argument 2:
  expected: Js.Error
  got:      String
```

This is too implementation-shaped. It says which nested type position differs, but not which source
expression made the compiler expect `Js.Error`, or which source expression made it infer `String`.

The useful diagnostic is shorter and more source-oriented:

```txt
type mismatch in Task.andThen callback result

expected Task error: Js.Error
  from examples/portscan.wm:130:7 scanAll(host, ports)

got Task error: String
  from examples/portscan.wm:121:8 Result.mapErr((_) => { "CLI args unavailable" })
```

The compiler should point to where to look. It does not need to narrate the entire inference story.

## Design Goals

- Print source-aware locations for both sides of a type conflict.
- Keep messages terse: expected type, got type, origin locations.
- Prefer user paths such as `Task.andThen callback result` over internal paths such as
  `parameter 1 -> tuple item 2 -> result`.
- Keep the solution general. Do not add special diagnostic paths for `Task`, pipe, or one example
  program.
- Reuse the existing inference choke points where possible:
  - `constrainAt`
  - `unify`
  - type variable binding callbacks
  - existing expression/type facts
- Avoid advanced compiler machinery that violates the project 80/20 rule.

## Existing Pieces

### Type Diff

`src/type_diff.ts` can find the first structural mismatch inside two types. That is useful, but it
should not be the main user-facing explanation when the path is detached from source syntax.

The useful part to keep is the final slot:

```txt
Task error
Result error
Js.Array element
```

This needs named type argument labels.

### Type Facts

`src/infer/type_facts.ts` records expression and binding facts. These are useful for tooling and
debugging, but they are not enough for mismatch origins because they describe inferred expressions
after the fact. They do not explain which constraint committed a shared type variable.

### Type Provenance

`src/infer/provenance.ts` is closer to what is needed. It currently records related diagnostics when
type variables are bound, but the data is mostly message-shaped and can be lost once a variable is
pruned to a concrete type.

The portscan error is a typical case:

```wm
Task.andThen : (Task<a, e>, (a) => Task<b, e>) => Task<b, e>
```

One instantiated type variable `e` is shared between:

- the incoming task error type
- the callback result task error type

The diagnostic should report the two commitments to that same `e`.

## Proposed Model

Track type variable commitments as structured data.

```ts
type ConstraintOrigin = {
  label: string;
  node?: AstNode;
  slot?: string;
};

type TypeCommitment = {
  type: Ty;
  origin: ConstraintOrigin;
};
```

When unification binds a type variable to a type, record:

- the variable id
- the concrete or partially concrete type it was bound to
- the source origin for the constraint that caused the binding

When a later constraint conflicts with that binding, the diagnostic can compare:

- the existing commitment
- the new attempted commitment

That gives the formatter enough information to print:

```txt
expected Task error: Js.Error
  from <existing/new origin>

got Task error: String
  from <existing/new origin>
```

The exact expected/got orientation should follow the constraint site, but both sides must have
origins when known.

## Constraint Contexts

The type system should not print raw structural paths if the constraint site can provide a better
user context.

Examples:

```txt
Task.andThen callback result
function argument 2
pipe input
if branch result
match arm result
annotation
```

`inferCall` and `inferPipe` already know the callee expression and the argument expressions. They
are the right places to attach a source-aware context label to the constraint. They should not
contain custom explanations for individual basis functions.

## Named Type Slots

Add labels to `TypeInfo` for named type arguments.

Examples:

```txt
Task<a, e>      -> value, error
Result<a, e>    -> value, error
Option<a>       -> value
Js.Array<a>     -> element
Js.Dict<a>      -> value
Js.Promise<a>   -> value
```

Then a type diff can say `Task error` instead of `Task argument 2`.

This is small, general, and improves diagnostics even before full commitment tracking exists.

## CLI Output

The LSP already has related-information support. CLI formatting should also print useful related
origin locations, otherwise the compiler may have the right data but terminal users still cannot see
where to look.

The output should stay concise. Related locations for this feature should be part of the primary
type mismatch message or formatted immediately below it.

## Implementation Plan

1. Remove any unused side-channel formatter causes from `type_diff`. Causes should come from
   structured constraint/provenance data, not optional strings passed only by selected callers.

2. Add named type argument labels to `TypeInfo` and preserve them in `named` types.

3. Change type diff formatting to prefer named slots such as `Task error`. Keep raw structural paths
   only as a fallback.

4. Introduce structured constraint origins in `src/infer/provenance.ts`. Keep this beside existing
   provenance rather than spreading a new parameter through every inference function.

5. Record type variable commitments in the `UnifyBind` callback. This is the key general hook:
   repeated type variables are where many useful mismatch explanations come from.

6. Teach mismatch construction to use the previous commitment and the attempted commitment when
   unification fails.

7. Add user context labels at central constraint sites:
   - calls
   - pipes
   - branch results
   - match arm results
   - annotations

8. Update CLI diagnostic formatting to show the concise origin locations.

9. Add regression coverage using `examples/portscan.wm` or a smaller focused program with the same
   shape:

   ```wm
   Task.andThen : (Task<a, e>, (a) => Task<b, e>) => Task<b, e>
   ```

## Non-Goals

- Do not special-case `Task.recover` as the blamed location.
- Do not add a bespoke diagnostic pipeline for portscan.
- Do not attempt whole-program explanation trees.
- Do not make type errors verbose by default.
- Do not replace type inference with a complex constraint graph solver.

## Open Questions

- Should the existing first commitment be printed as `expected` and the new conflicting commitment
  as `got`, or should expected/got always follow the syntactic constraint direction?
- How much source text should be included after the location? A single trimmed expression is useful,
  but full multiline expressions will become noisy.
- Should CLI related locations use the same rendering as primary diagnostics, or compact one-line
  locations?
