# Current Subset Ledger

This note is the working inventory for current `wm-mini` as compared with
Standard ML '97. It is intentionally more checklist-like than the syntax and
semantic notes.

Use it to answer two questions:

- What part of SML has actually made it into `wm-mini`?
- Which `wm-mini` features should be reconsidered before they become permanent
  parts of the formal core?

## Kept SML Core Shape

These are the strongest currently grounded SML correspondences in `wm-mini`.
Each item below includes a Standard ML Definition anchor and a current
`wm-mini` implementation or test anchor:

- Let-bound value generalization and declaration-ordered visibility.
  SML anchor: `syncor.tex` value declarations and `statcor.tex`
  `valdec`/closure rules. `wm-mini` anchor:
  `tests/type_elaboration_test.ts` declaration snapshots and
  `src/infer/decl.ts`.
- Recursive value groups. SML anchor: `syncor.tex` `val rec` and recursive
  value-binding syntax; it requires recursive value expressions to be function
  expressions. `wm-mini` anchor: `src/grammar.peggy` parses
  `let rec ... and ...`, and `tests/recursive_test.ts` verifies guarded
  recursive use and rejection of unguarded recursive values.
- Algebraic datatypes and constructors. SML anchor: `syncor.tex` datatype
  declarations and `statcor.tex` datatype elaboration. `wm-mini` anchor:
  `src/grammar.peggy` `TypeDecl`, plus `tests/datatype_test.ts` and
  `tests/type_elaboration_test.ts`.
- Function values. SML anchor: `syncor.tex` `fn` expressions and
  `statcor.tex` function-expression typing. `wm-mini` anchor:
  `src/grammar.peggy` `Lambda`/`MatchFn` and `tests/call_test.ts`.
- Tuple-shaped application for comma calls. SML anchor: `syncor.tex`
  application is unary and tuples are records/products rather than a separate
  multi-argument call convention. `wm-mini` anchor: `src/grammar.peggy`
  `ArgList`, `TupleOrGroup`, and `tests/call_test.ts` showing `f(1, 2)` and
  `f((1, 2))` have the same tuple-argument behavior.
- Expression-valued `if` and `match`. SML anchor: `syncor.tex` expression
  syntax for `if` and `case`. `wm-mini` anchor: `src/grammar.peggy` `IfExpr`
  and `MatchExpr`, plus pattern/exhaustiveness tests in
  `tests/pattern_test.ts`.

Items still needing explicit grounding before they can be claimed here:
lexical scope as a whole, closure dynamic semantics, exact value restriction,
and block/sequence typing beyond the parser-level final-expression rule.

## Re-Spelled SML Concepts

These are mostly notation changes:

| SML | Current `wm-mini` |
| --- | --- |
| `val x = e` | `let x = e;` |
| `val rec f = fn x => e` | `let rec f = (x) => { e };` |
| `fn x => e` | `(x) => { e }` |
| `case e of ...` | `match(e) { ... }` |
| `if a then b else c` | `if (a) { b } else { c }` |
| `datatype 'a t = C of 'a` | `type T<A> = C<A>;` |
| `int`, `string`, `bool`, `unit` | `Number`, `String`, `Bool`, `Void` |
| `()` | `void` |
| `f (x, y)` | `f(x, y)` or `f((x, y))` |
| `f x y` | `f(x)(y)` |

The key verified preservation rule is that `wm-mini` comma-argument calls are one
tuple-shaped argument. This avoids silently switching to JavaScript-style
multi-argument function semantics. Anchor: `tests/call_test.ts`.

## Changed Semantics

These are not just spelling:

- Records are nominal declarations, not SML structural row types. SML anchor:
  `statcor.tex` defines record/row types as finite maps from labels to types.
  `wm-mini` anchor: `src/grammar.peggy` `RecordDecl` and
  `tests/record_test.ts`.
- Bare identifiers in `match` patterns are pinned by default. Fresh binders use
  `Var(name)` except in constructor payload, lambda parameter, and `let`
  patterns. SML anchor: `syncor.tex` says an identifier in a pattern is a
  constructor if a datatype binding introduced it as such, otherwise a value
  variable. `wm-mini` anchor: `src/grammar.peggy` emits `PPinned` for ordinary
  bare match identifiers and `PVar` for `Var(name)`, constructor payload
  binders, lambda parameters, and `let` patterns; `tests/pattern_test.ts`
  verifies the behavior.
- Blocks currently allow declaration and expression items to be mixed. SML
  anchor: `syncor.tex` has `let dec in exp end` for local declarations and
  parenthesized sequence expressions for expression sequencing. `wm-mini`
  anchor: `src/grammar.peggy` `BlockSeqItem`.
- A trailing semicolon in a block or parenthesized sequence means an inserted
  final `void` result. SML anchor: `syncor.tex` sequence expressions require
  expressions between semicolons; there is no trailing-semicolon-as-unit result
  rule. `wm-mini` anchor: `src/grammar.peggy` `BlockSeqBody` and `ParenSeqBody`.
- General exceptions are absent from the grammar; the current basis and syntax
  provide `Option`, `Result`, and `Panic` instead. SML anchor: `syncor.tex`
  and `statcor.tex` include `exception`, `raise`, and `handle`. `wm-mini`
  anchor: `src/grammar.peggy` has `PanicExpr` but no exception declaration,
  raise, or handle forms; `std/option.wm`, `std/result.wm`, and
  `tests/basis_combinator_test.ts` cover the replacement value-level idioms.
- File imports are path-based declarations, not SML `open` declarations over
  already-bound structure identifiers. SML anchor: `syncor.tex` has `open` as a
  declaration over structure identifiers, and `statcor.tex` gives the
  open-declaration rule. `wm-mini` anchor: `src/grammar.peggy` `ImportDecl`,
  `src/infer/imports.ts`, and `tests/module_test.ts`.
- The operator table is fixed in the grammar and runtime, not controlled by
  SML fixity directives or user-defined symbolic identifiers. SML anchor:
  `syncor.tex` fixity directives and `app4.tex` initial infix basis.
  `wm-mini` anchor: `src/grammar.peggy` binary operator precedence,
  `src/infer/expr_flow.ts`, `src/types_basis.ts`, `src/core/emit_js.ts`, and
  `src/core/emit_prelude.ts`.

## Omitted SML Features

Current `wm-mini` omits large parts of SML:

- SML module language: `structure`, `signature`, `functor`, signature matching,
  opaque ascription, sharing constraints, `where type`, `include`, and SML
  `open`.
- General exceptions: `exception`, `raise`, and `handle`.
- Mutable references and assignment: `ref`, `!`, and `:=`.
- Arrays and vectors as SML Basis types.
- Fixity declarations: `infix`, `infixr`, and `nonfix`.
- Custom symbolic identifiers as user-defined operators.
- Equality type variable syntax and `eqtype` specifications.
- `fun` as a separate declaration form, including SML-style multi-clause
  function declarations.
- `local ... in ... end` as an exact declaration form.
- `abstype`.
- Datatype replication.
- `withtype`.
- SML record row polymorphism and flexible record inference.
- Character literals.
- SML numeric tower and numeric overloading.
- Full Standard ML Basis Library.

Some omissions may be permanent design choices; others may be future features.
They should not be treated as accidental gaps without a design note.

## Needs Grounding Before Classifying

These are verified `wm-mini` facts, but they should not be listed as SML
differences until the matching SML rule has been checked:

- Top-level file declarations are visible to imports by default. `wm-mini`
  anchor: `tests/module_test.ts` checks `exportedStructure`. This is not yet a
  difference claim, because SML structure visibility and signature/ascription
  hiding need a direct `synmod.tex`/`statmod.tex` comparison.
- There is no current `export` marker. This is not by itself an SML difference;
  SML controls module interfaces through signatures and ascription, not an
  `export` keyword.
- Import collision behavior rejects duplicate imported names at the import
  point, while later local declarations may shadow imported bindings. `wm-mini`
  anchor: `src/infer/imports.ts`, `tests/module_test.ts`, and
  `tests/compiler_module_test.ts`. This still needs comparison against SML
  environment enrichment and `open` elaboration before being called a semantic
  difference.
- The basis is `wm-mini`-specific and JS-oriented. This needs a grounded
  inventory against `intro.tex`/`app3.tex` before individual basis differences
  are treated as formal claims.
- Equality is exposed through fixed `==`/`!=` operators and checked with the
  current `admitsEquality` predicate. `wm-mini` anchor: `src/types_basis.ts`,
  `src/infer/equality.ts`, and equality call sites in
  `src/infer/expr_flow.ts`.
  This still needs a focused comparison against SML equality identifiers,
  equality type variables, and equality attributes before being called a
  semantic difference.
- Value generalization uses the current `src/infer/decl_binding.ts`
  `generalizeBinding` rule: non-expansive values can be generalized, while
  expansive values, unresolved FFI types, and FFI-boundary expressions are not.
  This needs a direct comparison against `statcor.tex` non-expansive
  expressions and closure rules before being called a semantic difference.
- Files and imports are the current module boundary. They expose visible file
  environments, but this should not be treated as an SML difference until the
  comparison with SML structure expressions, signature/ascription hiding, and
  structure environments has been completed.

## wm-mini Extensions Outside SML

These are useful, but they are outside the SML subset:

- JavaScript and TypeScript FFI imports.
- `unsafe` JS imports.
- `Task<T, E>` and promise-oriented interop.
- `Js.Value`, `Js.Object`, `Js.Array<T>`, `Js.Dict<T>`, and `Js.Error`.
- `JSON{}` and `JSON[]` literals for JS object/array construction.
- Forward pipe `:>`, including member-call pipe forms such as `value :> .map(...)`.
- Backtick multiline strings.
- Line comments: `--` and `//`.
- `Panic("message")` as a bottom-like expression.

These should be specified as boundary features layered around the core. They
are not evidence for or against any SML correspondence unless the relevant SML
Definition rule and `wm-mini` implementation rule are both checked.

## Reconsideration Queue

These are features already present or documented that deserve explicit design
decisions before formalization:

- `private` is not implemented yet. Until it exists, the file boundary has no
  source-level hiding mechanism.
- Mixed declaration/expression block items. This is convenient, but weakens the
  clean SML `declarations then expression` model.
- Pinned bare match identifiers. This is useful for value-pattern style
  matching, but is a major surprise for SML readers.
- `Var(name)` binder syntax. It solves the pinning ambiguity, but makes binding
  patterns visibly non-SML.
- Trailing-semicolon-as-`Void`. It is pragmatic, but should be specified as
  sugar for an inserted `void` expression.
- Nominal records. This likely should stay, but it should be documented as a
  deliberate rejection of SML row polymorphism.
- `Number` as a single numeric type. This simplifies JS interop, but it is not
  SML's `int`/`real` split or overloading story.
- Fixed built-in operator table. If custom fixity stays omitted, the current
  table becomes part of the language definition.
- File imports with `import *`. This is `wm-mini` open-import syntax. It brings
  a file's visible top-level environment into unqualified scope; it must not be
  described as SML `open` without also stating that SML `open` operates on
  already-bound structure identifiers.
- Pipe/member-call syntax. It is ergonomic, but it creates a `wm-mini`-specific
  application form that should be desugared precisely.
- `Panic` as a bottom-like expression. It is useful as the replacement for
  exceptions and holes, but it needs an explicit typing rule and runtime rule.

## Formalization Order

A practical formalization order:

1. Define the core expression and declaration grammar after `wm-mini` surface
   desugaring.
2. Define values, environments, type environments, and constructor environments.
3. Specify datatype/type-alias elaboration and constructor typing.
4. Specify nominal record declaration, construction, projection, and pattern
   matching.
5. Specify block and sequence typing, including trailing semicolon.
6. Specify pattern typing and binding, including pinned identifiers.
7. Specify value generalization and the `wm-mini` value restriction.
8. Specify equality and primitive operators.
9. Specify module/file import elaboration separately from SML modules.
10. Specify JS FFI as an outer boundary, not as part of the pure core.
