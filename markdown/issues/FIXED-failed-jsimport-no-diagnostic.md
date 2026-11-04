Status: fixed. Verified 2026-11-04: a missing `js.module` path now reports `ffi.import-resolution`. Regression test in `tests/known_issues_test.ts`.

if we have something like "from js.module("missing path") import * as Raylib;"
we get no error and instead Raylib is just a fully dynamic js object, this causes later errors which are misleading