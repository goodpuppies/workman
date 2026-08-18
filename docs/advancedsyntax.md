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

The local name can be removed by substituting its definition into the pipe. This relies on a
specific rule for piping into a nested curried application:

```wm
-- Schematic: someCurried is itself an application expression, such as `f a`.
x :> someCurried thing

-- means:
(someCurried thing)(x)
```

Here `someCurried` is a metavariable for an expression that is already partially applied, not the
name of a variable holding a function. In the Task example, `via Task` is that expression: `via`
receives `Task`, returns a function that receives the continuation, and that application returns the
function that receives the piped Task.

This computed-function rule differs from an ordinary piped call:

```wm
x :> f(y)     -- f(x, y)
x :> f a y    -- ((f(a))(y))(x)
```

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
