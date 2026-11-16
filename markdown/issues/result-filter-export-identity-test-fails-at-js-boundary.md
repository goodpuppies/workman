# Result.filter export identity test fails at the JS boundary

Status: open, 2026-11-16. Reproduces with the previous hand-authored Basis manifest as well as
the source-generated descriptors; it is not introduced by descriptor generation.

```sh
deno test -A --filter 'returns original passing and failed results unchanged' tests/result_filter_test.ts
```

The test compares `runtime.kept` and `runtime.input` by JavaScript object identity after each
Result is exported separately. Both are `{ ok: true, value: 3 }`, but they are distinct wrappers.
The library ABI converts WM Results to plain JS tagged values at each crossing. This does not
establish whether `Result.filter` preserved the internal WM object as its source promises.

The test needs to check internal identity before export, or the library ABI needs an explicit
identity-preservation contract. The predicate count, skipped-Err predicate, result types and
value assertions in the other Result.filter tests pass.
