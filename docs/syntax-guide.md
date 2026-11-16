# Workman Syntax Guide

A practical guide to Workman's syntax. Workman is a functional language that blends TypeScript-style
familiarity with ML-style type inference and pattern matching.

If you already know Standard ML, see [SML Parallels](./smlparallels.md) for a concept-by-concept
translation guide.

---

## Table of Contents

- [Comments](#comments)
- [Entry Point](#entry-point)
- [Variables and Functions](#variables-and-functions)
- [Types](#types)
- [Records](#records)
- [Pattern Matching](#pattern-matching)
- [If/Else](#ifelse)
- [Operators](#operators)
- [Carriers and Pipelines](#carriers-and-pipelines)
- [Lists](#lists)
- [Modules and Imports](#modules-and-imports)
- [Quirks and Gotchas](#quirks-and-gotchas)
- [Current `wm` Unsupported Notes](#current-wm-unsupported-notes)

---

## Comments

Line comments use either spelling:

```workman
-- This is a dash comment
// This is also a comment (C-style)
/* A block comment can span
   several lines. */
```

---

## Entry Point

Running a file first initializes its imported modules and then evaluates its top-level declarations
in order. A discarded top-level binding is enough for a small script:

```workman
let _ = print("hello");
```

If the file exports a `main` function, `wm run` calls it after initialization:

```workman
let main = () => {
  print("hello")
};
```

---

### Return (there is no return)

The last expression (without semicolon) is the return value:

```workman
let example = () => {
  let x = 1;
  let y = 2;
  x + y  -- This is returned (no semicolon)
};

-- If last expression has semicolon, return type is Void
let printTwice = (msg) => {
  print(msg);
  print(msg);  -- Semicolon here means return Void
};

-- void is also a literal value (the type is `Void`)
let nothing = () => { void };
```

---

## Variables and Functions

### Basic Let Bindings

```workman
let x = 42;
let name = "Workman";
let pair = (1, "hello");
```

### Strings

Double-quoted strings are single-line:

```workman
let short = "hello\nworld";
```

Backtick strings can span multiple lines and use JavaScript-style `${...}` interpolation.
Interpolation renders Workman values as text, including numbers, booleans, records, tuples,
lists, and algebraic datatype constructors:

```workman
let page = `first line
second line
third line`;

let withTick = `use \` to include a backtick`;
let greeting = `Hello, ${name}!`;
let score = `score: ${42}, complete: ${true}`;
let token = `token: ${Some("name")}`; -- token: Some(name)
let escaped = `write \${name} to show it literally`;
```

The same conversion is available explicitly as `Text.of(value)`. Ordinary `++` remains strict
string concatenation and does not convert its operands.

### Tuple Destructuring

Destructure tuples directly in let bindings:

```workman
let (a, b) = somePair;
let (x, y, z) = triple;

-- Nested destructuring
let ((first, second), third) = nestedTuple;
```

### Functions

```workman
-- Simple function
let double = (x) => {
  x * 2
};

-- Multiple parameters
let add = (a, b) => {
  a + b
};

-- Tuple parameter patterns (destructure in parameter)
let swap = (a, b) => {
  (b, a)
};

let processPoint = (x, y) => {
  x + y
};

-- With type annotations (optional but helpful)
let greet = (name: String) => {
  print(name)
};

-- Zero-argument functions use ()
let main = () => {
  print("hello world")
};
```

### Application, Tuples, and Currying

A single parameter can omit its parameter-list parentheses, and a single-expression
body can omit braces:

```workman
let square = x => x * x;
let addCurried = x => y => x + y;
let mapped = map([1, 2, 3], x => x * x);
let typed = x: Real64 => x * x;
```

A bare parameter may also be a single delimited pattern, such as
`[head, ..tail] => head`. Tuple-shaped multi-parameter lists still use `(x, y)`.
Parentheses and braces remain available, and formatting preserves the authored
choice rather than inserting them as repairs.

The semicolon in `let square = x => x * x;` ends the declaration; the function
returns the product. To discard a final expression, put its semicolon inside an
explicit block: `x => { x * x; }` returns `Void`. Use a block for local declarations
or a sequence of statements. Comments and line breaks can separate tokens, but
do not replace declaration semicolons.

An expression body extends through the following expression, including nested
lambdas and whitespace application, until its enclosing delimiter or semicolon.
For example, `apply x => x + 1` means `apply(x => x + 1)`. Use parentheses when a
lambda must be grouped as an operand. Bare `x: Real64 => ...` annotates the
parameter; `(x): Real64 => ...` annotates the function's return.

Use `_` as a whole argument in a parenthesized call to create a function:

```workman
let subtract = (a, b) => a - b;
let fromTen = subtract(10, _); -- x => subtract(10, x)
let result = 3 :> subtract(10, _); -- 7
let both = subtract(_, _); -- (a, b) => subtract(a, b)
```

Placeholders belong to their nearest call: `x(z(_, true))` is
`x(value => z(value, true))`. A pipe applies the generated function without
inserting an extra argument. Fixed argument expressions run each time the
generated function is called, as in an explicit lambda. See
[argument placeholders](advancedsyntax.md#argument-placeholders) for details.

Match arms can also return expressions directly. Match functions can omit the
braces around their arms:

```workman
let rec fac = match(n) => 0 => 1, Var(n) => n * fac(n - 1);
let rec facBraced = match(n) => {0 => 1, Var(n) => n * facBraced(n - 1)};
let rec facAnonymous = match 0 => 1, Var(n) => n * facAnonymous(n - 1);
let flag = match true => 1, false => 0;
```

Braced match functions support direct application with or without named parameters:

```wm
let named = match(x)=>{true=>1,false=>0} true;
let anonymous = match{true=>1,false=>0} true;
let explicit = match(x)=>{true=>x,false=>x}(true);
```

The first two bindings are `1`; the last is `true`. Use a space or explicit `(argument)`
parentheses before the argument. Compact `}true` is a syntax error.
The named form keeps `x` available inside the arms. Group a braceless match function in
parentheses before applying it directly.

The prefix `match (identifiers) =>` is reserved for the named form, even if its
arm list is invalid. For an anonymous match whose first pattern has that shape,
keep the braces: `match { (a, b) => _ => 0 }`. Here `a` and `b` are pinned values
in a tuple pattern; `match(a, b) => _ => 0` instead names two function parameters.

Arm bodies may still use blocks for local declarations or statements. Braced arm
lists allow a trailing comma; braceless lists do not, so a comma before another
call argument remains outside the match. An inner braceless match takes following
arms until its enclosing delimiter; use braces or parentheses to end its arms
before continuing an outer match.

`wm` follows the SML-style distinction between tuple arguments and curried application:

```workman
let addPair = (a, b) => { a + b };

-- One tuple-shaped argument (the usual multi-parameter function style)
let x = addPair(1, 2);
let y = addPair((1, 2));

-- Explicit currying by returning functions
let addCurried = a => b => { a + b };
let z = addCurried(1)(2);
```

Rule of thumb:

- `f(1, 2)` means one tuple argument
- `f(1)(2)` means two unary applications (curried style)

### Pipeline Lambdas

When a function uses its input only as the head of one pipeline, omit the named
parameter and start its body with `:>`:

```workman
let add = (a: Int32, b: Int32) => a + b;
let double = (x: Int32) => x * 2;

let explicit = x => x :> add(1) :> double;
let implicit = => :> add(1) :> double;
let block = => {
  :> add(1)
  :> double
};
```

All three functions do the same thing. The `=> :>` shorthand supplies a fresh
implicit input to the leading pipe; a braced body can use `=> { :> ... }`.
Ordinary pipe rules still apply, including inline matches, record/JS member stages,
and piped conditionals.

This notation also works in a `via` transformation:

```workman
let increment = Monad.via Result => {
  :> add(1)
  :> Ok
};
```

Use an explicit parameter if later expressions need its name. With no leading
pipe, a bare arrow such as `=> { 42 }` remains a `Void`-argument function. Braces
can end an inline pipeline lambda before the surrounding pipeline continues.
See [Pipeline lambdas](./advancedsyntax.md#pipeline-lambdas) for scope details.

#### Reading Adjacent Arrows

The common spelling `==>` places a binding's `=` directly beside a lambda's
`=>`. Read the lambda according to how its body starts:

| Lambda form | Expansion |
| --- | --- |
| `=> :> step` | `value => value :> step` |
| `=> expression` (no leading `:>`) | `() => expression` |

For example, using `add` from above:

```workman
let transform ==> :> add(1);
let produce ==> 42;

-- The same declarations with explicit parameters:
let transformExplicit = value => value :> add(1);
let produceExplicit = () => 42;
```

Both lambda shorthands work independently of a preceding `=`. They can appear
directly as arguments:

```workman
let incremented = List.map([1, 2], => :> add(1));
let invoke = thunk => thunk();
let answer = invoke(=> 42);
```

The leading `:>` chooses the implicit-input expansion. Without it, the lambda
takes `Void`; the body runs when the function is called. `==>` has no additional
behavior, and spacing it as `= =>` does not change the lambda.

### Recursive Bindings

**Use `let rec`** for a binding that refers to itself. Recursive references must
occur beneath a function:

```workman
-- ❌ WRONG: Regular let cannot self-reference
let factorial = (n) => {
  match(n) {
    0 => { 1 },
    _ => { n * factorial(n - 1) }  -- Error: factorial not in scope
  }
};

-- ✅ CORRECT: Use let rec
let rec factorial = match(n) => {
  0 => { 1 },
  _ => { n * factorial(n - 1) }
};

-- Recursive references must occur beneath a function
```

Direct self-calls in tail position are compiled as iteration and do not grow the JavaScript call
stack. Tail positions include the function result, either branch of a tail-position `if`, each arm
of a tail-position `match`, and the final result of a block. Mutual tail calls and non-tail
recursive calls still use the JavaScript call stack.

The optimizer also follows known function wrappers, including imported procedure adapters
such as `via(callback)`. If the adapter calls the callback in tail position, a self-call
inside that callback can become iteration too. Captured arguments are evaluated once at
the original binding site. This analysis is bounded and conservative: unknown callbacks,
wrappers with work after the callback, and inaccessible private captures retain ordinary
calls.

```workman
let rec fold = match(items, acc) => {
  ([], _) => { acc },
  ([head, ..tail], _) => { fold(tail, acc + head) }
};
```

### Mutual Recursion

**Use `and` for mutually dependent declarations:**

```workman
let rec isEven = match(n) => {
  0 => { true },
  _ => { isOdd(n - 1) }
}
and isOdd = match(n) => {
  0 => { false },
  _ => { isEven(n - 1) }
};
```

---

## Types

### Numbers and Literal Types

At the end of a top-level declaration, unconstrained integer literals default to
`Int32` when they fit its signed 32-bit range. Larger unconstrained literals,
fractional literals, and exponent literals use `Real64`. Context can give an integer
literal another numeric type before that default applies:

```workman
let count = 42;             -- Int32
let measurement = 42.0;     -- Real64
let real: Real64 = 42;      -- context makes the literal Real64
let increment = x => x + 1; -- Int32 -> Int32
let scale = (x: Real64) => x * 2;
```

`Int32` arithmetic checks signed 32-bit overflow. `Real64` is the usual floating-point
type; `Real32` provides explicit single-precision operations. Already-bound values
do not change numeric type implicitly: use a conversion such as
`count :> Int32.toReal64`. GPU regions have their own numeric rules; see
[Numeric literals](./numbers.md) and [WMSlang](../tooling/wmslang/README.md).

### Sum Types (Tagged Unions)

Instead of enums, Workman uses TypeScript-style union types that are functionally algebraic data
types:

```workman
-- Simple enum-like type
type Color = Red | Green | Blue;

-- Parameterized variants (like Rust enums with data)
type Option<T> = None | Some<T>;

type List<T> = Empty | Link<T, List<T>>;

type Result<T, E> = Ok<T> | Err<E>;

-- Multiple type parameters
type Either<A, B> = Left<A> | Right<B>;
```

`Option`, `List`, and `Result` are already provided by the standard library.
The declarations above illustrate the syntax; redeclaring a datatype creates a
new nominal type, not an alias of its standard-library counterpart.

### Alias vs Variant Disambiguation

Single-item type bodies are intentionally disambiguated:

```workman
type T = X;      -- Alias: T is the same type as X
type T = | X;    -- Variant: T has constructor X
type T = | X | Y;-- Variant: leading pipe multi-constructor form
```

Rule of thumb:

- no leading `|` and exactly one item => alias body
- leading `|` => variant body, even with one constructor
- any body with multiple `|`-separated constructors => variant body

OCaml-style leading pipe is also supported (useful for multiline):

```workman
type Expr =
  | Literal<Real64>
  | Add<Expr, Expr>
  | Mul<Expr, Expr>
  | Neg<Expr>;

type Token =
  | LParen
  | RParen
  | Number<Real64>
  | Ident<String>;
```

Mutually recursive types are declared in one group with `and`. Every name in the group is visible
in every constructor payload:

```workman
type Even = EvenZero | EvenSucc<Odd>
and Odd = | OddSucc<Even>;
```

As with an ordinary declaration, a single-constructor variant needs a leading `|`; without it the
right-hand side is a type alias.

### Using Constructors

Constructors are called like functions:

```workman
let color = Red;
let maybeNum = Some(42);
let list = Link(1, Link(2, Empty));
```

### Function Types and Type Variables

Function types use `->`; function and match bodies use `=>`. The type arrow
associates to the right. A higher-order input is grouped, as in `(a -> b) -> c`.

```workman
let parse: String -> Result<Int32, Int32.Error> = Int32.fromString;
let add: (Int32, Int32) -> Int32 = (a, b) => a + b;
let apply: ((a -> b), a) -> b = (f, value) => f(value);
```

Lowercase names such as `a` and `b` in annotations stand for type variables.
An explicit type declaration binds its named parameters, so uppercase parameters
are also valid in `type Box<T> = | Box<T>;`. An uppercase name not bound as a
parameter must resolve to a declared type or type constructor.

### Typed Holes

Use `?` for an expression that is not implemented yet:

```workman
let todo: String -> Int32 = ?;
let calculate = (x: Real64): Real64 => {
  let intermediate = x * 2;
  ?
};
```

The hole receives constraints from its context, and the language server can show
its type. The rest of the program remains available to tooling. Reaching a hole
at runtime fails with `typed hole`; it is not an FFI implementation or a successful
placeholder value.

### Record Types

```workman
record Point = { x: Int32, y: Int32 };
record Person = { name: String, age: Int32 };

-- Records with type parameters
record Pair<A, B> = { first: A, second: B };
```

---

### Inline Record Types

Declare a nominal record directly in a type annotation by writing its name followed by
its fields:

```wm
let point = .{ a = 1, b = 2 }: Point{ a: Int32, b: Int32 };
let next: Point = .{ a = point.a + 1, b = point.b };
let origin = Point(0, 0);
```

The first expression defines `Point` alongside the literal. Later expressions can
use the type name and its ordered constructor. This gives the convenience of
describing a record's shape where it is used while retaining nominal records:
another record type with identical fields remains a different type.

The same syntax works in parameter and return annotations:

```wm
let add = (r: AddI{ a: Int32, b: Int32 }): AddRes{ result: Int32 } => {
  .{ result = r.a + r.b }
};
let sum: AddRes = add(AddI{ a = 2, b = 3 });
```

This is shorthand for ordinary `record AddI = { a: Int32, b: Int32 };` and
`record AddRes = { result: Int32 };` declarations immediately before `let add`.
The types and their ordered constructors are available throughout that statement and
to later statements in the containing module or block. New module-level definitions are
exported; block-local types follow the usual restrictions on escaping their scope.

An inline annotation creates a nominal type only if its name is not already visible.
Repeated `Point{a:Int32, b:Int32}` annotations refer to the same `Point` and check that the field
names and types match. Field order may differ in a repeated annotation; the ordered
constructor retains the order established by the original declaration. Differently
named records remain distinct even when their fields match.

An explicit `record Point = ...` redeclaration in the same module or block is an error.
An explicit declaration in a nested block may shadow an outer type; an inline annotation
instead reuses any visible record of that name. Referencing an existing non-record type
with inline record syntax is an error.

Inline definitions also work in expression and binding annotations, nested fields, aliases, and function
types. Empty records use `Empty{}`. Explicit type parameters define generic records:

```wm
let unwrap = (box: Box<t>{ value: t }) => { box.value };
let number: Box<Int32> = Box(42);
let text: Box<String> = Box("hello");
```

## Records

Records are **nominal** (not structural). Declare a record type separately or inline in a type annotation.

### Creating Records

```workman
-- First, declare the record type
record Point = { x: Int32, y: Int32 };

-- Then create instances (note the leading dot)
let p = .{ x = 10, y = 20 };

-- With explicit type annotation
let p: Point = .{ x = 10, y = 20 };
```

When the record type is inferred, the language server shows it after the literal's closing
brace, as in `.{ x = 10, y = 20 }: Point`.

### Ordered Constructors

Every record declaration also introduces an ordinary constructor function. Its arguments follow
field declaration order:

```workman
record Point = { x: Int32, y: Int32 };

let p = Point(10, 20);
```

For a polymorphic record, the constructor is polymorphic in the same way as the record:

```workman
record Pair<A, B> = { first: A, second: B };

let pair = Pair(1, "one");
```

Because the constructor is an ordinary function, it composes with carrier operations without any
record-specific carrier behavior:

```workman
Result|xResult, yResult|
  :> Result.map(Point)
```

This has type `Result<Point, E>`. Use an explicit record literal when values do not follow
declaration order or when naming the fields is clearer.

### Field Punning

When a variable name matches the field name, write the name once:

```workman
let x = 10;
let y = 20;

-- ❌ Verbose
let p = .{ x = x, y = y };

-- ✅ Punned (x and y are both field names and values)
let p = .{ x, y };
```

### Record Spread

Use `..source` inside a record literal to copy an existing record, then override fields by placing
explicit fields after the spread:

```workman
let p1 = .{ x = 10, y = 20 };

-- Copy p1, override x
let p2 = .{ ..p1, x = 100 };  -- { x: 100, y: 20 }

-- Override multiple fields
let p3 = .{ ..p1, x = 5, y = 5 };

-- Spread with punning: x is both the field name and the value variable
let x = 50;
let p4 = .{ ..p1, x };
```

Each spread must have the same nominal record type as the literal being built. Punning and explicit
`field = value` entries can be mixed in the same literal.

### Field Access

```workman
let p = .{ x = 10, y = 20 };
let xVal = p.x;  -- 10
```

A record field can be read from any expression without a binding, and the result can be read or
called in turn. `e` runs once, and `e.field` is SML's `#field e`:

```workman
let did = profile("thing").did;
let port = config().server.port;
let grouped = (profile("thing")).did;
let next = counter().step(1);
```

The `.` must follow the expression directly, with no space, and a numeric literal can't take a field.
After an expression, `.` reads a record field. A pipe member stage, `:> .member`, works with both
Workman records and JavaScript values:

```workman
record Label = { text: String };
let label = Label("hello");
let text = label :> .text; -- same as label.text
let length = "hello" :> .length;
```

For a computed JS receiver, use a pipe member stage, as in
`JSON.parse(text) :> .did`. A name bound to a JS value can also use `value.member`.
Chained projections and function-valued record fields work too: `value :> .inner.text`
and `value :> .transform(argument)`. The receiver runs once, before call arguments.

In a pipeline, the input goes into the first call of the access. Parentheses make the stage a value
that gets called with the input, as they do for any call:

```workman
did :> feed(30).posts;      -- feed(did, 30).posts
did :> feed(30).next(1);    -- feed(did, 30).next(1)
1 :> (counter()).step;      -- counter().step(1)
1 :> (counter().step);      -- counter().step(1)
```

See [Generic programming](./generic-programming.md) for using records in place of traits,
interfaces, and other capability abstractions.

---

## Pattern Matching

### Basic Match

Matching an explicit value with `match(value) { arms }` requires braces. Named and
anonymous match functions can omit them as described under functions above:

```workman
let describe = match(n) => {
  0 => { "zero" },
  1 => { "one" },
  _ => { "many" }
};

-- Match several subjects directly; no extra tuple parentheses are needed
let describeReady = (status, ready) => {
  match(status, ready) {
    (Some(_), true) => { "go" },
    _ => { "wait" }
  }
};
```

### Constructor Patterns

```workman
let unwrap = match(opt) => {
  Some(x) => { x },
  None => { 0 }
};

let rec sum = match(list) => {
  Empty => { 0 },
  Link(head, tail) => { head + sum(tail) }
};
```

### Tuple Patterns

```workman
let swap = match(pair) => {
  (Var(a), Var(b)) => { (b, a) }
};

-- Nested tuples
let getFirst = match(nested) => {
  ((Var(a), _), _) => { a }
};
```

### Literal Patterns

Integer, real, character, string, boolean, and `void` patterns are supported. Integer patterns
take their numeric type from context, just as literal expressions do.

```workman
let isZero = match(n) => {
  0 => { true },
  _ => { false }
};

let checkChar = match(c) => {
  'a' => { "it's an a" },
  'b' => { "it's a b" },
  _ => { "something else" }
};
```

### First-Class Match

A match can be written directly as an anonymous function and used in a pipeline:

```workman
let value = option :> match {
  Some(x) => { x },
  None => { 0 }
} :> transform;
```

It can also be bound like any other function:

```workman
let unwrap = match {
  Some(x) => { x },
  None => { 0 }
};

let value = option :> unwrap;
```

For top-level function definitions, prefer naming the input with `match(input) =>`:

```workman
let unwrap = match(option) => {
  Some(value) => value,
  None => 0
};
```

An unapplied match implicitly creates a match function, but the named form makes a
top-level function's input explicit and gives it a name available throughout the
arms. It also provides a place for an explicit capture clause, such as
`match(input) |limit| =>`. Anonymous matches are convenient inline in pipelines
and callbacks.

The named-parameter match form is syntactic sugar for a regular function:

```workman
-- First-class match (sugar)
let matcher = match(input) => {
  true => { "yes" },
  false => { "no" }
};

-- Equivalent to a regular function:
let matcher = (input) => {
  match(input) {
    true => { "yes" },
    false => { "no" }
  }
};
```

### Pattern Rules (Current Subset)

Current `wm` pattern behavior:

- Wildcard `_`, literals, tuple patterns, and constructor patterns are supported.
- Bare names in `match` patterns are pinned (matched against existing names).
- `=(expression)` computes an equality value when a match-arm check is reached.
- Use `Var(x)` to introduce a new binding where needed.
- Match guards (`when`) and match bundles are currently out of scope.

### Pinned Patterns (Default Behavior)

Workman matches against existing variable values **by default** (pinning). This is the opposite of
most ML-style languages:

```workman
let expected = 42;

-- expected is PINNED (matched against its value), not bound
let check = match(actual) => {
  expected => { "matches!" },  -- Matches if actual == 42
  _ => { "different" }
};

-- To BIND a new variable, use Var()
let extract = match(actual) => {
  Var(x) => { x }  -- x is bound to actual's value
};
```

**Key insight:** In Workman, bare identifiers in patterns are looked up as existing variables. Use
`Var(name)` to introduce a new binding.

Constructor payload and list-element positions introduce their own bindings, as in
`Some(x)` and `[head, ..tail]`. For tuple patterns, use explicit binders such as
`(Var(a), Var(b))` when introducing new names.

`Var(x)` binds the whole matched value. In a `Result` match, `Var(x) => x` preserves
the original success and error types and also catches remaining `Ok` values.
`Err(error) => Err(error)` matches only the error variant and allows the other arms
to change the success type. These forms are not interchangeable.

### Computed Equality Patterns: `=(expression)`

Use `=(expression)` to match the value of an expression:

```workman
let limit = 10;
let describe = match(input) |limit| => {
  =(limit - 1) => "just below",
  =(limit + 1) => "just above",
  _ => "other"
};
let label = describe(11); -- "just above"
```

Here `input` names the matched value, and `|limit|` declares the enclosing binding
captured by the function. The computed patterns compare `input` with their values.

The expression must have the same type as the matched value and support equality.
This works with values such as numbers, strings, and constructed
datatypes, not just Booleans. Computed patterns also work inside other patterns,
such as `Some(=(limit + 1))`.

The subject is evaluated once. Arms are checked in order, and a computed
expression runs only when that pattern check is reached. After an arm matches,
later conditions and arm bodies are skipped. Expressions use the enclosing
lexical scope, not names newly introduced elsewhere in the same pattern.

`=(expression)` is an equality pattern, not a `when` guard or a binding form.
Include a fallback when needed; computed patterns do not establish exhaustiveness
on their own.

---

## If/Else

`if/else` is syntax sugar for boolean match. **Important rules:**

1. **`else` is mandatory** (expressions must return a value)
2. **`else if` is banned** (use nested if or match instead)
3. **Braces are mandatory**

### Cond-Style Matches

For a sequence of conditions, use a match against `true` with computed equality
patterns:

```workman
let n = -3;
let thing = match {
  =(n < 0) => "negative",
  =(n == 0) => "zero",
  _ => "positive"
} true;
```

Each computed expression produces a Boolean. The first one equal to `true`
selects its arm, and `_` supplies the final fallback. This is a convenient
convention for a cond-style decision instead of an `if` / `else if` / `else`
chain. The trailing `true` makes that intention visible when reading the code.

Its placement is a style choice: this is an ordinary match function applied to
`true`, with the same meaning as `match(true) { ... }` or `true :> match { ... }`.
There is no separate `cond` keyword.

When piping the selected result onward, group the complete application:

```workman
let decorate = text => "[" ++ text ++ "]";
let decorated = (match {
  =(n < 0) => "negative",
  =(n == 0) => "zero",
  _ => "positive"
} true) :> decorate;
```

The parentheses make the pipe consume the match's result. Without that grouping,
the pipe can attach to the argument expression instead. See
[Computed equality patterns](#computed-equality-patterns-expression) for evaluation
and scope rules.

### Boolean Conditions and Piped `if`

A pipeline can supply the Boolean condition directly:

```workman
let label = (value > 0) :> if { "positive" } else { "nonpositive" };
-- Equivalent to: if (value > 0) { "positive" } else { "nonpositive" }
```

The input is evaluated once and only the selected branch runs. Branches use normal
block scope and must have compatible types. The result can feed another pipe.
`if { ... } else { ... }` is a conditional stage only after `:>`; a standalone
conditional still needs `if (condition)`. Parenthesize a comparison before piping
it, since `:>` currently binds tighter than comparison and arithmetic operators.

```workman
-- ✅ CORRECT
let abs = (n) => {
  if (n < 0) {
    0 - n
  } else {
    n
  }
};

-- ❌ WRONG: No else
let wrong = (n) => {
  if (n < 0) {
    0 - n
  }
};

-- ❌ WRONG: else if not allowed
let wrong = (n) => {
  if (n < 0) {
    "negative"
  } else if (n == 0) {  -- Error!
    "zero"
  } else {
    "positive"
  }
};

-- ✅ CORRECT: Use nested if or match instead
let correct = (n) => {
  if (n < 0) {
    "negative"
  } else {
    if (n == 0) {
      "zero"
    } else {
      "positive"
    }
  }
};

```

---

## Operators

### Built-in Operators

```workman
-- Arithmetic: * / % bind tighter than + -
let sum = 1 + 2;
let diff = 5 - 3;
let prod = 4 * 2;    -- Higher precedence than +/-
let quot = 10 / 2;
let remainder = 10 % 3;

-- String concatenation (same precedence as + and -)
let greeting = "Hello" ++ " " ++ "World";

-- Comparisons bind less tightly than arithmetic; ordering binds tighter than equality
let equal = x == y;
let notEqual = x != y;
let less = x < y;
let greater = x > y;
let lessEq = x <= y;
let greaterEq = x >= y;

-- Boolean: && binds tighter than ||; both bind less tightly than comparisons
let both = a && b;
let either = a || b;
let negated = !flag;
```

### Custom Operators

**Not supported yet in current `wm`.** Fixed built-in operators are available; custom fixity is
planned/design syntax.

```workman
-- Define a function
let append = (a, b) => { ... };

-- Bind it to an operator
infixl 5 ++ = append;    -- Left-associative, precedence 5
infixr 5 :: = cons;      -- Right-associative
infix 4 === = strictEq;  -- Non-associative

-- Prefix operators
prefix ! = not;
```

### Pipe Operators

```workman
-- Forward pipe (send value to function)
let result = 42 :> double :> print;
-- Equivalent to: print(double(42))

-- With multi-argument functions, piped value becomes first arg (UFCS-style)
let result = 10 :> add(5);
-- Equivalent to: add(10, 5)

-- To pipe multiple arguments, wrap in a tuple
let result = (10, 5) :> add;
-- Equivalent to: add(10, 5)

-- Chain with mixed arities
let result = 42 :> double :> add(10) :> print;
-- Equivalent to: print(add(double(42), 10))
```

When the right side uses space application to produce a function, the pipe calls that produced
function with the piped value. This is distinct from the parenthesized UFCS form above:

```workman
let result = input :> f argument;
-- Equivalent to: (f(argument))(input)

let result = input :> f(argument);
-- Equivalent to: f(input, argument)

let result = input :> f (argument);
-- Also equivalent to: f(input, argument); whitespace before `(` is only layout

let result = input :> (f(makeArgument value));
-- Equivalent to: (f(makeArgument(value)))(input)
```

The space application may itself be nested:

```workman
let makeTransform = (offset) => {
  (transform) => {
    (value) => { transform(value + offset) }
  }
};

let result = 40 :> makeTransform 1 (value) => { value + 1 };
-- Equivalent to: ((makeTransform(1))((value) => { value + 1 }))(40)
```

This rule enables compact carrier continuations such as `task :> Monad.via Task (value) => { ... }`.
See [Inline Task continuations with `via`](./advancedsyntax.md#inline-task-continuations-with-via) for the
full expansion into `Task.andThen`.

---

## Carriers and Pipelines

Carrier values keep effects explicit: `Result<T, E>` carries success or failure,
and `Task<T, E>` carries asynchronous work. A carrier group combines related
operations into one carrier containing a tuple:

```workman
let parsed = Result|Int32.fromString("12"), Int32.fromString("34")|;
let total = parsed :> Result.map((a, b) => a + b);
```

`Result.map` transforms a successful value; `Result.mapErr` translates an error.
`Monad.via` adapts a carrier-returning function into a transformation of an
already-wrapped input:

```workman
let increment = Monad.via Result n => Ok(n + 1);
let answer = Ok(41) :> increment;
```

Here the bare namespace `Result` selects `Result.carrier`; the namespace rules are
described [below](#namespace-shorthand-self-and-carrier).

Both named procedures built with `via` and a full pipeline with inline `match`
and `map` are idiomatic. [Carrier-oriented function styles](./carriers.md#two-ways-to-write-a-carrier-returning-function)
shows both on the same parser. Pipeline-lambda shorthand (`=> :>`)
is a separate parameter convention usable with either style.

## Lists

### List Literals

```workman
let empty = [];
let nums = [1, 2, 3];
let nested = [[1, 2], [3, 4]];
```

### List Spread

```workman
-- Prepend elements
let withHead = [0, ..rest];

-- In function
let prepend = (x, xs) => {
  [x, ..xs]
};
```

### List Patterns

```workman
let rec sum = match(xs) => {
  [] => { 0 },                    -- Empty list
  [x] => { x },                   -- Single element
  [x, y] => { x + y },            -- Exactly two
  [head, ..tail] => {             -- Head and rest
    head + sum(tail)
  }
};

-- Ignore rest
let firstTwo = match(xs) => {
  [a, b, .._] => { (a, b) },
  _ => { (0, 0) }
};
```

---

## Modules and Imports

### Importing

```workman
-- Import from a file js style
from "./file.wm" import { func };

-- Import specific items
from "./math.wm" import { add, sub };

-- Import with alias
from "./math.wm" import { add as plus };

-- Namespace import (import entire module)
from "./math.wm" import * as Math;
-- Use as: Math.add, Math.sub, etc.

-- Open import (bring module names into local scope)
from "./math.wm" import *;

-- JS imports can infer types from TypeScript declarations
from js.global("Math") import { max as jsmax, floor };
from js.global("Math") import * as Math;

-- Manual types are trusted claims, so they need `unsafe`
from js.global("console") import unsafe { log: (String, Real64) -> Void } as console;

-- Import types
from "./option.wm" import { Option, Some, None };
```

### Module Visibility

Top-level values, types, records, and datatype constructors are visible to imports by default.

```workman
let myFunction = (x) => { x * 2 };

type MyType = A | B<Real64>;

```

Imports are private. Prefix one with `export` to make what it imports part of this module too:

```workman
export from "./shapes.wm" import *;             -- clients see shapes.wm's names directly
export from "./process.wm" import * as Process; -- clients write OS.Process.run(...)
export from "./math.wm" import { add as plus }; -- clients see only plus
```

### Namespace Shorthand: `Self` and `carrier`

A namespace can opt into two context-dependent shorthands:

| Position | Bare namespace | Explicit member |
| --- | --- | --- |
| Type | `Qualifier<a>` | `Qualifier.Self<a>` |
| Value | `Qualifier` | `Qualifier.carrier` |

The type shorthand requires a type named `Self` in the namespace:

```workman
-- meters.wm
type Self = Int32;
```

```workman
-- main.wm
from "./meters.wm" import * as Meters;
let double = (value: Meters) => value + value;
let distance: Meters.Self = 21;
```

Type arguments pass through unchanged: if `box.wm` declares
`type Self<a> = | Box<a>;`, an annotation `Box<String>` after importing the
namespace as `Box` means `Box.Self<String>`.

The value shorthand requires a value named `carrier`. The standard `Result` and
`Task` namespaces provide carrier records, so these select the same record:

```workman
let short = Result;
let explicit = Result.carrier;
```

An ordinary value with the same name takes precedence in value position; an
ordinary type takes precedence in type position. These shorthands do not create
new value or type bindings. They select the member only when the name denotes
the namespace itself. A qualified member such as `Result.map` is looked up
directly; a missing member does not fall back through `carrier` or `Self`.

### Standard Library and Host Imports

Standard namespaces such as `List`, `String`, `Int32`, `Result`, and `Task` are
available implicitly. Explicit imports can select a local name for the same module:

```workman
from "std/int32.wm" import * as I;
let parsed = I.fromString("42");
let real = 42 :> I.toReal64;
```

Explicit imports include both source-defined and compiler-owned members. A
`-- @no-prelude` directive omits implicit library bindings while still allowing
explicit imports. See [Modules](./modules.md) for the namespace and visibility rules.

JavaScript data literals use `JSON{}` and `JSON[]`; Workman records and lists
remain distinct:

```workman
let options = JSON{ label: "hello", values: JSON[1, 2, 3] };
```

See [JavaScript FFI](./jsffi.md) for reflected imports, JS member stages, and safe
calls that return carriers.

`export` isn't reserved, so it's still usable as a name elsewhere.

---

## Quirks and Gotchas

### Semicolons Are Mandatory

```workman
-- ❌ WRONG
let x = 1
let y = 2

-- ✅ CORRECT
let x = 1;
let y = 2;
```

### Braces Depend on the Construct

Single-expression function and match-arm bodies may omit braces:

```workman
let double = x => x * 2;
let describe = match { 0 => "zero", _ => "other" };
```

An explicit-value match keeps braces around its arms: `match(n) { 0 => 1, _ => n }`.
An `if` keeps braces around each branch. Use a block when a function or arm needs local
bindings or statements. See [Application, Tuples, and Currying](#application-tuples-and-currying)
for expression-body boundaries.

### Record Syntax Variations

```workman
-- Type declaration uses colon
record Point = { x: Int32, y: Int32 };

-- Construction uses zig style
let p1 = .{ x = 10, y = 20 };
```

### Constructors Are Uppercase

```workman
-- ✅ Types and constructors start uppercase
type Status = Active | Inactive;
let s = Active;

-- ❌ Lowercase constructors are invalid
type wrong = active | inactive;  -- Error!
```

### Functions Are Not Automatically Curried

```workman
-- This is a 2-argument function, not curried
let add = (a, b) => { a + b };

-- Must call with both args
let result = add(1, 2);  -- ✅
let partial = add(1);    -- ❌ Error

-- For currying, write one lambda per argument
let addCurried = a => b => { a + b };
let add5 = addCurried(5);
let result = add5(3);  -- 8
```

Use the compact form for ordinary currying. The expanded layout can communicate
intent when making function boundaries explicit, such as eta-expanding an adapter:

```workman
let via = (domain) => {
  (f) => {
    domain.via(f)
  }
};
```

Here the inner lambda explicitly forwards `f` to `domain.via`. Both layouts use
the same function syntax; choose the layout that makes the operation's intent
clearer.

### Type Annotations Are Optional But Helpful

Workman uses Hindley-Milner type inference. Most types are inferred automatically, but annotations
can help with readability and error messages:

```workman
-- Types are inferred
let double = (x) => { x * 2 };  -- Inferred: Int32 -> Int32
let identity = (x) => { x };    -- Inferred: forall a. a -> a

-- Annotations help with complex cases or documentation
let process = (items: List<Real64>) => List.length(items);

-- Annotate lambda parameters
let makePoint = (x: Int32, y: Int32) => { .{ x, y } };

-- Annotate record parameters for clarity
let pointX = (p: Point) => { p.x };

-- Equivalent function return annotations
let first: Void -> Bool = () => { true };
let second = (): Bool => { true };
let third = () => { true }: Bool;

-- Annotation positions can be combined when they agree
let checked: Void -> Bool = (): Bool => { true }: Bool;
```

### Explicit Closure Captures

A lambda may declare the complete set of enclosing lexical bindings that it captures. The clause
appears after the parameters and optional result annotation, immediately before `=>`:

```workman
let makeAdder = (x: Real64) => {
  (y: Real64): Real64 |x| => { x + y }
};

let constant = (): Real64 || => { 1 };
```

Named match functions accept the same capture clause between their parameter list
and `=>`, including `||` for a function with no captures:

```workman
let limit = 10;
let describe = match(input) |limit| => {
  =(limit - 1) => "just below",
  _ => "other"
};
let isZero = match(input) || => {
  0 => true,
  _ => false
};
```

An authored capture clause is a contract. Using an unlisted lexical binding is an error, `||`
requires a captureless lambda, and listing an unused binding produces a warning. When the clause is
omitted, captures remain inferred and the language server displays a `|name, ...|` inlay before the
lambda arrow. Workman module `let` values are part of the generated module environment and therefore
participate in capture clauses; imported and basis-owned values remain external dependencies.
Nominal constructors, including ordered record constructors synthesized for C struct types, are
statically resolved and do not enter a closure's captured environment.

### Match Is an Expression

```workman
-- Match returns a value
let result = match(opt) {
  Some(x) => { x * 2 },
  None => { 0 }
};

-- Can be used inline
print(match(flag) { true => { "yes" }, false => { "no" } });

-- if is also an expression
print(if(flag) { "yes" } else { "no" } );
```

### No Early Return

```workman
-- ❌ No return keyword
let wrong = (x) => {
  if (x < 0) {
    return 0;  -- Error!
  };
  x * 2
};

-- ✅ Use expression-based flow
let correct = (x) => {
  if (x < 0) {
    0
  } else {
    x * 2
  }
};
```

### String Concatenation Uses ++

```workman
-- ❌ Not + like in JS
let wrong = "Hello" + " World";  -- This is arithmetic!

-- ✅ Use ++
let right = "Hello" ++ " " ++ "World";

-- Prefer interpolation when assembling a string from several pieces
let clearer = `Hello ${name}, welcome to ${place}`;
```

### Type Constraints Use `:`

Use `:` to require an expression or pattern to have a specific type:

```workman
let x = (someValue : Real64);
let result = compute() : Option<String>;

match(result) {
  (Some(value) : Option<String>) => { value },
  None => { "" },
}
```

This is a compile-time equality constraint, not a runtime cast or conversion. It cannot turn dynamic
JS/JSON data into a Workman record or primitive; use an explicit runtime validator such as
`Json.assert` for dynamic data.

### Panic for Unrecoverable Errors

Both `Panic("message")` and `Panic "message"` are supported. The space form takes
one argument, like ordinary space application; group a computed message, as in
`Panic ("failed: " ++ detail)`.

`Panic` is a special expression for unrecoverable errors. It can appear in any type context since it
never returns:

```workman
let divideBy = (a, b) => {
  match (b == 0) {
    true => { Panic("Division by zero!") },
    false => { a / b }
  }
};

-- Panic in match arms
let safeHead = match(xs) => {
  [] => { Panic("Cannot get head of empty list") },
  [x, .._] => { x }
};

-- Panic can substitute for any type
let getValue = (opt) => {
  match(opt) {
    Some(x) => { x },
    None => { Panic("Expected a value") }
  }
};
```

---

## Current `wm` Unsupported Notes

The guide includes some intended Workman syntax, but current `wm` is deliberately smaller.
These features are not supported yet or are only partially supported:

- **Full SML modules/functors/signatures:** files are the current module boundary.
- **Opaque type declarations:** `type Handle;` is planned/design syntax, not current syntax.
- **Match guards:** `pattern when cond => ...` is listed as intended syntax, but guards are not
  implemented.
- **Early return:** there is no `return`; blocks return their final expression.
- **Loops:** use recursion and lists for now.
- **Mutation/refs:** no mutable variables or SML refs yet.
- **Exceptions:** use `Result`, `Option`, and `Panic`; general exception handling is not
  implemented.
- **Async/await keywords:** asynchronous work uses `Task`, `via`, and carrier pipelines.
  See [Async](./async.md); `Task` provides sequencing without an `await` keyword.
- **Custom operators/fixity:** fixed built-in operators only.
- **Automatic JS record/object conversion:** use `JSON{}` and `JSON[]` for current JS object/array
  literals.
- **Full JS FFI ergonomics:** some APIs still need manual wrappers or `Js.Object` annotations.

See [JavaScript FFI](./jsffi.md) for the current JS interop surface.

---

## Quick Reference

Native data literals include `WON{key = "value"}` and `WON[1 2]`.
See [WON literals](./won-literals.md) for tags, nesting, and portable data semantics.

| Feature               | Syntax                                |
| --------------------- | ------------------------------------- |
| Comment               | `-- text` or `// text`                |
| Let binding           | `let x = value;`                      |
| Function              | `let f = (a, b) => { body };`         |
| Expression lambda     | `x => x + 1`                         |
| Pipeline lambda       | `=> :> first :> second`              |
| Recursive             | `let rec f = ...;`                    |
| Mutual recursion      | `let rec f = ... and g = ...;`        |
| Type union            | `type T = A \| B<Real64>;`            |
| Record type           | `record R = { field: Type };`         |
| Inline record type    | `.{ a = 1 }: Point{ a: Int32 }`       |
| Record value          | `.{ field = value }` or `.{ field }`  |
| Record spread         | `.{ ..source, field = value }`        |
| Match                 | `match(x) { pattern => { body } }`    |
| Computed pattern      | `=(expression) => body`               |
| Cond-style match      | `match { =(condition) => a, _ => b } true` |
| Match guard           | `Var(x) when cond => { body }`        |
| Match guard status    | Planned, not supported yet            |
| Bind whole value      | `Var(x)` (bare match names are pinned) |
| If/else               | `if (cond) { a } else { b };`         |
| List literal          | `[1, 2, 3]`                           |
| List spread           | `[head, ..tail]`                      |
| Import                | `from "path" import { item };`        |
| Namespace import      | `from "path" import * as Name;`       |
| Namespace as type     | `Name<a>` selects `Name.Self<a>`       |
| Namespace as value    | `Name` selects `Name.carrier`          |
| Module value          | `let x = ...;`                        |
| Pipe                  | `value :> fn`                         |
| Member stage          | `value :> .field` or `value :> .method(arg)` |
| Piped conditional     | `condition :> if { a } else { b }`    |
| Carrier group         | `Result\|left, right\|`               |
| Procedure adapter     | `Monad.via Result transform`           |
| String concat         | `"a" ++ "b"`                          |
| Multiline string      | `` `line one\nline two` ``            |
| Type constraint       | `expr : Type`                         |
| Panic                 | `Panic("message")`                    |
| Tuple destruct        | `let (a, b) = pair;`                  |
| Tuple param           | `let f = (a, b) => { ... };`          |
| Void return           | `let f = () => { expr; };`            |
