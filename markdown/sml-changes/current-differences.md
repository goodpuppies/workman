# Current Subset Ledger

This note is the working inventory for current `wm-mini` as a subset of, and
departure from, Standard ML '97. It is intentionally more checklist-like than
the syntax and semantic notes.

Use it to answer two questions:

- What part of SML has actually made it into `wm-mini`?
- Which Workman features should be reconsidered before they become permanent
  parts of the formal core?

## Kept SML Core Shape

These are the strongest SML-aligned pieces of current `wm-mini`:

- Lexical scope.
- Hindley-Milner-style inference.
- Let-bound values with declaration-ordered elaboration.
- Explicit recursive value groups through `let rec ... and ...`.
- Algebraic datatypes with constructor payloads as one logical argument.
- Tuples as product values.
- Expression-valued `if`.
- Expression-valued pattern matching.
- Function values and closures.
- Blocks/sequences whose result is the final expression, except for the
  Workman trailing-semicolon extension.
- Parametric polymorphism for ordinary pure values.

These should be treated as the formalization anchor. Where possible, the future
rules should be a small translation from Workman surface syntax into this
SML-shaped core.

## Re-Spelled SML Concepts

These are mostly notation changes:

| SML | Current Workman |
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

The key preservation rule is that Workman comma-argument calls are still one
tuple-shaped argument. This avoids silently switching to JavaScript-style
multi-argument function semantics.

## Changed Semantics

These are not just spelling:

- Records are nominal declarations, not SML structural row types.
- Bare identifiers in `match` patterns are pinned by default. Fresh binders use
  `Var(name)` except in constructor payload, lambda parameter, and `let`
  patterns.
- Blocks currently allow declaration and expression items to be mixed.
- A trailing semicolon in a block or parenthesized sequence means a final
  `void` result.
- General exceptions are replaced by `Option`, `Result`, and `Panic`.
- Equality is exposed as built-in `==`/`!=`, not as SML equality type variables
  and the full equality-type discipline.
- The basis is Workman-specific and JS-oriented rather than the SML initial
  basis or full Basis Library.
- Files and imports are the current module boundary. They expose structure-like
  visible environments, but not SML signatures, functors, ascription, sharing,
  or generative module semantics.
- Top-level declarations are visible to imports by default. There is no current
  `export` marker.
- File imports are path-based declarations. Their source-order elaboration is
  SML-like; their path resolution and cycle rejection are Workman-specific.
- Import collision behavior is Workman-specific: duplicate imported names are
  rejected at the import point, while later local declarations may shadow an
  imported binding.

## Omitted SML Features

Current `wm-mini` deliberately omits large parts of SML:

- SML module language: `structure`, `signature`, `functor`, signature matching,
  opaque ascription, sharing constraints, `where type`, `include`, and SML
  `open`.
- General exceptions: `exception`, `raise`, and `handle`.
- Mutable references and assignment: `ref`, `!`, and `:=`.
- Arrays and vectors as SML Basis types.
- Fixity declarations: `infix`, `infixr`, and `nonfix`.
- Custom symbolic identifiers as user-defined operators.
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

Some omissions are probably permanent for `wm-mini`; others may be future
features. They should not be treated as accidental gaps without a design note.

## Workman Extensions Outside SML

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

These should be specified as boundary features layered around the core, not as
evidence that the core itself has stopped being ML-shaped.

## Reconsideration Queue

These are features already present or documented that deserve explicit design
decisions before formalization:

- File declarations are visible to imports by default, matching the SML-shaped
  model where structures expose their resulting environment and hiding is a
  separate boundary feature.
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
- File imports with `import *`. This is Workman's open-import form. It is close
  to SML `open` only in the narrow sense of bringing names into unqualified
  scope; it opens a file's visible top-level environment rather than an
  already-bound SML structure.
- Pipe/member-call syntax. It is ergonomic, but it creates a Workman-specific
  application form that should be desugared precisely.
- `Panic` as a bottom-like expression. It is useful as the replacement for
  exceptions and holes, but it needs an explicit typing and runtime rule.

## Formalization Order

A practical formalization order:

1. Define the core expression and declaration grammar after Workman surface
   desugaring.
2. Define values, environments, type environments, and constructor environments.
3. Specify datatype/type-alias elaboration and constructor typing.
4. Specify nominal record declaration, construction, projection, and pattern
   matching.
5. Specify block and sequence typing, including trailing semicolon.
6. Specify pattern typing and binding, including pinned identifiers.
7. Specify value generalization and the Workman value restriction.
8. Specify equality and primitive operators.
9. Specify module/file import elaboration separately from SML modules.
10. Specify JS FFI as an outer boundary, not as part of the pure core.
