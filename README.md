# wm-mini

`wm-mini` is a deliberately boring, small Workman side language: an SML-flavored functional core
written in Deno TypeScript, with JavaScript as its only backend.

The intent is to keep the implementation tiny and legible while preserving the parts that matter for
experimenting with a complete language:

- Hindley-Milner style inference with generalized `let` bindings
- recursive and mutually recursive `let rec ... and ...`
- nominal algebraic data types
- file imports as implicit SML-style structures
- constructor, tuple, and eventually list/record pattern matching
- expression blocks, lambdas, `if`, primitive operators, and `void`
- typed JavaScript namespace imports for small FFI bindings
- temporary JavaScript output for smoke tests

Each implementation source file should stay under 500 lines. Markdown docs and research/stress notes
may exceed that when the document benefits from staying whole. When the language grows, split source
files before they become archives.

## Reference Bias

This project uses:

- `research/The-Definition-of-Standard-ML-Revised` for the boring FP core shape: declarations,
  expressions, patterns, lexical conservatism, and static/dynamic separation.
- `research/workmangr/docs/reference` for Workman spelling and goals: `let`, `type`, constructor
  syntax, `match(...) { ... }`, blocks, and explicit semicolon top-level declarations.

Skipped on purpose for now: infection, flow, traits, raw/FFI, backend profiles, mutability, and
non-JS compilation. Basic lists and nominal records are part of the frontend roadmap; advanced
record ergonomics are staged later.

## SML Reduction Rule

SML is the semantic checklist, not the surface syntax target.

Workman keeps one obvious form when SML has both a core form and sugar:

- SML `fun f x = e` reduces to Workman `let rec f = (x) => { e };`.
- SML `structure M = struct ... end` reduces to a Workman file imported as a namespace:
  `from "./m.wm" import * as M;`.
- `from "./m.wm" import *;` opens all exported values, constructors, and types into local scope.
- JavaScript globals can be imported through TypeScript-backed reflection:
  `from js.global("Math") import { max as jsmax, floor };`.
- JavaScript modules use the same import clauses with `js.module`, such as
  `from js.module("node:crypto") import { createHash };`.
- Promise-returning JavaScript APIs become eager `Task` handles; see
  [`docs/async.md`](./docs/async.md) for the current async model.
- Manual JS type annotations are still available when reflection is too broad:
  `from js.global("console") import { log: (String, Number) => Void } as console;`.
- Inline structures, functors, signatures, `fun`, and other SML conveniences are not syntax goals
  unless Workman needs them.

Internally, each file should elaborate like an SML structure environment: values, constructors, and
eventually type names live in that file environment, and imports expose those components through
long identifiers such as `Math.add`.

## Frontend First

The current priority is the frontend: parsing, file-as-structure imports, long identifiers, nominal
datatype inference, and SML-guided static semantics. JavaScript emission exists only as a smoke-test
harness until the frontend is rigorous.

See [`frontend-subset.md`](./frontend-subset.md) for the exact Goal 1 frontend subset and the
Workman/SML correspondence used by the tests.

## Try It

```sh
deno task check
deno task test
deno task wm run examples/factorial.wm
deno task compile examples/factorial.wm /tmp/factorial.js
deno run /tmp/factorial.js
deno task wm compile examples/use_math.wm /tmp/use_math.js
deno task wm run examples/use_math.wm
```

The example prints:

```txt
120
some
```

To install the local CLI as `wm`:

```sh
deno install --global --allow-read --allow-write --allow-run --allow-env --name wm src/main.ts
wm run examples/factorial.wm
```
