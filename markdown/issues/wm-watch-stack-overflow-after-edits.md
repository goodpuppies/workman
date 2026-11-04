# `wm watch` reported a stack overflow after several edits, and not after a restart

Status: not reproduced, recorded 2026-11-04 in case it happens again.

## Report

```text
wm watch file.wm -> multiple edits -> suddenly a stack overflow error
restart with the same file -> no stack overflow
```

It probably happened while editing `scratch3.wm`, a `let rec while` with a recursive inner lambda and a
capture clause. The exact message and the source at that moment weren't kept.

## What was tried

None of these overflowed:

- 400 rebuilds of a small program in one process, using the same `coreFile` and
  `compileFileArtifactsFromCore` path as `runFile`. Time stayed flat at about 69 ms, and the heap only
  rose and fell with GC.
- 120 rebuilds each of several programs, cycling through valid edits, unfinished lambdas, type errors,
  unknown names and truncated files, with `loadModuleGraph` in recovery mode as `watch` uses it. The
  `tooling/tuiman/demo.wm` run stopped early at an unrelated crash, see
  `comment-at-end-of-file-without-newline-exhausts-memory.md`.
- 54 `runFile` calls in one process over 9 variants of `scratch3.wm`, including recursion 300,000 deep.
  Each variant gave the same exit code in every round and in a fresh process.
- Generated code for `examples/webhook.wm` is byte-identical between a fresh compiler and one that has
  already been through 40 edits.

So the likely causes tested so far, growing shared type state and stale emit state, have no evidence
behind them. This doesn't rule out an edit sequence that wasn't tried.

## If it happens again

Keep the full error text, which says whether it came from the compiler or from the program:

- `error[runtime.stack-overflow ...]` comes from the program, which runs in a fresh child process. Then
  the generated code is the suspect, so save the source and compare it with a fresh `wm compile`.
- A plain `RangeError: Maximum call stack size exceeded` with compiler frames comes from the long-lived
  compiler. The stack trace then shows which recursion it was.
