# Goal 1: Rigorous SML-Based Frontend

Build a complete frontend for `wm-mini`: parsing, module/file loading, static semantics, and
frontend diagnostics for a deliberately small language.

`wm-mini` is **not** a full Workman implementation. It is a subset of SML 97 with Workman syntax:
Workman source forms and file imports backed by SML-style Core and Modules semantics wherever the
subset overlaps.

JavaScript output is not the priority for this goal. The backend may remain a smoke-test harness
while the frontend becomes rigorous.

## Semantic Target

Use `research/The-Definition-of-Standard-ML-Revised` as the semantic checklist. When `wm-mini`
supports a feature that overlaps SML 97, it should follow the SML Definition accurately unless this
document explicitly marks it out of scope.

Core frontend target:

- lexical structure and reserved words appropriate for the Workman surface
- expressions: literals, variables, functions, application, tuples, blocks, `if/else`, and `match`
- declarations: value bindings, recursive value bindings, datatype bindings, sequential
  declarations, and local block declarations
- patterns: wildcard, literals, tuples, constructors, pinned names, and explicit `Var(name)` binders
- Hindley-Milner inference with principal types for the supported subset
- correct generalization/instantiation boundaries
- recursive binding inference compatible with the intended Workman reduction of SML `fun`
- duplicate binder and duplicate declaration checks matching SML-style syntactic restrictions
- nominal datatype identity using fresh type names, not string equality
- long value identifiers and long type constructors

Module/frontend target:

- each `.wm` file elaborates as an implicit SML-style structure environment
- imports expose file environments through long identifiers: `from "./math.wm" import * as Math;`
- imported values and constructors are used as `Math.add`, `Math.Some`, etc.
- imported type constructors are used as `Math.Box<T>`
- import cycles are rejected
- inline SML `structure`, `signature`, `functor`, and `open` syntax are not part of Goal 1

## Workman Surface

Use `research/workmangr/docs/reference` and `research/workman/workmansyntaxguide.md` as the syntax
guide.

The source syntax should be Workman syntax:

- functions use `let f = (x) => { ... };`
- recursive functions use `let rec f = (x) => { ... };` or `let rec f = match(x) => { ... };`
- algebraic datatypes use `type Option<T> = None | Some<T>;`
- matches use `match(value) { ... }` or first-class `match(x) => { ... }`
- files are modules; no inline `module Math { ... }`

When SML has sugar that Workman does not need, omit it rather than copying it. Examples:

- no SML `fun` syntax
- no inline `struct ... end`
- no signatures/functors until a later goal
- no SML basis library completeness requirement

## SML / Workman Overlap

Workman and SML overlap heavily in the frontend subset we care about. The main difference is that
Workman keeps a smaller, more regular syntax for the same underlying ideas.

Strong overlap:

- `let` value bindings map to SML `val` declarations.
- `let rec` function values map to SML recursive value/function bindings.
- Workman lambdas `(x) => { ... }` map to SML `fn`.
- Workman block-local `let` declarations map to SML local declarations/`let ... in ... end`.
- Workman `type T<A> = C<A> | D;` maps to SML `datatype`.
- Workman constructor calls and constructor patterns map to SML value constructors.
- Workman tuples map to SML tuple records/products.
- Workman `match` maps to SML `case`/`fn` match rules.
- Workman type variables and HM inference map to SML type schemes/generalization.
- Workman qualified names from imports map to SML long identifiers through structure environments.
- A Workman file maps to an implicit SML-style structure environment.

Intentional surface differences:

- Workman has no SML `fun` syntax; use `let rec f = (x) => { ... };`.
- Workman has no inline `struct ... end`; files are the structure boundary.
- Workman uses `Type<T>` syntax instead of SML postfix type constructors.
- Workman uses `match(x) => { ... }` and `match(x) { ... }` instead of SML `fn`/`case` syntax.
- Workman uses explicit `from "...wm" import ...` instead of SML top-level `structure` declarations.
- Workman patterns bind with `Var(x)` in match positions where bare names are pinned.

Non-overlap for Goal 1:

- SML exceptions, refs, signatures, functors, sharing constraints, and the full Basis are out of
  scope.
- Workman infection types, flow, traits, raw mode, and other advanced Workman-only features are out
  of scope.

## Explicit Non-Goals

Goal 1 does not include:

- infection types or flow/infection semantics
- traits/interfaces
- mutation
- exceptions
- FFI/raw mode
- optimizer work
- production JS backend/runtime
- self-hosting
- full Workman compatibility

## Verification

The frontend must be verified with tests that correspond to the SML Definition sections and Workman
syntax reference.

Required test categories:

- parser acceptance tests for valid Workman syntax in the supported subset
- parser rejection tests for unsupported SML/Workman syntax
- type inference tests for polymorphic `let`, recursive functions, tuples, functions, and datatypes
- datatype nominality tests proving same-spelled datatypes from different files are distinct
- long identifier tests for imported values, constructors, and type constructors
- module graph tests for transitive imports and cycle rejection
- syntactic restriction tests for duplicate binders, duplicate constructors, duplicate type
  parameters, and duplicate bindings in the same group
- negative type tests with clear diagnostic expectations

Prefer frontend-only tests through a `checkFile`/`checkSource` style API. Backend tests may exist
only as smoke tests.

## Codebase Constraints

- No source file may exceed 500 lines.
- If a file approaches the limit, split it by responsibility.
- For large areas, create folders:
  - `src/infer/` for inference environment, unification, schemes, and rules
  - `src/parser/` for grammar/parser helpers if needed
  - `src/modules/` for file graph and structure environment logic
  - `src/ast/` for AST types if they grow
- Keep implementation boring and direct.
- Prefer small explicit data structures over clever abstractions.
- Use libraries where they reduce implementation surface without obscuring semantics.

## Done Means

Goal 1 is done when:

- the supported frontend subset is documented
- every supported construct has parser and inference tests
- long value/type identifiers and file-as-structure imports behave according to the SML based
  environment model
- datatype declarations are nominal and fresh
- import cycles are rejected deterministically
- all source files are under 500 lines
- the test suite can be used as a practical checklist against the SML Definition and Workman syntax
  references
