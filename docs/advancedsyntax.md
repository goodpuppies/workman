# Advanced syntax

This document records unusual but useful syntax you may encounter in Workman code.

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
    carrier.fn(f)
  }
};
```

`Monad.via` factors out that `andThen` shape. The Task carrier supplies an `fn` adapter equivalent
to:

```wm
let fn = (transform) => {
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
