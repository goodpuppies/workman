Yeah, there are a bunch of “looks obvious, is actually SML-specific” traps. The big ones outside tuple/application are these:

## 1. Pattern identifiers depend on the environment

SML does **not** use capitalization to decide constructor vs variable.

```sml
case xs of
  nil => 0
| x :: xs => 1
```

`nil` is a constructor because the environment says it is. A random lowercase name in a pattern is usually a variable:

```sml
case x of
  y => ...
```

This matches everything and binds `y`; it does **not** compare against an existing value named `y`.

So pattern elaboration needs the current constructor environment.

Related trap:

```sml
val SOME x = maybeValue
```

`val` patterns can be refutable. This may raise `Bind` at runtime.

---

## 2. `fun` is recursive, `val` is not

```sml
fun f x = f x
```

`f` is in scope inside its own body.

But:

```sml
val f = fn x => f x
```

does not define recursive `f`, unless there was already an outer `f`.

For recursive values:

```sml
val rec f = fn x => f x
```

And SML restricts `val rec` pretty heavily; it is not general recursive value binding like in some lazy languages.

---

## 3. `and` is simultaneous, not sequential

```sml
fun even 0 = true
  | even n = odd (n - 1)
and odd 0 = false
  | odd n = even (n - 1)
```

This is mutual recursion.

But plain declaration sequencing is different:

```sml
val x = 1
val y = x + 1
```

Here `y` sees the earlier `x`.

With `and`:

```sml
val x = 1
and y = x + 1
```

`y` does **not** see this new `x`; it sees an outer `x` if one exists.

---

## 4. Value restriction

This is one of the biggest “implementation is almost ML but not quite” traps.

```sml
val id = fn x => x
```

generalizes:

```sml
id : 'a -> 'a
```

But:

```sml
val r = ref NONE
```

does not become fully polymorphic:

```sml
r : 'a option ref
```

in the naive HM sense. It gets a weak/monomorphic type variable, because the RHS is expansive.

Otherwise this would be unsound:

```sml
r := SOME 1;
r := SOME true;
```

So Algorithm W alone is not enough for real SML; you need the value restriction/generalization rule.

---

## 5. Equality types are special

SML has equality type variables:

```sml
''a
```

The equality operator has roughly:

```sml
= : ''a * ''a -> bool
```

Not every type admits equality.

These are not equality types:

```sml
real
'a -> 'b
```

Usually these are equality types if their components are:

```sml
int
bool
string
'a list
'a option
```

Refs are equality types by identity-ish equality:

```sml
ref 1 = ref 1   (* false *)
```

A naive implementation that gives `=` type:

```sml
'a * 'a -> bool
```

is wrong.

---

## 6. Overloading is small but real

Numeric literals and arithmetic operators are overloaded.

```sml
1
1.0
x + y
x < y
```

The compiler has to resolve overloaded classes such as `int`, `real`, `word`, etc., depending on the Basis and implementation defaults.

This is not ordinary Hindley–Milner polymorphism:

```sml
+ : 'a * 'a -> 'a
```

is wrong. It is constrained over numeric types.

---

## 7. Records are not normal row-polymorphic records

SML records look like they want row polymorphism:

```sml
fun getX {x, ...} = x
```

But Standard ML does not have full inferred row polymorphism. This is often rejected unless enough type information is available:

```sml
fun getX ({x, ...} : {x : int, y : bool}) = x
```

So if you accidentally implement nice row polymorphism, you may make a language that is nicer than SML, but not SML.

Tuples are also records underneath in the formal model:

```sml
(1, true) : int * bool
```

is basically:

```sml
{1 = 1, 2 = true}
```

but user syntax does not expose that fully.

---

## 8. Infix status is part of parsing

This one is nasty.

```sml
infix 6 ++

fun x ++ y = x + y
```

After an `infix` declaration, the parser must parse `++` differently.

To use an infix identifier as a normal function:

```sml
op + (1, 2)
```

To remove infix status:

```sml
nonfix ++
```

Important: fixity is not a runtime property of the value. It affects parsing in scope. This means your parser may need access to a fixity environment, not just the lexer grammar.

---

## 9. Constructors are not multi-argument either

This is tuple-adjacent, but it shows up everywhere.

```sml
datatype t = Pair of int * int
```

The constructor has type:

```sml
Pair : int * int -> t
```

So:

```sml
Pair (1, 2)
```

is valid.

But:

```sml
Pair 1 2
```

is wrong.

Likewise:

```sml
exception E of int * string
```

means `E` takes one tuple argument.

---

## 10. Nullary constructors are values, not functions

```sml
datatype color = Red | Blue
```

Then:

```sml
Red
```

is a value.

This is wrong:

```sml
Red ()
```

Same with:

```sml
NONE
nil
true
false
```

They are constructors/values, not zero-argument functions.

---

## 11. `if` always has `else`

No statement-style `if`.

```sml
if cond then a else b
```

Both branches must have the same type.

There is no:

```sml
if cond then doThing()
```

unless you write:

```sml
if cond then doThing() else ()
```

---

## 12. `andalso` and `orelse` are special forms

These short-circuit:

```sml
a andalso b
a orelse b
```

They are not ordinary functions, because an ordinary function would evaluate both arguments before the call.

So these cannot just be implemented as Basis functions with types like:

```sml
bool * bool -> bool
```

They need special expression forms or desugaring into `if`.

---

## 13. Pattern matching order matters

```sml
case x of
  _ => 1
| 0 => 2
```

The second case is unreachable. Matching is top-to-bottom.

Likewise function clauses:

```sml
fun f 0 = "zero"
  | f _ = "other"
```

are ordered pattern matches.

Also, non-exhaustive matches are not type errors in SML. They may warn, but at runtime they raise `Match`.

---

## 14. Duplicate variables in one pattern are illegal

This is not an equality test:

```sml
fun f (x, x) = ...
```

That should be rejected.

To compare components, you need:

```sml
fun f (x, y) =
  if x = y then ...
  else ...
```

---

## 15. Negative numbers use `~`, not `-`

SML has:

```sml
~1
```

not really:

```sml
-1
```

`-` is an infix operator. `~` is unary negation.

So parsing numeric literals and unary negation needs care.

Examples:

```sml
x - 1
~x
~42
```

This matters especially in patterns too:

```sml
case x of
  ~1 => ...
| _ => ...
```

---

## 16. Comments nest

SML comments are:

```sml
(* comment *)
```

but they can nest:

```sml
(* outer (* inner *) outer again *)
```

A simple “scan until next `*)`” lexer is wrong.

---

## 17. Type arrows associate right

```sml
int -> int -> int
```

means:

```sml
int -> (int -> int)
```

not:

```sml
(int -> int) -> int
```

Function application associates left:

```sml
f x y
```

means:

```sml
(f x) y
```

So the expression and type parsers have opposite-feeling associativity traps.

---

## 18. Type application syntax is postfix-ish

SML writes:

```sml
'a list
int option
(int, string) map
```

not:

```sml
list 'a
option int
map int string
```

So type constructors have a different surface syntax from value-level functions.

Also, type constructor arity matters:

```sml
int list        (* okay *)
(int, string) list  (* wrong; list has arity 1 *)
```

---

## 19. Datatype/type generativity

```sml
datatype t = A
datatype t = A
```

The second `t` is a fresh type, not the same type redefined.

This gets especially important with modules/functors. If a functor body defines a datatype, applying the functor can generate fresh types/constructors.

A naive implementation that treats structurally identical datatypes as equal will be wrong.

---

## 20. `type` aliases are not new types

```sml
type meters = int
type seconds = int
```

These are just aliases. They do not create distinct types.

So:

```sml
val x : meters = 3
val y : seconds = x
```

is fine.

For a fresh type, you need `datatype` or an abstract type through the module system.

---

## 21. Exceptions are dynamically generative values

```sml
exception E
raise E
```

Exceptions behave like constructors into `exn`, but exception identity matters. Two exception declarations with the same name are not “the same exception” semantically if generated separately.

This matters in modules and local scopes:

```sml
let
  exception E
in
  E
end
```

creates a fresh exception constructor.

---

## 22. `local ... in ... end` is declaration-level hiding

```sml
local
  val secret = 1
in
  val public = secret + 1
end
```

After this, `public` is exported, `secret` is not.

It is not just the same as an expression-level `let`. It transforms the declaration environment.

---

## 23. Modules are a separate language layer

SML Core is already nontrivial, but Modules add a lot:

```sml
structure S = struct ... end
signature SIG = sig ... end
functor F(X : SIG) = struct ... end
```

Common traps:

```sml
structure S : SIG = ...
```

transparent-ish ascription.

```sml
structure S :> SIG = ...
```

opaque ascription.

With opaque ascription, type identities can be hidden:

```sml
structure S :> sig
  type t
  val x : t
end = struct
  type t = int
  val x = 1
end
```

Outside, `S.t` is abstract, not just `int`.

---

## 24. `open` imports bindings, but does not merge structures magically

```sml
open List
```

brings names from `List` into scope. It is not inheritance/import in the JavaScript/Python sense.

Also, opening structures can shadow existing names.

---

## 25. Top-level conveniences are not necessarily the language

Things like:

```sml
use "file.sml";
it
```

are implementation/REPL conveniences, not really the core language from the Definition.

Likewise, the Basis Library is separate from the core Definition. For a real usable implementation you probably want a Basis subset, but it is not the same thing as implementing the static/dynamic semantics of SML.

---

The really high-risk ones, implementation-wise, are probably:

1. environment-sensitive pattern identifiers
2. value restriction
3. equality types
4. overloaded numeric operators/literals
5. fixity-directed parsing
6. record flexibility limits
7. datatype/exn generativity
8. module opacity/type sharing

Those are the places where a tiny ML usually quietly becomes “ML-inspired” instead of SML.
