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

## Missing SML Module Semantics

SML has structures, signatures, functors, sharing constraints, and `open`.

Current Workman import syntax is covered in
[Syntactic Differences](./syntax-differences.md). The semantic difference is
that current `wm-mini` does not implement the SML module language. It has no
signatures, functors, sharing constraints, or `open` declarations.

## Effects And Exceptions

Current Workman does not implement general SML exceptions, `raise`, or
`handle`.

Workman uses:

- `Option<T>` and `Result<T, E>` for recoverable failure.
- `Panic("message")` for unrecoverable failure.
- JS FFI safe calls returning `Result<_, Js.Error>` or `Task<_, Js.Error>`.

This is a semantic departure from SML's exception mechanism.

## Equality

SML has a formal equality-type discipline.

Current Workman exposes `==` and `!=` as built-in operators over the supported
runtime/value subset. It does not expose SML equality type variables or the full
equality-type mechanism.

Formalization work should decide whether Workman eventually adopts an explicit
equality discipline or keeps equality as a smaller built-in relation.

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

## Open Formalization Items

- Decide whether mixed declaration/expression block items are a permanent
  language feature.
- Specify the exact Workman value restriction.
- Specify equality.
- Specify local nominal type escape rules for `record` and `type`.
- Decide whether nominal records should stay independent from SML record rows
  forever or whether a structural record subset is ever desirable.
- Separate Workman core semantics from JS FFI elaboration semantics.
- Decide how much of SML modules Workman wants, if any.
