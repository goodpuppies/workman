# WM test runner reports incompatible Test identities

Status: open, 2026-11-16. Found while checking frontend-v3's native portability work.

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
