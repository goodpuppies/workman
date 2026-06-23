# How to implement frontend v2 in Workman

## Purpose

This is practical onboarding for contributors implementing the structural frontend
and later LSP in current `wm-mini`. It does not replace
[`docs/wm-minisyntaxguide.md`](../../docs/wm-minisyntaxguide.md) or
[`docs/jsffi.md`](../../docs/jsffi.md). Before writing substantial code, also read
[`docs/carriers.md`](../../docs/carriers.md). It explains one compact design pattern
and its syntax sugar, but that pattern shapes most real Workman code because errors
are explicit and FFI-heavy programs produce `Result` and `Task` values constantly.

This project uses WM for new frontend and structural-editor implementation code.
Do not create new TypeScript or JavaScript helpers merely because a familiar API is
easier to express there. Existing TypeScript compiler/LSP code remains in scope for
the migration, and existing JS/TS/Deno/Node APIs can be consumed directly through
Workman's safe FFI. Nearly all platform functionality needed here is already
reachable that way.

Workman sits between them:

- like Grain, it favors algebraic data types, pattern matching, immutable values,
  explicit recursion, and expression-oriented code;
- like TypeScript, it targets JavaScript and can use existing JavaScript, Deno,
  Node, and TS-backed modules through its FFI;
- unlike either predecessor, frontend v2 should be designed around current
  `wm-mini` capabilities rather than transliterated line by line.

## Read and run these first

Start with small examples, then inspect larger interop code.

### Carrier-oriented error flow

- [`docs/carriers.md`](../../docs/carriers.md) — required reading. It explains
  carrier lifting, `Result|...|`/`Task|...|`, primitive `Result` coercion, and the
  `Monad.lift` pattern.
- [`std/result.wm`](../../std/result.wm) — the concrete `map`, `andThen`, `mapErr`,
  and tuple-combination operations used by carrier-oriented code.
- [`std/task.wm`](../../std/task.wm) — the asynchronous carrier surface.

The design comparison is:

```text
Go:       call -> inspect err -> return/continue
Elm:      value |> andThen (...) |> andThen (...)
Workman:  value :> Result.andThen(...) / Task.andThen(...)
          Result|a, b, c| / Task|a, b, c|
          lifted functions and primitive carrier coercion
```

Safe FFI calls return `Result`; Promise-returning calls return `Task`. Carrier
composition keeps the explicit error information without nesting a `match` around
every call. This is not a niche convenience. It determines the shape of most
FFI-heavy Workman code, particularly the Raylib examples.

### Pure functional style

- [`std/list.wm`](../../std/list.wm) — recursive list traversal, first-class match,
  and accumulator-free functional structure.
- [`examples/aoc_depths.wm`](../../examples/aoc_depths.wm) — a compact lexer/parser-
  adjacent style of recursive list processing and pattern matching.
- [`examples/exercises/tree.wm`](../../examples/exercises/tree.wm) — recursive ADTs
  and tree algorithms.

### JavaScript/Deno boundaries

- [`examples/weather.wm`](../../examples/weather.wm) — typed records at a JSON
  boundary, safe FFI, `Result`, `Task`, Deno file access, and JS arrays.
- [`examples/github_repos.wm`](../../examples/github_repos.wm) — safe HTTP/JSON
  interop, `Result`/`Task` pipelines, JS arrays, and carrier conversion.
- [`examples/task_lift.wm`](../../examples/task_lift.wm) — several equivalent
  carrier-composition styles for asynchronous Deno operations.

### Larger multi-file/Raylib code

- [`examples/raylib/orbital_run/game.wm`](../../examples/raylib/orbital_run/game.wm)
  — immutable application state, nominal records, ADTs, recursion, and module
  boundaries.
- [`examples/raylib/orbital/vec.wm`](../../examples/raylib/orbital/vec.wm) — a small,
  cohesive utility module with typed records.
- [`examples/raylib/colony/sim.wm`](../../examples/raylib/colony/sim.wm) — a larger
  functional simulation split from rendering/host concerns.
- [`examples/raylib/orbital_run/main.wm`](../../examples/raylib/orbital_run/main.wm)
  — extensive local-module and generated TypeScript/Raylib FFI integration.

In the Raylib entry points, look specifically for `:> Result.mapErr(...)`,
`Result|...|`, `Task` composition, and match-based recovery. Although the bindings
come from generated TypeScript, the application logic remains WM; no parallel
TypeScript implementation helper is needed.

These examples demonstrate language use, not current architectural perfection.
Some repository code is already over the 500-line limit. Frontend-v2 maintained
code must still stay at or below 500 lines per file; Markdown is exempt.

Useful commands:

```sh
~/.local/bin/wm check std/list.wm
~/.local/bin/wm check examples/aoc_depths.wm
deno task wm check examples/raylib/orbital_run/game.wm
```

Use `deno task wm` when `~/.local/bin` is not in the active shell's `PATH`.

## Current language constraints that shape the frontend

Do not design against intended future Workman syntax by accident. Current
`wm-mini` has important constraints:

- no mutable variables or references;
- no `while`/`for` loops;
- no general exceptions;
- no async/await syntax;
- no authored typed-hole `?` syntax yet;
- no match guards;
- no custom operator definitions;
- files are the module boundary;
- functions are ML-shaped and fixed-arity/tuple-argument, not automatically
  curried;
- top-level declarations require semicolons in the compiler frontend currently;
- blocks return their final expression;
- recursive definitions require `let rec`.

The structural frontend can represent an inferred `HoleExpr` ADT constructor even
though a user cannot yet write `?` in ordinary compiled WM source. Do not confuse
the frontend's data model with current authored syntax.

## Think in Workman, not TypeScript

### Use ADTs for alternatives

Prefer:

```wm
type TokenKind =
  | Ident<String>
  | LetKeyword
  | Equals
  | Semicolon
  | EndOfFile
  | Opaque<String>;

type Expr =
  | NameExpr<String>
  | LetExpr<Pattern, Expr>
  | HoleExpr<RecoveryId>
  | ErrorExpr<RecoveryId, String>;
```

over a record containing many boolean flags or nullable fields. The exact frontend
types will be designed during implementation; the point is to make impossible
states harder to construct.

### Use records for products

Records are nominal. Declare the type before constructing it:

```wm
record Span = {
  start: Number,
  end: Number,
};

record ParserState = {
  remaining: List<Token>,
  nextId: Number,
  marks: List<Mark>,
};

let initial: ParserState = .{
  remaining = tokens,
  nextId = 1,
  marks = [],
};
```

Type annotations are useful at module boundaries and for recursive structures even
when inference could recover the type.

### Thread state explicitly

Without mutation, model the parser like the Grain implementation:

```text
Parser<A> = ParserState -> (A, ParserState)
```

In current surface syntax that usually means functions returning tuples:

```wm
let freshId = (state: ParserState) => {
  let next = .{ ..state, nextId = state.nextId + 1 };
  (state.nextId, next)
};
```

Return updated marks, diagnostics, and token position in state. Do not recreate the
Grain prototype's global mutable diagnostic buffers through JS globals.

### Use recursion for traversal

Lists are persistent and traversed with match/recursion:

```wm
let rec reverseInto = match(items, out) => {
  ([], out) => { out },
  ([head, ..rest], out) => { reverseInto(rest, [head, ..out]) }
};
```

Direct self-calls in tail position are emitted as iteration, but mutual recursion
and non-tail recursion still use the JavaScript stack. Keep hot traversals tail
recursive where practical. Measure before replacing clear persistent structures
with JS arrays.

### Remember pattern semantics

Workman pattern behavior is not identical to Grain, TypeScript, or ordinary ML:

- `_` is a wildcard;
- constructor patterns such as `Some(value)` destructure payloads;
- bare identifier arms can mean pinned existing values;
- `Var(name)` explicitly binds a whole matched value where required.

Use existing compiler-accepted examples as the authority when a pattern is
ambiguous. Run `wm check` early rather than assuming Grain syntax transfers.

### Remember tuple application

The usual multi-parameter form is one tuple-shaped argument:

```wm
let advance = (state, token) => { ... };
let next = advance(state, token);
```

Explicit currying requires nested lambdas and calls:

```wm
let makeAdvance = (state) => { (token) => { ... } };
let next = makeAdvance(state)(token);
```

Frontend code should normally use the first style.

## Modules and dependency direction

Every `.wm` file is a module. Top-level values, types, records, and constructors are
importable by default.

```wm
from "./token.wm" import { Token, TokenKind };
from "./source.wm" import * as Source;
```

Avoid cycles. A reasonable eventual direction is:

```text
source/span
  -> token/trivia
  -> mark/recovery facts
  -> structural syntax
  -> lexer
  -> parser helpers and grammar families
  -> concrete/virtual renderer and source maps
  -> semantic projection
  -> public frontend API
```

This is a dependency sketch, not a required file list. Keep every maintained code
file at or below 500 lines and split by ownership before reaching the limit.

Likely coherent parser splits include declarations, expressions, patterns, types,
lists/delimiters, and recovery helpers. Do not split one recursive algorithm across
arbitrary numbered files merely to satisfy line count.

## JavaScript, Deno, and Node are available

Workman can import platform APIs directly:

```wm
from js.global("Deno") import { readTextFile };
from js.global("JSON") import {
  parse: (String) => Js.Object,
  stringify: (Js.Value) => String,
} as JSON;
from js.module("node:path") import { resolve };
```

The exact signatures must match what current reflection accepts. Consult
[`docs/jsffi.md`](../../docs/jsffi.md) and existing imports rather than guessing.

### Use safe FFI only

Safe JS calls normally produce `Result<T, Js.Error>`; Promise-returning calls
produce `Task<T, Js.Error>`. Compose them using the carrier patterns from
[`docs/carriers.md`](../../docs/carriers.md), or match explicitly when branches need
different behavior.

Do not use unsafe imports in frontend-v2 or structural-editor code. That surface is
not sufficiently tested for this project and bypasses the explicit error model the
implementation is meant to exercise.

Existing platform functionality should be imported directly through safe FFI:

- Deno stdin/stdout, filesystem, environment, and timing APIs;
- Node path or other standard modules;
- JavaScript strings, arrays, encoders, and JSON APIs;
- existing generated TypeScript bindings such as the Raylib modules;
- existing TypeScript compiler/LSP services during migration.

Keep new project logic in WM, including:

- token classification policy;
- grammar and recovery decisions;
- fallback construction;
- marks and diagnostic evidence;
- virtual artifact ordering;
- structural/semantic projection.

### Do not add convenience TS/JS helpers

If an existing JS/TS API is difficult to reach, first use a manual safe FFI type,
improve reflection, or improve the WM standard-library wrapper. Do not solve routine
frontend implementation problems by adding a new TypeScript helper behind a WM
call. The exception is integration work inside an already-existing TypeScript
subsystem, such as adapting frontend-v2 DTOs into the current compiler's `Module`
shape; that bridge must not contain frontend behavior.

## Collections and performance

Start with native immutable lists where algorithms naturally consume from the
front. Store accumulators in reverse order and reverse once rather than repeatedly
appending.

Use existing JS arrays through safe FFI when the algorithm needs indexed access or
profiling shows persistent lists dominate runtime. Crossing the FFI for every
character or token may be expensive, so benchmark the available WM/FFI operations
and improve the shared runtime surface when needed rather than creating a private
TypeScript implementation.

For parser state:

- prefer a remaining-token list or cursor abstraction with explicit ownership;
- avoid rescanning source for line/column conversion;
- build line starts once;
- do not tokenize repeatedly for parser, formatter, and inlays;
- keep virtual artifact ordering as explicit data;
- add caches only after document/version ownership exists.

Use the predecessor benchmarks listed in
[`grain-inventory.md`](./grain-inventory.md) to choose representative edit traces.

## Errors inside the implementation

Use different mechanisms for different meanings:

- authored malformed syntax -> structural fallback plus mark, never a thrown host
  exception;
- expected JS boundary failure -> `Result` or `Task`;
- impossible internal invariant -> `Panic` with a concise phase/invariant message;
- batch policy rejecting recovery marks -> a structured diagnostic result, not a
  parser crash.

Do not use `Panic` for user text. The structural grammar must remain total.

## Testing WM code

Current `wm-mini` does not provide a dedicated WM test framework. Phase 0 can use a
small WM assertion module and a `main` entry point:

```wm
let assertBool = (label, condition) => {
  if (condition) {
    void
  } else {
    Panic("assertion failed: " ++ label)
  }
};

let main = () => {
  assertBool("round trip", rendered == source);
  assertBool("two artifacts", artifactCount == 2)
};
```

Run it with:

```sh
deno task wm run tooling/frontend-v2/self_test.wm
```

As the package grows:

- keep pure WM assertions close to pure algorithms;
- use TypeScript black-box tests to run WM executables and inspect process output
  when that improves CI integration;
- use TypeScript tests for the generated JS ABI and LSP protocol boundaries;
- port Workmangr golden behavior rather than rewriting expectations from memory;
- do not create one trivial test per function.

## Phase 0 suggested file shape

One possible starting layout is:

```text
tooling/frontend-v2/
  source.wm       span and source helpers
  token.wm        token/trivia data
  mark.wm         recovery IDs and graded marks
  syntax.wm       minimal structural document forms
  lexer.wm        narrow lossless lexer
  let_parser.wm   first tolerant vertical slice
  preview.wm      concrete/virtual marked rendering
  self_test.wm    wm-run entry point and assertions
```

This is a starting hypothesis. Combine files that remain tiny and split files that
gain distinct responsibilities, while enforcing the 500-line maximum.

The first behavior should remain intentionally small:

```text
complete:    let thing = value;
incomplete:  let thing =
virtual:     let thing = ?;
```

The implementation should demonstrate:

- exact authored-text round trip;
- a valid structural document for both samples;
- a typed fallback rather than absence;
- one stable recovery identity per event;
- graded marks for the hole and semicolon;
- deterministic virtual artifact ordering;
- no TypeScript import requirement.

Once this works cleanly in WM, add importable-library emission and expose the same
package to TypeScript. Do not rewrite the Phase 0 frontend behind the ABI.

## Common mistakes to avoid

- Porting TypeScript classes, nullable fields, mutation, and exception control flow
  directly into WM.
- Porting Grain standard-library/WASI workarounds that JS/Deno already solves.
- Moving grammar or recovery policy into a local TypeScript helper because FFI is
  convenient.
- Treating safe FFI `Result` values as if they were direct values.
- Forgetting `let rec` on recursive traversals.
- Assuming Workman functions curry automatically.
- Assuming bare match identifiers bind in every context.
- Using authored `?` in frontend implementation source before the language supports
  it; represent holes as ADT values instead.
- Repeatedly appending persistent lists in hot paths.
- Letting one parser/LSP file exceed 500 lines before choosing module boundaries.
- Treating large existing examples as code-size precedent.
- Reconstructing Workmangr behavior from plan prose without reading its code and
  tests.
