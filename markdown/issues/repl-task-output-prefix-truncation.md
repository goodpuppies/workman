# Interactive REPL corrupts output after a second Task phrase

Status: fixed by the persistent REPL in 88f3417, included in 0.6.1. Originally reproduced 2026-11-05 with WM 0.6.0 and Deno 2.9.8.

The evaluator now runs each accepted phrase once in a persistent child and forwards marked output streams without slicing by previous stdout length. The reproduction below is retained as the original report.

## Reproduction

Pipe these two phrases into `wm repl`, or enter them interactively:

```wm
Task.succeed("first") :> Task.map(print);
Task.succeed("second") :> Task.map(print);
```

Observed output (prompts retained):

```text
- it = {  } : Task<Void!, 'a>!
first
-   } : Task<Void!, 'a>!
first
second
-
```

The second binding display is truncated, and `first` is reprinted. Pure `print("first");` followed by `print("second");` does not reproduce this corruption.

## Likely mechanism

`src/repl.ts` reexecutes the whole accepted program in a fresh process, then slices the new stdout at `committedStdout`, assuming the old bytes are an unchanged prefix. Task completion is asynchronous: newly added synchronous binding displays can appear before the earlier Task's output. The old stdout is therefore not a prefix of the new stdout. Check this hypothesis against the emitted REPL module before implementing the fix.

Expected: each new phrase's binding and completed output appear intact. Replayed output must not be removed by a raw byte offset when it can be reordered.

## Impact

Atview's `url :> fetchPost :> show(Image)` can print PNG Kitty APCs, sixel strips, or ANSI half blocks asynchronously. Cutting an image stream at an arbitrary byte offset can corrupt terminal control sequences, not just duplicate a line. `show(Text)` also reproduces the issue without any image backend.

A genuinely persistent session with phrase-scoped output would address both replay effects and output ownership. This issue does not prescribe a particular implementation. Until fixed, a single `wm run` script is the dependable way to render once; watched files also replay on save.

## Validation

Include the two-Task reproduction, two ordinary print phrases, mixed synchronous/asynchronous output, and binary terminal-control strings. Ensure each complete phrase's output survives intact with errors/interruption as well as success.
