# Semantic Differences From SML

This note records places where current `wm-mini` does not merely spell SML
differently, but changes behavior, typechecking, elaboration, or the language
boundary. A point belongs here only after checking the relevant Standard ML
Definition rule and the current `wm-mini` implementation or tests.

## Nominal Records

SML records are structural row types. A record expression such as:

```sml
{ x = 1, y = 2 }
```

has a structural record type determined by its labels and field types.

`wm-mini` records are nominal. A record type must be declared:

```wm
record Point = { x: Number, y: Number };
let p: Point = .{ x = 1, y = 2 };
```

Two same-shaped records are distinct:

```wm
record Point = { x: Number, y: Number };
record Vector = { x: Number, y: Number };
```

This is a semantic difference: SML record compatibility is determined by row
labels and field types, while current `wm-mini` record compatibility depends on
the declared record type name.

Current implementation consequence: an unannotated `wm-mini` record literal can
be ambiguous if more than one nominal record has the same required fields.

Anchors: SML record types are structural rows in `statcor.tex`; current
`wm-mini` record declarations and literals are parsed by `src/grammar.peggy`
`RecordDecl`/record expressions, inferred in `src/infer/records.ts`, and
covered by `tests/record_test.ts`.

## Blocks Versus `let ... in ... end`

SML local declarations are written:

```sml
let
  dec
in
  exp
end
```

`wm-mini`'s primary local form is a block expression:

```wm
{
  let x = 1;
  x + 1
}
```

That spelling alone would be syntactic, but current `wm-mini` also permits mixing
declarations and expression sequence items:

```wm
{
  print("before");
  let x = 1;
  print("after");
  x
}
```

This is more permissive than SML's `let dec in exp end` split, where
declarations belong before `in` and expressions belong after it.

This section only claims the current difference. Whether mixed block items
should remain in the formal core belongs in the open formalization list below.

Anchors: SML local declarations and sequence expressions are in `syncor.tex`.
Current `wm-mini` mixed block items are parsed by `src/grammar.peggy`
`BlockSeqItem`, inferred by `src/infer/expr_lambda.ts`, and covered by
statement-only block tests in `tests/compiler_test.ts`.

## Trailing Semicolon Means `Void`

SML sequence expressions have a final expression:

```sml
(exp1; exp2)
```

`wm-mini` adds a trailing-semicolon extension in sequence contexts:

```wm
{ exp; }
(exp;)
```

means:

```wm
{ exp; void }
(exp; void)
```

So a trailing expression semicolon forces a `Void` result. This makes these two
forms intentionally different:

```wm
{ print("a") }   -- result is whatever print returns
{ print("a"); }  -- result is Void
```

Anchors: SML sequence expressions are in `syncor.tex`. Current `wm-mini`
inserts `Void` when `src/grammar.peggy` `BlockSeqBody` or `ParenSeqBody` has no
final result expression; `tests/compiler_test.ts` checks statement-only blocks,
empty blocks, and `(1;)` as `Void`.

## Pattern Identifier Defaults

In SML, an unqualified lowercase identifier in a pattern normally binds a fresh
variable unless it is known as a constructor.

`wm-mini` match patterns use pinned bare identifiers by default:

```wm
let expected = 42;

match(actual) {
  expected => { "matched existing value" },
  _ => { "different" },
}
```

Fresh match binders use `Var(name)`:

```wm
match(actual) {
  Var(x) => { x },
}
```

Constructor payload patterns, let patterns, and lambda parameter patterns bind
payload names rather than pinning existing values:

```wm
match(opt) {
  Some(x) => { x },
  None => { 0 },
}
```

This is a semantic difference because the same bare identifier spelling in a
match arm means "compare with the existing value" in current `wm-mini`, while
the corresponding SML pattern identifier rule binds a variable unless that
identifier has constructor status.

Anchors: SML pattern identifier status is defined in `syncor.tex`. Current
`wm-mini` parses ordinary bare match identifiers as `PPinned` and explicit
`Var(name)` as `PVar` in `src/grammar.peggy`; `src/infer/patterns.ts` and
`tests/pattern_test.ts` cover the behavior.

## File Imports Versus SML Modules

SML has structures, signatures, functors, sharing constraints, and `open`.

Current `wm-mini` import syntax is covered in
[Syntactic Differences](./syntax-differences.md). The semantic difference is
that current `wm-mini` has path-based file imports, not SML module declarations.
It has no `structure`, `signature`, `functor`, signature matching, opaque
ascription, sharing constraints, or SML `open` declarations.

Namespace imports provide qualified access through an alias:

```wm
from "./math.wm" import * as Math;
Math.add(1, 2)
```

Open imports provide unqualified access:

```wm
from "./math.wm" import *;
add(1, 2)
```

The similarity to SML `open` is narrow:

- Both can bring names into unqualified scope.
- SML `open Math` opens an already-bound structure identifier.
- `wm-mini` `from "./math.wm" import *;` loads a file path and imports that
  file's visible names.
- SML `open` participates in the SML module language, including structures and
  signature-constrained environments.
- `wm-mini` open imports do not involve signatures, transparent or opaque
  ascription, functor application, sharing, or generative module semantics.

`wm-mini` imports also have these current implementation rules. They are facts
about current `wm-mini`, but only the path-import-versus-SML-module point above
is classified here as a semantic difference:

- Imports are declaration-ordered and not hoisted. This matches the Definition's
  sequential declaration shape: `statcor.tex` elaborates `dec_1` before `dec_2`
  using `C \oplus E_1`, and `statmod.tex` does the analogous thing for
  structure-level declarations and top-level declarations.
- Named imports can import a value and a type with the same spelling, because
  `wm-mini` keeps separate value and type namespaces.
- `import *;` and named imports reject collisions with existing user bindings
  at the import point.
- A later local declaration may shadow an imported binding.
- Reusing a namespace alias for another namespace import is rejected if it would
  create duplicate qualified names.
- Import cycles are rejected.
- Same-spelled datatypes from different files remain nominally distinct.

The declaration-order rule is not being claimed as a difference. The
`wm-mini`-specific part is that the declaration being ordered is a path-based
file import.

Definition anchors for this section:

- `prog.tex` defines programs as top-level declarations followed by semicolons.
- `synmod.tex` defines top-level declarations as structure-level, signature,
  or functor declarations.
- `syncor.tex` includes `open` as a declaration form.
- `statmod.tex` defines environment enrichment and signature matching, which
  are not part of `wm-mini` file import elaboration.
- `src/grammar.peggy` `ImportDecl`, `src/infer/imports.ts`,
  `tests/module_test.ts`, and `tests/compiler_module_test.ts` are the current
  `wm-mini` anchors.

## Effects And Exceptions

Current `wm-mini` does not implement general SML exceptions, `raise`, or
`handle`.

`wm-mini` uses:

- `Option<T>` and `Result<T, E>` for recoverable failure.
- `Panic("message")` for unrecoverable failure.
- JS FFI safe calls returning `Result<_, Js.Error>` or `Task<_, Js.Error>`.

This is a semantic departure from SML's exception mechanism.

`Panic("message")` is also not SML `raise`. It behaves as an unrecoverable
escape hatch and is typed as usable in any result context.

Anchors: SML exception declarations, `raise`, and `handle` are in `syncor.tex`
and `statcor.tex`. Current `wm-mini` has `PanicExpr` in `src/grammar.peggy` but
no exception declaration, `raise`, or `handle` grammar; `std/option.wm`,
`std/result.wm`, and `tests/basis_combinator_test.ts` cover the replacement
value-level idioms.

## Primitive Operators

SML has both fixed initial fixities and user-controlled fixity directives.
Current `wm-mini` has a fixed built-in operator set and no custom fixity
declarations.

This is partly syntactic, but it is also semantic because the operator table
defines the primitive operations exposed by the core:

- arithmetic over `Number`,
- string concatenation through `++`,
- comparison and equality,
- boolean operators,
- unary negation and boolean negation,
- pipe application.

Current code generation lowers binary operators to primitive calls; the runtime
prelude defines `__wm_op_and` and `__wm_op_or` over tupled arguments. That means
short-circuit behavior should not be claimed unless a later implementation or
test anchors it explicitly.

Anchors: SML fixity directives and the initial infix basis are in `syncor.tex`
and `app4.tex`. Current `wm-mini` precedence and operator parsing are in
`src/grammar.peggy`; primitive operator typing is in `src/infer/expr_flow.ts`
and `src/types_basis.ts`; emitted primitive operator names and runtime
definitions are in `src/core/emit_js.ts` and `src/core/emit_prelude.ts`.

## JavaScript FFI

JavaScript FFI is outside SML:

```wm
from js.global("Math") import { floor };
from js.module("node:crypto") import { createHash };
```

The FFI adds semantic boundaries that SML does not have:

- reflected TypeScript/JavaScript type discovery,
- safe versus `unsafe` imports,
- `Result`/`Task` wrapping for fallible effects,
- dynamic JSON values,
- nominal foreign object modeling.

This is a boundary feature outside the compared-against-SML core, even though
the core typechecker must account for it.

Anchors: current `wm-mini` FFI syntax is in `src/grammar.peggy` `JsImportDecl`
forms and covered by `tests/compiler_js_import_test.ts`,
`tests/compiler_js_reflection_test.ts`, and `tests/ffi_elab_test.ts`.

## Needs Grounding Before Classifying

These current `wm-mini` facts need a focused SML Definition comparison before
they should be listed as semantic differences:

### Equality

SML has a formal equality-type discipline. Current `wm-mini` exposes `==` and
`!=` as built-in operators and checks supported equality with
`src/infer/equality.ts` `admitsEquality`.

Verified anchors so far: `syncor.tex` reserves `=` as the equality predicate and
defines equality type variables; `synmod.tex` has `eqtype` specifications;
`app3.tex`/`app4.tex` include the initial equality basis entries. Current
`wm-mini` anchors are `src/types_basis.ts`, `src/infer/equality.ts`, and
`src/infer/expr_flow.ts`.

The remaining work is to compare the exact `admitsEquality` predicate against
SML equality attributes. Until that is done, this section should not claim a
complete equality-discipline difference beyond the already documented fixed
operator spelling and missing `eqtype` syntax.

This also interacts with pinned match identifiers: a pinned pattern must compare
the scrutinee with an existing value. If pinning stays in the language, the
equality relation needed by patterns must be specified together with `==`.

### Value Restriction

SML's value restriction allows full generalization only for non-expansive
expressions. Current `wm-mini` has an implementation rule in
`src/infer/decl_binding.ts`: `generalizeBinding` generalizes only non-expansive
values and also blocks generalization for unresolved FFI types or expressions
that cross an FFI boundary.

SML anchors already identified: `statcor.tex` sections on non-expansive
expressions, closure, and value declarations. Until the exact SML rule and
current `wm-mini` rule are compared case by case, this section should not claim
a specific semantic difference.

### Basis And Primitive Types

SML '97 distinguishes the minimal initial basis in the Definition from the
richer Standard ML Basis Library. `intro.tex` says the initial basis contains a
small set of predefined identifiers, with the richer basis defined separately.
`app3.tex` defines that minimal initial static basis, including type names such
as `bool`, `int`, `real`, `string`, `char`, `word`, `list`, `ref`, and `exn`.
`whatisnew.tex` also notes that the initial basis was cut down to a bare
minimum to interface cleanly with the Basis Library.

Grounding target: compare `wm-mini` first against that smaller initial/core
basis, then separately against the richer Standard ML Basis Library.

Current `wm-mini` has its own small basis and adds JS interop types:

- `Number`, `String`, `Bool`, `Void`.
- `Option`, `Result`, `List`, `Task`.
- `Js.Value`, `Js.Object`, `Js.Array<T>`, `Js.Dict<T>`, `Js.Error`.

Differences from the SML initial/core basis still need to be made precise. For
example, `wm-mini` currently spells unit as `Void`/`void`, uses `Number` rather
than an SML numeric tower, does not expose `ref` as an SML primitive, and adds
`Task` plus JS-specific types.

Lists are algebraic data in the `wm-mini` basis, but the surface constructors
and spellings are `wm-mini`-specific. The current syntax guide uses `[]` and
`[head, ..tail]`; the implementation lowers these into the list constructors
supplied by the basis.

Current `wm-mini` does not expose SML `char`, `word`, arrays, vectors, or the
full numeric overloading story.

## Surface Features That Need Desugaring Rules

Several current features can stay small if the formal definition treats them as
surface forms with precise translations:

- first-class `match(x) => { ... }` functions,
- list literals and list spread patterns,
- forward pipe `:>`,
- member-call pipe forms such as `value :> .map(fn)`,
- `if` as a boolean match or equivalent conditional expression,
- trailing semicolon as inserted `void`.

Each translation should state which identifiers it introduces, whether it
preserves source-level evaluation order, and whether it affects generalization.

## Open Formalization Items

- Decide whether mixed declaration/expression block items are a permanent
  language feature.
- Specify file import elaboration, including ordering, collision behavior,
  cycles, named imports, namespace imports, and open imports.
- Specify the exact `wm-mini` value restriction.
- Specify equality.
- Specify short-circuiting and primitive operator evaluation.
- Specify `Panic` as bottom-like typing plus unrecoverable dynamic behavior.
- Specify list syntax lowering and the exact basis constructors it targets.
- Specify pipe and member-pipe desugaring.
- Specify local nominal type escape rules for `record` and `type`.
- Decide whether nominal records should stay independent from SML record rows
  forever or whether a structural record subset is ever desirable.
- Separate `wm-mini` core semantics from JS FFI elaboration semantics.
- Decide how much of SML modules `wm-mini` wants, if any.
