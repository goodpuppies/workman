# Single Error Example

This note checks whether the diagnostic object model can answer the user thesis for one concrete
error.

Thesis, verbatim:

```txt
you told me a rule failed? please list out - what is the exact rule - what part of the rule i violated if the rule is has parts to fix: - you told me data points, how did you figure out those data points? basically where do i look in my code to reproduce the error in my head? - if the error message essentially tells me the solution i need to know the exact reason why i have to solve it myself and so on essentially i see an error as state snapshot that should allow me to reconstruct the compilers state in my head at the moment of the failure, to do that i need to know what logic branch were in, what that logic is in the branch is, what state was relevant in that branch
```

## Source

This is the current recursive binding mismatch shape covered by `tests/lsp_test.ts`.

```wm
type Int_list = Empty | Cons<Number, Int_list>

let rec sumList = (list, val) => {
  match(list) {
    Empty => {val},
    Cons(i, rest) => {sumList(rest, val+i)}
  }
}
```

The compiler reports a mismatch at the recursive call:

```txt
sumList(rest, val+i)
```

Current related evidence already contains:

```txt
body: (Int_list) => Number
rec: occurrences share one monomorphic type
operator +: Number
```

## Diagnostic Object Sketch

```txt
Diagnostic D1
  code: type.mismatch
  severity: error
  primary: source anchor for sumList(rest, val+i)

  failure:
    frame:
      id: RF1
      rule: WM.RecursiveBinding.Result
      subject: binding sumList
      anchor: source anchor for the whole recursive binding
      path:
        ElaborateDeclaration
        -> ElaborateRecursiveBinding
        -> InferBindingBody
        -> CheckRecursiveResult

    premise:
      id: P1
      role: recursive-body-result-must-match-placeholder-result
      predicate:
        equal(type(body-result), type(recursive-placeholder-result), type)
      origin:
        source anchor for the recursive binding result check

    violation:
      kind: contradicted
      observed:
        body-result has type (Int_list) => Number
        recursive-placeholder-result has type Number
      conflictPath:
        result

  support:
    entries:
      C1 claim:
        binding placeholder sumList has type (Int_list, Number) => Number
        origin: let rec sumList = ...

      C2 claim:
        recursive occurrence sumList(rest, val+i) has result Number
        origin: sumList(rest, val+i)

      C3 claim:
        match body has type (Int_list) => Number
        origin: match(list) { ... }

      C4 claim:
        operator + has type Number
        origin: val+i

      K1 constraint:
        equal(type(body-result), type(recursive-placeholder-result), type)
        createdBy: P1
        status: failed

      R1 rule:
        frame RF1

    edges:
      C1 -> K1: provides recursive placeholder
      C2 -> C1: occurrence uses recursive placeholder
      C3 -> K1: provides body result
      C4 -> C2: helps derive recursive occurrence result

    roots:
      K1: failed-constraint
      C2: primary-observed
      C3: body-result
      C1: recursive-placeholder
```

## Rendered Form

```txt
[type.mismatch] rule failed: WM.RecursiveBinding.Result

compiler path:
  ElaborateDeclaration
  -> ElaborateRecursiveBinding
  -> InferBindingBody
  -> CheckRecursiveResult

failed premise:
  recursive-body-result-must-match-placeholder-result
  equal(type(body-result), type(recursive-placeholder-result), type)

violation:
  contradicted at result

observed:
  body-result:
    (Int_list) => Number
    from match(list) { ... }

  recursive-placeholder-result:
    Number
    from recursive occurrence sumList(rest, val+i)

why this occurrence matters:
  recursive occurrences of sumList share one monomorphic placeholder
  the recursive call is checked against that placeholder

supporting evidence:
  sumList placeholder: (Int_list, Number) => Number
  operator +: Number
```

## Thesis Check

Exact rule:

```txt
WM.RecursiveBinding.Result
```

Exact part of the rule violated:

```txt
premise P1:
  recursive-body-result-must-match-placeholder-result
  equal(type(body-result), type(recursive-placeholder-result), type)
```

Data points reported:

```txt
body-result: (Int_list) => Number
recursive-placeholder-result: Number
recursive occurrence: sumList(rest, val+i)
operator +: Number
```

How the compiler figured out those data points:

```txt
C3 came from inferring the match body.
C2 came from checking the recursive occurrence against the binding placeholder.
C1 came from the recursive binding environment used while inferring the body.
C4 came from operator provenance for val+i.
K1 came from premise P1.
```

Where to look in code to reproduce the error:

```txt
Start at the primary span:
  sumList(rest, val+i)

Then inspect:
  the recursive binding header: let rec sumList = ...
  the match body: match(list) { ... }
  the operator expression: val+i
```

Exact reason a suggested fix would be required:

```txt
Any fix must make premise P1 true.

That means:
  type(body-result) must equal type(recursive-placeholder-result)

In this failure:
  (Int_list) => Number must equal Number

So a valid repair must either make the body produce Number, or change the recursive binding shape so
the recursive placeholder result is the function type being returned.
```

State snapshot:

```txt
logic branch:
  ElaborateDeclaration -> ElaborateRecursiveBinding -> InferBindingBody -> CheckRecursiveResult

rule:
  recursive binding result check

relevant state:
  recursive placeholder type
  recursive occurrence result
  inferred body result
  failed equality constraint
  supporting operator fact
```

## Verdict

The model can answer the thesis for this error.

The important point is that the error is not stored as "expected Number, got (Int_list) => Number".
That rendering is only a projection. The object stores:

```txt
rule frame
failed premise
violation counterexample
evidence log
```

That is enough to reconstruct the compiler state at the failure without making the top-level
diagnostic object more complex.
