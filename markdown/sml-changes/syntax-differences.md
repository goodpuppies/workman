# Syntactic Differences From SML

This note records Workman changes that are mainly surface syntax. These forms
look different from SML, but the intended core behavior is still SML-like where
the feature overlaps.

## Baseline

Workman keeps the SML-shaped model for:

- Hindley-Milner inference.
- Lexical scope.
- Algebraic datatypes.
- Constructor payloads as one logical argument.
- Tuples as ordinary product values.
- Sequential declaration elaboration.
- Expression sequencing where earlier results are discarded without requiring
  type `Void`.

The sections below are mostly spelling changes over that model.

## Declaration Spelling

SML:

```sml
val x = 1
fun double x = x * 2
```

Workman:

```wm
let x = 1;
let double = (x) => { x * 2 };
```

The `let` spelling is a surface choice. Workman still has declaration-ordered
bindings and HM generalization. Recursive bindings use `let rec`, matching the
SML idea of explicit recursive value declarations.

## Program Semicolons

SML programs are semicolon-delimited top-level declarations. Workman keeps
mandatory semicolons at top level:

```wm
type Option<T> = None | Some<T>;
let x = Some(1);
```

This is mostly syntax. The important parser rule is phrase-layered:

```txt
top-level declaration ;    -- program phrase delimiter
block-local declaration ;  -- block phrase delimiter
expression ;               -- expression sequence item
```

The semicolon belongs to the surrounding phrase layer, not to the declaration
itself.

## Function And Application Syntax

SML:

```sml
fn x => x + 1
f x
f (x, y)
```

Workman:

```wm
(x) => { x + 1 }
f(x)
f(x, y)
```

Workman uses JavaScript-like call syntax, but keeps the SML semantic distinction
between one tuple argument and curried application:

```wm
let add = (x, y) => { x + y };
let a = add(1, 2);
let b = add((1, 2));
```

Both calls pass one tuple-shaped argument. Curried application is still explicit:

```wm
let add = (x) => { (y) => { x + y } };
let result = add(1)(2);
```

## Datatype And Type Syntax

This is mostly syntax.

SML:

```sml
datatype 'a option = None | Some of 'a
datatype tree = Leaf | Node of int * tree * tree
```

Workman:

```wm
type Option<T> = None | Some<T>;
type Tree = Leaf | Node<Number, Tree, Tree>;
```

The semantic shape is still algebraic datatype declarations with constructors
and constructor payloads. Workman changes the spelling:

- Type application uses `Type<Arg>` instead of postfix type constructors.
- Type parameters are written in angle brackets.
- Constructor payload types are written in angle brackets on the constructor.
- Workman conventionally uses uppercase type and constructor names.
- A leading pipe is allowed for one-case or multiline variants:

```wm
type Token =
  | LParen
  | RParen
  | Number<Number>;
```

Workman also uses syntax to disambiguate aliases from one-case datatypes:

```wm
type T = X;    -- alias
type T = | X;  -- one-case datatype
```

This corresponds to SML's separate declaration forms:

```sml
type t = int
datatype token = Token
```

The distinction itself is SML-like. The Workman-specific part is the spelling.

## Match And Conditional Syntax

SML:

```sml
case opt of
    Some x => x
  | None => 0

if ok then a else b
```

Workman:

```wm
match(opt) {
  Some(x) => { x },
  None => { 0 },
}

if (ok) { a } else { b }
```

The syntax is brace-oriented. `if` remains expression-valued, and `match` plays
the role of SML `case`.

Workman also has first-class match-function syntax:

```wm
let unwrap = match(opt) => {
  Some(x) => { x },
  None => { 0 },
};
```

That is syntax for a function whose body is a match.

## Sequence Syntax

SML sequence expressions are parenthesized:

```sml
(exp1; exp2; exp3)
```

Workman supports parenthesized sequences and block sequences:

```wm
(exp1; exp2)
{ exp1; exp2 }
```

The ordinary non-trailing case is SML-like: the result type is the final
expression's type, and earlier expression results are discarded.

Trailing expression semicolon as `Void` sugar is a behavioral extension and is
covered in [Semantic Differences](./semantic-differences.md).

## Record Surface Syntax

SML record values use braces:

```sml
{ x = 1, y = 2 }
```

Workman record values use a leading dot so they do not conflict with block
expressions:

```wm
.{ x = 1, y = 2 }
```

Field punning is supported:

```wm
let x = 1;
let y = 2;
let p = .{ x, y };
```

Workman record declarations are not merely syntax, because records are nominal.
That semantic difference is covered in [Semantic Differences](./semantic-differences.md).

## Module Import Syntax

SML modules use structures, signatures, functors, and related declarations.

Current Workman uses file/module import syntax:

```wm
from "./math.wm" import * as Math;
from "./math.wm" import { add };
```

Qualified use is structure-like:

```wm
Math.add(1, 2)
```

The syntax is familiar and structure-like. Missing SML module semantics are
covered in [Semantic Differences](./semantic-differences.md).

## Unit Spelling

SML unit:

```sml
()
```

Workman:

```wm
void
```

The type is spelled:

```wm
Void
```

This is primarily spelling. Workman `Void` is the unit-like type in the current
core.
