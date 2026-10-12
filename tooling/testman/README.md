# testman

> **Proposal.** This is a first proposal for the shape of a Workman testing framework, written so
> pakman could get a real test suite. The design may change completely; treat everything here as
> provisional.

`wm test` runs the tests in `*.test.wm` files, in the style of `deno test`.

## Writing tests

A test file ends in `.test.wm` and exports `tests`, a list of named tests. A test is a function
returning a `Task`; it passes when the Task succeeds. Plain and asynchronous tests look the same.

```wm
from "../../testman/test.wm" import *;
from "./lock.wm" import { upsert, LockEntry };

let tests = [
  test("upsert keeps entries sorted by name", () => {
    let entries = [] :> upsert(entry("zig")) :> upsert(entry("aimp"));
    assertEqual(names(entries), ["aimp", "zig"])
  }),
  test("a written lock reads back the same", () => {
    write(file, entries)
      :> Task.andThen((_) => { read(file) })
      :> Task.andThen((back) => { assertEqual(back, entries) })
  })
];
```

The test is a function rather than a Task because Tasks start as soon as they are created; the
runner starts each test only when it gets to it, one at a time.

Assertions are ordinary functions in `test.wm` returning Tasks that fail with a readable message:

| assertion | passes when |
|---|---|
| `assert(condition, message)` | `condition` is true |
| `assertEqual(actual, expected)`, `assertNotEqual` | the values are (not) equal by `==` (structural) |
| `assertContains(text, part)` | `text` contains `part` |
| `assertOk(result)`, `assertErr(result)` | the Result is Ok / Err; gives the value inside |
| `assertSome(option)`, `assertNone(option)` | the Option is Some / None; `assertSome` gives the value |
| `assertFails(task)` | the task fails; gives its error |
| `checks([...])` | every check passes; reports the first failure |

`pass()` and `fail(message)` build the rest.

## Running tests

```sh
wm test                      # every *.test.wm under the current directory
wm test tests/               # under a directory
wm test lock.test.wm         # one file
wm test --filter rollback    # only tests whose name contains "rollback"
```

Output has one line per test, then the failures and a summary. `wm test` exits 1 when a test failed
or no test ran. A test that throws (a JavaScript exception, a failed pattern match) is reported as
crashed instead of stopping the run. Colors are off when stdout isn't a terminal or `NO_COLOR` is
set.

## How it works

`wm test` (`src/test.ts`) finds the test files and writes a small entry module that imports each
one and passes their `tests` to `runSuites` in `runner.wm`, then runs it like `wm run`. All test
files are compiled together, so a type error in any of them stops the run before tests start.
The runner is plain Workman over direct JS FFI: `Deno.args`, `performance.now`, terminal and
`NO_COLOR` checks, and `Promise.try`, which turns a throw inside a test (or inside its task) into a
failed Task so the runner can report it as crashed.

## Known limits

- `assertEqual` is a generic function in another module, and wm currently rejects user-declared
  records and variant types passed to such a function ("does not admit equality"; see
  `markdown/issues/equality-through-imported-generic-function-rejects-user-types.md`). Lists and
  tuples of them work. Until that's fixed, tests compare such values through a description or a
  projection (see pakman's `tests/resolve.test.wm`).
- Values print through `Text.of`, so lists show as `Cons(1, Cons(2, Nil))` in failure messages.
- No setup/teardown hooks, skipping, timeouts, or parallel files yet; `withTempDir`-style helpers
  in the test files cover setup so far.
