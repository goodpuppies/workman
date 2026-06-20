# Lift design pattern

lift is defined as 
```wm
let lift = (x) => { 
  (f) => {
    x.fn(f) -- means (#fn x)(f) like sml
  }
};
```

most carrier structures then define something like
```wm
let fn = (f) => {
  (result) => {
    result :> andThen(f)
  }
};
```

the idea is pretty simple, lift all expressions you work with to the carrier at definition or use site,
then simply chain the expressions to thread the side effect trough.

an even simpler parallel can be made lift Task in workman behaves almost like async keyword, 
but its not a keyword just currying based design pattern.


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

# Carrier Coercion and Tuple Lifts

wm-mini has two small conveniences for working with carrier-shaped values such as `Result<T, E>` and
`Task<T, E>`.

They solve different problems:

- primitive carrier coercion lets primitive operators work through `Result`
- explicit carrier tuple lifts turn several carrier values into one carrier tuple

Neither mechanism is general operator overloading. They are deliberately small rewrites around
existing carrier operations.

## Primitive `Result` Coercion

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