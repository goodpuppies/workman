# A line comment at the end of a file without a newline exhausts memory

Status: open, found 2026-11-04. Release blocker: it crashes the compiler on a valid file.

```text
$ printf 'let a = 1;\n-- c' > m.wm
$ wm check m.wm
# Fatal JavaScript out of memory: Ineffective mark-compacts near heap limit
```

| Source | Result |
|---|---|
| `-- c` | crash |
| `// c` | crash |
| `let a = 1; -- c` | crash |
| `let a = 1;\n-- c` | crash |
| `-- c\n` | ok |
| `/* c */` | ok |
| empty file | ok |

It also reproduces at `4e9b523`, from before effect taint and before the lambda recovery change. It's
easy to hit in `wm watch`, or in any editor that doesn't add a final newline, and it takes about 13
seconds to fail with a 1.5 GB heap. It was found by truncating `tooling/tuiman/demo.wm` during the
`wm-watch-stack-overflow-after-edits.md` investigation, and isn't known to be related to that report.

## Likely cause, not yet confirmed by a fix

`Comment` in the grammar is `"--" [^\r\n]*`, the only common repetition over an inverted class that can
reach the end of input. `matchCharacterClass` in `tooling/frontend-v2/compiled_probe_runtime.wm` guards
the end of input with `code < 0`, but `codeAt` calls `charCodeAt`. If that returns `NaN` past the end, as
the JavaScript method does, the guard is false, `classContains` is false, and an inverted class matches.
The repetition then advances forever and allocates a capture each time.

Known-issue test: `tests/known_issues_test.ts`.
