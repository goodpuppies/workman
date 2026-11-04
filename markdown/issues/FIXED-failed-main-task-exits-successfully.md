# Issue: A Failed `main` Task Is Silently Discarded and Exits 0

Status: fixed 2026-11-04. The entry point now checks what `main` returns: an outermost `Err` prints
`error[runtime.main-failed]: main failed with <value>` and sets exit code 1. Regression test:
`tests/main_exit_code_test.ts`.

A plain `Result` gets the same treatment as a Task, because a settled Task is a `Result` at runtime and
an `Err` reaching the program's edge is a failure either way. `Ok(Err(x))` counts as success. The check
compares the basis constructor id, so a user constructor named `Err` isn't affected.

Discovered while moving the wmthree NTO pipeline onto `Bytes.readFile` on 2026-09-23.

## Summary

When `main` returns a `Task` that settles with `Err`, the program prints nothing and exits with
status 0. The executable boundary awaits `main()` but ignores the resolved `Result`, so an
explicit, typed failure becomes indistinguishable from success.

## Minimal reproduction

```wm
let main = () => { Task.fail("boom") :> Task.map((x) => { print(x) }) };
```

```text
$ wm run m.wm; echo $?
0
```

The same happens for a real I/O failure, e.g. `Bytes.readFile("missing.bin")` as the head of
`main`'s pipeline.

## Expected behavior

An `Err` reaching the `main` boundary should be reported (rendered with the ordinary value
formatter) and set a non-zero exit status, analogous to an uncaught `Panic`. Scripts and CI
entry points must not report success after a failed Task.

## Current workaround

Every Task-returning wmthree entry point ends with
`:> Task.recover((error) => { Panic(label ++ ": " ++ Text.of(error)) })`, e.g.
`sotcexperiment/pipeline/nto_summary.wm` and `decode_e5_textures.wm` (`runDecode`). Forgetting it
silently reintroduces the problem.

## Suspected implementation boundary

`src/core/emit_js.ts` emits the entry call as
`if (typeof main === "function") await main();`. For a Task, the awaited value is the settled
`Result` object, which is discarded.

## Constraints for a fix

- A non-Task `main` (returning `Void` or any other value) must keep its current behavior.
- A `main` returning a plain `Result` should probably get the same treatment; decide explicitly.
- Keep the REPL path separate; it already reports runtime errors itself.
- The stack-overflow and typed-hole reporting paths must keep their current output.

## Possible approaches

1. After `await main()`, if the value is an `Err` carrier, print `error[runtime.main-failed]:`
   followed by the formatted error and set `Deno.exitCode = 1`.
2. Type-directed: when `main` is inferred as `Void -> Task<a, e>` or `Void -> Result<a, e>`, emit
   the checking wrapper only for those shapes.

## Focused regression coverage

- `Task.fail("boom")` as `main` prints the error and exits 1.
- `Task.succeed(void)` exits 0 with no extra output.
- A `main` returning `Void` is unchanged.
