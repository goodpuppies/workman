# Issue: Recursive `via` Binding Mismatch Diagnostic Is Too Indirect

Status: open

## Summary

A wrong argument passed to a recursive function built with `via` produces a large type-mismatch diagnostic
at the function's entire definition. The actual mistake is a small recursive call inside the body,
but that call is not identified as the primary source.

The diagnostic is technically correct, but too indirect and verbose to make the fix discoverable.

## Minimal shape

```workman
record State = { n: Number };

let rec loop = Monad.via Task (state: State) => {
  let continue = Monad.via Task (_) => {
    state :> loop
  };

  Task.succeed(void) :> continue
};
```

`Monad.via Task` makes `loop` consume a `Task<State, E>`. The recursive call instead pipes the
plain `State` value into it. The fix is:

```workman
state
  :> Task.succeed
  :> loop
```

## Observed diagnostic

In the larger `examples/node-gotchi.wm` occurrence, the diagnostic:

- highlights the complete multi-line `let rec loop = ...` binding;
- reports `InferBinding.PatternExpressionAgreement`;
- compares the definition against a function type inferred from the recursive use;
- includes a very long support trace;
- does not point at the `:> loop` call that introduced the incompatible argument.

The important information is buried inside a comparison resembling:

```text
expected: State
actual:   Task<State, Js.Error>
```

That ordering is also confusing from the call site's perspective: the piped value is `State`, while
the recursive function expects `Task<State, Js.Error>`.

## Expected diagnostic

The primary diagnostic should be attached to the recursive call:

```text
cannot pipe State into loop

loop expects: Task<State, Js.Error>
piped value:  State
```

The recursive binding agreement can remain as secondary evidence, but it should not be the primary
span or presentation. The normal concise diagnostic should not print the full constraint support
trace unless explicitly requested through a debugging command.

## Reproduction from Node Gotchi

The relevant shape was:

```workman
let rec petLoop = Monad.via Task (state) => {
  let continue = Monad.via Task (action) => {
    doAction(action, state)
      :> petLoop
  };

  getAction() :> continue
};
```

`doAction(action, state)` returned `PetState`, while `petLoop` consumed
`Task<PetState, Js.Error>`.

## Likely diagnostic boundary

The recursive placeholder is unified with the completed binding type by
`InferBinding.PatternExpressionAgreement`. Provenance from the recursive call appears to be
subsumed by that final binding constraint. Diagnostics should retain and prefer the inner call or
pipe provenance that first constrained the recursive placeholder incompatibly.
