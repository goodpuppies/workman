# REPL needs an explicit Task wait boundary with completed binding types

Status: proposal, not implemented. Recorded 2026-11-05 while designing atview's importable REPL API.

## User workflow

A query currently returns a Task. Selecting an image from a user's feed therefore requires Task.map/andThen callbacks around otherwise ordinary list operations. The user wants to fetch once, bind a page, filter its posts, select one, and render it interactively.

Proposed spelling, subject to WM language design:

```wm
let page = awaitTask(feed("username.bsky.social", 30)) :> Result.debug;
let images = page.posts :> List.filter((post) => {
  match(post.image) { Some(_) => { true }, None => { false } }
});
let selected = images :> List.at(0);
```

This is not supported syntax/API today. `feed` is the example atview query; the wait operation must be generic and work without atview.

## Semantics to establish

- Conceptually `awaitTask: Task<a, e> -> Result<a, e>` at a REPL phrase boundary. The evaluator suspends until completion; it does not block the event loop.
- Preserve errors explicitly. Unwrapping with Result.debug in the example is the user's separate choice.
- Bind the real completed value with its real static type. Merely awaiting before display while retaining a Task binding does not solve subsequent field access/list composition.
- Establish where waiting is legal, including nested blocks and function definitions. A library-looking name alone cannot justify pretending an ordinary function can return a synchronous Result from a Promise. Keep the initial feature restricted to phrase/top-level evaluation if that is the intended boundary.
- Keep ordinary module functions and async script APIs unchanged; no implicit type-changing await on arbitrary imported calls.
- Wait for asynchronous output/rendering before the phrase is complete too.
- Retain completed bindings without reexecuting earlier requests. The session is now persistent (88f3417), so completed earlier phrases already execute once. The explicit wait boundary is still a separate feature.

## Why not an atview wrapper

WM Tasks use JavaScript Promises. Synchronously blocking the thread prevents promise callbacks/network completion. A subprocess workaround introduces serialization and repeated process/authentication setup. A proper solution belongs to the REPL evaluator/compiler boundary, with a documented type rule.

## Acceptance cases

Use local Tasks, not network access:

1. A completed Task and a callback-delayed Task yield Result values usable by following ordinary expressions.
2. The value inside a successful Result is inferred correctly, including nominal record fields and lists.
3. Err preserves its error type and does not silently unwrap.
4. Rejected host promises, interrupt, and failed phrases retain the defined previous basis.
5. Earlier effectful phrases execute once in a persistent session; if persistence is a separate change, explicitly document the remaining replay behavior.
6. Async output is emitted intact and in phrase order, rather than removed by a raw previous-stdout byte offset.
