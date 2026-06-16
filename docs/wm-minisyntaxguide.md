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
- [Lists](#lists)
- [Modules and Imports](#modules-and-imports)
- [Quirks and Gotchas](#quirks-and-gotchas)
- [Current `wm-mini` Unsupported Notes](#current-wm-mini-unsupported-notes)

---

## Comments

Both styles are valid:

```workman
-- This is a comment (ML-style)
// This is also a comment (C-style)
```

---

## Entry Point

**No top-level function calls allowed.** Create a `main` function:

```workman
-- error: Top-level call
print("hello");

-- Create a main function instead
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

Backtick strings can span multiple lines. They do not interpolate expressions:

```workman
let page = `first line
second line
third line`;

let withTick = `use \` to include a backtick`;
```

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

`wm-mini` follows the SML-style distinction between tuple arguments and curried application:

```workman
let addPair = (a, b) => { a + b };

-- One tuple-shaped argument (the usual multi-parameter function style)
let x = addPair(1, 2);
let y = addPair((1, 2));

-- Explicit currying by returning functions
let addCurried = (a) => { (b) => { a + b } };
let z = addCurried(1)(2);
```

Rule of thumb:

- `f(1, 2)` means one tuple argument
- `f(1)(2)` means two unary applications (curried style)

### Recursive Bindings

**Use `let rec`** for recursion (functions or values):

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

-- Recursive values are also allowed
let rec x = x;
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
  | Literal<Number>
  | Add<Expr, Expr>
  | Mul<Expr, Expr>
  | Neg<Expr>;

type Token =
  | LParen
  | RParen
  | Number<Number>
  | Ident<String>;
```

### Using Constructors

Constructors are called like functions:

```workman
let color = Red;
let maybeNum = Some(42);
let list = Link(1, Link(2, Empty));
```

### Record Types

```workman
record Point = { x: Number, y: Number };
record Person = { name: String, age: Number };

-- Records with type parameters
record Pair<A, B> = { first: A, second: B };
```

---

## Records

Records are **nominal** (not structural). You must declare a record type before using it.

### Creating Records

```workman
-- First, declare the record type
record Point = { x: Number, y: Number };

-- Then create instances (note the leading dot)
let p = .{ x = 10, y = 20 };

-- With explicit type annotation
let p: Point = .{ x = 10, y = 20 };
```

### Field Punning

When variable name matches field name:

```workman
let x = 10;
let y = 20;

-- ❌ Verbose
let p = .{ x = x, y = y };

-- ✅ Punned (x and y are both field names and values)
let p = .{ x, y };
```

### Record Spread

**Not supported yet in current `wm-mini`.** Current record construction supports explicit fields and
field punning, but not `..source` update syntax.

Planned copy/update syntax:

```workman
let p1 = .{ x = 10, y = 20 };

-- Copy p1, override x
let p2 = .{ ..p1, x = 100 };  -- { x: 100, y: 20 }

-- Override multiple fields
let p3 = .{ ..p1, x = 5, y = 5 };

-- Spread with punning
let newX = 50;
let p4 = .{ ..p1, x = newX };  -- or just: .{ ..p1, newX } if field is named newX
```

### Field Access

```workman
let p = .{ x = 10, y = 20 };
let xVal = p.x;  -- 10
```

---

## Pattern Matching

### Basic Match

**Braces `{}` are mandatory** around match bodies:

```workman
let describe = match(n) => {
  0 => { "zero" },
  1 => { "one" },
  _ => { "many" }
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
  (a, b) => { (b, a) }
};

-- Nested tuples
let getFirst = match(nested) => {
  ((a, _), _) => { a }
};
```

### Literal Patterns

Number, string, boolean, and `void` patterns are supported. Character literals like `'a'` are shown
as intended syntax below, but they are **not supported yet** in current `wm-mini`.

```workman
let isZero = match(n) => {
  0 => { true },
  _ => { false }
};

-- Planned only:
-- let checkChar = match(c) => {
--   'a' => { "it's an a" },
--   'b' => { "it's a b" },
--   _ => { "something else" }
-- };
```

### First-Class Match

A first-class match is syntactic sugar for a function:

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

Current `wm-mini` pattern behavior:

- Wildcard `_`, literals, tuple patterns, and constructor patterns are supported.
- Bare names in `match` patterns are pinned (matched against existing names).
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

---

## If/Else

`if/else` is syntax sugar for boolean match. **Important rules:**

1. **`else` is mandatory** (expressions must return a value)
2. **`else if` is banned** (use nested if or match instead)
3. **Braces are mandatory**

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

-- Planned syntax: match guards are not supported yet.
-- let better = match(n) => {
--   Var(x) when x < 0 => { "negative" },
--   0 => { "zero" },
--   _ => { "positive" }
-- };
```

---

## Operators

### Built-in Operators

```workman
-- Arithmetic (precedence 6-7)
let sum = 1 + 2;
let diff = 5 - 3;
let prod = 4 * 2;    -- Higher precedence than +/-
let quot = 10 / 2;

-- String concatenation (precedence 5)
let greeting = "Hello" ++ " " ++ "World";

-- Comparison (precedence 4)
let equal = x == y;
let notEqual = x != y;
let less = x < y;
let greater = x > y;
let lessEq = x <= y;
let greaterEq = x >= y;

-- Boolean (precedence 2-3)
let both = a && b;
let either = a || b;
let negated = !flag;
```

### Custom Operators

**Not supported yet in current `wm-mini`.** Fixed built-in operators are available; custom fixity is
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

---

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

-- Manual type annotations are available when needed
from js.global("console") import { log: (String, Number) => Void } as console;

-- Import types
from "./option.wm" import { Option, Some, None };
```

### Module Visibility

Top-level values, types, records, and datatype constructors are visible to imports by default.

```workman
let myFunction = (x) => { x * 2 };

type MyType = A | B<Number>;

-- Re-export declarations are planned/design syntax, not current `wm-mini`.
```

---

## Quirks and Gotchas

### 1. Semicolons Are Mandatory

```workman
-- ❌ WRONG
let x = 1
let y = 2

-- ✅ CORRECT
let x = 1;
let y = 2;
```

### 2. Braces Are Mandatory Everywhere

```workman
-- ❌ WRONG
let f = (x) => x * 2;
match(n) { 0 => 1, _ => n };

-- ✅ CORRECT
let f = (x) => { x * 2 };
match(n) { 0 => { 1 }, _ => { n } };
```

### 4. Record Syntax Variations

```workman
-- Type declaration uses colon
record Point = { x: Number, y: Number };

-- Construction uses zig style
let p1 = .{ x = 10, y = 20 };
```

### 5. Constructors Are Uppercase

```workman
-- ✅ Types and constructors start uppercase
type Status = Active | Inactive;
let s = Active;

-- ❌ Lowercase constructors are invalid
type wrong = active | inactive;  -- Error!
```

### 6. Functions Are Not Automatically Curried

```workman
-- This is a 2-argument function, not curried
let add = (a, b) => { a + b };

-- Must call with both args
let result = add(1, 2);  -- ✅
let partial = add(1);    -- ❌ Error

-- For currying, nest lambdas explicitly
let addCurried = (a) => { (b) => { a + b } };
let add5 = addCurried(5);
let result = add5(3);  -- 8
```

### 7. Type Annotations Are Optional But Helpful

Workman uses Hindley-Milner type inference. Most types are inferred automatically, but annotations
can help with readability and error messages:

```workman
-- Types are inferred
let double = (x) => { x * 2 };  -- Inferred: Number -> Number
let identity = (x) => { x };    -- Inferred: forall a. a -> a

-- Annotations help with complex cases or documentation
let process = (items: List<Number>) => { ... };

-- Annotate lambda parameters
let makePoint = (x: Number, y: Number) => { .{ x, y } };

-- Annotate record parameters for clarity
let pointX = (p: Point) => { p.x };
```

### 8. Out of Scope (for now)

The following are intentionally not part of current `wm-mini` frontend scope:

- infection/effect features
- full record and list feature set
- custom fixity declarations and advanced operator definitions
- panic/typed-hole runtime semantics

Some sections below describe intended Workman syntax or older/full Workman design ideas. When a
feature is not implemented in current `wm-mini`, it is marked with a **Not supported yet** note.

#### Opaque Types

**Not supported yet in current `wm-mini`.**

Declare types without exposing their implementation:

```workman
-- Opaque type declaration (no constructors)
type GpaHandle;
type Allocator;

-- Zig primitive types are opaque
type U8;
type I32;
type Usize;
```

#### Function Type Annotations

**Partially supported.** Parameter annotations are supported. Full binding-level function
annotations and return annotations in the examples below are not supported yet.

Annotate function bindings with their full signature:

```workman
-- Function type annotation: (params) => ReturnType
let zig_gpa_init: (Void) => GpaHandle = ?;
let zig_gpa_deinit: (Ptr<GpaHandle, s>) => Void = ?;

-- Multiple parameters
let zig_gpa_create: (Ptr<GpaHandle, s>, t) => Ptr<t, s> = ?;
let zig_gpa_alloc: (Ptr<GpaHandle, s>, t, Usize) => Slice<t, s> = ?;
```

#### Lowercase vs Uppercase in Types

- **Uppercase** (`T`, `Number`, `Option`) — Concrete types or type constructors
- **lowercase** (`t`, `s`, `a`) — Type variables (generics)

```workman
-- 't' and 's' are type variables (generic parameters)
let zig_gpa_create: (Ptr<GpaHandle, s>, t) => Ptr<t, s> = ?;

-- 'T' would refer to a specific type constructor named T
type Container<T> = Empty | Full<T>;
```

#### Type Holes (`?`)

**Not supported yet in current `wm-mini`.** Use `Panic("todo")` as the current escape hatch when an
expression must typecheck in any context.

Use `?` as a placeholder for values you haven't implemented yet. Based on
[Hazel's typed holes](https://hazel.org/), this lets you write incomplete programs that still
typecheck(but workman has no defined runtime support):

```workman
-- Hole expression: placeholder for unimplemented value
let zig_gpa_init: (Void) => GpaHandle = ?;
let zig_free: (Ptr<t, s>) => () = ?;

-- Useful during development
let todoFunction: (Number) => String = ?;

-- The typechecker infers what type the hole must be
let calculate = (x: Number): Number => {
  let intermediate = x * 2;
  ?  -- Hole must be Number (inferred from return type)
};
```

Type holes are especially useful for:

- FFI bindings where the implementation is provided by the runtime
- Stubbing out functions during incremental development
- Letting the typechecker tell you what type is expected

### 8. Match Is an Expression

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

### 9. No Early Return

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

### 10. String Concatenation Uses ++

```workman
-- ❌ Not + like in JS
let wrong = "Hello" + " World";  -- This is arithmetic!

-- ✅ Use ++
let right = "Hello" ++ " " ++ "World";
```

### 11. Type Assertions Use `as`

**Not supported yet in current `wm-mini`.** Prefer annotations on `let` bindings or lambda
parameters for now.

Use `as` to ask the typechecker to verify that an expression already has a specific type:

```workman
let x = someValue as Number;
let result = compute() as Option<String>;

-- Useful for disambiguating polymorphic expressions
let empty = [] as List<Number>;
```

`as` is not a runtime cast. It must not allow unsafe conversions such as `number as String`, and it
must not be used to turn dynamic JS/JSON data into a Workman record or primitive. Dynamic data needs
an explicit runtime validation function that returns a typed value, such as a future whole-shape JSON
assertion.

### 12. Panic for Unrecoverable Errors

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

## Current `wm-mini` Unsupported Notes

The guide includes some intended Workman syntax, but current `wm-mini` is deliberately smaller.
These features are not supported yet or are only partially supported:

- **Full SML modules/functors/signatures:** files are the current module boundary.
- **Opaque type declarations:** `type Handle;` is planned/design syntax, not current syntax.
- **Typed holes:** `?` is not implemented. Use `Panic("todo")` for temporary unreachable values.
- **Binding-level function annotations:** annotate parameters or simple `let` bindings for now;
  `let f: (...) => T = ...` is not generally implemented.
- **Return type annotations on lambdas:** `let f = (x): T => { ... }` is not implemented.
- **Record spread/update:** `.{ ..source, field = value }` is listed as intended syntax, but current
  record construction is `.{ field = value }` or `.{ field }`.
- **Match guards:** `pattern when cond => ...` is listed as intended syntax, but guards are not
  implemented.
- **Character literals:** use strings for now; `'a'` is not implemented.
- **Early return:** there is no `return`; blocks return their final expression.
- **Loops:** use recursion and lists for now.
- **Mutation/refs:** no mutable variables or SML refs yet.
- **Exceptions:** use `Result`, `Option`, and `Panic`; general exception handling is not implemented.
- **Async/await syntax:** JS promises are used through FFI methods like `.then(...)`.
- **String interpolation:** backtick strings are multiline only; they do not interpolate.
- **Custom operators/fixity:** fixed built-in operators only.
- **Automatic JS record/object conversion:** use `JSON{}` and `JSON[]` for current JS object/array
  literals.
- **Full JS FFI ergonomics:** some APIs still need manual wrappers or `Js.Object` annotations.

See [JavaScript FFI](./jsffi.md) for the current JS interop surface.

---

## Quick Reference

| Feature              | Syntax                                |
| -------------------- | ------------------------------------- |
| Comment              | `-- text` or `// text`                |
| Let binding          | `let x = value;`                      |
| Function             | `let f = (a, b) => { body };`         |
| Recursive            | `let rec f = ...;`                    |
| Mutual recursion     | `let rec f = ... and g = ...;`        |
| Type union           | `type T = A \| B<Number>;`            |
| Record type          | `record R = { field: Type };`         |
| Record value         | `.{ field = value }` or `.{ field }`  |
| Record spread        | `.{ ..source, field = value }`        |
| Record spread status | Planned, not supported yet            |
| Match                | `match(x) { pattern => { body } }`    |
| Match guard          | `Var(x) when cond => { body }`        |
| Match guard status   | Planned, not supported yet            |
| Bind variable        | `Var(x)` (literals pinned by default) |
| If/else              | `if (cond) { a } else { b };`         |
| List literal         | `[1, 2, 3]`                           |
| List spread          | `[head, ..tail]`                      |
| Import               | `from "path" import { item };`        |
| Namespace import     | `from "path" import * as Name;`       |
| Module value         | `let x = ...;`                        |
| Pipe                 | `value :> fn`                         |
| String concat        | `"a" ++ "b"`                          |
| Multiline string     | `` `line one\nline two` ``            |
| Type assertion       | `expr as Type`                        |
| Type assertion status | Planned, not supported yet           |
| Panic                | `Panic("message")`                    |
| Tuple destruct       | `let (a, b) = pair;`                  |
| Tuple param          | `let f = (a, b) => { ... };`          |
| Void return          | `let f = () => { expr; };`            |
