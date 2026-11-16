# Parameter-name inlays appear on calls through an alias

Status: open, 2026-11-16. Found while running related tests for 0.8.0 step 6; not caused by it.

`tests/lsp_type_inlays_test.ts`, "parameter-name inlays omit aliases without reliable authored
parameters", fails on `main` and already failed at `1bafa71`, the last commit that touched the
test. For

```wm
let original = (left, right) => { left + right }; let alias = original; let result = alias(1, 2);
```

the server returns `left:` and `right:` hints on `alias(1, 2)`; the test expects none, because an
alias carries no authored parameter list of its own.

Next: decide whether the alias should inherit the hints (then update the test) or whether the hint
collector should stop following the alias (then fix `semanticInlayHints`).
