# Semantic Differences From SML

This note records places where Workman does not merely spell SML differently,
but changes behavior, typechecking, elaboration, or the language boundary.

## Nominal Records

SML records are structural row types. A record expression such as:

```sml
{ x = 1, y = 2 }
```

has a structural record type determined by its labels and field types.

Workman records are nominal. A record type must be declared:

```wm
record Point = { x: Number, y: Number };
let p: Point = .{ x = 1, y = 2 };
```

Two same-shaped records are distinct:

```wm
record Point = { x: Number, y: Number };
record Vector = { x: Number, y: Number };
```

This is a semantic change. It avoids SML-style flexible record inference and row
polymorphism in the mini compiler.

Current implementation consequence: an unannotated record literal can be
ambiguous if more than one nominal record has the same required fields.

## Blocks Versus `let ... in ... end`

SML local declarations are written:

```sml
let
  dec
in
  exp
end
```

Workman's primary local form is a block expression:

```wm
{
  let x = 1;
  x + 1
}
```

That spelling alone would be syntactic, but current Workman also permits mixing
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

Open design question: whether mixed block items are permanent, or whether a
future formal subset should restrict blocks to declaration items followed by an
expression sequence.

## Trailing Semicolon Means `Void`

SML sequence expressions have a final expression:

```sml
(exp1; exp2)
```

Workman adds a trailing-semicolon extension in sequence contexts:

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

## Pattern Identifier Defaults

In SML, an unqualified lowercase identifier in a pattern normally binds a fresh
variable unless it is known as a constructor.

Workman match patterns use pinned bare identifiers by default:

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

Constructor payload patterns, let patterns, and lambda parameter patterns still
bind names in the usual ML-like way:

```wm
match(opt) {
  Some(x) => { x },
  None => { 0 },
}
```

This difference is one of the largest semantic surprises for SML readers.

## File Imports Versus SML Modules

SML has structures, signatures, functors, sharing constraints, and `open`.

Current Workman import syntax is covered in
[Syntactic Differences](./syntax-differences.md). The semantic difference is
that current `wm-mini` has file-level structure-like imports, not the full SML
module language. It has no signatures, functors, sharing constraints, or SML
`open` declarations.

Workman namespace imports provide qualified access that looks structure-like:

```wm
from "./math.wm" import * as Math;
Math.add(1, 2)
```

Workman open imports provide unqualified access:

```wm
from "./math.wm" import *;
add(1, 2)
```

This is structure-like file elaboration: each checked file has an internal file
environment and a visible file environment used by imports. Current declarations
are visible by default.

There is no current `export` marker. This is closer to SML structures than the
old JavaScript-shaped spelling: a file's top-level declarations contribute to
its visible structure-like environment unless a future hiding mechanism says
otherwise.

The similarity to SML `open` is narrow:

- Both bring names from a structure-like environment into unqualified scope.
- SML `open Math` opens an already-bound structure identifier.
- Workman `from "./math.wm" import *;` loads a file path and opens that file's
  visible top-level environment.
- SML `open` participates in the SML module language, including structures and
  signature-constrained environments.
- Workman open imports do not involve signatures, transparent or opaque
  ascription, functor application, sharing, or generative module semantics.
- Workman currently rejects duplicate imported names eagerly; SML's module
  rules are specified in terms of environment enrichment and declaration
  elaboration rather than this file-import collision rule.

Workman imports also have these current semantic rules:

- Imports are declaration-ordered and not hoisted. This matches the Definition's
  sequential declaration shape: `statcor.tex` elaborates `dec_1` before `dec_2`
  using `C \oplus E_1`, and `statmod.tex` does the analogous thing for
  structure-level declarations and top-level declarations.
- Named imports can import a value and a type with the same spelling, because
  Workman keeps separate value and type namespaces.
- `import *;` and named imports reject collisions with existing user bindings
  at the import point.
- A later local declaration may shadow an imported binding.
- Reusing a namespace alias for another namespace import is rejected if it would
  create duplicate qualified names.
- Import cycles are rejected.
- Same-spelled datatypes from different files remain nominally distinct.

The declaration-order rule is SML-like. The Workman-specific part is that the
declaration being ordered is a path-based file import, and that import collision
and cycle handling are part of Workman's file-import elaboration rather than
SML's `open` rule.

Definition anchors for this section:

- `prog.tex` defines programs as top-level declarations followed by semicolons.
- `synmod.tex` defines top-level declarations as structure-level, signature,
  or functor declarations.
- `syncor.tex` includes `open` as a declaration form.
- `statmod.tex` defines environment enrichment and signature matching, which
  are not part of Workman file import elaboration.

## Effects And Exceptions

Current Workman does not implement general SML exceptions, `raise`, or
`handle`.

Workman uses:

- `Option<T>` and `Result<T, E>` for recoverable failure.
- `Panic("message")` for unrecoverable failure.
- JS FFI safe calls returning `Result<_, Js.Error>` or `Task<_, Js.Error>`.

This is a semantic departure from SML's exception mechanism.

`Panic("message")` is also not SML `raise`. It behaves as an unrecoverable
escape hatch and is typed as usable in any result context. A formal definition
should give it an explicit bottom-like typing rule and a separate dynamic rule.

## Equality

SML has a formal equality-type discipline.

Current Workman exposes `==` and `!=` as built-in operators over the supported
runtime/value subset. It does not expose SML equality type variables or the full
equality-type mechanism.

Formalization work should decide whether Workman eventually adopts an explicit
equality discipline or keeps equality as a smaller built-in relation.

This interacts with pinned match identifiers: a pinned pattern must compare the
scrutinee with an existing value. If pinning stays in the language, the equality
relation needed by patterns must be specified together with `==`.

## Primitive Operators

SML has both fixed initial fixities and user-controlled fixity directives.
Current Workman has a fixed built-in operator set and no custom fixity
declarations.

This is partly syntactic, but it is also semantic because the operator table
defines the primitive operations exposed by the core:

- arithmetic over `Number`,
- string concatenation through `++`,
- comparison and equality,
- boolean operators,
- unary negation and boolean negation,
- pipe application.

The boolean operators should be specified as short-circuiting expression forms
if that is the intended behavior. If they are ordinary primitive functions,
their evaluation rule should say so explicitly.

## Value Restriction

SML's value restriction allows full generalization only for non-expansive
expressions.

`wm-mini` already treats expansive expressions conservatively and keeps JS FFI
effect boundaries from becoming unsoundly polymorphic. The user-facing language
does not yet document a complete SML value-restriction rule.

This should become a formalized area rather than staying as implementation
behavior.

## Basis And Primitive Types

SML '97 distinguishes the minimal initial basis in the Definition from the
richer Standard ML Basis Library. `intro.tex` says the initial basis contains a
small set of predefined identifiers, with the richer basis defined separately.
`app3.tex` defines that minimal initial static basis, including type names such
as `bool`, `int`, `real`, `string`, `char`, `word`, `list`, `ref`, and `exn`.
`whatisnew.tex` also notes that the initial basis was cut down to a bare
minimum to interface cleanly with the Basis Library.

Workman should likely be compared against that smaller initial/core basis first,
not against the whole Basis Library.

Current Workman has its own small basis and adds JS interop types:

- `Number`, `String`, `Bool`, `Void`.
- `Option`, `Result`, `List`, `Task`.
- `Js.Value`, `Js.Object`, `Js.Array<T>`, `Js.Dict<T>`, `Js.Error`.

Differences from the SML initial/core basis still need to be made precise. For
example, Workman currently spells unit as `Void`/`void`, uses `Number` rather
than an SML numeric tower, does not expose `ref` as an SML primitive, and adds
`Task` plus JS-specific types.

Lists are SML-shaped algebraic data in the Workman basis, but the surface
constructors and spellings are Workman-specific. The current syntax guide uses
`[]` and `[head, ..tail]`; the implementation lowers these into the list
constructors supplied by the basis.

Current Workman does not expose SML `char`, `word`, arrays, vectors, or the
full numeric overloading story.

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

This should remain documented separately from the SML-shaped core, even though
the core typechecker must account for it.

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
- Specify the exact Workman value restriction.
- Specify equality.
- Specify short-circuiting and primitive operator evaluation.
- Specify `Panic` as bottom-like typing plus unrecoverable dynamic behavior.
- Specify list syntax lowering and the exact basis constructors it targets.
- Specify pipe and member-pipe desugaring.
- Specify local nominal type escape rules for `record` and `type`.
- Decide whether nominal records should stay independent from SML record rows
  forever or whether a structural record subset is ever desirable.
- Separate Workman core semantics from JS FFI elaboration semantics.
- Decide how much of SML modules Workman wants, if any.
