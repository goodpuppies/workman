# Allow deferred generators to select their carrier at collection

Status: open. Requested 2026-11-18.

The chosen API captures the carrier when constructing a deferred generator:

```wm
list
  :> List.generate(Result, predicate)
  :> List.collect(Primitive.find)
```

Explore an additional formulation which stores only the original input and callback,
and takes the carrier at consumption time:

```wm
let source = list :> List.generate(predicate);
source :> List.collect(Result, Primitive.find)
source :> List.collect(Result, Primitive.filter)
```

The point is independent instantiation of carrier operations for different accumulator
and output types. SML gives a captured carrier record one instantiation in a generator
value; its first collection may fix the loop, succeed and map slots to that consumer.
Selecting the carrier at each collection gives each use fresh operation instantiations.
A carrier-free producer containing only `items` and `check` was tested with both find
and filter in the native SML experiment. The value restriction and error-type annotations
must be considered explicitly in any public formulation.

A concrete native reproduction with the chosen API is:

```wm
let source = [1, 2, 3] :> List.generate(Result, n => Ok(n % 2 == 0));
let found = source :> List.collect(Primitive.find);
let filtered = source :> List.collect(Primitive.filter);
```

The native SML reader rejects the second collection: the stored loop/map/succeed
operations were constrained to an option accumulator/output by find, while filter
requires lists. This was reproduced with `wm sml ... --mlton`. Recreate the generator
per consumer for the current API.

This is a possible additional API, not a request to replace the current carrier-at-
generation spelling. Do not add ad hoc function overloading to express it; consider
separate names or an explicit carrier-free producer constructor.

Acceptance criteria:

- Keep the preferred `List.generate(Result, predicate) :> List.collect(Primitive.find)` API.
- Demonstrate a named producer collected with two consumers having different accumulator
  and output types in both native SML and WM/JS.
- Construction must not invoke the callback. Define repeated consumption as repeated
  evaluation, including Task effects, unless a separate caching operation is explicit.
- Preserve typed errors and stop before requesting the next input after a decisive answer.
- Keep the representation expressible in SubsetML, with no higher-rank record fields,
  compiler fusion requirement, references, or hidden memoization.
- Check stack safety and memory use on long synchronous and asynchronous traversals.
