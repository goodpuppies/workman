# Issue: Lambda Parameter Annotation Does Not Provide Equality Evidence in the Body

Status: to be determined if real issue 

Discovered while writing a Workman-owned exact-name selector for the wmthree
Shadow of the Colossus asset pipeline on 2026-07-19.

## Summary

An ordinary lambda parameter annotated as `List<String>` does not constrain a
list element bound by matching early enough for `==` in the lambda body.
Workman checks the equality operand while it is still a fresh type variable and
reports that the type does not admit equality. The annotation is apparently
verified only after body inference.

This makes a concrete annotation unable to establish a basic operation that is
valid for its declared type. The issue is broader than lists: any body operation
whose admissibility is checked eagerly can fail before a concrete parameter
annotation is applied.

## Minimal reproduction

```workman
let rec stringIn = (name: String, expected: List<String>) => {
  match(expected) {
    [] => { false },
    [Var(candidate), ..Var(rest)] => {
      if (name == candidate) { true } else { stringIn(name, rest) }
    }
  }
};

let main = () => {
  print(stringIn("b", ["a", "b"]))
};
```

Run the focused command:

```text
wm check /path/to/reproduction.wm
```

## Actual behavior

Checking fails at `name == candidate`:

```text
type "'a" does not admit equality
```

The diagnostic identifies the right operand as an unresolved `T` even though
`candidate` comes from matching the parameter declared as `List<String>`.

Changing `Var(candidate)` to `candidate` does not change the result.

## Expected behavior

The parameter annotation should make `expected` a `List<String>` while the body
is checked. The list pattern should therefore bind:

```text
candidate : String
rest      : List<String>
```

`String` admits equality, so the program should check and print `true`.

If Workman deliberately treats some annotations as verification-only, ordinary
non-GPU Workman annotations still need either:

1. enough bidirectional propagation to validate operations in the annotated
   body, or
2. deferred operation constraints that are revisited after the annotation is
   unified.

Rejecting a valid operation before checking the declared concrete type makes
the annotation misleading and unnecessarily prevents locally typed generic
helpers.

## Current workaround

The wmthree selector uses explicit `String` comparisons instead of recursively
matching an annotated `List<String>`. This is correct but repetitive and should
not become a standard-library design pattern.

Another possible workaround is to add a separate expression that forces the
element to `String` before equality, but that duplicates type evidence already
present in the signature and depends on inference order.

## Suspected implementation boundary

`src/infer/expr_lambda.ts` currently infers the body with fresh parameter types,
then checks parameter annotations afterward. Its comments explicitly describe
annotations as verification-only for GPU behavior, but the ordering also
affects ordinary Workman lambdas.

`src/infer/equality.ts` calls `admitsEquality` immediately. An unresolved type
variable returns false rather than leaving an equality-admissibility constraint
to solve after later unification.

The interaction between these two choices produces the failure:

- `inferPattern` gives `candidate` the fresh list-element type;
- `assertEqualityType` rejects that fresh type while inferring the body;
- the later `List<String>` annotation check never gets a chance to resolve it.

## Constraints for a fix

- Do not make arbitrary unconstrained type variables equality-comparable.
- Do not weaken equality restrictions for functions, foreign values, or ADTs
  containing non-equality members.
- Preserve the annotation-erased validation required by the GPU dialect; a fix
  for ordinary Workman must not allow annotations to disguise invalid shader
  inference.
- Keep genuinely polymorphic equality honest. The reproduction is concrete,
  not a request for an unconstrained equality type class.
- Diagnostics for a real mismatch such as `expected: List<Number>` combined
  with a String-only body operation must remain precise.

## Possible approaches

1. For the ordinary dialect, constrain fresh lambda parameter types with their
   annotations before body inference, while retaining the current separate
   annotation-erased GPU check.
2. Represent equality admissibility as a deferred constraint on type variables
   and validate it after all body and annotation unification completes.
3. Propagate concrete annotations through parameter patterns before checking
   the body, but continue treating foreign-receiver and GPU-specific evidence
   according to their existing stricter rules.

Approach 1 appears smallest, but needs a focused audit of why all annotations
were made post-inference before changing ordering globally.

## Focused regression coverage

- The reproduction checks and runs successfully.
- The same helper over `List<Number>` also admits equality.
- A list of functions is still rejected by equality.
- A deliberately inconsistent annotation/body pair reports a type mismatch.
- The GPU annotation-erasure tests continue to prove that annotations cannot
  make an otherwise invalid shader body valid.

The full wm-mini suite is not required during development; run the narrow
lambda/equality/inference tests first.
