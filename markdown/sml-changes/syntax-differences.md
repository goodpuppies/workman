# Syntactic Differences From SML

This note records current `wm-mini` changes that are mainly surface syntax.
Each comparison should be grounded against both the Standard ML Definition and
the current `wm-mini` grammar/tests. Similar spelling is not evidence of equal
semantics by itself.

## Baseline

Grounded comparisons in this file should cite SML syntax from
`research/The-Definition-of-Standard-ML-Revised` and `wm-mini` syntax from
`src/grammar.peggy`. The broad comparison targets are:

- Hindley-Milner inference.
- Lexical scope.
- Algebraic datatypes.
- Constructor payloads as one logical argument.
- Tuples as ordinary product values.
- Sequential declaration elaboration.
- Expression sequencing where earlier results are discarded without requiring
  type `Void`.

The sections below are spelling-oriented only where the corresponding semantic
rule has also been checked.

## Declaration Spelling

SML:

```sml
val x = 1
fun double x = x * 2
```

`wm-mini`:

```wm
let x = 1;
let double = (x) => { x * 2 };
```

The `let` spelling is a surface choice. Current `wm-mini` still has
declaration-ordered bindings and HM generalization. Recursive bindings use
`let rec`; SML has explicit recursive value declarations through `val rec`.

Mutually recursive groups use `and`:

```wm
let rec even = match(n) => {
  0 => { true },
  _ => { odd(n - 1) },
}
and odd = match(n) => {
  0 => { false },
  _ => { even(n - 1) },
};
```

Unlike SML, `wm-mini` does not currently have a separate `fun` declaration syntax
or SML-style multi-clause function declarations.

## Program Semicolons

SML programs are semicolon-delimited top-level declarations. `wm-mini` keeps
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

`wm-mini`:

```wm
(x) => { x + 1 }
f(x)
f(x, y)
```

`wm-mini` uses JavaScript-like call syntax, but keeps the SML semantic distinction
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

Zero-argument `wm-mini` lambdas use `()` at the surface:

```wm
let main = () => { print("hello"); };
```

The corresponding core argument is the unit-like `Void` value.

## Datatype And Type Syntax

This is mostly syntax.

SML:

```sml
datatype 'a option = None | Some of 'a
datatype tree = Leaf | Node of int * tree * tree
```

`wm-mini`:

```wm
type Option<T> = None | Some<T>;
type Tree = Leaf | Node<Number, Tree, Tree>;
```

The semantic shape is still algebraic datatype declarations with constructors
and constructor payloads. `wm-mini` changes the spelling:

- Type application uses `Type<Arg>` instead of postfix type constructors.
- Type parameters are written in angle brackets.
- Constructor payload types are written in angle brackets on the constructor.
- `wm-mini` conventionally uses uppercase type and constructor names.
- A leading pipe is allowed for one-case or multiline variants:

```wm
type Token =
  | LParen
  | RParen
  | Number<Number>;
```

`wm-mini` also uses syntax to disambiguate aliases from one-case datatypes:

```wm
type T = X;    -- alias
type T = | X;  -- one-case datatype
```

This corresponds to SML's separate declaration forms:

```sml
type t = int
datatype token = Token
```

The distinction itself follows SML's separate type abbreviation and datatype
declaration forms. The `wm-mini`-specific part is the spelling.

## Match And Conditional Syntax

SML:

```sml
case opt of
    Some x => x
  | None => 0

if ok then a else b
```

`wm-mini`:

```wm
match(opt) {
  Some(x) => { x },
  None => { 0 },
}

if (ok) { a } else { b }
```

The syntax is brace-oriented. `if` remains expression-valued, and `match` plays
the role of SML `case`.

`wm-mini` also has first-class match-function syntax:

```wm
let unwrap = match(opt) => {
  Some(x) => { x },
  None => { 0 },
};
```

That is syntax for a function whose body is a match.

`wm-mini` requires braces around match arm bodies and `if` branches. `else` is
mandatory because `if` is an expression. There is no `else if` surface form;
nest another `if` or use `match`.

## Sequence Syntax

SML sequence expressions are parenthesized:

```sml
(exp1; exp2; exp3)
```

`wm-mini` supports parenthesized sequences and block sequences:

```wm
(exp1; exp2)
{ exp1; exp2 }
```

The ordinary non-trailing case matches SML sequence typing at the spelling
level: the result type is the final expression's type, and earlier expression
results are discarded.

Trailing expression semicolon as `Void` sugar is a behavioral extension and is
covered in [Semantic Differences](./semantic-differences.md).

## List Syntax

SML lists:

```sml
[]
[1, 2, 3]
x :: xs
```

`wm-mini` keeps algebraic list values but uses bracket spread for cons-like
construction and patterns:

```wm
[]
[1, 2, 3]
[x, ..xs]
```

The surface list syntax is not SML syntax. In the current compiler,
`src/grammar.peggy` lowers list expressions and patterns to `Nil`/`Cons`;
`tests/list_syntax_test.ts` checks those lowered forms against the current
`wm-mini` list basis.

## Record Surface Syntax

SML record values use braces:

```sml
{ x = 1, y = 2 }
```

`wm-mini` record values use a leading dot so they do not conflict with block
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

`wm-mini` record declarations are not merely syntax, because records are nominal.
That semantic difference is covered in [Semantic Differences](./semantic-differences.md).

## Module Import Syntax

SML modules use structures, signatures, functors, and related declarations.
The Definition anchors for this comparison are:

- `synmod.tex`: structure expressions, structure-level declarations,
  signature expressions, functor declarations, and top-level declarations.
- `syncor.tex`: the `open` declaration appears among core declarations.
- `prog.tex`: programs are sequences of top-level declarations followed by
  semicolons.

Current `wm-mini` uses file import syntax:

```wm
from "./math.wm" import * as Math;
from "./math.wm" import *;
from "./math.wm" import { add };
```

Qualified use goes through the import alias:

```wm
Math.add(1, 2)
```

The spelling is an import declaration over a path. Missing SML module semantics
are covered in [Semantic Differences](./semantic-differences.md).

`from "./file.wm" import *;` is `wm-mini`'s open-import form. It brings the
visible top-level names of that file into the current file unqualified.

It is intentionally close to the common use of SML `open` only in the narrow
sense that names become available unqualified. It is not the same syntax and it
is not part of the full SML module language:

```sml
open Math
```

```wm
from "./math.wm" import *;
```

The `wm-mini` form names a file path and import mode in one declaration. The SML
form opens an already-bound structure identifier.

`wm-mini` imports are ordinary top-level declarations in source order. They are
not hoisted; this is consistent with SML's sequential declaration elaboration
rather than a difference claim:

```wm
let x = Math.add(1, 2);          -- Math is not in scope yet
from "./math.wm" import * as Math;
```

The import must appear before uses that depend on it.

Top-level `wm-mini` declarations are visible to file imports by default:

```wm
-- math.wm
let add = (x, y) => { x + y };
type Maybe<T> = None | Some<T>;

-- main.wm
from "./math.wm" import * as Math;
let result = Math.add(1, 2);
```

The fact that top-level file declarations are visible to file imports by
default is a current `wm-mini` implementation fact, not a syntactic difference
from SML by itself. The SML comparison depends on structures, signatures, and
ascription, so this belongs in the grounding queue in
[Current Subset Ledger](./current-differences.md) until that comparison is
complete.

## Unit Spelling

SML unit:

```sml
()
```

`wm-mini`:

```wm
void
```

The type is spelled:

```wm
Void
```

This is primarily spelling. `wm-mini` `Void` is the unit-like type in the current
core.

## Operators And Fixity

SML has fixity declarations and symbolic identifiers. Current `wm-mini` has a
fixed built-in operator table:

```wm
!x
-x
a * b
a / b
a % b
a + b
a - b
a ++ b
a < b
a <= b
a > b
a >= b
a == b
a != b
a && b
a || b
a :> f
```

This is syntax plus a missing SML feature. `wm-mini` does not currently implement
`infix`, `infixr`, `nonfix`, or user-defined symbolic operators.

## Comments And Literals

SML block comments are `(* ... *)`. Current `wm-mini` uses line comments:

```wm
-- wm-mini line comment
// C-style line comment
```

String literals are double-quoted, and `wm-mini` also supports backtick
multiline strings. Character literals are not part of current `wm-mini`.
