# Issue: Record Projection Resolution Is Eager Instead of SML Context-Deferred

Status: open; historical proposal, partially implemented. The current behavior and annotation
policy are tracked in [the current-state issue](nominal-projection-context-needs-honest-elaboration.md).
The proposed removal of all early annotation disambiguation below is not an accepted requirement:
annotations may legitimately select an owner when ordinary constraints leave multiple possibilities.

Written on 2026-09-28 while deciding how the inference-order issues should be fixed. The decision:
inference order follows SML, so SML semantics are preserved. This issue supersedes the approach
section of `nominal-projection-ignores-annotation-through-type-constructor.md`.

## Summary

When a projected label is owned by several nominal records and the receiver is still a type
variable, `selectedFieldRecord` (`src/infer/records.ts`) picks an owner right away. It filters
candidates against the expected type, falls back to the first candidate, and emits
`record.ambiguous-projection` as a warning. The result depends on how much of the program has been
unified when the projection is visited:

- an annotation that has not been applied yet (`rows: List<B>`) loses to the first candidate, and
  the annotation then conflicts with the body;
- an unannotated function is silently fixed to the first candidate at its declaration, and a use
  in a later declaration fails far from the cause.

`src/infer/expr_lambda.ts` (`InferAnnotation.NominalRecordParameter`) works around this by applying
bare record parameter annotations before body inference. Annotations then act as evidence rather
than checks, which FFI principle 8 rules out. It also covers only the case where the annotation is
itself a record.

Equality does not have this problem. `addEqualityConstraint` (`src/types.ts`) already defers the
admissibility check through a hook on the type variable, which is SML's equality attribute in all
but name. The reproduction in
`lambda-parameter-annotation-does-not-provide-equality-evidence.md` now checks and prints `true`.

## SML semantics

The SML analogue of a projection with several possible owners is `#lab`, or a flexible record
pattern, on a type the context has not yet determined.

- Revised Definition §4.11, item 1 (`statcor.tex`): "the program context must determine uniquely
  the domain … of its row type … For this purpose, an explicit type constraint may be needed."
  There is no default: an undetermined row is an error.
- Appendix E (`overloading.tex`): "the surrounding text is no larger than the smallest enclosing
  structure-level declaration; an implementation may require that a smaller context determines the
  type."

For Workman, the structure-level declaration is a top-level `let` (or `let rec ... and ...`
group) in a file.

## Minimal reproductions

Annotated, currently rejected:

```wm
record A = { s: String, n: Number };
record B = { s: String, k: Number };

let first = (rows: List<B>) => {
  match(rows) {
    [] => { "" },
    [Var(row), ..Var(_rest)] => { row.s }
  }
};

let main = () => { print(first([B("x", 1)])) };
```

```text
type error: rows: List<B> can't be both:
  - B
  - A
  Cons(row, _rest): A
```

Unannotated, currently resolved to `A` with a warning, then rejected at the use site:

```wm
record A = { s: String, n: Number };
record B = { s: String, k: Number };

let first = (rows) => {
  match(rows) {
    [] => { "" },
    [Var(row), ..Var(_rest)] => { row.s }
  }
};

let useIt = () => { first([B("x", 1)]) };
```

```text
type error: first([B("x", 1)]) can't be both:
  - A
  - B
```

## Expected behavior

- The annotated program checks and prints `x`. Where the annotation sits does not matter, because
  `List<B>` eventually unifies with the element type.
- In the unannotated program, `first` is rejected at its own declaration: the projection `s` is
  ambiguous between `A` and `B`, and the error asks for an annotation. The use in `useIt` is a
  separate top-level declaration, so it cannot resolve the projection, as in SML.

## Proposed semantics

1. A label with exactly one owner in scope resolves immediately, as it does today.
2. A projection with several owners on an unresolved receiver adds a pending projection constraint
   to the receiver's type variable, using the same hook mechanism as `equalityConstraint`. When the
   variable is bound to a nominal record, the hook checks that the record owns the label and unifies
   the field type with the projection's result type. A record that does not own the label reports
   an ordinary "no field" mismatch there.
3. A type variable with a pending projection is not generalized. A local `let` that projects stays
   monomorphic until a later use in the same top-level declaration resolves it.
4. After each top-level declaration, any projection still pending is an error
   (`record.ambiguous-projection`, severity error) that names the candidates and asks for an
   annotation on the receiver, binding, or parameter. There is no default owner.

## Consequences

- The early-annotation path in `expr_lambda.ts` becomes unnecessary and should be removed, so that
  annotations are only checks again.
- The `expected` filtering (`canUnifyWithoutCommit`) in `selectedFieldRecord` is an order-dependent
  heuristic and should be removed. The constraint waits for context instead.
- Programs that currently compile only because of the first-candidate warning become errors. wmthree
  probably has some, since this was found during its nominal projection migration. Each one is fixed
  by an annotation. The pattern-constraint workaround (`(Var(row) : B)`) keeps working but is no
  longer needed where the signature already carries the type.
- The "keep the existing ambiguity warning and first-candidate rule" constraint in
  `nominal-projection-ignores-annotation-through-type-constructor.md` is replaced by rule 4 above.

## Constraints for a fix

- Keep annotations as constraints, never coercions or evidence.
- Keep the GPU dialect's own projection path (`gpu_dialect.ts` `inferProjection`) and its
  annotation-erased validation unchanged.
- No fixed-point iteration: a pending constraint fires once, when its variable is bound, or fails
  once, at the end of the declaration.
- A genuinely inconsistent annotation/body pair still reports a precise mismatch, with the
  projection as an origin.
- Projections through JS FFI values, dotted module paths, and struct-tagged types are unaffected.

## Focused regression coverage

- Both reproductions: the first checks and runs; the second reports an ambiguity error at `first`.
- `Option<B>`, `(B, Number)`, and function-typed annotations resolve the projection.
- `let rec sources: List<B> -> List<String> = match(rows) => { ... }` checks.
- A local helper `let get = (r) => { r.s };` used only at `B` within the same top-level function
  checks and is not generalized; using it at both `A` and `B` in that function is an error.
- A single-owner label still resolves immediately and generalizes normally.
- An annotation of `List<A>` with a body that constructs `B` still reports a mismatch.
- Close `lambda-parameter-annotation-does-not-provide-equality-evidence.md` with a regression test
  for its reproduction, since it already passes.

## Current implementation (2026-10-06)

Calls and pipes share application inference, and receiver obligations wait for ordinary
constraints through a top-level declaration. The atview callback clash and pakman branch
clash are fixed. Pakman's resolve function infers the same type with its Option<LockEntry>
parameter annotation present or removed.

Unresolved labels retain the compatibility first-owner default and warning. Bare nominal
parameter annotations remain valid disambiguation when the computation genuinely permits
several owners; they must not override an incompatible identity determined by the computation.
The complete no-default proposal above remains a separate language-policy decision, not a
requirement for the current fixes.

See [the current-state issue](nominal-projection-context-needs-honest-elaboration.md) for
implementation boundaries, validation and the SML/Grain comparison.
