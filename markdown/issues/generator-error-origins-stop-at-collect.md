# Error origins through a generator stop at `List.collect`

Status: open. Found 2026-11-18 while removing the carrier-aware `List.*With` functions.

When a carried check's error type conflicts with the surrounding pipeline, the origin note
should point at the operation inside the check that introduced the error. With a direct
callback parameter it does:

```wm
type ParseError = | InvalidInput;
let parsed: Result<List<Int64>, ParseError> = Ok([11, 22]);
let predicate = n => List.splitAt([n], 0) :> Result.map(_ => true);
let filter = Monad.via Result items => Monad.traverse(items, Result, predicate);
let mapped = parsed :> filter;
```

reports `List.splitAt call result: List.Error` at line 3. The same check through a deferred
generator,

```wm
let filter = Monad.via Result items => items
  :> List.generate(Result, predicate)
  :> List.collect(Primitive.filter);
```

reports `List.collect call result: List.Error` instead. `generate` stores the check in the
`Generator` record's `check` field, and type provenance does not follow the type through the
record construction and the field access inside `collect`, so the trail ends at the nearest
application whose result carries the concrete error.

Since `generate`/`collect` is now the only carrier-aware list traversal, this is the common
case for AoC-style code. The removed `List.filterWith` had a direct callback parameter and
pointed at `splitAt`; `tests/diagnostics_test.ts` now covers that behavior with
`Monad.traverse`.

Acceptance criteria:

- The generator example above reports the `List.splitAt` origin at line 3.
- Origins through ordinary user records holding a callback improve the same way, or the
  limitation is documented if it must stay generator-specific.
