# Issue: Nominal Projection Ignores Annotations Nested Inside Type Constructors

Status: open

Discovered while migrating the wmthree Shadow of the Colossus pipeline to nominal record
projection on 2026-09-23.

## Summary

When several records own a label, projection selects a candidate record while the body is
inferred. A lambda parameter annotated with a nominal record (`value: B`) is applied before body
inference, so `value.s` resolves to `B`. An annotation that only *contains* the record, such as
`rows: List<B>`, is not applied early. Elements bound from `rows` by a match pattern are therefore
still fresh when `row.s` is projected, the first candidate (`A`) is selected, and checking fails
against the annotation afterwards.

## Minimal reproduction

```wm
record A = { s: String, n: Number };
record B = { s: String, k: Number };

let first = (rows: List<B>) => {
  match(rows) {
    [] => { "" },
    [Var(row), ..Var(_rest)] => { row.s }
  }
};

let main = () => { print(first([B { s = "x", k = 1 }])) };
```

```text
wm run reproduction.wm
```

## Actual behavior

```text
type error: rows: List<B> can't be both:
  - B
  - A
  Cons(row, _rest): A
```

The same failure occurs when the annotation is on a `let` binding of a match function:

```wm
let rec sources: List<B> -> List<String> = match(rows) => {
  [] => { [] },
  [Var(row), ..Var(rest)] => { [row.s, ..sources(rest)] }
};
```

## Expected behavior

`rows` is `List<B>` before the body is checked, so `row : B` and `row.s` selects `B.s`. The program
should print `x`.

## Current workaround

Constrain the binder directly with a pattern constraint:

```wm
[(Var(row) : B), ..Var(rest)] => { row.s }
```

wmthree uses this in `object_animation_summary.wm`, `e5_stage_module_summary.wm`,
`e5_common_layout.wm`, `e5_shrine_placement.wm`, and `e5_placement_origin.wm`. Most of those
functions already carry the correct `List<Record>` parameter annotation, so the binder constraint
duplicates evidence already present in the signature.

## Suspected implementation boundary

`src/infer/expr_lambda.ts` applies parameter annotations early only when the pruned annotation is
itself a named record type (`target?.tag === "named" && recordFields`). Other annotations are
verified after body inference. `List<B>`, `Option<B>`, tuples of records, and function types
returning records all fall through to post-inference verification.

For `let` annotations on match functions, the declared type is likewise unified only after the
right-hand side has been inferred.

This is the same ordering root cause as
`lambda-parameter-annotation-does-not-provide-equality-evidence.md`, now observable through
nominal projection instead of equality admissibility.

## Constraints for a fix

- Keep annotations as constraints, never coercions.
- Keep the GPU dialect's annotation-erased validation.
- Keep the existing ambiguity warning and first-candidate rule when no annotation provides
  evidence.
- A genuinely inconsistent annotation/body pair must still report a precise mismatch.

## Possible approaches

1. In the ordinary dialect, constrain parameter types with any annotation that mentions a nominal
   record (or simply with every ordinary annotation) before body inference.
2. For annotated `let` bindings, unify the binding's declared type with a fresh placeholder before
   inferring the right-hand side, as recursive bindings already do.
3. Defer label-owner selection for projections whose receiver is still a type variable, and
   resolve it after body and annotation unification.

Approach 1 is the smallest extension of the existing nominal-record special case and would also
resolve the equality issue above.

## Focused regression coverage

- The reproduction checks and runs.
- The `let rec ...: List<B> -> List<String> = match(...)` form checks.
- `Option<B>` and `(B, Number)` parameter annotations resolve the projection.
- Without any annotation, the ambiguity warning and first-candidate behavior are unchanged.
- An annotation of `List<A>` with a body that constructs `B` still reports a mismatch.
