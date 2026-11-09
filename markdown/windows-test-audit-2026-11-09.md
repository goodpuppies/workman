# Windows test audit — 2026-11-09

Ran `deno task test` outside the filesystem sandbox with the current, uncommitted REPL fixes.

Result: **1,581 passed, 14 failed, 22 ignored**, in **6m25s**.

## Path fixes verified

All 12 path-related failures below are now fixed in the tests. The five affected test files cover 65 tests; all pass across the targeted reruns (55 in the combined run plus all 10 FFI generic identity tests after the final fixture-path correction). No additional compiler defect appeared once the paths were corrected. Formatting and whitespace checks pass. The full suite has not been rerun after these fixes.

Native CLI and reflection base paths now use `fileURLToPath`; fixture paths embedded in Workman source use forward-slash native absolute paths, since file URLs are not accepted by that reflection path. Cache assertions use native basename extraction, result lookups use canonical paths, and publish-pattern comparisons use normalized repository-relative paths.

## Remaining issues investigated

- Winsock: integer literals intentionally adopt C ABI parameter types. The test now verifies `ntohs(htons(8080))` succeeds while rejecting an explicitly typed `Number` and a `Word32.Word` passed to a Word16 parameter.
- Watch cleanup: Windows may report Access Denied when terminating an already-exited process. Cleanup now tolerates this only if child exit is confirmed within a bounded wait, and preserves the permission error if exit cannot be confirmed. Two regression tests cover both cases.
- Full parallel rerun: **1,596 passed, 1 failed, 22 ignored**, in **6m29s**. All original 14 failures are gone, including all watch tests. A different C `puts` test intermittently captured no output; it now explicitly calls `fflush(None)` before the Deno process exits.

The final focused C FFI and watch rerun passes after the flush change. The full suite was not repeated again after that final test-only change. Full rerun log: `_scratch/windows-tests-after-fixes.log` (gitignored).

## Release verification follow-up

Preparing 0.6.3 exposed the same exit/kill race in `runFile` itself: a file change can abort a child that has already exited, and the Windows Access Denied exception escaped the abort event handler and ended `wm watch` before it reported the edited program's parse error. Runtime cancellation and watch-test cleanup now share `terminateChild`, which confirms exit before tolerating Access Denied. Cancellation failures propagate through the running operation rather than an uncaught abort listener.

The updated watcher passes the transitive-change and typed-hole recovery tests under full parallel load. Native Windows console checks for cbreak mode restoration and Shift+Enter also pass separately, since the standard captured-output suite skips them.

Final 0.6.3 release suite: **1,597 passed, 0 failed, 22 ignored**, in **5m58s**. All original failures and the subsequent buffering and runtime cancellation failures are resolved. The generated release artifacts, local VSIX packaging, and JSR publication dry run also pass. Final full-suite log: `_scratch/release-0.6.3-tests-final.log` (gitignored).

## Failure groups

| Tests | Count | Finding |
| --- | ---: | --- |
| `module_analysis_cache_test.ts` | 4 | RecordingCache extracts filenames using `/` only; actual Windows keys contain backslashes. Assertions compare full native paths against basenames. |
| `publish_files_test.ts` | 1 | Repository-relative native paths contain backslashes, but publish patterns and exclusions use forward slashes. |
| `compiler_js_import_test.ts` | 2 | One test looks up a canonical result using a mixed-separator input key; another passes a file URL's `.pathname` to the Deno CLI as a config path. |
| `ffi_generic_identity_test.ts` | 4 | Tests derive fixture paths and reflection base paths from URL `.pathname`, producing `/C:/...` paths and, in one case, `C:\C:\...`. All four fail again in isolation. The tests using ordinary relative fixture imports pass. |
| `run_location_test.ts` | 1 | REPL child entrypoint uses URL `.pathname` as a Windows filesystem path. The adjacent `run` package/import-map tests pass. |
| `c_ffi_edge_cases_test.ts` | 1 | Winsock byte-order round trips pass. The test then expects a numeric literal argument to reject; that expectation fails. Numeric C ABI literal selection has separate passing coverage, so this may be stale. Reproduces in isolation. |
| `watch_test.ts` | 1 | Full-run failure is Access Denied from `child.kill()` during cleanup. All four watch tests pass in isolation. Potential cleanup race; the cleanup exception may hide an earlier error. |

These failures do not yet establish additional user-facing compiler defects. Most point directly to test portability mistakes. Fix the test paths and rerun before drawing conclusions about the underlying FFI/module behavior.

## Follow-up

- Use `fileURLToPath` for native paths and JSON-encode native paths embedded in Workman string literals (or use file URLs where supported).
- Use native basename extraction for cache test keys.
- Normalize repository-relative paths to `/` before publish-pattern comparisons.
- Look up file results with canonical paths.
- Reconcile the Winsock negative assertion with numeric C ABI literal selection.
- Make watch-test cleanup preserve the original error and account for a child that has already exited.

The 22 ignored tests include opt-in known issues, platform-specific tests, and the two native-console tests that require a terminal. The native console tests were verified separately during the preceding REPL work.
