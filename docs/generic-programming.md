# Generic programming

This guide assumes you have already written a carrier-oriented procedure using
`Result` or `Task`. If that pattern is unfamiliar, start with
[Carrier-oriented procedure design](./carriers.md).

The first generic function most Workman programs encounter is `Monad.lift`:

```wm
let requirePositive = Monad.lift Result (number) => {
  if (number > 0) {
    Ok(number)
  } else {
    Err("number must be positive")
  }
};

Ok(input)
  :> requirePositive
```

`lift` is generic over the carrier. The same function can lift a transformation
into `Task`:

```wm
let fetchBody = Monad.lift Task (request) => {
  fetch(request)
};

Task.succeed(request)
  :> fetchBody
```

This is the starting point for generic programming in Workman: write an
ordinary function that accepts a record of operations, then pass the record for
the behavior you want.

## What the carrier record is

In the first example, `Result` is the monad. A `Result<Value, Error>` carries a
successful value while keeping failure as the additional effect that must be
threaded through the program.

“Monad” here names this composition pattern. It is not a special Workman
declaration or compiler feature.

The useful part of the monad pattern is that transformations compose without
manually checking every result:

```wm
Ok(input)
  :> requirePositive
  :> calculateTotal
  :> formatTotal
```

If one step returns `Err`, the later transformations are skipped. If it returns
`Ok`, the successful value is passed to the next transformation.

`Task` follows the same composition pattern while also representing asynchronous
work.

To implement that pattern, `Result` and `Task` define operations such as `fn`,
`fnError`, `succeed`, `map`, `map2`, and `andThen`. Each module exports them in
a record like this:

```wm
let carrier = .{
  fn = fn,
  fnError = fnError,
  succeed = succeed,
  map = map,
  map2 = map2,
  andThen = andThen,
};
```

This ordinary value is the carrier record: a record of the operations helpful
or necessary for composing values that follow the monad pattern.

Using a module namespace in value position selects its carrier record:

```wm
Monad.lift Result transform
Monad.lift Task transform
```

These are shorthand for:

```wm
Monad.lift Result.carrier transform
Monad.lift Task.carrier transform
```

There is no hidden typeclass lookup. `lift` receives a normal Workman value.

Its essential shape is:

```wm
let lift = (carrier) => {
  (transform) => {
    carrier.fn(transform)
  }
};
```

`Result.fn` and `Task.fn` supply the carrier-specific behavior.

## Composing different error types

Every carrier pipeline has one error type, but the functions you want to compose
may return different errors. Put those errors in one application ADT:

```wm
type WeatherError =
  | JavaScriptFailure<Js.Error>
  | WeatherFailure<String>;
```

The basic solution is `Monad.lift` followed by `mapErr` at the end of the
transformation:

```wm
let decode = Monad.lift Task (response) => {
  response
    :> .json()
    :> Task.mapErr(JavaScriptFailure)
};
```

`Monad.liftError` is exactly shorthand for that:

```wm
let decode = Monad.liftError Task JavaScriptFailure (response) => {
  response :> .json()
};
```

Another transformation can map its `String` error into the same ADT:

```wm
let requireOk = Monad.liftError Task WeatherFailure (response) => {
  checkResponse(response)
};
```

Both lifted transformations now return `WeatherError` and can be composed in one
pipeline. Use plain `Monad.lift` when the transformation already returns the
pipeline's error type.

## Generic algorithms and required operations

Usually, generic programming means writing an algorithm that works with more
than one concrete type. The algorithm is not completely unrestricted: it
requires those types to provide certain operations.

Rust expresses those requirements with trait bounds. Go uses interfaces or
generic constraints, depending on whether the abstraction is an interface value
or a type parameter. In both cases, the algorithm says “I work with any type
that implements this functionality.”

Workman expresses the same relationship with an ordinary record argument. The
record contains the required functionality, and the generic algorithm
destructures the functions it needs:

```wm
let algorithm = (.{ requiredOperation }) => {
  ...
};
```

Carrier records are an immediate example of this idea. `Result` and `Task`
implement the same composition operations and export them through their
respective carrier records. An algorithm that needs those operations can accept
a carrier record and work with either type.

`Traverse.with` is such an algorithm. It walks a list, applies a
carrier-producing transformation to each item, and collects the successful
values:

```wm
let with = (.{ succeed, map, andThen }) => {
  (items, transform) => {
    -- Traverse the items using the supplied carrier operations.
    ...
  }
};
```

The caller supplies the implementation of those operations:

```wm
let parsed: Result<List<Number>, String> = Traverse.with Result (
  ["1", "2", "3"],
  parseNumber,
);

let loaded: Task<List<String>, Js.Error> = Traverse.with Task (
  paths,
  readTextFile,
);
```

Traversal requires `succeed`, `map`, and `andThen`. `Result` and `Task` both
provide those functions, so the same traversal algorithm works for both. The
carrier argument fills the same role as the required trait, interface, or
constraint in another language.

The generic function does not need to name an abstract `F<Value>` type. At each
use, inference sees a concrete shape:

```wm
Result<List<Number>, String>
Task<List<String>, Js.Error>
```

This is usually enough for real library code: the algorithm accepts the
operations it needs, while callers use concrete `Result`, `Task`, or other
carrier values.

## Writing a carrier-generic function

Destructure the operations your function needs:

```wm
let joinWith = (.{ andThen }) => {
  (nested) => {
    nested :> andThen((value) => {
      value
    })
  }
};
```

It can then be used with either standard carrier:

```wm
let result = joinWith Result (Ok(Ok(1)));

let task = joinWith Task (
  Task.succeed(Task.succeed(1)),
);
```

Another example maps through two known carrier layers:

```wm
let nestWith = (.{ map }) => {
  (.{ fn }) => {
    (transform) => {
      (nested) => {
        map(nested, fn(transform))
      }
    }
  }
};

let updateWeatherTask = (transform) => {
  nestWith Result Task transform
};
```

This helper can update the successful value inside a concrete shape such as:

```wm
Result<Task<Weather, Js.Error>, String>
```

There is no need to introduce a general type-constructor abstraction when the
program has a small, known carrier stack.

## Generic code outside carriers

The same approach replaces many uses of traits and interfaces outside the monad
pattern.

For one operation, pass a function:

```wm
let choose = (isBetter, left, right) => {
  if (isBetter(left, right)) {
    left
  } else {
    right
  }
};
```

For several related operations, pass a record:

```wm
record TextStore<Read, Write> = {
  read: Read,
  write: Write,
};

let copyText = (.{ read, write }, from, to) => {
  read(from)
    :> Task.andThen((text) => {
      write(to, text)
    })
};
```

Different record values provide different implementations:

```wm
let diskStore = .{
  read = readTextFile,
  write = writeTextFile,
};

let memoryStore = .{
  read = readMemoryText,
  write = writeMemoryText,
};
```

The correspondence with other languages is direct:

| Rust or Go | Workman |
| --- | --- |
| Trait or interface | Record type |
| Implementation | Record value |
| Generic or interface parameter | Function parameter |
| Method call | Record field call |
| Factory returning an implementation | Function returning a record |

Workman keeps the record argument explicit. There are no implementation
declarations or implicit instance searches.

## Building a library from a record

Where Standard ML might use a functor, or another language might construct an
object implementing an interface, use an ordinary function that accepts and
returns values:

```wm
record UserLibrary<Find, Save> = {
  find: Find,
  save: Save,
};

let userLibraryWith = (store) => {
  .{
    find = (id) => {
      store.read("users/" ++ id)
    },
    save = (id, text) => {
      store.write("users/" ++ id, text)
    },
  }
};

let diskUsers = userLibraryWith(diskStore);
let memoryUsers = userLibraryWith(memoryStore);
```

The input record supplies the required behavior. The returned record is the
configured library. Both remain normal Workman values.

## Reusing a generic function at different types

Let-bound functions and records can be used at different types at separate
occurrences:

```wm
let resultLift = (transform) => {
  Monad.lift Result transform
};

let incremented = resultLift(increment)(Ok(1));
let labelled = resultLift(addLabel)(Ok("item"));
```

The same works for a let-bound record:

```wm
record MapRunner<Run> = {
  run: Run,
};

let resultMap = .{
  run = Result.map,
};

let numberResult: Result<Number, String> = resultMap.run(
  Ok(1),
  increment,
);

let textResult: Result<String, String> = resultMap.run(
  Ok("item"),
  addLabel,
);
```

Each occurrence of `resultLift` or `resultMap` receives a type appropriate for
that use.

When creating a reusable configured helper, keep it written as a lambda:

```wm
let reusableLift = (transform) => {
  specializeLift Result transform
};
```

This often remains reusable where storing a partially applied function call
would become fixed to one type.

## One limitation to recognize

A function parameter has one type during a call. A single received operation
cannot be used at both `Number` and `String` if those types do not unify:

```wm
let consume = (stage) => {
  (
    stage(numberTransform),
    stage(textTransform),
  )
};
```

The same applies to a field of one received record:

```wm
let consume = (carrier) => {
  (
    carrier.stage(numberTransform),
    carrier.stage(textTransform),
  )
};
```

Usually the clearest solution is to pass one value for each differently typed
use:

```wm
let consume = (numberStage, textStage) => {
  (
    numberStage(numberTransform),
    textStage(textTransform),
  )
};

let values = consume(resultLift, resultLift);
```

The two `resultLift` occurrences are typed independently.

A local generic helper can also keep the varying carrier as an argument:

```wm
let consumeCarriers = (numberCarrier, textCarrier) => {
  let stage = (transform) => {
    (carrier) => {
      Monad.lift carrier transform
    }
  };

  (
    stage(increment)(numberCarrier)(Ok(1)),
    stage(addLabel)(textCarrier)(Ok("item")),
  )
};
```

This limitation rarely affects ordinary procedure code. It matters mainly when
building a library that tries to store and reuse one generic operation at
several unrelated types during the same call.

## What to reach for

When code starts repeating a composition pattern:

1. Write the concrete version first.
2. Identify the functions that provide the changing behavior.
3. Pass one function directly, or group related functions in a record.
4. Let the generic function destructure only the operations it uses.
5. Specialize it with a concrete record such as `Result`, `Task`, `diskStore`,
   or `memoryStore`.

For carrier-oriented procedures specifically:

- use `Monad.lift` to lift a transformation into the shared carrier;
- use `Monad.liftError` when the transformation's native error must enter a
  shared error ADT;
- use `Traverse.with` for sequentially applying a carrier-producing
  transformation to a list;
- write another small record-taking function when a composition pattern is
  genuinely repeated.

Workman does not currently need separate trait, interface, typeclass, or functor
systems for these cases. Ordinary functions and records keep the abstraction
visible and are sufficient for the generic code used by current Workman
programs.

## Complete examples

- [`examples/weather.wm`](../examples/weather.wm) uses `Task`, lifted
  transformations, and a shared application error type.
- [`examples/traverse_carrier/main.wm`](../examples/traverse_carrier/main.wm)
  uses one generic traversal with `Result` and `Task`.
- [`examples/carrier_flattening.wm`](../examples/carrier_flattening.wm) contains
  more involved record and nested-carrier examples.
