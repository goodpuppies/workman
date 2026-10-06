# Issue: `&&` and `||` are eager, so they do not short-circuit

Status: open

## Summary

Workman's `&&` and `||` are ordinary binary operator functions of type
`(Bool, Bool) -> Bool`. Both operands are always evaluated, including the right
operand when the left operand already determines the result.

In Standard ML, `andalso` and `orelse` are syntactic derived forms:

```sml
e1 andalso e2   ==>  if e1 then e2 else false
e1 orelse e2    ==>  if e1 then true else e2
```

so the right operand is never evaluated when the left operand decides the
outcome.

This makes every guard idiom unsafe in Workman and is currently mis-documented
as an equivalence.

## Minimal reproduction

```wm
let f = (x) => {
  print("RHS evaluated");
  x
};

let r = false && f(true);
let s = true || f(true);
print((r, s));
```

Observed:

```text
RHS evaluated
RHS evaluated
(false, true)
```

Both right operands ran. Under SML semantics neither would.

The type checker is satisfied with either form, because `f` returns `Bool`
here. The same program with an argument type that does not satisfy `(Bool, Bool)`
still reports the eager evaluation as a type error, which hides the runtime
behavior from anyone who writes a guard naturally:

```wm
let f = (x) => { print("RHS evaluated"); x };
let r = false && f(1);
```

```text
type error: false && f(1) can't be both:
- Bool
- Number
```

## Why it matters

Any SML guard transliterated into Workman runs its right operand
unconditionally. With the current basis that means `Panic`, FFI calls, and
`print` side effects that the guard was written to prevent:

- `if (n != 0 && total / n > 1)` divides by zero
- `if (present && present.field)` reads through `None`/`None` and panics
- short-circuit guards used to avoid an expensive or effectful call still pay
  for the call

The compiler is aware of this and has chosen it deliberately, but the choice is
not visible at the use site, and it is the opposite of the language the
documentation claims to follow.

## Current cause

Binary operators lower to plain application of a tupled argument, so operand
evaluation cannot be deferred:

- `src/core/from_surface.ts:526-539` lowers a `Binary` surface expression to
  `CoreApp(expr.op, CoreTuple([expr.left, expr.right]))`.
- `src/core/emit_js.ts:1499-1509` emits `__wm_op_and_d2(left, right)` and
  `__wm_op_or_d2(left, right)`, evaluating both operands before the call.

The compiler documents the tradeoff in two comments:

`src/core/emit_js.ts:1502-1504`:

```ts
// Workman operators are eager because applications evaluate their tuple
// argument before the call. Keep that behavior for JavaScript's normally
// short-circuiting operators while still avoiding tuple allocation.
```

`src/core/emit_prelude.ts:511-512`:

```ts
// Direct eager entry points let statically known boolean applications avoid
// their argument tuple without adopting JavaScript's short-circuit semantics.
```

The optimization that motivated the choice is the elimination of the tuple
allocation, not short-circuiting itself. The two are separable.

## Expected behavior

`false && e2` must not evaluate `e2`, and `true || e2` must not evaluate `e2`.

## Proposed resolution

Emit the boolean operators as control flow at the core level rather than as
primitive applications, so operand evaluation is not forced:

1. Lower `e1 && e2` to a conditional whose branch is `e2` and whose fallback is
   `false`; lower `e1 || e2` symmetrically.
2. Keep the existing non-allocating direct entries for the cases where both
   operands are already simple values, or drop them if the conditional form is
   uniform enough not to need them.
3. Preserve the existing result types: both operators are `Bool`-valued and
   remain non-expansive with respect to their operands for the value
   restriction.

## Documentation correction

`docs/smlparallels.md:74` currently lists `andalso`, `orelse`, `not e` against
`&&`, `||`, `!e` as a semantic equivalent with no qualification. That row is
wrong as written and must either be corrected or carry an explicit note until
this issue is resolved.

`markdown/sml-changes/semantic-differences.md:258-283` already hedges by
declining to claim short-circuit behavior, but it frames the point as
"should not be claimed unless anchored", not as a known behavioral divergence.

## Regression coverage

Add tests proving that:

1. `false && <effectful>` does not evaluate the effect;
2. `true || <effectful>` does not evaluate the effect;
3. `true && e2` and `false || e2` still evaluate and return `e2`;
4. the result of both operators is `Bool` in every case;
5. the tuple-allocation regression that motivated the direct entries is
   measured before and after, so the change is not silently reverted later.
