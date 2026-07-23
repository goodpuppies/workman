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
Monad.lift Result transform
```

Not every type with operations is a monad. A `Number` module might expose
`compare`, `minimum`, and `maximum`, but that does not provide the `succeed` and
`andThen` composition required by a monad.

I like to view workman code as procedures(top level functions), transformations(pipelines) and invocation groups(the code that makes use of procedures).

Workman makes errors and asynchronous effects explicit. Safe JavaScript calls
therefore produce carrier values such as `Result<T, E>` and `Task<T, E>` instead of
throwing or implicitly awaiting.

The main Workman pattern is not to write `Result.andThen` after every expression.
It is:

1. start a procedure with its head input already inside one shared carrier;
2. define or select transformations lifted into that carrier;
3. compose those lifted transformations as a pipeline in result position;
4. group procedure results with `Carrier|...|` and `match` where concrete control
   flow or effect coordination is required.

“Procedure” here is a coding role, not a separate language construct. It is usually
a top-level Workman function that returns a carrier.

## Procedure shape

```wm
let lift = Monad.lift;

let calculate = (input) => {
  let requirePositive = lift Result (number) => {
    if (number > 0) {
      Ok(number)
    } else {
      Err("number must be positive")
    }
  };

  let double = lift Result (number) => {
    Ok(number * 2)
  };

  let divide100By = lift Result (number) => {
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
- local functions describe transformations and are lifted into `Result`;
- the final expression is the transformation pipeline and remains a `Result`.

For `Task`, `Task.succeed(value)` can establish a pure head value. A Deno/JS call
that already returns a `Task` can be used directly:

```wm
let lift = Monad.lift;

let readTitle = (path) => {
  let readFile = lift Task (filePath) => {
    readTextFile(filePath)
      :> Task.mapErr((_) => { "could not read " ++ filePath })
  };

  let titlePrefix = lift Task (text) => {
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

`lift Task` resembles an `async` procedure boundary, but it is ordinary Workman
currying and carrier operations rather than a keyword or hidden control flow.

## Lift at definition or call site

Lift a transformation at its definition when it belongs to the procedure's shared
carrier:

```wm
let floorR = lift Result jsFloor;
let rounded = value :> floorR;
```

Keep a reusable function carrier-generic and lift it where used when that is more
appropriate:

```wm
let rounded = lift Result jsFloor(value);
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
let readBody = Monad.lift Task (response) => {
  response
    :> .json()
    :> Task.mapErr(JavaScriptFailure)
};
```

`Monad.liftError` combines that final `mapErr` with `lift`:

```wm
let readBody = Monad.liftError Task JavaScriptFailure (response) => {
  response :> .json()
};

let requireValue = Monad.liftError Task ValidationFailure (value) => {
  if (value == "") {
    Task.fail("value was empty")
  } else {
    Task.succeed(value)
  }
};
```

Use plain `Monad.lift` when the transformation already returns the pipeline's
error type.

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

- [`examples/result_lift.wm`](../examples/result_lift.wm) shows a complete `Result`
  procedure pipeline followed by `match(Result|...|)`;
- [`examples/task_lift.wm`](../examples/task_lift.wm) contrasts nested
  `Task.andThen` with lifted procedure pipelines;
- [`examples/raylib/main.wm`](../examples/raylib/main.wm) and
  [`examples/raylib/orbital_run/main.wm`](../examples/raylib/orbital_run/main.wm)
  use lifted FFI transformations and carrier grouping throughout rendering and
  lifecycle control flow.

## Where `andThen` still belongs

`andThen` remains useful when the next operation depends on a successful value and
the control flow is clearer as an explicit continuation—for example, a conditional
network step, a dynamically selected procedure, or conversion between carriers.
It is also the mechanism underneath `lift` and `Carrier|...|`.

The distinction is about code shape:

- routine procedure transformations: lift and pipeline;
- combine independent or staged procedure results: `Carrier|...|`;
- perform carrier-dependent branching: `match(Carrier|...|)`;
- write an explicit dependent continuation when needed: `andThen`.

## How `lift` works

`Monad.lift` is essentially:

```wm
let lift = (carrier) => {
  (f) => {
    carrier.fn(f)
  }
};
```

A carrier structure supplies an `fn` adapter shaped like:

```wm
let fn = (f) => {
  (wrapped) => {
    wrapped :> andThen(f)
  }
};
```

Lifting therefore changes how a function accepts its input: it consumes a value
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
pair   : Result<(Number, String), E>
triple : Result<(Number, String, Bool), E>
```

This is useful when a lifted function expects one tuple argument:

```wm
let liftR = (f) => {
  Monad.lift Result f
};

let fade = liftR Raylib.H.Fade;
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
`Result<Number, Js.Error>`, they can be used directly. If either is pure, wrap it with `Ok(...)`.

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

## Primitive `Result` coercion

Primitive carrier coercion is another convenience used inside carrier-oriented
procedures. It lets primitive operators work through `Result`; it is not general
operator overloading.

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
x : Result<Number, E>
y : Result<Number, E>
z : Result<Number, E>
n : Result<Number, E>
b : Result<Bool, E>
```

The rule is intentionally mechanical:

1. If either operand is `Result<T, E>`, the operator is type-checked against `T`.
2. Any pure operand is wrapped with `Ok(...)`.
3. The result is wrapped back into `Result<OperatorResult, E>`.
4. If both operands are `Result`, their error types must match.

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
types. For example, a JS function such as `Math.floor` still receives `Result<Number, Js.Error>`
unless it is lifted:

```wm
from js.global("Math") import { floor as jsFloor };

let liftR = (f) => {
  Monad.lift Result f
};

let floor = liftR jsFloor;
let rounded = floor(Ok(4.8));
```
