# Goal 1 Checklist

This checklist tracks `goal1.md` against current implementation evidence.

Status legend:

- Done: implemented and covered by tests or direct source evidence.
- Partial: implemented with known limitations or weak coverage.
- Gap: not yet implemented or not sufficiently verified.
- Out of scope: explicitly excluded by `goal1.md`.

## Scope Decisions

- wm-mini uses Workman syntax over an SML 97 core/module subset.
- `type T = C | D;` is treated as SML `datatype`, not as a Workman-only type form.
- Exported datatypes use SML-style behavior: exporting the datatype also exports its constructors.
- Exhaustiveness follows SML behavior: non-exhaustive matches are frontend diagnostics, not hard
  rejection. This differs from canonical Workman's stricter total-match rule.
- Inline `structure`, `signature`, `functor`, `open`, SML `fun`, exceptions, refs, mutation, traits,
  infection/flow, raw mode, and Basis completeness are out of scope for Goal 1.

## Core Frontend

| Requirement                                                           | Status  | Evidence                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workman lexical structure and reserved words                          | Partial | `src/grammar.peggy`; parser rejection tests cover unsupported SML/advanced Workman syntax. Needs broader lexical negative cases.                                                                                                      |
| Literals: int, float, string, bool, void                              | Partial | Parser/inference support in `src/grammar.peggy`, `src/infer.ts`; tests cover several literals but not float-specific behavior.                                                                                                        |
| Variables and long value identifiers                                  | Done    | `LongName` grammar; import tests use `Math.add`, `Math.Just`, `Lib.value`.                                                                                                                                                            |
| Functions and application                                             | Done    | Lambda grammar/inference; typed/untyped lambda tests; recursive function tests.                                                                                                                                                       |
| Tuples                                                                | Done    | Tuple expression/pattern/type grammar; tuple destructuring and tuple annotation tests.                                                                                                                                                |
| Blocks and local declarations                                         | Done    | Block grammar permits local `let` and `type`; void block and local type escape tests.                                                                                                                                                 |
| `if/else`                                                             | Done    | Grammar/inference require boolean condition and unified branch type; void branch test.                                                                                                                                                |
| `match` expressions and first-class match functions                   | Done    | Grammar/inference support both forms; constructor, pin, binder, exhaustiveness diagnostic tests.                                                                                                                                      |
| Value bindings                                                        | Done    | `LetDecl` inference and tests for polymorphic `let`, annotations, duplicates.                                                                                                                                                         |
| Recursive value/function bindings                                     | Done    | Recursion uses placeholders, requires function RHS, checks annotations, generalizes after solving.                                                                                                                                    |
| Datatype bindings                                                     | Done    | Fresh nominal `TypeInfo`; constructor schemes; duplicate parameter/constructor tests.                                                                                                                                                 |
| Sequential declarations                                               | Done    | Module and block inference process declarations in order; shadowing tests cover sequential behavior.                                                                                                                                  |
| Patterns: wildcard, literals, tuples, constructors, pins, `Var(name)` | Done    | Pattern grammar/inference; tests cover constructor binding, tuple pins, missing pins, explicit binders.                                                                                                                               |
| Hindley-Milner inference with principal types                         | Partial | Core Algorithm W-style inference is implemented. Tests cover polymorphic lets, recursive functions, annotations, tuples, ADTs. No formal principal-type oracle yet.                                                                   |
| Generalization/instantiation boundaries                               | Partial | Let, destructuring, recursive, and local type escape tests cover key cases. Value restriction is not modeled because mutable/effectful constructs are out of scope.                                                                   |
| Duplicate binder/declaration restrictions                             | Done    | Tests cover duplicate pattern binders, tuple let binders, type params, constructors, recursive destructuring, import collisions.                                                                                                      |
| Nominal datatype identity                                             | Done    | Same-spelled datatypes from different files reject unification.                                                                                                                                                                       |
| Exhaustiveness                                                        | Partial | SML-style diagnostics implemented for missing constructors, non-sum literal matches, nested finite constructor patterns, and redundant arms. Full SML-quality pattern coverage for all infinite/refined spaces is still conservative. |

## Module Frontend

| Requirement                                          | Status | Evidence                                                                                               |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Each `.wm` file elaborates as an implicit structure  | Done   | `src/compiler.ts` module graph; `inferModule` returns value/type exports.                              |
| Namespace imports produce long identifiers           | Done   | `from "./math.wm" import * as Math;` tests and examples.                                               |
| Named imports with aliases                           | Done   | Named import tests for values, constructors, and types.                                                |
| Imported values and constructors as long identifiers | Done   | Tests use `Boxed.make`, `Math.Just`, named `Some`/`None`.                                              |
| Imported type constructors as long names             | Done   | Tests use `Boxed.Box<Number>` and nominal cross-file types.                                            |
| Default exports                                      | Done   | Import tests cover plain values, constructors, and types through named and namespace imports.          |
| Import cycles rejected                               | Done   | Deterministic cycle test.                                                                              |
| Transitive imports                                   | Done   | `base -> mid -> main` test.                                                                            |
| Duplicate import collisions                          | Done   | Tests cover duplicate named import, duplicate namespace alias, and cross-declaration named collisions. |

## Verification Coverage

| Required test category                         | Status  | Evidence                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser acceptance for supported Workman syntax | Partial | Existing tests parse core forms indirectly; a dedicated parser acceptance matrix is still useful.                                                                                                                         |
| Parser rejection for unsupported syntax        | Partial | Tests reject `fun`, `structure`, infection syntax. More unsupported Workman forms can be added as syntax grows.                                                                                                           |
| Type inference tests                           | Done    | Tests cover polymorphic let, recursive functions, tuples, functions, datatypes, annotations.                                                                                                                              |
| Datatype nominality tests                      | Done    | Cross-file `Box` test.                                                                                                                                                                                                    |
| Long identifier tests                          | Done    | Namespace import tests for values, constructors, and type constructors.                                                                                                                                                   |
| Module graph tests                             | Done    | Transitive import and cycle rejection tests.                                                                                                                                                                              |
| Syntactic restriction tests                    | Done    | Duplicate binders/constructors/type params/binding groups/import collisions.                                                                                                                                              |
| Negative type tests with diagnostics           | Partial | LSP tests now verify type diagnostic codes and non-empty spans. Pattern tests verify structured refutability and redundancy diagnostics. Stage/node-id fields are still not part of the current compact diagnostic shape. |

## Codebase Constraints

| Constraint                        | Status  | Evidence                                                                                                                                       |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Source files under 500 lines      | Done    | `src/infer.ts` is 498 lines after extracting import and snapshot helpers; generated/vendor files are excluded from this rule.                  |
| Split files approaching limit     | Partial | `src/infer.ts` is split but still close to the limit, so the next inference feature should move declarations or expressions into `src/infer/`. |
| Keep implementation boring/direct | Done    | Small direct modules; Peggy parser; no unnecessary abstraction yet.                                                                            |

## Remaining High-Value Work

1. Continue splitting `src/infer.ts` before adding more inference behavior.
2. Add a dedicated parser acceptance/rejection matrix tied to Workman reference productions.
3. Improve SML match diagnostics from conservative coverage to fuller witness generation for
   infinite/refined spaces.
4. Add recovery continuation for parse/type failures so one frontend run can report more than the
   first hard error in a broken module.
5. Add a short supported-subset reference document once the frontend surface stabilizes.
