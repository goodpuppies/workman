# C FFI anonymous struct typedef emits invalid JavaScript helper names

Status: fixed. Verified 2026-11-04: `print(sizeOfsigset_t)` runs and prints 128. Regression test in `tests/known_issues_test.ts`.

## Reproduction

On Linux/glibc, compile and run a WM library that imports `sigset_t` from
`signal.h` and uses `sizeOfsigset_t`, or imports functions whose reflected
signatures transitively bring in that type. For example:

```wm
from c.header("signal.h") import type { sigset_t };
let main = () => { print(sizeOfsigset_t); };
```

Observed while compiling the challenge's signal setup: compilation completed,
but loading the generated library threw `SyntaxError: Missing initializer in
const declaration`. Its output included this invalid identifier:

```js
const sizeOf(anonymous struct at /usr/include/bits/types/__sigset_t.h:5:9)_1393 = 128;
```

The source description of the anonymous record leaks into generated helper
identifiers. Investigate typedef alias identity and identifier sanitization;
this report does not claim every anonymous C record fails.

## Existing workaround

`examples/server/challenge/main.wm` uses authored `c.lib("c")` pointer
signatures for `sigemptyset`, `sigaddset`, `sigismember`, `sigprocmask` and
`signalfd`. Its mask buffer is explicitly 128 bytes, matching this Linux/glibc
sigset_t ABI (1024 bits). `signalfd_siginfo` is a named struct and is still
reflected for record size and field offsets. No new compiler feature is needed
to exercise the transport.
