# LSP mini update: responsive diagnostics and smaller inlays

## Goal

Ship one small, standalone LSP update today with three visible changes:

1. Rapid edits validate only the newest pending document state and never publish stale diagnostics.
2. Long type-inlay labels are cut off with `...` by the language server.
3. A directly bound function shows parameter and return hints in the function syntax instead of a
   duplicated whole-function type beside its name.

For example, unannotated source:

```workman
let somefn = (x) => { body };
```

should appear as:

```workman
let somefn = (x: TypeA): TypeB => { body };
```

not:

```workman
let somefn: TypeA -> TypeB = (x: TypeA) => { body };
```

This update is independent of [`lsp-update26.7`](./lsp-update26.7/README.md). It does not need to
advance that plan or take on any of its unfinished architecture work.

## Ship order and cut line

1. Latest-wins diagnostics.
2. Hard inlay-label cutoff.
3. Function inlay layout.

If time runs short, ship after any completed step whose focused tests pass. Do not hold a finished
diagnostic responsiveness fix for the two presentation changes.

## Checklist

### Latest-wins diagnostics

The current `didChange` path awaits validation before it can process the next edit. The older server
in [`research/workman-old/lsp/server/src/validate.ts`](../research/workman-old/lsp/server/src/validate.ts)
used a useful 50 ms debounce, but then waited for an in-progress validation. Keep the debounce idea,
not the obsolete-work queue.

- [x] Make `didOpen`, `didChange`, and `didSave` record the notification and schedule validation
      without awaiting the complete compiler pass in the message loop.
- [x] Give each validation key a monotonically increasing generation.
- [x] Debounce rapid edits for 50 ms so typing `somename` usually starts one validation rather than
      eight.
- [x] If validation is already running, retain only the newest pending generation; discard any
      intermediate pending generations.
- [x] When the active validation finishes, publish it only if its generation is still current.
- [x] If it became stale, start the newest pending generation immediately rather than waiting for a
      second debounce or running intermediate generations.
- [x] Apply stale checks before publishing diagnostics, clearing old imported-file diagnostics, or
      replacing the last-published URI set.
- [x] Keep one semantic compiler analysis active at a time; do not race mutable project caches.
- [x] Add deterministic scheduler tests: rapid idle edits run once, an edit arriving during active
      validation suppresses the old publication, and several edits during active validation run
      only the newest follow-up.
- [x] Add a server-level test proving a rapid notification burst publishes only its latest document
      version.

This slice supersedes obsolete work at scheduler and publication boundaries. Interrupting
already-running synchronous compiler code requires cooperative compiler cancellation or a
terminable worker and is not required here.

### Hard label cutoff

- [x] Add one server-owned maximum length for inline type labels; use 60 displayed characters for
      the first version.
- [x] Shorten labels that exceed it and end them with the exact suffix `...`.
- [x] Keep short labels unchanged.
- [x] Keep the complete type in the existing tooltip.
- [x] Add one focused test for the cutoff and full tooltip.

### Function layout

- [x] For a direct `let name = (...) => ...`, stop emitting the whole-function type after `name`.
- [x] Keep inferred parameter hints after each unannotated parameter.
- [x] Add the inferred return type after the closing `)`.
- [x] Do not repeat explicit parameter or return annotations.
- [x] Keep current inlays unchanged for non-function bindings and destructuring.
- [x] Cover a top-level function, a local function, and explicit annotations in focused tests.

### Ship

- [x] Run the focused diagnostic-scheduler, inlay, and server tests.
- [x] Run `deno task check`.
- [x] Run formatting and inspect the diff for unrelated changes.
- [ ] Manually confirm the result in one LSP client if practical.
- [x] Update only documentation directly made inaccurate by this change.
- [ ] Commit only after explicit approval.

## Keep out of this update

- Configurable cutoff length.
- VS Code extension settings or middleware.
- New parameter hints for foreign, curried, or datatype-constructor calls.
- Hole or partial-type hints.
- Worker-thread compiler execution or deep cooperative compiler cancellation.
- General language-service, cache, protocol, or renderer redesigns.
- Unrelated items from the 26.7 LSP roadmap.

## Done when

- Rapid typing does not queue one full validation per keystroke.
- Obsolete validation results cannot publish or mutate diagnostic publication state.
- The newest pending validation starts as soon as the active compiler pass releases the semantic
  service.
- No inline inferred-type label exceeds the server limit.
- A direct function binding reads like `let somefn = (x: TypeA): TypeB => ...`.
- The full inferred type remains available in the tooltip.
- Focused tests and the repository typecheck pass.
