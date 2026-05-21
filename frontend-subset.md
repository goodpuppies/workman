# wm-mini Goal 1 Frontend Subset

`wm-mini` is a deliberately small descendant of Workman and Standard ML. The surface syntax is
closer to Workman, but the frontend is meant to preserve the SML semantic shape wherever the
supported subset overlaps SML.

The long-term direction is:

- small enough to stay understandable
- rigorous enough that the SML-overlapping core could be related formally to the SML Definition
- practical enough to become self-hostable in a small subset before growing into a fuller language

Goal 1 is only the frontend: parsing, module/file loading, static semantics, type inference, and
diagnostics. JavaScript emission is a smoke-test harness, not the semantic target.

The eventual `wm-mini` surface should cover the practical Workman syntax guide. Goal 1 grows toward
that surface in stages: basic semantic features first, advanced ergonomic sugar later.

## Surfaces And Core

Goal 1 has two frontend surfaces that elaborate into the same AST and inference core:

- `workman`: the main wm-mini source surface
- `wmsml`: a verification surface for a small SML Core subset

These are not two languages. They are two spellings of overlapping constructs. Tests should prefer
checking that equivalent `workman` and `wmsml` programs produce the same inferred binding shapes.

## Workman Surface

Supported top-level declarations:

- `from "./file.wm" import * as Name;`
- `from "./file.wm" import { value, Type, Ctor as Alias };`
- `let pattern = expr;`
- `let rec name = expr;`
- `let a = expr and b = expr;`
- `type T<A> = C<A> | D;`
- `type Alias<A> = Other<A>;`
- `record R<A> = { field: A };`

Supported expressions:

- literals: numbers, strings, booleans, `void`
- variables and long variables such as `Math.add`
- lambdas: `(x) => { body }`, `(x, y) => { body }`, `=> { body }`
- calls: `f(x)`, `f(x, y)`, `f(x)(y)`
- tuples
- list literals such as `[]`, `[a, b, c]`, and `[head, ..tail]`
- nominal record construction and field access
- blocks with local declarations
- `if (cond) { then } else { else }`
- `match(value) { pattern => { body }, ... }`
- first-class match functions: `match(x) => { ... }`
- built-in unary and binary operators currently present in `baseEnv`

Supported patterns:

- wildcard `_`
- literals
- tuples
- list patterns such as `[]`, `[x, y]`, and `[head, ..tail]`
- nominal record patterns
- constructors and long constructors
- pinned names in match patterns
- explicit binders with `Var(name)` in match patterns
- ordinary binders in lambda and let patterns

Important Workman differences from SML:

- bare match identifiers are pinned, not binders
- `Var(name)` introduces a match binder
- type application is `Type<T>`, not SML postfix syntax
- files are the module/structure boundary

## wmsml Verification Surface

`wmsml` intentionally supports only the SML subset needed to check shared semantics:

- `val`
- `val rec`
- `and`
- `fn`
- `case ... of`
- `if ... then ... else ...`
- `datatype`
- SML tuple types with `*`
- right-associative type arrows with `->`
- postfix type application such as `'a option`
- nested SML comments

`wmsml` is not a full SML parser. Unsupported SML features should stay unsupported unless they help
verify a Goal 1 construct.

## Static Semantics Target

The supported subset aims for:

- Hindley-Milner inference with principal types
- explicit generalization and instantiation boundaries
- simultaneous `and` groups
- recursive groups solved before generalization
- nominal datatype identity using fresh type ids
- transparent type aliases
- constructor arity checks
- type constructor arity checks
- duplicate binder/declaration checks
- file environments exposed through long identifiers
- deterministic import cycle rejection
- basic list literals and patterns backed by a regular algebraic list model
- basic nominal records with declaration, construction, field access, and pattern support

The current Goal 1 subset intentionally omits:

- refs and mutation
- value restriction
- equality types
- numeric overloading
- SML flexible record inference
- advanced record ergonomics such as spread and flexible record updates
- custom operators, fixity declarations, and pipe syntax
- holes and panic expressions
- exceptions
- signatures, functors, sharing, `open`
- full Basis library
- Workman infection, flow, traits, raw/FFI, and backend profiles

## Verification Style

Tests should increasingly assert elaboration facts, not just pass/fail:

- inferred scheme at a binding
- environment snapshot after each declaration
- constructor/type availability after datatype declarations
- module import environments
- exact negative diagnostics where practical

Use `checkSourceSteps` when the question is “what does the frontend know after this declaration?”
Use `checkSource` or `checkFile` when the final module environment is enough.
