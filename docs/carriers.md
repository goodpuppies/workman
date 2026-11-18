# Carrier-oriented procedure design

For practical patterns for writing code that works with several carriers, see
[Generic programming](./generic-programming.md).

## Terms used in this guide

`Result` is a monad: it lets successful values move through a pipeline while
threading errors past the remaining steps. `Result<_, E>` is its **carrier
type**, and an `Ok` or `Err` is a **carrier value**.

`Result.carrier` is an ordinary record containing composition operations such
as `succeed`, `map`, and `andThen`. These docs call it a **carrier record**.
Bare `Result` selects that record when used as a value:

```wm
Monad.via Result transform
```

Not every type with operations is a monad. A `Real64` module might expose
`compare`, `minimum`, and `maximum`, but that does not provide the `succeed` and
`andThen` composition required by a monad.

I like to view workman code as procedures(top level functions), transformations(pipelines) and invocation groups(the code that makes use of procedures).

Workman makes errors and asynchronous effects explicit. Safe JavaScript calls
therefore produce carrier values such as `Result<T, E>` and `Task<T, E>` instead of
throwing or implicitly awaiting.

In the procedure style, the pattern is:

1. start a procedure with its head input already inside one shared carrier;
2. define or select transformations created via that carrier;
3. compose those transformations as a pipeline in result position;
4. group procedure results with `Carrier|...|` and `match` where concrete control
   flow or effect coordination is required.

“Procedure” here is a coding role, not a separate language construct. It is usually
a top-level Workman function that returns a carrier.

## Two ways to write a carrier-returning function

Both the procedure style and the full pipeline style are idiomatic WM. They
organize the same carrier operations at different scales.

### Procedure style with `via`

Name the transformations, adapt them to a shared carrier with `via` or
`viaErr`, and compose them in the final pipeline. This gives longer functions
recognizable steps and lets transformations be reused.

For example, these declarations describe a parser's output and errors:

```wm
record Pair = { first: Int32, second: Int32 };

type ParseError =
  | FieldsFailed<String.Error>
  | NumberFailed<Int32.Error>
  | ExpectedPair;
```

The procedure version names splitting and parsing as transformations:

```wm
let parsePairProcedure = input => {
  let split = Monad.viaErr Result FieldsFailed text => {
    String.fields(text, c => c == '-')
  };

  let parseFields = Monad.via Result match {
    [a, b] => {
      Result|Int32.fromString(a), Int32.fromString(b)|
        :> Result.map(Pair)
        :> Result.mapErr(NumberFailed)
    },
    _ => Err(ExpectedPair)
  };

  Ok(input) :> split :> parseFields
};
```

### Full pipeline style

Keep the transformations inline when the function reads naturally as one
pipeline. Use `map` to transform successful values, `mapErr` to translate errors,
and inline `match` for branching on the value's shape. Carrier groups such as
`Result|...|` combine related operations within that pipeline.

Using the same `Pair` and `ParseError` declarations:

```wm
let parsePair = input => {
  input
    :> String.fields(c => c == '-')
    :> Result.mapErr(FieldsFailed)
    :> match {
      Ok([a, b]) => {
        Result|Int32.fromString(a), Int32.fromString(b)|
          :> Result.map(Pair)
          :> Result.mapErr(NumberFailed)
      },
      Ok(_) => Err(ExpectedPair),
      Err(error) => Err(error)
    }
};
```

The match handles the input shape and changes the success type from
`List<String>` to `Pair`. Each arm still returns a `Result` with the same error
type. There is no need to extract every inline step into a named procedure;
extract one when the name or reuse makes the function easier to read. The two
styles can also be combined within a function.

### Pipeline lambdas are a separate convention

The function's shape and its parameter notation are separate choices. When an
input is used only to start a pipeline, `x => x :> ...` can be written
`=> :> ...`:

```wm
let explicit = x => x :> first :> second;
let implicit = => :> first :> second;

let block = => {
  :> first
  :> second
};
```

The `=> :>` shorthand gives the leading pipe the function's implicit input.
The body may also use braces, as in `=> { :> ... }`. This is useful for a function
that consists of one pipeline, including the full pipeline parser above. It also
works with `via`:

```wm
let split = Monad.viaErr Result FieldsFailed => {
  :> String.fields(c => c == '-')
};
```

Keep the explicit parameter when later expressions need to refer to it by name.
See [Pipeline lambdas](./advancedsyntax.md#pipeline-lambdas) for the syntax and
scope rules, and [Reading adjacent arrows](./syntax-guide.md#reading-adjacent-arrows)
for the common `==>` spelling in bindings.

## Procedure shape

```wm
let via = Monad.via;

let calculate = (input) => {
  let requirePositive = via Result (number) => {
    if (number > 0) {
      Ok(number)
    } else {
      Err("number must be positive")
    }
  };

  let double = via Result (number) => {
    Ok(number * 2)
  };

  let divide100By = via Result (number) => {
    if (number == 0) {
      Err("cannot divide by zero")
    } else {
      Ok(100 / number)
    }
  };

  Ok(input)
    :> requirePositive
    :> double
    :> divide100By
};
```

The procedure has three recognizable parts:

- `Ok(input)` establishes the carrier at the head of the pipeline;
- local functions describe transformations created via `Result`;
- the final expression is the transformation pipeline and remains a `Result`.

For `Task`, `Task.succeed(value)` can establish a pure head value. A Deno/JS call
that already returns a `Task` can be used directly:

```wm
let via = Monad.via;

let readTitle = (path) => {
  let readFile = via Task (filePath) => {
    readTextFile(filePath)
      :> Task.mapErr((_) => { "could not read " ++ filePath })
  };

  let titlePrefix = via Task (text) => {
    text
      :> .slice(0, 9)
      :> Result.mapErr((_) => { "could not slice title" })
      :> Task.fromResult
  };

  Task.succeed(path)
    :> readFile
    :> titlePrefix
};
```

`via Task` resembles an `async` procedure boundary, but it is ordinary Workman
currying and carrier operations rather than a keyword or hidden control flow.

## Use `via` at definition or call site

Use `via` at a transformation's definition when it belongs to the procedure's shared carrier:

```wm
let floorR = via Result jsFloor;
let rounded = value :> floorR;
```

Keep a reusable function carrier-generic and apply `via` where it is used when that is more
appropriate:

```wm
let rounded = via Result jsFloor(value);
```

The Raylib examples use this call-site form heavily because reflected FFI values
are already `Result` values.

## Compose procedures with different error types

Every value in a carrier pipeline must have the same error type. A JavaScript
operation returning `Task<_, Js.Error>` therefore cannot be composed directly
with validation returning `Task<_, String>`.

First, define one error ADT for the procedure:

```wm
type AppError =
  | JavaScriptFailure<Js.Error>
  | ValidationFailure<String>;
```

The basic solution is to map each transformation's error at the end:

```wm
let readBody = Monad.via Task (response) => {
  response
    :> .json()
    :> Task.mapErr(JavaScriptFailure)
};
```

`Monad.viaErr` combines that final `mapErr` with `via`:

```wm
let readBody = Monad.viaErr Task JavaScriptFailure (response) => {
  response :> .json()
};

let requireValue = Monad.viaErr Task ValidationFailure (value) => {
  if (value == "") {
    Task.fail("value was empty")
  } else {
    Task.succeed(value)
  }
};
```

Use plain `Monad.via` when the transformation already returns the pipeline's
error type.

## Map existing carrier values

`Monad.map`, `Monad.mapErr`, `Monad.andThen`, and `Monad.traverse` are
carrier-generic forms of the ordinary operations. They take the carrier value
first, so a pipeline supplies it and the stage names the carrier:

```wm
task
  :> Monad.mapErr(Task, ActorCallFailure)
  :> Monad.map(Task, print)
```

The parentheses also end a lambda argument, so later stages are not absorbed
into its body. To name a reusable stage, use a pipeline lambda:

```wm
let tagFields ==> :> Monad.mapErr(Result, FieldsFailed);
```

`via` and `viaErr` stay curried because they build a stage rather than being
one: `Monad.via(Result)(f)` is `wrapped => Monad.andThen(wrapped, Result, f)`.
Use `via` to name or pass a transformation, and `andThen` to apply one in place.

`Monad.traverse(items, carrier, f)` applies `f` to each item in order and
collects the results in one carrier. Each item runs after the previous one
succeeds, and the first failure stops the traversal:

```wm
let pairs = fields :> Monad.traverse(Result, parsePair);
```

`map` applies a pure transformation to a successful value. Use `via` instead when
the transformation starts another effect and therefore returns another value in
the carrier.

`mapErr` changes the error of an existing carrier value. `viaErr` instead
declares how the native error returned by an effectful transformation enters the
shared procedure error type:

```wm
let fetchBody = Monad.viaErr Task JavaScriptFailure (request) => {
  fetch(request)
};
```

## Group procedures at computation boundaries

`Carrier|...|` combines several carrier-producing procedures. Match the combined
carrier where the program must branch on success/failure or use the unwrapped
values for concrete computation:

```wm
match(Result|
  loadWindow(),
  readInput(),
  prepareFrame()
|) {
  Ok((Var(window), Var(input), Var(frame))) => {
    runFrame(window, input, frame)
  },
  Err(error) => {
    handleError(error)
  }
}
```

This keeps procedures carrier-shaped and delays explicit unwrapping until a real
control-flow boundary. The Raylib renderers use the same shape to group many FFI
operations into one `Result` before matching.

Concrete references:

- [`examples/result_via.wm`](../examples/result_via.wm) shows a complete `Result`
  procedure pipeline followed by `match(Result|...|)`;
- [`examples/task_via.wm`](../examples/task_via.wm) contrasts nested
  `Task.andThen` with procedure pipelines created via `Task`;
- [`examples/raylib/main.wm`](../examples/raylib/main.wm) and
  [`examples/raylib/orbital_run/main.wm`](../examples/raylib/orbital_run/main.wm)
  use carrier-aware FFI transformations and carrier grouping throughout rendering and
  lifecycle control flow.

## Where `andThen` still belongs

`andThen` remains useful when the next operation depends on a successful value and
the control flow is clearer as an explicit continuation—for example, a conditional
network step, a dynamically selected procedure, or conversion between carriers.
It is also the mechanism underneath `via` and `Carrier|...|`.

The distinction is about code shape:

- pure transformations of existing carrier values: `Monad.map`;
- routine effectful procedure transformations: `via` and pipeline;
- translate an existing carrier error: `Monad.mapErr`;
- combine independent or staged procedure results: `Carrier|...|`;
- perform carrier-dependent branching: `match(Carrier|...|)`;
- write an explicit dependent continuation when needed: `andThen`.

## How `via` works

`Monad.via` is essentially:

```wm
let via = (carrier) => {
  (f) => {
    carrier.via(f)
  }
};
```

In short, `Monad.via M f` creates the carrier-aware callable form of `f` via
`M`'s `via` function.

A carrier structure supplies a `via` adapter shaped like:

```wm
let via = (f) => {
  (wrapped) => {
    wrapped :> andThen(f)
  }
};
```

`via` changes how a function accepts its input: it consumes a value
already inside the carrier, applies the function only after success, and preserves
the carrier through the result.


## Explicit Carrier Tuple Lifts

`Carrier|...|` sequences multiple values in a carrier and returns one carrier containing a tuple of
the unwrapped values.

think
(Carrier<T,E>, Carrier<T,E>, ...) -> Carrier<(T,T,...),E>

```wm
let pair = Result|Ok(1), Ok("a")|;
let triple = Result|Ok(1), Ok("a"), Ok(true)|;
```

These infer as:

```txt
pair   : Result<(Real64, String), E>
triple : Result<(Real64, String, Bool), E>
```

This is useful when a function created with `via` expects one tuple argument:

```wm
let viaR = (f) => {
  Monad.via Result f
};

let fade = viaR Raylib.H.Fade;
let accent = fade(Result|Ok(baseAccent), pulse|);
```

The sugar is explicit about the carrier. `Result|...|` lowers through `Result.andThen` and
`Result.map`:

```wm
Result|a, b, c|
```

is equivalent to:

```wm
Result.andThen(a, (av) => {
  Result.andThen(b, (bv) => {
    Result.map(c, (cv) => {
      (av, bv, cv)
    })
  })
})
```

The same shape works for another carrier when that carrier exposes compatible `andThen` and `map`
members:

```wm
Task|readConfig(), fetchUser()|
```

For `Task`, this is close to an `await` sequence:

```wm
Task|
  a,
  b,
  c
|
```

has the same control-flow shape as:

```js
const av = await a;
const bv = await b;
const cv = await c;
return [av, bv, cv];
```

The Workman result is a `Task<(A, B, C), E>`, not a direct tuple. If any task fails, the later steps
are skipped and the first failure is returned. Also remember that Tasks are eager handles: if `a`,
`b`, and `c` were bound before the tuple lift, their underlying JavaScript promises may already be
running. The tuple lift controls when their successful values are unwrapped and threaded, not
necessarily when the underlying JS work starts.

The lowering is dumb on purpose. Items inside the bars must already be carrier values. Pure values
must be injected explicitly:

```wm
let args = Result|message, centerX, Ok(170), Ok(32), accent|;
```

If `message` is already `Result<String, Js.Error>` and `centerX` is already
`Result<Real64, Js.Error>`, they can be used directly. If either is pure, wrap it with `Ok(...)`.

The sugar supports arbitrary arity because it lowers to nested `andThen` calls with one final `map`.
A single item is returned unchanged:

```wm
Result|Ok(1)| == Ok(1)
```

An empty carrier tuple is invalid.

## Bare `|...|`

The older bare tuple lift syntax remains Task-specific for now:

```wm
|taskA, taskB|
```

Use the explicit carrier form for new carrier-generic code:

```wm
Result|Ok(1), Ok(2)|
Task|taskA, taskB|
```

## Primitive carrier coercion

Primitive carrier coercion is another convenience used inside carrier-oriented
procedures. It lets primitive operators work through a carrier; it is not general
operator overloading. The operator's meaning never changes - `+` stays primitive
`+` on the payload - the carrier only decides how the operation is threaded.

Primitive operators can flow through `Result`.

```wm
let x = Ok(2) + 3;
let y = 3 * Ok(4);
let z = Ok(8) / Ok(2);
let n = -Ok(4);
let b = !Ok(false);
```

These infer as:

```txt
x : Result<Real64, E>
y : Result<Real64, E>
z : Result<Real64, E>
n : Result<Real64, E>
b : Result<Bool, E>
```

The rule is intentionally mechanical:

1. If either operand is `Result<T, E>`, the operator is type-checked against `T`.
2. Any pure operand is wrapped with `Ok(...)`.
3. The result is wrapped back into `Result<OperatorResult, E>`.
4. If both operands are `Result`, their error types must match.

Equality is the exception: `==` and `!=` are never lifted. Comparing two carriers is ordinary
structural equality, so `Ok(1) == Ok(1)` is `true`, as in SML, and `Ok(2) == 2` is a type error.
Lifting is for operations that would otherwise be rejected, not a new meaning for ones that
already have one.

So this:

```wm
Ok(2) * 3
```

lowers like:

```wm
Result.map2(Ok(2), Ok(3), (left, right) => {
  left * right
})
```

And this:

```wm
Ok(2) * Ok(3)
```

lowers like:

```wm
Result.map2(Ok(2), Ok(3), (left, right) => {
  left * right
})
```

At runtime `Result.map2` evaluates the inputs left-to-right. The first `Err` is returned. If every
input is `Ok`, the primitive operation runs on the unwrapped values and the answer is wrapped in
`Ok`.

Unary operators use `Result.map`:

```wm
-Ok(4)
```

lowers like:

```wm
Result.map(Ok(4), (value) => {
  -value
})
```

This coercion is only for primitive operators. Ordinary functions still keep their declared argument
types. For example, a JS function such as `Math.floor` still receives `Result<Real64, Js.Error>`
unless it is adapted with `via`:

```wm
from js.global("Math") import { floor as jsFloor };

let viaR = (f) => {
  Monad.via Result f
};

let floor = viaR jsFloor;
let rounded = floor(Ok(4.8));
```

## Registering another carrier

The coercion rule is not specific to `Result`. `Task` lifts the same way:

```wm
(Task.succeed(2) + 3) :> Task.map(print)
```

Tasks are eager handles, so the arithmetic controls when the successful values
are threaded, not when the underlying work starts.

Any type can register. The rule needs a type that holds a payload, a way to
inject a pure operand, and a way to combine two carriers. A module supplies
those by exporting `succeed`, `map`, and `map2` together with a `carrier`
record, which registers the type `succeed` returns:

```wm
record Vec2 = { x: Real64, y: Real64 };

let succeed = (s: Real64) => {
  Vec2(s, s)
};

let map = (v: Vec2, f) => {
  Vec2(f(v.x), f(v.y))
};

let map2 = (a: Vec2, b: Vec2, f) => {
  Vec2(f(a.x, b.x), f(a.y, b.y))
};

let carrier = .{
  succeed = succeed,
  map = map,
  map2 = map2,
};
```

Operators then lift over `Vec2` the same way they lift over `Result`:

```wm
let pos = Vec2(10, 10);
let vel = Vec2(1, 0.5);

let stepped = pos + vel * dt;
```

`vel * dt` wraps the pure `dt` with `succeed`, so a scalar broadcasts across the
lanes; there is no separate broadcast rule.

[`examples/carrier_operators/`](../examples/carrier_operators/) runs every
carrier side by side, and [`examples/asteroids/vec.wm`](../examples/asteroids/vec.wm)
registers the `Vec2` used throughout
[`examples/asteroids/game.wm`](../examples/asteroids/game.wm).

### Operators, not `via`

`Monad.Carrier` bundles `via` and `andThen` alongside `succeed`/`map`/`map2`.
`Vec2` has neither, and cannot: `andThen` means "if this succeeded, feed the
value to the next step", and a fixed-size vector has no success to check and
nothing to short-circuit. So a `Vec2` carrier uses `Monad.Applicative`, and gets
operators without `via Vec2 f` or `Vec2|...|`.

`Carrier|...|` needs `andThen` for a further reason: it builds a tuple, so the
payload type changes as it goes. `Result|Ok(1), Ok("a")|` is
`Result<(Real64, String), E>`. The equivalent for `Vec2` would be a vector whose
lanes each hold a tuple.

### What lifts and what does not

`Vec2` is monomorphic: its payload is always `Real64`, in and out. Nothing
restricts which operators may lift; unification decides:

- `a + b`, `a - b`, `a * 3`, `2 * a`, `-a` all lift, because the operator answers
  in `Real64`;
- `a < b` does not, because `<` answers in `Bool`, which is not `Vec2`'s payload.
  The error points at the comparison.

A generic carrier has a payload argument to replace, so its operators may answer
in a different payload type than they consumed. `Ok(1) < Ok(2)` is
`Result<Bool, E>`, and a user carrier behaves the same way:

```wm
record Pair<T> = { left: T, right: T };
```

```txt
Pair(1, 2) < Pair(10, 20)          : Pair<Bool>
Pair("x", "y") ++ Pair("1", "2")   : Pair<String>
```

Reductions stay ordinary functions. `lengthSq` sums the lanes and `withinSq`
compares a distance, so neither is expressible as a lifted operator; both read
better named anyway.

### One carrier at a time

The lowering peels exactly one layer. Both operands must agree on the carrier,
and every carrier argument that is not the payload - `Result`'s error type, for
instance - is unified across the two operands. Unwrap the outer carrier with
`via` or `Carrier|...|` first.

Two carriers whose payloads still disagree report that mismatch:
`Ok(1) + Task.succeed(2)` is `operator + mixes carriers Result and Task`, while
`Result<Vec2, E> + Vec2` reports `Real64` against `Vec2`, because the operator is
checked against the peeled payloads before the carriers are compared.

A module's own declarations do not see its carrier, since registration completes
with the module. A carrier module writes its payload arithmetic by hand and hands
the operators to its consumers.

## A carrier name has one type

The bare-namespace rule selects the ordinary value named `carrier`; it does not restrict that
value to the monadic `Carrier` record. Numeric modules use it for `Numeric.Arithmetic<T>`, also
exported as `.math`, so `items :> List.sumWith(Int32)` selects `Int32.carrier`.

A particular module has only one such default value and one type scheme. It cannot select
between monadic and arithmetic record shapes based on the expected argument type. Different
structures can export different types under the same name; functions still require the record
type declared in their signatures. Use explicitly named records such as `.math` when a module
needs several capabilities. See [explicit arithmetic domains](./numbers.md#explicit-arithmetic-domains).

## Deferred generation and pure consumers

Construct a deferred traversal with its carrier, then collect it with a pure consumer:

```wm
list
  :> List.generate(Result, hasIdenticalHalves)
  :> List.collect(Primitive.filter)
```

`List.generate(items, domain, check)` stores the original list, carrier record and callback.
Construction runs no checks and allocates no second list of closures or annotated values.
`List.collect(source, consumer)` requests checked inputs from left to right, using the carrier
to preserve failures. Each successful answer is passed with its original input to the pure
consumer. A decisive answer or a carrier failure stops before requesting another input.

The same producer/consumer protocol supports different operations:

```wm
list :> List.generate(Result, predicate) :> List.collect(Primitive.find)
list :> List.generate(Task, predicateTask) :> List.collect(Primitive.exists)
list :> List.generate(Result, pairToDupes) :> List.collect(Primitive.map)
list :> List.generate(Result, pairToDupes) :> List.collect(Primitive.concatMap)
```

| Consumer | Check's successful answer | Collection's successful output |
| --- | --- | --- |
| `Primitive.filter` | `Bool` | matching original inputs |
| `Primitive.map` | any value | list of answers |
| `Primitive.filterMap` | `Option<T>` | list of Some payloads |
| `Primitive.concatMap` | `List<T>` | concatenated answer lists |
| `Primitive.find` | `Bool` | first matching original input as `Option<T>` |
| `Primitive.findMap` | `Option<T>` | first Some answer, or None |
| `Primitive.exists` | `Bool` | true at the first true answer; otherwise false |
| `Primitive.all` | `Bool` | false at the first false answer; otherwise true |
| `Primitive.takeWhile` | `Bool` | original inputs before the first false answer |
| `Primitive.partition` | `Bool` | pair of lists: true inputs, false inputs |
| `Primitive.lastOr(fallback)` | any value | last answer, or the fallback for empty input |

When `pairToDupes` returns a carried list, `Primitive.map` keeps each list as one output
element; `Primitive.concatMap` emits its elements separately. Searches return successful
absence as None, distinct from a carrier failure. Empty input calls no checks and returns the
consumer's finished initial state: for example, an empty list, None, false for exists, or true
for all.

### Custom consumers and tail recursion

`Primitive.Consumer<Item, Answer, State, Output>` is an ordinary record:

```wm
let count = Primitive.Consumer{
  initial = 0,
  step = (_, _, total) => Monad.Continue(total + 1),
  finish = total => total
};
```

Its step takes `(original input, successful answer, state)`. `Monad.Continue(nextState)`
requests another checked input; `Monad.Stop(output)` returns immediately. `finish` runs only
when the input is exhausted; Stop already contains the final output. The consumer's state
and output types may differ. Stateful checks can use List.generateState, described below.

The carrier's `loop` operation drives collection. `Result.loop(initial, advance)` directly
tail-recurses over successful Continue states and returns on Stop or Err. `Task.loop` sequences
iterations through Task's promise boundary. The generic wrapper is
`Monad.loop(initial, domain, advance)`. These are ordinary functions; collection does not
require compiler fusion or recursion through an opaque andThen callback. Long synchronous
and asynchronous traversals remain stack safe.

Custom `Monad.Carrier` records include a `loop` field in addition to via, viaErr, succeed,
map, map2, andThen and mapErr. Its type parameters are independent of the other operations,
just as map and andThen have their own instantiations. Numeric and Applicative dictionaries
are unchanged.

### Stateful generation

`List.generateState(items, domain, initial, check)` defers a stateful traversal. Its check
receives `(item, previousState)` and returns the next state inside the carrier. Each successful
state is also the answer available to the consumer. A failure preserves the error and stops
before another check; successful early-stopping consumers work the same way as for generate.

A checked sum can be expressed without an effectful fold operation:

```wm
values
  :> List.generateState(Result, (0: Int64), (value, total) => {
    Int64.checkedAdd(value, total)
  })
  :> List.collect(Primitive.lastOr((0: Int64)))
```

`Primitive.lastOr(initial)` selects the final successful state and provides an explicit result
for empty input. Collecting the same kind of generator with Primitive.map instead returns the
history of successful states. The ordinary List.generate remains independent per element;
its check receives just that element.

### Reuse, eager annotation and imports

A generated traversal captures one carrier instantiation. Use a fresh generator per consumer;
SML may constrain a named generator's accumulator and result types at its first collection.
Consuming the same generator again reruns its checks, including Task effects. Generation does
not memoize results.

`List.annotate(items, domain, check)` remains available when the complete carried list of
`(original input, answer)` pairs is useful. It runs all checks before a later pure operation
can inspect them. `List.concatMap(items, emit)` is the pure list operation that concatenates
zero or more emitted elements per input, preserving their order.

Explicit imports from `"std/list.wm"` and `"std/primitive.wm"` expose the same operations as
the implicit namespaces. If input is already a carrier, use via around the complete generation
and collection pipeline. Unify different error types explicitly with mapErr.

## Callbacks that return a carrier

`via` unwraps a function's input. It does not change how `List.filter` or a fold
calls its callback. When the callback itself can fail or perform a task, generate
with that carrier and collect with the consumer for the operation you want, as
described in [deferred generation](#deferred-generation-and-pure-consumers):

```wm
let total = values
  :> List.generateState(Result, (0: Int64), Int64.checkedAdd)
  :> List.collect(Primitive.lastOr((0: Int64)));
```

The result is `Result<Int64, Int64.Error>`. Each check receives plain values and
returns a carrier value; a failure skips the remaining checks.

When the input is already a result, use `via` for the outer result around the whole
generation and collection:

```wm
parsedValues
  :> Monad.via Result values => {
    values
      :> List.generateState(Result, (0: Int64), (value, acc) => {
        Int64.checkedAdd(value, acc) :> Result.mapErr(NumberFailed)
      })
      :> List.collect(Primitive.lastOr((0: Int64)))
  }
```

The outer result and the checks must use the same error type. Map errors where
they enter the pipeline. Operations such as `concat` have no callback to lift:
`nestedLists :> Result.map(List.concat)` flattens the list inside the result.

The arithmetic helpers `lengthWith`, `repeatWith`, `splitAtWith` and
`tabulateWith`, and the numeric `sumWith`/`productWith`, take explicit arithmetic
operations rather than a monadic carrier. For fallible generation by index,
generate indices first, map the count error, then collect the checked values:

```wm
List.tabulate(count, i => i)
  :> Result.mapErr(ListFailed)
  :> Monad.via Result indices => {
    indices :> List.generate(Result, generate) :> List.collect(Primitive.map)
  }
```
