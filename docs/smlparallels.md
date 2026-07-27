# SML Parallels

This document is for readers who already know Standard ML and want to understand how SML concepts
map onto Workman syntax.

Workman implements a subset of Standard ML and follows the Revised Definition of Standard ML for
the static and dynamic semantics of that subset. Its different surface syntax does not imply
approximate or merely SML-inspired behavior.

In this document, **equivalent** means semantically equivalent: after accounting for the documented
spelling, the SML and Workman forms have the same typing, binding, evaluation, and value behavior.
Rows with an important qualification state it explicitly. Workman extensions and deliberate
semantic changes—such as nominal records and pinned match identifiers—are identified as
differences, not presented as equivalents.

Workman is not a full Standard ML implementation. It deliberately omits parts of the language and
adds a small set of its own surface and interoperability features.

## Quick Translation Table

The table covers the Standard ML language forms, not every identifier in the Standard ML Basis
Library. “Not implemented” is intentional: there is no reliable mechanical translation for that
form.

### Semantic Equivalents And Qualified Mappings

| SML                                      | Workman                                                     | Important qualification |
| ---------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| top-level phrase `topdec;`               | top-level `declaration;` or `expression;`                    | `;` is generally the equivalent phrase separator |
| sequence `(e1; e2; e3)`                  | `(e1; e2; e3)` or `{ e1; e2; e3 }`                          | A trailing Workman `;` inserts `void` |
| `val x = e`                              | `let x = e;`                                                | Patterns may replace `x` in both |
| `val _ = e`                              | `let _ = e;`                                                | Evaluate and discard the binding |
| `val p1 = e1 and p2 = e2`                | `let p1 = e1 and p2 = e2;`                                 | Non-recursive binding group |
| `val rec f = fn x => e`                  | `let rec f = (x) => { e };`                                 | Recursive groups use `and` in both languages |
| `fun f x = e`                            | `let rec f = (x) => { e };`                                 | SML `fun` is recursive; do not translate it as plain `let` |
| `fn x => e`                              | `(x) => { e }`                                              | |
| `fn (x, y) => e`                         | `(x, y) => { e }`                                          | Both take one tuple-shaped argument |
| `fn a => fn b => e`                      | `(a) => (b) => { e }`                                      | Curried lambda chain |
| `f x`                                    | `f(x)` or `f x`                                             | Parenthesized calls are conventional Workman |
| `f x`                                    | `x :> f`                                                    | Workman forward-pipe spelling |
| `f (x, y)`                               | `f(x, y)` or `f((x, y))`                                   | Both Workman spellings pass one tuple |
| `f x y`                                  | `f x y` or `f(x)(y)`                                       | Both are curried application |
| `case e of p => a \| ...`                | `match(e) { p => { a }, ... }`                              | See the binder difference below |
| function clauses `fun f p = a \| ...`    | `let rec f = match(x) => { p => { a }, ... };`              | Introduce an explicit match parameter |
| `if a then b else c`                     | `if (a) { b } else { c }`                                  | Workman always requires `else` |
| `let dec in e end`                       | `{ dec; e }`                                                | Workman blocks may also mix declarations and expressions |
| expression-valued function body          | final block expression                                      | Neither language needs an early `return` |
| `(x, y)` / `int * string`                | `(x, y)` / `(Number, String)`                               | |
| `t1 -> t2`                               | `T1 -> T2`                                                  | Function type |
| expression constraint `(e : t)`          | `(e : T)`                                                   | A constraint checks; it does not cast |
| typed pattern `(p : t)`                  | `(p : T)`                                                   | The pattern and written type must agree |
| `datatype a = A of b and b = B of a`     | `type A = AValue<B> and B = BValue<A>;`                     | Mutually recursive datatype group |
| `type a = int and b = string`            | `type A = Number and B = String;`                           | Simultaneous non-recursive aliases |
| `datatype t = A \| B of int`             | `type T = A \| B<Number>;`                                  | Constructor payloads remain one logical argument |
| `datatype t = Only`                      | `type T = \| Only;`                                         | Leading `\|` distinguishes a nominal datatype from an alias |
| `type t = u`                             | `type T = U;`                                               | Type abbreviation/alias; no fresh nominal identity |
| `type 'a t = 'a option`                  | `type T<A> = Option<A>;`                                    | |
| `'a option`                              | `Option<A>`                                                 | Type application is prefix with angle brackets |
| `NONE` / `SOME x`                        | `None` / `Some(x)`                                         | Workman conventionally capitalizes constructors this way |
| `[]` / `[1, 2, 3]`                       | `[]` / `[1, 2, 3]`                                         | |
| `x :: xs`                                | `[x, ..xs]`                                                 | Works in expressions and binding positions |
| `()` / `unit`                            | `void` / `Void`                                             | |
| `true`, `false` / `bool`                 | `true`, `false` / `Bool`                                    | |
| string literal / `string`                | string literal / `String`                                   | Workman also has backtick multiline strings |
| integer or real literal                  | number literal / `Number`                                   | Workman has one JS-oriented numeric type |
| value annotation `val x : t = e`         | `let x: T = e;`                                             | Lambda parameters and results can also be annotated |
| wildcard pattern `_`                     | `_`                                                         | |
| tuple, constructor, and literal patterns | corresponding Workman pattern                              | Match-arm bare names are pinned; use `Var(x)` for a fresh binder |
| record value `{x = e, y = f}`            | `.{ x = e, y = f }`                                        | Workman records are nominal |
| record fields `{x = x, y = y}`           | punned `.{ x, y }`                                         | Field punning is Workman shorthand |
| record projection `r.x`, `#x r`          | `r.x`                                                       | Same projection operation |
| selector function `#x`                   | `(r: Point) => { r.x }`                                     | SML provides derived shorthand; Workman writes the function explicitly |
| record pattern `{x, y}`                  | `.{ x, y }`                                                 | No SML flexible-row `...` pattern |
| `andalso`, `orelse`, `not e`             | `&&`, `\|\|`, `!e`                                         | |
| `=` / `<>`                               | `==` / `!=`                                                 | Workman does not expose SML equality type variables |
| `~e`                                     | `-e`                                                        | |
| `^`                                      | `++`                                                        | String concatenation |
| `open Math`                              | `from "./math.wm" import *;`                                | Practical equivalent: Workman opens a file rather than an SML structure |
| qualified name `Math.f`                  | namespace import plus `Math.f`                              | `from "./math.wm" import * as Math;` |
| `structure Math = struct ... end`        | file `math.wm`, imported with `* as Math`                    | A file's public environment is a real SML structure environment |
| program execution                        | `let main = () => { ... };`                                 | `wm run` invokes `main`; watched REPL files accept top-level expressions |
| SML comment `(* text *)`                 | `-- text` or `// text`                                      | Workman comments are line comments |

### SML Language Forms With No Workman Equivalent

| Missing SML form or family | Current Workman status |
| -------------------------- | ---------------------- |
| `exception`, `raise`, `handle` | Not implemented; use `Option`, `Result`, or unrecoverable `Panic` |
| `ref`, dereference `!`, assignment `:=` | Mutable references are not implemented |
| `while ... do ...` | Not implemented; use recursion |
| layered/as patterns `x as p` | No direct syntax; the common “whole value plus components” use case can be expressed with an outer binding or match-function parameter |
| flexible record patterns `{x, ...}` and structural record types | No direct equivalent; use a nominal record, tuple, list, or datatype according to the data shape |
| character literals and the `char` type | Intentionally omitted; use one-character `String` values |
| word literals/types and SML's distinct `int`/`real` numeric types | Not implemented; Workman uses `Number` |
| user symbolic identifiers, `op`, `infix`, `infixr`, `nonfix` | Not implemented; Workman has a fixed operator table |
| explicit equality variables such as `''a` | Intentionally omitted |
| `local dec1 in dec2 end` | No exact declaration form; use lexical blocks where applicable |
| `abstype ... with ... end` | Not implemented |
| `datatype t = datatype M.t` replication | Omitted for now; aliases preserve type identity and imports can bring constructors into scope |
| `withtype` | Not implemented |
| explicit or nested `structure ... = struct ... end` | No direct syntax; each file is already an implicit structure |
| signatures, `sig ... end`, and signature specifications (`val`, `type`, `eqtype`, `datatype`, `exception`, `structure`, `include`, sharing) | Not implemented |
| transparent/opaque ascription `:` / `:>` and `where type` | Not implemented |
| functor declarations and applications | Not implemented |
| structure/type sharing constraints | Not implemented |

Arrays, vectors, I/O, and most other library facilities are Basis Library features rather than
grammar forms. They are also absent unless a Workman library or the JavaScript FFI supplies an
alternative.

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

## Program Entry

An SML program evaluates its top-level declarations and expressions. A Workman application run with
`wm run` instead provides a `main` binding:

```wm
let main = () => {
  print("hello")
};
```

This is an application entry convention, not a different function model: `main` is an ordinary
zero-argument Workman function with the unit-like `Void` argument. Watched REPL files use the
phrase-oriented model described next and do accept bare top-level expressions.

## Watched REPL Files

`wm repl file.wm` evaluates the file as a sequence of top-level phrases without requiring `main`. It
reports the value and inferred type of each final visible binding:

```wm
let answer = 1 + 1;
```

```text
answer = 2 : Number
```

A bare top-level expression is treated like SML's implicit `it` binding:

```wm
1 + 1;
```

```text
it = 2 : Number
```

Pattern declarations report every introduced binder, and datatype and record declarations report
their inferred interface. REPL rendering quotes strings while ordinary `print` keeps its existing
application-oriented output.

Unlike a traditional stateful SML prompt, the watched file starts from a fresh basis after every
save. Dependencies and declarations earlier in the file still form the basis for later phrases;
bindings from a previous version of the file do not survive the next evaluation.

Within one evaluation, semicolon-terminated phrases follow the SML Program model. A successful
phrase extends the basis. A phrase that fails parsing or elaboration does not modify the basis, and
later phrases are still attempted against the previously committed basis. Workman's `Panic` remains
an unrecoverable failure rather than an SML exception; output and external side effects from earlier
phrases are retained when it aborts the current file evaluation.

## Functions

SML:

```sml
fun double x = x * 2
val id = fn x => x
```

Workman:

```wm
let rec double = (x) => {
  x * 2
};

let id = (x) => {
  x
};
```

Like SML, Workman functions return the value of an expression; there is no early `return` keyword.
In a Workman block, the final expression without a semicolon is the result:

```wm
let absolute = (n) => {
  if (n < 0) {
    0 - n
  } else {
    n
  }
};
```

A trailing semicolon instead makes the block result `void`, which is a Workman extension described
below.

Zero-argument Workman functions use `()` at the surface and take `Void` in the core:

```wm
let main = () => {
  print("hello")
};
```

## Tuple Arguments And Currying

This is one of the most important SML equivalences.

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

Curried functions chain lambdas directly:

```sml
fun add x y = x + y
```

```wm
let add = (x) => (y) => {
  x + y
};

let spaced = add 1 2;
let parenthesized = add(1)(2);
```

Whitespace application is supported directly. `add 1 2` associates to the left and has the same
meaning as `add(1)(2)`. Comma application remains different: `add(1, 2)` passes one tuple-shaped
argument.

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

### Alias Versus One-Constructor Datatype

SML uses different declaration keywords for a type abbreviation and a datatype:

```sml
type t = existing
datatype token = Token
```

Workman uses `type` for both and distinguishes them with a leading pipe:

```wm
type T = Existing;     -- alias: T and Existing are the same type
type Token = | Token;  -- datatype: introduces a fresh nominal type and constructor
```

Without the leading `|`, a body containing exactly one type name is an alias. A leading `|` always
means a datatype, including multiline and multi-constructor forms:

```wm
type Token =
  | LParen
  | RParen
  | NumberToken<Number>;
```

Mutually recursive datatypes use `and`:

```wm
type Tree = Node<Forest>
and Forest = Empty | Trees<Tree, Forest>;
```

All type names in the group are in scope throughout the group.

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

Type abbreviations can also be declared simultaneously:

```wm
type Name = String
and Count = Number;
```

## Function Types

Function types use `->`, keeping them visually distinct from lambda expressions:

```wm
let id: T -> T = (value) => { value };
let first: (T, Y) -> T = (x, y) => { x };
let apply: (T -> Y, T) -> Y = (f, value) => { f(value) };
```

Arrows associate to the right, so `T -> Y -> Z` means `T -> (Y -> Z)`. `(T, Y) -> Z` takes one
tuple-shaped argument. Use `(T -> Y) -> Z` when a function itself is the argument.

The type of a zero-argument surface function uses `Void` as its domain:

```wm
Void -> String
```

## Type Constraints

`:` constrains expressions and patterns:

```wm
let point = (.{ x = 1, y = 2 } : Point);

match(value) {
  (Some(x) : Option<Number>) => { x },
  None => { 0 },
}
```

A constraint requires the inferred type and written type to agree. It does not cast or convert the
value. The same rule applies to binding, parameter, and lambda-result annotations.

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

## Layered Patterns Without `as`

Workman has no direct equivalent of SML layered patterns:

```sml
merge (l1 as x :: xs, l2 as y :: ys)
```

The common purpose of a layered pattern—retaining the whole value while also binding its
components—can still be expressed. If the whole values are already bound, destructure them with
local `let` declarations:

```wm
let [x, ..xs] = l1;
let [y, ..ys] = l2;
```

After these declarations, `l1` and `l2` still refer to the complete lists while `x`, `xs`, `y`, and
`ys` refer to their components.

Inside a multi-clause function, match-function parameter names can retain the whole arguments while
the arm pattern binds their components:

```wm
let rec merge = match(l1, l2) => {
  ([x, ..xs], [y, ..ys]) => {
    -- l1, l2, x, xs, y, and ys are all in scope
    if (x <= y) {
      [x, ..merge(xs, l2)]
    } else {
      [y, ..merge(l1, ys)]
    }
  },
  ([], ys) => { ys },
  (xs, []) => { xs },
};
```

This covers the usual layered-list-pattern use case, but it is not a general `as` pattern. In
particular, a refutable Workman `let` pattern may fail at runtime instead of falling through to
another function clause. Prefer the match-function form when pattern failure should select another
arm.

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

The declaration also introduces an ordinary ordered constructor:

```wm
let p = Point(1, 2);
```

That ordered constructor is Workman-specific. SML structural record construction always names the
fields; the closest SML alternative is the record expression `{x = 1, y = 2}`.

SML record selection uses `#x r`, while Workman uses `r.x`. In SML, `#x` can also appear alone as a
selector function; the Definition specifies it as a derived lambda form. Workman writes that lambda
explicitly and gives its nominal record type:

```sml
#x
```

```wm
(r: Point) => { r.x }
```

This is intentionally different from SML flexible record inference. It keeps the compiler focused
and avoids a large record-polymorphism feature.

When translating an SML structural record, choose the Workman representation by how the value is
used:

- Use a nominal `record` when field names are meaningful and the shape is part of the program's
  domain model.
- Use a tuple for a small, fixed, positional product.
- Use a list for a homogeneous sequence whose length may vary.
- Use an algebraic datatype when the value can have one of several distinct shapes.

For example, an incidental pair of values does not need a record declaration:

```sml
{ value = 42, label = "answer" }
```

```wm
(42, "answer")
```

There is no exact replacement for SML flexible record constraints such as a function accepting any
record containing an `x` field. In Workman, declare the nominal record type expected by the
function, pass the required fields as separate arguments or a tuple, or redesign the boundary
around a datatype.

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

SML has no core record-update/spread expression. The direct translation is to construct another
record explicitly from the old fields and replacements.

## Forward Pipe As Application

Workman's forward pipe is another spelling of ordinary application:

```wm
value :> transform :> consume
```

corresponds to:

```sml
consume (transform value)
```

For a tuple-shaped call, pipe the tuple:

```wm
(x, y) :> add
```

which has the same argument shape as SML `add (x, y)`. Pipe/member-call forms used for JavaScript
interop are Workman-specific and have no SML parallel.

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

Workman's module system has two deliberately separate foundations. The shared language fragment
uses exact Revised Definition semantics: environments are the SML product
`Env = StrEnv × TyEnv × ValEnv` with `StrEnv = StrId → Env`, and structures, types, and values
occupy separate namespaces. The file layer — resolution, canonical module identity, graph
discovery, and initialization — is a small Workman compilation-unit protocol specified directly,
not an SML feature and not approximate ESM. The normative rules live in
[`../markdown/module-update26.7/proposed-semantics.md`](../markdown/module-update26.7/proposed-semantics.md).

Every Workman file elaborates to a public SML environment containing its module-owned top-level
value, type, record, and datatype declarations. Import forms select how that environment enters
another file:

```wm
from "./math.wm" import * as Math; -- bind Math as a static structure identifier in StrEnv
from "./math.wm" import { add };   -- project selected members, preserving each namespace
from "./math.wm" import *;         -- SML open: right-biased environment modification
```

A qualified name such as `Math.add` is the Definition's long identifier
(`strid_1.….strid_n.x`): lookup is iterated structure-environment projection, never string
matching on the dotted spelling. It qualifies values, types, and constructors, and imported
semantic objects keep their defining schemes, constructor status, and nominal identities:

```wm
from "./option.wm" import * as Opt;
let value: Opt.Option<Number> = Opt.Some(1);
```

Collisions follow the Definition's sequential, right-biased environment modification: a later
import or local declaration shadows an earlier binding in the same namespace, and equal spellings
in different namespaces do not collide. Imports take effect at their declaration positions, like
ordered SML environment declarations, and are not re-exported: the normative account nests each
import as the local part of an SML `local … in … end` around the remaining declarations.

The file protocol contributes the ESM-derived properties: every import is statically
discoverable; resolution produces one canonical `ModuleId`, so all spellings of one file share
one module instance and one set of nominal identities; the graph is acyclic; dependencies
initialize once, dependency-first, in source-edge depth-first order, and a remembered
initialization failure prevents importers from starting. A bare namespace name in expression
position is a syntactic extension meaning `Math.carrier`, resolved only after ordinary value
lookup; it does not make the module a first-class value.

The initial basis follows the SML model independently of library size: a minimal kernel of
non-source-expressible facts, compiled standard structures (`Option`, `Result`, `List`, `Task`, …)
installed as real structure environments in `StrEnv`, and an explicit pervasive table whose
unqualified bindings (`print`, `Some`, `Ok`, …) are genuine projections of the same semantic
objects as their qualified members. Ordinary initial values shadow normally; fixed operators are
kernel syntax, not rebindable `ValEnv` identifiers. Each file starts from this basis plus its
explicit imports — compilation order grants no ambient visibility.

The limitation is that Workman identifies a structure with a file. It has no separate syntax for
creating anonymous, local, or nested structures; no structure expressions independent of file
loading; and no full SML module layer with signatures, ascription, functors, or sharing
constraints. Top-level file declarations are public by default; `private` is deferred.

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

Workman does not implement general SML exceptions. Use datatypes such as `Option` and
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

Workman has a conservative generalization story and treats JS FFI as effectful at the boundary.
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

## SML Concepts Missing In Workman

Workman does not implement:

- signatures
- functors
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
- `as` patterns
- char literals
- full Basis library
- local declarations exactly as `local ... in ... end`
- abstypes
- datatype replication
- `withtype`
- `where type`
- explicit and nested structure declarations
- signatures, ascription, functors, sharing, and the rest of the full SML module language

Some of these may never be added to Workman; the language is intentionally focused.

## Mental Model

The useful mental model is:

```txt
Revised Definition semantics where Workman overlaps SML:
  tuples, constructors, pattern matching, HM inference, lexical scope

Workman surface where ergonomics differ:
  braces, semicolons, Type<T>, JSON literals, JS-style imports

Explicit omissions:
  full SML module system, refs, exceptions, flexible records, large Basis
```

The compiler should stay rigorous about the SML-defined subset, while still being practical for
JavaScript interop and general programs.
