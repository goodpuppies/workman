# Pure std primitives carry `!`

Status: deferred, found 2026-11-04. Doesn't block a release: `!` is informational for now, so the
extra marks only affect test expectations and produce some false positives.

Every foreign call introduces taint, and `std` implements many pure operations with JS primitives.
So pure code reads as effectful:

| Code | Type now | Type wanted |
|---|---|---|
| `Word8.fromNumber(260)` | `Word8.Word!` | `Word8.Word` |
| `String.toList` | `String -> List<String!>!` | `String -> List<String>` |
| `Task.succeed(1)` | `Task<Number, 'a>!` | `Task<Number, 'a>` |
| `Monad.via Task (x) => { x :> Task.succeed }` | `(Task<..> -> Task<..>!)!` | `Task<..> -> Task<..>` |

This is over-taint, so it can't hide an effect. It isn't an edge case, though: all of `Word*`,
`Binary`, `Pack*`, `Word8Vector` and `Task` construction are affected, which makes `!` much less
informative in any program using them. Building a `Task` also isn't the effect, running it is.

## Options

1. Treat `std` primitives as pure, with an explicit list of the effectful ones (`print`, file IO,
   and so on).
2. Add a purity marker to foreign imports, for example `import pure { ... }`, usable by `std` and by
   user FFI declarations. This is more work, but user code gets it too.

Existing tests record the current `!` types so they keep covering everything else. They'll need
updating when this is fixed.

Known-issue test: `tests/taint_inference_test.ts`.
