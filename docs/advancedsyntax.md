# Advanced syntax

This document records unusual but useful syntax you may encounter in Workman code.

## Argument placeholders

An `_` occupying a complete argument in a parenthesized function call creates a
lambda for that call:

```wm
let subtract = (a, b) => a - b;
let fromTen = subtract(10, _); -- value => subtract(10, value)
let difference = 3 :> subtract(10, _); -- 7
let both = subtract(_, _); -- (left, right) => subtract(left, right)
let result = both(10, 3); -- 7
```

Each placeholder introduces a separate parameter, in argument order. Multiple
parameters use the usual tupled calling convention, so `(10, 3) :> subtract(_, _)`
also gives `7`. A pipe applies the generated lambda; it does not insert another
argument into the original call. Calls without direct placeholder arguments keep
the ordinary pipe insertion rule, including when a nested callback uses
placeholders: `items :> List.map(z(_, true))` still pipes `items` into `List.map`.

The nearest call owns its placeholders: `x(z(_, true))` means
`x(value => z(value, true))`. To delay the outer call too, write
`value => x(z(value, true))` explicitly. A call suffix after a placeholder call
applies the generated function, as in `subtract(_, 2)(8)`.

This is lambda shorthand. The callee and fixed argument expressions are evaluated
when the generated function is invoked, and evaluated again on each invocation.
Use a `let` binding outside the placeholder call to compute a fixed value once.

Placeholders are supported in ordinary parenthesized function and constructor
calls, including imported foreign functions. They must occupy whole arguments:
use `value => f(value + 1)` for `f(_ + 1)`. Space application `f _` and grouped
expression holes such as `f((_))` are not placeholder forms. Existing wildcard
patterns and parameters, including `Some(_)` in a pattern and `_ => value`,
retain their meanings.

## Pipeline lambdas

A bare `=>` whose body starts with `:>` introduces an implicit input parameter:

```wm
let increment = => :> add(1);
-- equivalent to: value => value :> add(1)

let transform = => { :> first() :> second() };
-- equivalent to: value => { value :> first() :> second() }
```

Whitespace and comments may appear before the leading `:>`. The same pipe rules
apply inside the body, including argument insertion, member stages, conditionals,
and multiple stages. A braced body can continue with ordinary statements after
its initial pipeline. The implicit parameter has a fresh internal name, so nested
pipeline lambdas have independent inputs and do not capture authored names.

This keeps a carrier continuation visually continuous:

```wm
fetch(spec, archivePath)
  :> Monad.via Task => { :> unpack("vendor/library", 1) }
  :> Task.recover(error => Panic(error))
```

As with other expression lambdas, a braceless body consumes the following pipe
stages. Use braces to end the continuation before resuming the outer pipeline.
A bare arrow with an ordinary body, such as `=> { nextTask }`, still takes `Void`.
The shorthand supplies only the input to the first pipe; it does not implicitly
bind inputs for later statements in the block.

## Piped conditionals

A Boolean can flow directly into an `if` stage:

```wm
(Some(1) :> match {
  Some(x) => x > 0
}) :> if { "positive" } else { "nonpositive" }
```

The incoming Boolean is evaluated once, then only the selected branch runs. An
input match that fails still raises a non-exhaustive-match error; it does not
choose the `else` branch. Here the missing `None` arm is intentional.

This is equivalent to an ordinary `if (condition) { ... } else { ... }`. Both
branches require blocks, share the usual branch type checks, and keep their
bindings local. The conditional's result can continue through more pipe stages.
Nested conditionals stay inside their branch blocks.

Group a computed condition, as in `(value > 0) :> if { ... } else { ... }`, because
the current pipe precedence is higher than arithmetic and comparison operators.

## Filtering a Result

`Result.filter(value, predicate, error)` keeps an `Ok` value when its predicate
passes and returns `Err(error)` when it fails. An existing `Err` passes through
unchanged without calling the predicate. The predicate runs once for an `Ok`.

```wm
let checked = Ok(3) :> Result.filter(x => x > 0, "not positive");
let fromOption = Some(3)
  :> Option.toResult("missing")
  :> Result.filter(x => x > 0, "not positive");
```

The supplied error must have the existing Result's error type. For a
`Result<Number, Js.Error>`, supply `Js.Error("not positive")`, or use
`Result.mapErr` first to convert existing errors to the type you want to return.
As with other function arguments, the supplied error value is evaluated before
the call; only the predicate callback is conditional on an `Ok` input.

## Inline Task continuations with `via`

Start with an ordinary `Task.andThen` continuation. The callback runs after `wait(duration)`
succeeds, ignores its successful `Void` value, and returns the next Task:

```wm
wait(duration)
  :> Task.andThen((_) => {
    spinner.succeed(finished)
      :> Result.map((_) => { void })
      :> Task.fromResult
  })
```

`Monad.via` is defined as:

```wm
let via = (carrier) => {
  (f) => {
    carrier.via(f)
  }
};
```

`Monad.via` factors out that `andThen` shape. The Task carrier supplies a `via` adapter equivalent
to:

```wm
let via = (transform) => {
  (task) => {
    task :> Task.andThen(transform)
  }
};
```

Therefore `via Task transform` produces a function that accepts an existing Task and continues it
with `transform`. Give that resulting function a name and the original code becomes:

```wm
let afterWait = via Task (_) => {
  spinner.succeed(finished)
    :> Result.map((_) => { void })
    :> Task.fromResult
};

wait(duration) :> afterWait
```

The local name can be removed by substituting its definition into the pipe. This relies on the
rule for piping into a function produced by space application:

```wm
-- Schematic: space application is evaluated before receiving the pipe input.
x :> f thing

-- means:
(f thing)(x)
```

In the Task example, `via Task` is such an expression: `via` receives `Task`, returns a function
that receives the continuation, and that application returns the function that receives the piped
Task.

This computed-function rule differs from an ordinary piped call:

```wm
x :> f(y)     -- f(x, y), explicit-call argument insertion
x :> f y      -- (f(y))(x), space application produces the pipe stage
x :> f a y    -- ((f(a))(y))(x), nested space application
x :> (f(y))   -- (f(y))(x), grouping explicitly treats the call as a stage value
```

Whitespace before an explicit call is only layout: `f(y)` and `f (y)` have the same meaning.
Parenthesize the complete call, as in `(f(y))`, when its result is the function that should receive
the piped value.

Before the pipe recognized the second shape directly, a trailing `()` could explicitly put the
produced function in call position:

```wm
wait(duration)
  :> via Task (_) => {
    spinner.succeed(finished)
      :> Result.map((_) => { void })
      :> Task.fromResult
  }()
```

The computed-function pipe rule makes that placeholder call unnecessary. The same expression is
now written:

```wm
wait(duration)
  :> via Task (_) => {
    spinner.succeed(finished)
      :> Result.map((_) => { void })
      :> Task.fromResult
  }
```

Finally, `wait` succeeds with `Void`. A bare lambda, `=> { ... }`, is shorthand for
`() => { ... }`, so it expresses that specific ignored input without binding `_`.

This is the final form used by [`examples/node-gotchi.wm`](../examples/node-gotchi.wm):

```wm
wait(duration)
  :> via Task => {
    spinner.succeed(finished)
      :> Result.map((_) => { void })
      :> Task.fromResult
  }
```

The progression is:

```wm
task :> Task.andThen((_) => { nextTask })
task :> (via Task)((_) => { nextTask })
-- x :> someCurried thing == (someCurried thing)(x)
task :> via Task (_) => { nextTask }
task :> via Task => { nextTask }  -- only when the Task succeeds with Void
```

The last form is not special Task or `await` syntax. It emerges from ordinary application,
currying, `Monad.via`, the bare `Void` lambda, and the pipe rule for a right-hand expression that
produces a function.

If the successful value is needed, keep an ordinary parameter:

```wm
fetchUser()
  :> via Task (user) => {
    user.name :> Task.succeed
  }
```

That is equivalent to:

```wm
fetchUser()
  :> Task.andThen((user) => {
    user.name :> Task.succeed
  })
```

In both forms, the continuation runs only after success. A failure passes through and skips the
block, and the block must return another `Task`.

For completeness, the compact `Void` form parenthesizes and reduces as follows:

```wm
wait(duration) :> via Task => { nextTask }

wait(duration) :> ((via Task)(() => { nextTask }))

((via Task)(() => { nextTask }))(wait(duration))

Task.andThen(wait(duration), () => { nextTask })
```

## The "triple DRY out" pattern

The triple “DRY out” pattern recognizes one logical input described in three
places: the source value, a forwarding parameter, and the use of that parameter.
The source and parameter are not the same binding; “triple” counts their shared
dataflow role:

```wm
through(x, (forwarded) => { stuff(y, forwarded) })
-- three roles: source, parameter, forwarded use

through(x, (forwarded) => { stuff(y)(forwarded) })
-- still three after making stuff explicitly curried

through(x, stuff(y))
-- one after eta-reduction

x :> through(stuff(y))
-- still one, now expressed as a pipeline
```

The progression removes plumbing without hiding the direction of data flow.
Explicit currying first makes `stuff(y)` produce the function the adapter needs;
this alone does not remove any repetition. Eta-reduction then removes the
forwarding parameter and its use together, taking the pattern directly from
three roles to one. The pipe keeps that single occurrence while placing it at
the beginning of the dataflow. This does not change the ordinary rule that
`x :> f(y)` means `f(x, y)`.

This does not add implicit currying to ordinary Workman functions. A tupled
function such as `(a, b) => { ... }` still cannot be applied to only `a`;
Workman currying remains explicit as `(a) => { (b) => { ... } }`. The middle
step above therefore requires either an explicitly curried Workman function or
a contextually partial reflected JavaScript method.

Here is the pattern using only ordinary Workman functions. Begin with a tupled
`tag` function. Because it cannot receive only its label, an adapter needs a
forwarding lambda:

```wm
let through = (value, transform) => {
  transform(value)
};

let tag = (label, value) => {
  (label, value)
};

through(message, (value) => {
  tag("notice", value)
})
```

Define `tag` as an explicitly curried function instead:

```wm
let tag = (label) => {
  (value) => {
    (label, value)
  }
};
```

Now `tag("notice")` is already the unary function that the adapter needs.
The forwarding `(value) => { tag("notice")(value) }` adds nothing and can be
removed:

```wm
through(message, tag("notice"))
```

Piping dries out the remaining explicit mention of where `message` is passed:

```wm
message :> through(tag("notice"))
```

This pure Workman version uses explicit currying to create the reusable
function value. No contextual or implicit partial application is involved.
The complete runnable progression is in
[`examples/triple_dry_out.wm`](../examples/triple_dry_out.wm).

A callback registration is a concrete example. The forwarding form repeats the
logical handler shape three times:

```wm
Task.fromCallback(
  eventHandler,
  (handler) => {
    worker :> .addEventListener("message", handler)
  }
)
```

A reflected receiver method can be contextually partial because its JavaScript
calling convention is fixed outside Workman and cannot be redefined as an
explicitly curried function. HM knows that the registration function still
needs one argument, so the compiler safely eta-expands the bound method and the
forwarding lambda can be removed:

```wm
Task.fromCallback(
  eventHandler,
  worker :> .addEventListener("message")
)
```

This FFI adaptation is allowed only when the remaining arity and reflected
overload are monomorphic. It does not change the application rules for
Workman-defined functions.

Finally, piping the handler through the adapter dries out its last explicit
application:

```wm
eventHandler
  :> Task.fromCallback(
    worker :> .addEventListener("message")
  )
```

This final form is useful when every intermediate name would merely repeat the
same value. Keep the expanded form when the lambda performs additional work,
reorders arguments, or makes an otherwise ambiguous foreign overload explicit.

## Anonymous matches in pipelines

`match { ... }` is an anonymous one-argument function, so it can appear directly as a pipeline
stage and the result can continue through later stages:

```wm
thing
  :> match {
    Some(value) => { value },
    None => { 0 },
  }
  :> func
```

This is ordinary function composition. It is equivalent to:

```wm
(match(thing) {
  Some(value) => { value },
  None => { 0 },
}) :> func
```

The anonymous form can also be bound or passed as a function value:

```wm
let unwrap = match {
  Some(value) => { value },
  None => { 0 },
};

thing :> unwrap :> func
```
