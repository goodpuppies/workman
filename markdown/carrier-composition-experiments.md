# Composing carried checks with a pure list consumer

The current std API is deferred: `List.generate(Result, check)` followed by
`List.collect(Primitive.filter)` or another pure consumer record. `Monad.Step` and the
carrier's `loop` operation permit successful early stopping and stack-safe collection.
`List.annotate` remains eager; pure flattening is named `List.concatMap`. Historical
fixture names and designs below describe the experiments, not the current public API.
The chosen formulation captures the carrier at generation; the alternative is tracked
in [a local issue](issues/deferred-generators-select-carrier-at-collection.md).
Public behavior is tested in `tests/list_generation_test.ts` and the native std test.
The experiment fixtures and `tests/carrier_composition_test.ts` were removed on 2026-11-18,
along with the carrier-aware `List.*With` functions the deferred API replaced; the links below
point at files in the history before that change.

The experiment in [carrier_composition.wm](../tests/fixtures/carrier_composition.wm)
works with one ordinary carrier record, without compiler changes or polymorphic
record fields. It is a prototype, not an addition to the public Basis.

```wm
items :> compose(Result, hasIdenticalHalves, decisions => {
  decisions
    :> List.filter((_, keep) => keep)
    :> List.map((item, _) => item)
})
```

The callback computes a carried answer for each plain input. The pure consumer
receives the successful `List<(input, answer)>` and may return any pure result.
Answer types need not be booleans, and the consumer need not return a list.

## Why this fits the existing carrier type

The original implementation uses the same `map` field at three incompatible
instantiations: answer to pair, pair to accumulated list inside `traverse`, and
completed list to final output. Passing `() => Result` instead does not help:
the passed function's return type is still one instantiation.

The working implementation assigns a single type to each existing operation:

| Field | Role |
| --- | --- |
| `succeed` | Wrap a list of input/answer pairs. |
| `andThen` | Sequence the next check after the accumulated list succeeds. |
| `map2` | Combine a carried answer with a successful accumulated list, prepending a pair. |
| `map` | Reverse the complete list and apply the pure consumer. |

The loop uses ordinary `List.foldLeft`. Each check is called inside `andThen`,
so a failed accumulator skips later checks, including when using Task. `map2`
is given one new check and one successful accumulator; it does not rerun any
prior check. Pair accumulation is linear, followed by one reversal.

This works because the carrier record already gives its different operations
independent type parameters. It does not make any one operation polymorphic
within the call. A different algorithm needing multiple incompatible uses of
one field could still encounter the original limitation.

A second successful experiment passed a record containing three separate carrier
instances, one for each original role. Each slot can be instantiated independently
at the call site. This preserves the original `traverse` implementation, but
requires an extra dictionary whose shape describes this specific composition.
Simply copying an already passed carrier into three fields would not give it
fresh type instantiations.

## Semantics and limits

The prototype gathers all answers before invoking its consumer. It stops checks
on carrier failure, but a successful `find`, `exists`, or `all` inside the final
consumer cannot stop checks that have already run. In particular, an early true
answer followed by a failed check produces failure here; `findWith` can instead
return the early match. Accumulating callbacks that depend on earlier successful
answers also need a sequencing fold rather than this independent-check pattern.

The consumer receives pairs, so passing raw `List.filter` is insufficient: the
caller supplies a pure function that describes how to consume those pairs.

## Validation

`tests/carrier_composition_test.ts` checks Result and Task behavior, exactly-once
ordered checks, typed error propagation, empty inputs, independent instantiations
of the let-bound composition function, the short-circuit distinction, both
rejected original designs, and 100,000-element synchronous input. All six tests
pass. A native MLton test in `tests/sml_target_test.ts` verifies the same helper
translates to SML and agrees with JS for unrelated input/answer/output types and
failure behavior. The TypeScript check also passes.

## Passing List.filter directly

The fixture also defines `select`, which supplies the answer-accessing predicate
to a passed selection function and restores the original elements afterward:

```wm
items :> select(Result, hasIdenticalHalves, List.filter)
```

Its implementation wraps `compose` with the pure consumer
`decisions => operation(decisions, (_, answer) => answer) :> List.map((item, _) => item)`.
This works for operations that accept a list and a boolean predicate and return
selected elements from that list. It is not a universal adapter for arbitrary
higher-order functions: `partition`, for example, returns two lists and needs a
different output adaptation. The gather-before-consume semantics still apply.
An additional test verifies the Day 2 example and error propagation, bringing the
composition suite to seven passing tests.

## Pure per-element primitives

A further experiment separates the pure decision step from the traversal. See
[traversal_primitive.wm](../tests/fixtures/traversal_primitive.wm) and
[primitive_composition.wm](../tests/fixtures/primitive_composition.wm).
Each primitive accepts `(input, successfulAnswer)` and emits a list of output elements:

```wm
let filter = (item, keep) => if (keep) { [item] } else { [] };
let map = (_, answer) => [answer];
let concatMap = (_, answer) => answer;
let filterMap = (_, answer) => match(answer) {
  Some(item) => { [item] },
  None => { [] }
};
```

The runner accepts an arbitrary carried computation and a pure primitive. It
sequences the computation, applies the primitive to each successful answer, and
collects its output elements in order:

```wm
list :> compose(Result, hasIdenticalHalves, Primitive.filter)
list :> compose(Result, pairToDupes, Primitive.map)
list :> compose(Result, pairToDupes, Primitive.concatMap)
```

The map example keeps each returned list as one output element; concatMap emits
its elements separately. Input, answer and output element types are independent.
No operation-specific output adaptation is required in the runner because the
primitive always returns a list. Primitive.filter captures just the ordinary
filter decision, without a callback, carrier, or traversal loop. An ordinary
pure List.filter could also use this step, although this experiment makes no
changes to that public implementation.

The carrier roles remain independent: succeed wraps the reversed output list,
andThen sequences its next step, map2 combines a carried answer with that list
and applies the primitive, and map reverses the final list. No polymorphic record
field or new language feature is involved. The primitive is applied immediately
after each successful computation, rather than after gathering all answers.
Failure skips later computations and primitive calls.

The emission protocol covers map, filter, filterMap and concatMap. It does not
express a successful early stop or a check depending on an evolving accumulator;
those require a richer step protocol or another runner. All functions are still
experimental fixture code, with no public Basis API added.

Three additional tests cover all four primitives, different input/answer/output
types, nested versus flattened lists, empty input, typed failures, Task sequencing,
and 100,000 inputs emitting 200,000 outputs. All ten composition tests pass. A
separate native test covers the shared runner and four primitives on SML and JS.

## Splitting sequencing from the pure operation

The latest fixture, [split_composition.wm](../tests/fixtures/split_composition.wm),
separates the previous runner into two ordinary functions:

```wm
list
  :> annotate(Result, hasIdenticalHalves)
  :> Result.map(=> :> collect(Primitive.filter))
```

`annotate` sequences checks and retains `(input, answer)` pairs inside the carrier.
`collect` is entirely pure: apply an emission primitive to each pair and collect
its emitted elements. It can also operate directly on a plain list of pairs,
without a carrier. The same pipeline accepts Primitive.map or Primitive.concatMap
at the second stage. The transformation stage now names the intended operation
explicitly, while the first stage only handles sequencing and preserving inputs.

All checks finish before collection starts; failure skips collection. This
requires storing the intermediate pairs and has the same successful early-stop
limitation as the original gather/consume prototype. All eleven composition tests
pass, including the split's filtering, mapping, flattening and failure behavior.
These remain experimental functions, with no public Basis change.
