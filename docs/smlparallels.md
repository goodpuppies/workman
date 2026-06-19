# SML Parallels

This document is for readers who already know Standard ML and want to understand how SML concepts
map onto current `wm-mini` / Workman syntax.

`wm-mini` is not a full SML implementation. It is a small Workman surface with an SML-shaped core:
Hindley-Milner inference, algebraic datatypes, pattern matching, tuples, records, lexical scope, and
mostly expression-oriented programming.

## Quick Translation Table

| SML concept                  | Workman spelling                           |
| ---------------------------- | ------------------------------------------ |
| `val x = e`                  | `let x = e;`                               |
| `fun f x = e`                | `let f = (x) => { e };`                    |
| `fn x => e`                  | `(x) => { e }`                             |
| `fn (x, y) => e`             | `(x, y) => { e }`                          |
| `f (x, y)`                   | `f(x, y)`                                  |
| `f x y`                      | `f(x)(y)`                                  |
| `(x, y)`                     | `(x, y)`                                   |
| `datatype t = A              | B of int`                                  |
| `'a option`                  | `Option<T>`                                |
| `NONE` / `SOME x`            | `None` / `Some(x)`                         |
| `case e of ...`              | `match(e) { ... }`                         |
| `if a then b else c`         | `if (a) { b } else { c }`                  |
| `let val x = a in b end`     | `{ let x = a; b }`                         |
| record type `{x:int, y:int}` | `record Point = { x: Number, y: Number };` |
| record value `{x=1, y=2}`    | `.{ x = 1, y = 2 }`                        |
| list `[1,2,3]`               | `[1, 2, 3]`                                |
| cons pattern `x :: xs`       | `[x, ..xs]`                                |
| unit `()`                    | `void`                                     |

## Values And Bindings

SML:

```sml
val x = 1
val y = x + 2
```

Workman:

```wm
let x = 1;
let y = x + 2;
```

Top-level Workman declarations end in semicolons. Inside a block, declarations also end in
semicolons, and the final expression is the block result.

```wm
let answer = {
  let x = 40;
  let y = 2;
  x + y
};
```

## Functions

SML:

```sml
fun double x = x * 2
val id = fn x => x
```

Workman:

```wm
let double = (x) => {
  x * 2
};

let id = (x) => {
  x
};
```

Zero-argument Workman functions use `()` at the surface and take `Void` in the core:

```wm
let main = () => {
  print("hello")
};
```

## Tuple Arguments And Currying

This is one of the most important SML parallels.

In SML, this:

```sml
fun add (x, y) = x + y
```

is a unary function whose one argument is a tuple.

Workman follows the same semantic shape:

```wm
let add = (x, y) => {
  x + y
};

let a = add(1, 2);
let b = add((1, 2));
```

Both calls pass one tuple-shaped argument.

Curried functions are explicit:

```sml
fun add x y = x + y
```

```wm
let add = (x) => {
  (y) => {
    x + y
  }
};

let result = add(1)(2);
```

## Datatypes

SML:

```sml
datatype color = Red | Green | Blue
datatype 'a option = None | Some of 'a
datatype tree = Leaf | Node of int * tree * tree
```

Workman:

```wm
type Color = Red | Green | Blue;
type Option<T> = None | Some<T>;
type Tree = Leaf | Node<Number, Tree, Tree>;
```

Constructor payloads are still one logical argument, as in SML. A constructor with multiple fields
is a constructor taking a tuple payload.

So:

```wm
Node(1, left, right)
```

corresponds to SML:

```sml
Node (1, left, right)
```

not to a curried constructor.

## Type Application

SML writes type application in postfix style:

```sml
int list
'a option
```

Workman writes type application with angle brackets:

```wm
List<Number>
Option<A>
```

Type variables are written as ordinary type parameter names in declarations. In examples, `T` is a
type parameter when introduced by `type Box<T> = ...`:

```wm
type Box<T> = Box<T>;
let id = (x) => { x };
```

## Pattern Matching

SML:

```sml
case opt of
    SOME x => x
  | NONE => 0
```

Workman:

```wm
match(opt) {
  Some(x) => { x },
  None => { 0 },
}
```

First-class match functions are a Workman spelling for common SML-style function clauses:

```wm
let unwrapOrZero = match(opt) => {
  Some(x) => { x },
  None => { 0 },
};
```

This is equivalent to:

```wm
let unwrapOrZero = (opt) => {
  match(opt) {
    Some(x) => { x },
    None => { 0 },
  }
};
```

## Pattern Binders Are Different

This is a deliberate Workman difference from SML.

In SML, a lowercase identifier in a pattern introduces a new binder:

```sml
case value of
    x => x
```

In Workman match patterns, bare identifiers are pinned: they refer to an existing value. Use
`Var(x)` to bind a fresh variable:

```wm
let expected = 42;

let pinned = match(actual) {
  expected => { "matched 42" },
  _ => { "different" },
};

let bound = match(actual) {
  Var(x) => { x },
};
```

Constructor payload patterns still bind names in the familiar way:

```wm
match(opt) {
  Some(x) => { x },
  None => { 0 },
}
```

Let patterns and lambda parameter patterns also bind normally:

```wm
let (x, y) = pair;
let swap = (x, y) => { (y, x) };
```

## Lists

SML:

```sml
[]
[1, 2, 3]
x :: xs
```

Workman:

```wm
[]
[1, 2, 3]
[x, ..xs]
```

List patterns:

```wm
let sum = match(xs) => {
  [] => { 0 },
  [x, ..rest] => { x + sum(rest) },
};
```

The list model is algebraic, like SML lists. The surface syntax is more JavaScript/Rust-like.

## Records

Current Workman records are nominal.

SML has structural record types:

```sml
{ x = 1, y = 2 }
```

Workman requires a record declaration:

```wm
record Point = { x: Number, y: Number };

let p = .{ x = 1, y = 2 };
let x = p.x;
```

This is intentionally different from SML flexible record inference. It keeps the mini compiler
smaller and avoids a large record-polymorphism feature.

Field punning is supported:

```wm
let x = 1;
let y = 2;
let p = .{ x, y };
```

Record spread/update copies an existing nominal record and applies later field overrides:

```wm
let p2 = .{ ..p, x = 10 };
```

## Blocks Instead Of `let ... in ... end`

SML:

```sml
let
  val x = 1
  val y = 2
in
  x + y
end
```

Workman:

```wm
{
  let x = 1;
  let y = 2;
  x + y
}
```

Blocks are expressions.

## Conditionals

SML:

```sml
if n < 0 then ~n else n
```

Workman:

```wm
if (n < 0) {
  0 - n
} else {
  n
}
```

`else` is mandatory. There is no `else if`; nest another `if` or use `match`.

## Modules

SML has structures, signatures, and functors. Current `wm-mini` uses files as the module boundary.

```wm
from "./math.wm" import * as Math;
from "./math.wm" import { add };
```

Qualified access looks structure-like:

```wm
Math.add(1, 2)
```

But this is not the full SML module system. There are no signatures, functors, sharing constraints,
or `open` declarations yet.

## Recursion

SML:

```sml
fun fact n =
  case n of
      0 => 1
    | _ => n * fact (n - 1)
```

Workman:

```wm
let rec fact = match(n) => {
  0 => { 1 },
  _ => { n * fact(n - 1) },
};
```

Mutual recursion uses `and`:

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

## Exceptions, `Option`, And `Result`

Current `wm-mini` does not implement general SML exceptions. Use datatypes such as `Option` and
`Result`, or `Panic` for unrecoverable failure.

```wm
type Result<T, E> = Ok<T> | Err<E>;

let unwrap = match(result) => {
  Ok(value) => { value },
  Err(_) => { Panic("expected Ok") },
};
```

JavaScript FFI uses `Result<T, Js.Error>` for safe reflected calls.

## Equality

Workman has `==` and `!=` operators. The current implementation does not expose SML equality types
or the full SML equality discipline.

For now, treat equality as a built-in operation with compiler/runtime support for the current
subset, not as SML's full `''a` equality type mechanism.

## Value Restriction

SML's value restriction exists to keep polymorphism sound in the presence of effects such as refs
and exceptions.

`wm-mini` has a conservative generalization story and treats JS FFI as effectful at the boundary.
The full SML value restriction machinery is not exposed as a user-facing feature yet, but the
compiler direction is to keep generalization sound around expansive/effectful expressions.

## JavaScript FFI Is Not SML

The JS FFI is Workman-specific:

```wm
from js.global("Math") import { floor };
from js.module("node:crypto") import { createHash };
from js.global import type { Request };
```

Safe reflected JS calls return `Result<T, Js.Error>` or `Task<T, Js.Error>` for Promise-returning
APIs. `unsafe` imports are available for direct JS calls.

See [JavaScript FFI](./jsffi.md) for details.

## SML Concepts Missing In Current `wm-mini`

Current `wm-mini` does not implement:

- signatures
- functors
- `open`
- sharing constraints
- infix/fixity declarations
- `fun` declarations as a separate syntax form
- curried multi-clause function definitions
- `handle` and general exception declarations
- refs and mutation
- arrays/vectors as SML Basis types
- equality types and overloaded equality discipline
- numeric overloading
- flexible record inference and record row polymorphism
- pattern guards
- `as` patterns
- char literals
- string interpolation
- full Basis library
- SML-style semicolon sequencing
- local declarations exactly as `local ... in ... end`
- abstypes
- datatype replication
- `withtype`
- `where type`
- full separate-compilation/module semantics

Some of these may never be added to `wm-mini`; the project is intentionally small.

## Mental Model

The useful mental model is:

```txt
SML semantics where wm-mini overlaps SML:
  tuples, constructors, pattern matching, HM inference, lexical scope

Workman surface where ergonomics differ:
  braces, semicolons, Type<T>, JSON literals, JS-style imports

Explicit omissions:
  full SML module system, refs, exceptions, flexible records, large Basis
```

The compiler should stay rigorous about the SML-shaped subset, while still being practical for
JavaScript interop and small programs.
