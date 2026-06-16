# Async and Task

wm-mini's async story is intentionally small:

```workman
Task<a, e>
```

A `Task<a, e>` is an asynchronous computation that eventually produces either:

```workman
Ok(value) : Result<a, e>
Err(error) : Result<a, e>
```

At runtime, a Task is represented by a JavaScript `Promise<Result<a, e>>`. Workman code does not
`await` it directly. Instead, the generated program awaits the `main` task boundary and Task
combinators compose the promise-backed value.

## The Important Rule

Tasks are eager handles.

When a JavaScript promise-returning API is called from Workman, the underlying JavaScript promise is
started immediately:

```workman
let userTask = fetchUser();
```

This creates a Task handle for work that has already been started. Passing the handle around does
not start it again.

That makes this expression parallel:

```workman
ports
  :> List.map((port) => {
    scanPort(host, port)
  })
  :> Task.collectList
```

`List.map` walks the list and calls `scanPort(host, port)` for every port. Each call starts its
underlying JavaScript promise immediately. `Task.collectList` then waits for the already-created
handles.

The setup loop is sequential, but the async operations overlap.

## Core Operations

The current Task basis surface is:

```workman
Task.fromResult : Result<a, e> -> Task<a, e>
Task.succeed    : a -> Task<a, e>
Task.fail       : e -> Task<a, e>

Task.map     : Task<a, e> -> (a -> b) -> Task<b, e>
Task.map2    : Task<a, e> -> Task<b, e> -> ((a, b) -> c) -> Task<c, e>
Task.andThen : Task<a, e> -> (a -> Task<b, e>) -> Task<b, e>
Task.mapErr  : Task<a, e> -> (e -> f) -> Task<a, f>
Task.recover : Task<a, e> -> (e -> a) -> Task<a, e>

Task.collectList : List<Task<a, e>> -> Task<List<a>, e>
Task.traverse    : List<a> -> (a -> Task<b, e>) -> Task<List<b>, e>
```

The pipe style is usually easier to read:

```workman
fetchUser()
  :> Task.map((user) => {
    user.name
  })
```

## `collectList`

`Task.collectList` flips this shape:

```workman
List<Task<a, e>> -> Task<List<a>, e>
```

It is the Workman spelling for the common "I have many existing async handles; gather their results"
operation.

Example:

```workman
[
  fetchUser(),
  fetchPosts(),
]
  :> Task.collectList
```

This is parallel because both `fetchUser()` and `fetchPosts()` are evaluated before
`Task.collectList` receives the list.

If every task succeeds, the result is:

```workman
Ok([user, posts])
```

as a Workman list inside a Task.

If any task fails, the collected task fails with an error. The current runtime waits for all task
handles through `Promise.all`, then chooses the first `Err` in list order.

## Why `collectList`, Not `all`

The operation is not fundamentally async-specific. It is a list-shaped collection operation:

```workman
List<Task<a, e>>   -> Task<List<a>, e>
List<Result<a, e>> -> Result<List<a>, e>
List<Option<a>>    -> Option<List<a>>
```

wm-mini currently provides the specialized list-shaped names:

```workman
Task.collectList
Result.collectList
Option.collectList
```

The name includes `List` because the outer shape matters. This leaves room for future shape-specific
operations without pretending Workman has higher-kinded modules, typeclasses, or SML functors:

```workman
Task.collectRecord
Task.collectTuple
```

Those do not exist yet, but the naming direction keeps the two axes clear:

- the outer shape is the thing being collected
- the inner wrapper decides how values combine

## Parallel Versus Sequential

These two forms are different.

Parallel handles:

```workman
ports
  :> List.map((port) => {
    scanPort(host, port)
  })
  :> Task.collectList
```

Sequential traversal:

```workman
ports
  :> Task.traverse((port) => {
    scanPort(host, port)
  })
```

`Task.traverse` currently calls the function for one item, waits for that task, then continues with
the rest. That makes it useful when work should happen in order or when the next task should not
start until the previous one has completed.

The naming is not ideal yet. A future cleanup may rename this to something like:

```workman
Task.traverseListSeries
Task.traverseListParallel
```

For now, use this rule:

- Use `List.map(...):> Task.collectList` for parallel work.
- Use `Task.traverse(...)` for sequential work.

## Bounded Parallelism

`Task.collectList` starts nothing by itself. It only waits for existing task handles.

However, the usual parallel pattern starts all handles before collecting:

```workman
ports
  :> List.map((port) => {
    scanPort(host, port)
  })
  :> Task.collectList
```

For a large list, this may create too much concurrency. A port scan over 1024 ports creates 1024
connection attempts immediately.

wm-mini does not yet have a bounded parallel helper. The likely future shape is:

```workman
Task.traverseListLimit(limit, items, f)
```

or:

```workman
items :> Task.traverseListLimit(limit, f)
```

That would start at most `limit` tasks at a time.

## Error Handling

Task errors are ordinary values in the error slot:

```workman
Task<a, e>
```

Map the error:

```workman
fetch(url)
  :> Task.mapErr((_) => {
    "could not fetch " ++ url
  })
```

Recover to a value:

```workman
fetch(url)
  :> Task.recover((_) => {
    fallbackResponse
  })
```

Turn a synchronous `Result` into a `Task`:

```workman
parseConfig(args)
  :> Task.fromResult
```

Fail explicitly:

```workman
"missing user" :> Task.fail
```

Succeed explicitly:

```workman
user :> Task.succeed
```

## JavaScript FFI

Safe JavaScript imports that return promises become Tasks.

For example, a reflected or manually typed promise-returning API maps to:

```workman
Task<a, Js.Error>
```

JavaScript can reject promises or throw while starting work. Both cases become `Err(Js.Error)` in
the Task result.

This is intentionally different from direct JavaScript:

```javascript
const value = await fetch(url);
```

Workman keeps async failure in the type:

```workman
fetch(url) : Task<Response, Js.Error>
```

You then use `Task.map`, `Task.andThen`, `Task.mapErr`, or `Task.recover`.

## Difference From JavaScript

JavaScript's common shape uses `await` to bind the fulfilled values in the local async function
scope:

```javascript
async function renderPage() {
  const [profile, settings] = await Promise.all([
    fetchProfile(),
    fetchSettings(),
  ]);

  return render(profile, settings);
}
```

Workman does not have `await`. A `let` pattern can still destructure the list, but it destructures
task handles, not fulfilled values:

```workman
let renderPage = () => {
  [
    fetchProfile(),
    fetchSettings(),
  ]
    :> Task.collectList
    :> Task.map(([profile, settings]) => {
      render(profile, settings)
    })
};
```

The list expression creates started task handles. `Task.collectList` gathers those handles. The
`Task.map` callback then uses an ordinary Workman list pattern to destructure the fulfilled values.

The return types are similar in shape but not identical:

```javascript
renderPage() : Promise<Page>
```

```workman
renderPage() : Task<Page, e>
```

In JavaScript, rejection lives in the promise's exception/rejection channel. In Workman, failure is
part of the Task type as the error parameter. If `fetchProfile()` and `fetchSettings()` fail with
`Js.Error`, then `renderPage()` has a type like:

```workman
Task<Page, Js.Error>
```

Current `List` values are homogeneous, so `Task.collectList` requires every task in the list to have
the same success type. Shape-specific collection for records or tuples would be the natural future
answer for heterogeneous values.

There is no special `await` syntax in user code today. Async composition is ordinary function
composition over `Task`.

## Difference From Elm

Elm's `Task` is closer to a description of work. You hand the description to the runtime, and the
runtime decides when to execute it.

wm-mini's Task is closer to an already-started JavaScript promise handle. This is because wm-mini's
async boundary is JavaScript FFI, and JavaScript promises start when created.

That means this is not just a description:

```workman
let task = fetch(url);
```

The fetch has already started.

## Difference From SML

Standard ML has no built-in async model. SML concurrency libraries usually introduce explicit
threads, futures, events, or implementation-specific primitives.

wm-mini does not add an SML-style concurrency subsystem. It only gives a typed Workman wrapper for
JavaScript promise-backed work.

The result is smaller:

- no effect system
- no scheduler API
- no functors/typeclasses for generic async composition
- no implicit awaiting

But it also means the JavaScript promise behavior matters. Tasks are eager handles, not pure
descriptions.

## Current Example Pattern

`examples/portscan.wm` uses parallel collection:

```workman
let scanAll = (host, ports) => {
  ports :> List.map((port) => {
    scanPort(host, port)
  }) :> Task.collectList
};
```

`examples/weather.wm` does the same for city reports:

```workman
let reports = cityList
  :> Js.Array.toList
  :> List.map((city) => {
    cityReport(cache, now, refresh, fahrenheit, unit, city)
  })
  :> Task.collectList
  :> Task.map(Js.Array.fromList);
```

Both examples rely on the same rule:

```workman
List.map starts/builds task handles.
Task.collectList waits for those handles.
```

## Design Boundary

There is a tempting generic abstraction:

```workman
List.collectWith(Task)
List.collectWith(Result)
List.collectWith(Option)
```

That is conceptually clean, but it requires advanced language machinery if `Task` is a first-class
effect dictionary:

- first-class module-like values
- polymorphic fields
- partial type application or higher-kinded types
- SML-functor-like abstraction or typeclass-like instance passing

wm-mini deliberately avoids that machinery for now. The current design keeps the language small and
spells the useful operations directly:

```workman
Task.collectList
Result.collectList
Option.collectList
```

The shared idea is documented and can guide future APIs, but it is not a language feature.
