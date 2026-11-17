# WM test runner reports incompatible Test identities

Status: fixed, 2026-11-17. Found while checking frontend-v3's native portability work.

Reproduction from the repository root:

```sh
deno run -A src/main.ts test tooling/frontend-v3/tests/project.test.wm
```

The generated main module reports `Runner.suite can't be both: Test - Test`, pointing to
`Runner.suite`'s parameter and `tooling/testman/test.wm`'s constructor result. The command exits
zero despite the diagnostic. The identity mismatch and exit-status handling need investigation.

Compiling `project.test.wm` with `compileLibraryFile` and invoking every exported test's `run`
function directly executes all ten tests successfully. Native parser/View parity is separately
covered by `python3 scripts/check_frontend_v3_projector_native.py`. Neither result establishes
that the ordinary test runner works.

Resolution: repository suites imported the source file `../../testman/test.wm`, while `wm test`
loads its runner from the packaged `testman/runner.wm`. Those are distinct module identities,
so their nominal Test records differ. Frontend-v3 and pakman suites now import the public
`testman/test.wm` API consistently. A CLI regression verifies a malformed suite returns status 1;
the earlier observed zero status was not reproduced. The existing timer-exit and project import-map
tests also pass.

Validation: the full frontend-v3 suite passes 61 tests; the full pakman suite passes 92 tests.
Pakman's CLI fixtures require a writable cache and host access for bubblewrap namespace setup.
