# Two portable JSON tests fail on main

Status: fixed, 2026-11-17. Found while running related tests for 0.8.0 step 7; not caused by it
(they fail at `56b0bba`, before steps 6 and 7 touched wm-mini).

`tests/json_test.ts`:

- "portable JSON rejects malformed syntax and ill-formed Unicode with offsets": every invalid input
  is rejected as expected, then `m.limited(["[]", 1])` returns `false`, where `true` is expected
  (line 144). `limited` is `(source, limit: Int32.Int) => R.isOk(J.decodeWithLimit(source, limit))`.
- "portable JSON accessors preserve paths, nulls, duplicate keys and dynamic names": the first
  assertion, `m.field(['{"東京":"🦊"}', "東京"])`, fails (line 153).

Both call compiled library functions from JavaScript with a tuple argument, so the likely cause is
the library calling convention for tuple arguments, or the `Int32` limit as a JS number, rather
than the JSON code itself. The other three JSON tests pass.

Next: bisect between 0.7.0 and `56b0bba`, and check what `compileLibraryVirtual` exports expect
for a tuple-taking function.

Resolution: the tests used the former tuple ABI (`m.field([source, key])`) against positional
library exports. They now call `m.field(source, key)`, `m.optional(source, key)` and
`m.limited(source, limit)`, following the library ABI documented in `docs/content-mapper.md`.
All five portable JSON tests pass, including depth limits, Unicode and dynamic field names.
