# Workman Syntax Cheatsheet

Adapted for Workman (WM) from David Sun's
[SML Syntax Cheatsheet](https://github.com/smlhelp/book/blob/master/docs/start/syntax.md)
(February 2021). Sections follow the original order, with WM syntax, types, and behavior.
`MISSING` marks a feature with no direct WM equivalent; alternatives are shown where available.
For a broader introduction, see the [syntax guide](wm-minisyntaxguide.md).

#### Built-in Types

Six commonly encountered types:

| Expression | Type |
| :---: | :---: |
| `0` | `Number` (default), or `I32` with context |
| `"foo bar"` | `String` |
| `' '` | `Char` |
| `true` | `Bool` |
| `1.0` | `Number` |
| `void` | `Void` |

WM's default `Number` covers both integer-looking and fractional values. For a signed 32-bit
integer, write `let n: I32 = 0;`. A `Char` literal contains one Unicode scalar; some Basis
character and string operations separately restrict their inputs to byte or ASCII domains.
`void` is the unit-like value. `()` is used for empty function parameter and argument lists.
See [numeric literals](numbers.md) for other numeric types and contextual literal typing.

#### Structured Types

Tuples and lists can contain basic values or other tuples and lists.

| Expression | Type |
| :---: | :---: |
| `(15, 150)` | `(Number, Number)` |
| `[1, 2, 3, 4]` | `List<Number>` |
| `[["foo", "bar"], ["baz"]]` | `List<List<String>>` |
| `((true, 1), (false, 0, void))` | `((Bool, Number), (Bool, Number, Void))` |
| `[(0, 1), (1, 0)]` | `List<(Number, Number)>` |
| `(['a', 'b'], [3.14])` | `(List<Char>, List<Number>)` |

A list's elements all have one type. There are no one-element tuples: `(x)` groups `x`.

#### Operators

Higher-priority operations bind more tightly. The levels below are relative WM levels for
these operators, not SML fixity declarations. WM has no user-defined fixity declarations.

| Operator or equivalent | Meaning | Priority | Example expression | Evaluates to | Notes |
| :---: | :--- | :---: | :--- | :--- | :--- |
| `*` | Multiplication | 7 | `8 * 3` | `24` | `Number` or `I32` |
| `/` | Division | 7 | `3.0 / 2.0` | `1.5` | Example uses `Number` |
| `Number.div` | Flooring division | Call | `Number.div(3, 2)` | `1` | Equivalent of SML `div` on integer-valued numbers |
| `Number.mod` | Flooring modulo | Call | `Number.mod(8, 3)` | `2` | Equivalent of SML `mod` on integer-valued numbers |
| `%` | Truncating remainder | 7 | `8 % 3` | `2` | Differs from flooring modulo for negative operands |
| `+` | Addition | 6 | `3 + 4` | `7` | `Number` or `I32` |
| `-` | Subtraction | 6 | `3 - -2` | `5` | Unary `-` negates a number; parentheses are optional |
| `++` | String concatenation | 6 | `"foo" ++ "bar"` | `"foobar"` | Both operands must be strings |
| `[head, ..tail]` | List construction | Delimited | `[1, ..[2, 3, 4]]` | `[1, 2, 3, 4]` | Equivalent of SML `::` |
| `List.append` | List concatenation | Call | `List.append([1, 2], [3, 4])` | `[1, 2, 3, 4]` | Equivalent of SML `@` |

The infix arithmetic and string operators above associate to the left. List construction uses
explicit brackets, and list concatenation uses a function call.

| Expression | Grouping | Evaluates to |
| :--- | :--- | :--- |
| `3 - -2 + -5` | `(3 - (-2)) + (-5)` | `0` |
| `[1, ..[2, ..[3, ..[]]]]` | Each spread supplies the remaining list | `[1, 2, 3]` |
| `List.append([1], List.append([2], [3]))` | Inner append first | `[1, 2, 3]` |

#### Boolean Operation

WM uses `&&`, `||`, and `!`.

| Expression | Evaluates to | Notes |
| :--- | :---: | :--- |
| `false && true` | `false` | Both operands are evaluated |
| `true \|\| false` | `true` | Both operands are evaluated |
| `!true` | `false` | Boolean negation |
| `!false` | `true` | Boolean negation |

**MISSING: short-circuit boolean operators equivalent to SML `andalso` and `orelse`.**
Use `if (a) { b } else { false }` for short-circuit conjunction, and
`if (a) { true } else { b }` for short-circuit disjunction.

Equality uses `==` and `!=`.

| Operator | Meaning | Priority | Example expression | Evaluates to |
| :---: | :--- | :---: | :--- | :---: |
| `==` | Equal | 4 | `1 + 2 == 4 - 1` | `true` |
| `!=` | Not equal | 4 | `"a" != "b"` | `true` |

Tuples and lists compare by their contents. `Number` equality is allowed, including fractional
values; function equality is rejected. **MISSING: SML's explicit equality-type notation `''a`
and its full equality-type discipline.**

| Expression | Evaluates to |
| :--- | :---: |
| `(true, true) == (true, true)` | `true` |
| `0 == 1 && 1 == 1` | `false` |
| `0 != 0 \|\| 1 != 1` | `false` |
| `[1, 2, 3, 4] == [1, 2, 3, 4]` | `true` |
| `(1, 2, "a", "b") == (1, 2, "a", "b")` | `true` |
| `([1, 2, 3, 4], (["a", "b"], [void])) == ([1, 2, 3, 4], (["a", "b"], [void]))` | `true` |
| `0.0 == 0.0` | `true` |

Numeric ordering uses `>`, `<`, `>=`, and `<=`. These bind more tightly than equality and less
tightly than addition. They do not provide SML's string/character ordering overloads.

| Operator | Meaning | Example expression | Evaluates to |
| :---: | :--- | :--- | :---: |
| `>` | Greater than | `2 > 1` | `true` |
| `<` | Less than | `1 < 2` | `true` |
| `>=` | Greater than or equal | `2 >= 2` | `true` |
| `<=` | Less than or equal | `1 <= 2` | `true` |

**MISSING: direct infix equivalents for the original string/character comparison examples.**
Use the comparison functions below for those domains.

#### Comparison Functions

`Real.compare(x, y)` is already available without imports through the preloaded `Real`
namespace. It returns `Result<Order, Basis.Error>` and reports NaN as `Err(Basis.Unordered)`.
This is namespace availability, rather than an unqualified pervasive `compare` function.
`Order`, `Less`, `Equal`, and `Greater` are pervasive: no import is needed for the type or
its constructors. The shared Basis comparison functions below require imports.
See [default pervasive values](pervasives.md) for the unqualified library functions.

Import the additional comparison functions and their supporting namespaces explicitly:

```wm
from "basis/order.wm" import { compareInt, compareReal };
from "basis/text.wm" import * as Text;
from "basis/unicode.wm" import * as Unicode;
from "basis/char.wm" import * as Char;
```

| Expression | Type |
| :--- | :--- |
| `Less` | `Order` |
| `Equal` | `Order` |
| `Greater` | `Order` |
| `compareInt` | `(I32, I32) -> Order` |
| `Text.compare` | `(String, String) -> Result<Order, Unicode.Error>` |
| `compareReal` | `(Number, Number) -> Result<Order, Error>` (`Error` from `basis/order.wm`) |

`Text.compare` checks Unicode text and returns its ordering in a `Result`. `basis/string.wm` also provides byte-string comparison,
returning a `Result` because input may contain non-byte characters. `Char.compareAscii` returns
a `Result` and rejects non-ASCII input. **MISSING: a direct, total SML `Char.compare` equivalent
under that name.**

| Expression | Evaluates to |
| :--- | :---: |
| `compareInt(-1, 0)` | `Less` |
| `compareInt(0, 0)` | `Equal` |
| `compareInt(1, 0)` | `Greater` |
| `Text.compare("abc", "bac")` | `Ok(Less)` |
| `Text.compare("cba", "cb")` | `Ok(Greater)` |
| `compareReal(0.0, 0.0)` | `Ok(Equal)` |
| `Char.compareAscii('a', 'A')` | `Ok(Greater)` |

`compareReal` returns `Err(Unordered)` if either operand is NaN. A custom comparison function
can return `Order` for tuples or other domain values, choosing which components to compare first.

#### Comments

Use line comments or nested block comments:

```wm
-- This is a comment.
// This is another comment.

/* This comment
   spans several lines. */

/* This is /* a nested comment */ inside a comment. */
```

#### Value Binding

`let` binds an immutable value to a name or a destructuring pattern. Declarations end with `;`.
Type annotations are optional.

```wm
let x: Number = 5;
let (a, b): (Number, Number) = (1, 2);
let l: List<Number> = [3, 4];
```

| Expression | Evaluates to |
| :--- | :--- |
| `x` | `5` |
| `a` | `1` |
| `b` | `2` |
| `3 * x` | `15` |
| `2 * x * (5 + 2 * x)` | `150` |
| `a * x + b` | `7` |
| `[a, b, ..l]` | `[1, 2, 3, 4]` |

#### Let-Expressions

A WM block replaces SML's `let ... in ... end`. Its declarations are local, and its final
expression supplies its value. A semicolon after that final expression instead yields `void`.

```wm
let answer = {
  let x: Number = 25;
  let x: Number = x + 25; -- Shadows the earlier binding.
  let y: Number = x + 50;
  x + y
}; -- answer = 150
```

Blocks can nest; each block introduces a scope:

```wm
let nestedAnswer = {
  let x: Number = 25;
  {
    let x: Number = x + 25;
    {
      let y: Number = x + 50;
      x + y
    }
  }
}; -- nestedAnswer = 150
```

#### Lambda Expressions

A lambda has a parameter pattern, `=>`, and a body expression. Use braces for a body containing
local declarations or multiple statements. Function types use `->`, which associates to the right.

| Expression | Evaluates to | Type |
| :--- | :--- | :--- |
| `(x: Number, y: Number) => x + y` | A function | `(Number, Number) -> Number` |
| `(3, 4)` | `(3, 4)` | `(Number, Number)` |
| `((x: Number, y: Number) => x + y)(3, 4)` | `7` | `Number` |

`f(3, 4)` passes one tuple-shaped argument. Curried application is `f(3)(4)` or `f 3 4`.

#### Function Binding

Name a lambda with `let`. The `=` belongs to the declaration, and `=>` belongs to the lambda.

```wm
let add: (Number, Number) -> Number = (x, y) => x + y;
```

Alternatively, annotate the parameters and result:

```wm
let addAnnotated = (x: Number, y: Number): Number => { x + y };
```

Both have type `(Number, Number) -> Number`. **MISSING: a separate SML-style `fun` declaration.**
Use `let rec` when the function refers to itself.

| Expression | Value | Type |
| :--- | :--- | :--- |
| `add` | A function adding its tuple components | `(Number, Number) -> Number` |
| `(x: Number, y: Number) => x + y` | A function adding its tuple components | `(Number, Number) -> Number` |
| `add(3, 4)` | `7` | `Number` |
| `((x: Number, y: Number) => x + y)(3, 4)` | `7` | `Number` |

#### Patterns and Case Expressions

WM uses `match` for SML's `case` expressions and multi-clause lambdas. Arms use `pattern => body`
and are separated by commas. All arm results must have the same type.

| Expression | Example clause | Clause pattern | Clause expression |
| :--- | :--- | :--- | :--- |
| `(x, y) => x + y` | `(x, y) => x + y` | `(x, y)` | `x + y` |
| `match { true => 1, false => 0 }` | `true => 1` | `true` | `1` |
| `match { 0 => true, _ => false }` | `_ => false` | `_` | `false` |
| `match(void) { _ => void }` | `_ => void` | `_` | `void` |
| `match(Char.compareAscii('A', 'a')) { Ok(Less) => ":)", _ => ":(" }` | `Ok(Less) => ":)"` | `Ok(Less)` | `":)"` |
| `match(compareInt(1, 0)) { Less => false, Equal => false, Greater => true }` | `Greater => true` | `Greater` | `true` |

`match { ... }` and `match arms` are functions; `match(value) { ... }` evaluates a match immediately.
The wildcard `_` accepts any value without binding a name.

Parenthesize the whole lambda to use constructor patterns in its parameters:

```wm
let unwrap = (Ok(x) => x);
let value = Ok(3) :> (Ok(x) => x) :> increment;
```

`(Ok (x) => x)` accepts the same pattern. The outer parentheses delimit the
lambda, preserving callback application such as `via Task (x) => body`.
Bare lambdas such as `value :> x => x + 1` are also valid pipe operands;
their expression bodies extend through subsequent pipes. Group the whole lambda
to end its body before the next pipeline stage.

Several spellings use the same arms. Braces around the **arm list** depend on the form:

```wm
let piped = true :> match true => 1, false => 0;    -- Arm-list braces optional.
let immediate = match(true) { true => 1, false => 0 }; -- Immediate match requires braces.
let applied = match { true => 1, false => 0 } true;
let called = (match true => 1, false => 0)(true);   -- Group a braceless function to apply it.

let namedMatch = match (x) => true => 1, false => 0; -- (x) required; braces optional.
let matched = namedMatch(true); -- 1
```

For direct application, these functions give the same result; the named form additionally
keeps `x` available inside its arms:

```wm
let namedApplied = match(x) => { true => 1, false => 1 } true;
let anonymousApplied = match { true => 1, false => 1 } true;
-- Both are 1. Braceless functions need grouping before direct application.
```

Both forms also accept explicit calls, such as `match(x)=>{true=>1,false=>0}(true)`.
Use a space or parentheses before the argument: `}true` is a syntax error, rather than
two independent top-level expressions. Separate independent expressions with `;`.
The closing brace ends the function's arm list, so the following argument applies to the
whole function. Grouping the whole function in parentheses remains valid but is optional
for a braced arm list. A braceless arm list extends through the final arm's expression;
group that function before applying it directly, as in
`(match(x) => true => 1, false => 0)(true)`.

The `piped`, `immediate`, `applied`, and `called` bindings above are all `1`.
The `match (x) => ...` form creates a function
whose parameter `x` remains available inside each arm. Its parameter-list parentheses are
required, even for one name. The immediate form requires parentheses around its subject,
as in `match(true) { ... }`.

The prefix `match (identifiers) =>` is reserved for named parameters, even when its
arm list is invalid. Keep braces when an anonymous first arm would have that shape:
`match { (a, b) => _ => 0 }` uses a tuple pattern with pinned values `a` and `b`,
whereas `match(a, b) => _ => 0` names two parameters.

Braced arm lists allow a trailing comma; braceless ones do not. Each arm body above is
an expression; use a block body such as `true => { let n = 1; n }` for local declarations.

Bare names in match patterns are **pinned**: they compare against existing values.
Use `Var(x)` to bind a fresh name for the whole subject. Names inside tuple, list, and constructor
patterns bind their components; `let` and lambda parameter patterns also bind normally.

| Candidate pattern | Valid? |
| :--- | :--- |
| `void`, `0`, `":)"`, `true`, `'a'` | Yes |
| `Equal` | Yes, with the constructor in scope |
| `3 + 4`, `":" ++ ")"`, `3 < 4` | No: expressions |
| `compareInt(0, 0)`, `compareInt` | No: ordinary functions are not constructors or equality-comparable values |
| `0.0` | Yes: a `Number` literal pattern |
| `x => x` | No: a lambda is not a pattern |
| `x` | Yes if an equality-comparable `x` is already in scope; pins its value |
| `Var(x)` | Yes: binds a fresh name |
| `_` | Yes |
| `(0, 1)`, `(x, y)`, `(_, _)` | Yes |
| `(x, x)` | No: duplicate binder |
| `[]`, `[x]`, `[[[]]]`, `([], [])` | Yes |
| `List.append([], [])`, `List.append([x], xs)` | No: function calls |
| `[x, ..xs]`, `[x, y, ..xs]`, `[_, .._]` | Yes |

A match is exhaustive when its arms cover every possible value of its subject type.
The following table describes coverage; deliberately incomplete examples may produce diagnostics.

| Match function | Subject type | Exhaustive? |
| :--- | :--- | :---: |
| `match { void => void }` | `Void` | Yes |
| `match { true => 1 }` | `Bool` | No |
| `match { true => 1, false => 0 }` | `Bool` | Yes |
| `match { Less => -1 }` | `Order` | No |
| `match { Less => -1, Equal => 0 }` | `Order` | No |
| `match { Less => -1, Equal => 0, Greater => 1 }` | `Order` | Yes |
| `match { 0 => true }` | `Number` | No |
| `match { 0 => true, _ => false }` | `Number` | Yes |
| `match { [x, .._] => x + 1 }` | `List<Number>` | No |
| `match { [] => 0, [x, .._] => x + 1 }` | `List<Number>` | Yes |
| `match { (0, b) => true && b }` | `(Number, Bool)` | No |
| `match { (0, b) => true && b, (n, _) => false }` | `(Number, Bool)` | Yes |

A wildcard covering an entire arm pattern makes that arm accept every remaining value.
If placed first, it makes later arms unreachable.

#### Recursive Function Binding

`let rec` makes the binding available inside its own function body. Ordinary `let` does not.

```wm
let rec length: List<Number> -> Number = match {
  [] => 0,
  [_, ..xs] => 1 + length(xs)
};
```

The named-subject form is equivalent:

```wm
let rec lengthNamed: List<Number> -> Number = match(items) => {
  [] => 0,
  [_, ..xs] => 1 + lengthNamed(xs)
};
```

| Expression | Value | Type |
| :--- | :--- | :--- |
| `length` | The recursive function above | `List<Number> -> Number` |
| `length([])` | `0` | `Number` |
| `length([1, 2, 3, 4])` | `4` | `Number` |

Mutually recursive functions use `let rec ... and ...;`.

#### Conditional Expressions

An `if` condition has type `Bool`; both branches must have the same type. Only the selected
branch runs. Both branches are required, and braces delimit them.

| Expression | Evaluates to |
| :--- | :--- |
| `if (0 != 1) { "foo" } else { "bar" }` | `"foo"` |
| `if (0 == 1) { if (true) { 1 } else { 2 } } else { if (false) { 3 } else { 4 } }` | `4` |
| `if (true) { 1 } else { Number.div(1, 0) }` | `1` |
| `if (false) { Number.div(1, 0) } else { 0 }` | `0` |

#### op

**MISSING: SML's `op` keyword for using an infix operator as a function.**
Wrap the operation in a lambda instead:

| WM equivalent | Evaluates to |
| :--- | :--- |
| `((a, b) => a * b)(8, 3)` | `24` |
| `((a, b) => a + b)(3, 4)` | `7` |
| `((a, b) => a ++ b)("foo", "bar")` | `"foobar"` |
| `((x, xs) => [x, ..xs])(1, [2, 3, 4])` | `[1, 2, 3, 4]` |
| `List.append([1, 2], [3, 4])` | `[1, 2, 3, 4]` |

#### as

**MISSING: SML's layered `as` patterns.** Keep the complete value in one binding, then
bind its components separately:

```wm
let tuple: (Number, Number) = (1, 2);
let (a, b) = tuple;
```

| Name | Bound to |
| :---: | :---: |
| `a` | `1` |
| `b` | `2` |
| `tuple` | `(1, 2)` |

```wm
let outer: ((Number, Number), Number) = ((1, 2), 3);
let (inner, c) = outer;
let (a, b) = inner;
```

| Name | Bound to |
| :---: | :---: |
| `outer` | `((1, 2), 3)` |
| `inner` | `(1, 2)` |
| `a` | `1` |
| `b` | `2` |
| `c` | `3` |

```wm
let l1: List<Number> = [1, 2, 3];
let [x1, ..l2] = l1;
let [x2, ..l3] = l2;
let [x3, ..l4] = l3;
```

| Name | Bound to |
| :---: | :---: |
| `l1` | `[1, 2, 3]` |
| `x1` | `1` |
| `l2` | `[2, 3]` |
| `x2` | `2` |
| `l3` | `[3]` |
| `x3` | `3` |
| `l4` | `[]` |

These list destructurings require nonempty lists and can fail at runtime. To select another arm
on an empty list, use a match function and retain the whole subject through its parameter name:

```wm
let describe = match(items) => {
  [head, ..tail] => (items, Some(head), tail),
  [] => (items, None, [])
};
```
