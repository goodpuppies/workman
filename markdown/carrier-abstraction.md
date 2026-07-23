# Design note: carrier abstraction with ordinary functions and records

Workman can cover most of its practical carrier-generic code with rank-1 HM,
ordinary functions, and explicit records. It does not currently need SML
functors, traits, interfaces, typeclasses, or higher-kinded types for this work.

This is a language-design direction rather than a claim that those mechanisms
are never useful. Workman should add abstraction machinery only when real code
has a recurring problem that the patterns in this document cannot express
clearly.

## The practical decision

Libraries should accept the operations they use instead of abstracting over a
type constructor itself.

For example, traversal needs `succeed`, `map`, and `andThen`. It does not need a
type variable representing all of `F`:

```wm
let traverseWith = (.{ succeed, map, andThen }) => {
  let rec traverse = match(items, transform) => {
    ([], _) => {
      succeed([])
    },
    ([item, ..rest], transform) => {
      transform(item)
        :> andThen((value) => {
          traverse(rest, transform)
            :> map((values) => {
              [value, ..values]
            })
        })
    },
  };

  traverse
};
```

The same function can be specialized at separate call sites:

```wm
let parsed = traverseWith Result (texts, parseNumber);
let loaded = traverseWith Task (paths, readTextFile);
```

Each use has a finite concrete type such as `Result<List<Number>, String>` or
`Task<List<String>, Js.Error>`. Ordinary HM infers those types without needing
to name `Result` or `Task` as a type-level function.

The standard spelling is already:

```wm
Traverse.with Result (texts, parseNumber)
Traverse.with Task (paths, readTextFile)
```

## Carrier values are explicit records

A carrier module exports an ordinary `carrier` record. Using its namespace in
value position selects that record:

```wm
Monad.lift Result transform
Monad.lift Task transform
Traverse.with Result (items, transform)
```

This is small convenience syntax around explicit value passing. Carrier code is
still normal Workman code, and a library may destructure only the operations it
needs:

```wm
let joinWith = (.{ andThen }) => {
  (nested) => {
    nested :> andThen((value) => { value })
  }
};
```

This gives most of the useful part of an interface or constructor class:

- a documented collection of operations;
- multiple implementations such as `Result` and `Task`;
- generic consumers checked against the operations they actually use;
- no hidden instance search or compiler-known carrier hierarchy.

Records should remain explicit. The namespace convenience should not turn them
into a second module or trait system.

## Specialize the consumer

The reusable algorithm should be generic, while each use supplies a concrete
carrier value:

```wm
let kleisliWith = (.{ fn }) => {
  (first, second) => {
    (input) => {
      fn(second)(first(input))
    }
  }
};

let parsePositive = kleisliWith Result (parseNumber, requirePositive);
let fetchAndDecode = kleisliWith Task (fetchBody, decodeBody);
```

This pattern applies to more than small examples. Current experiments cover:

- Kleisli composition and `join`;
- sequential traversal and folds;
- nested `Result<Task<A>>`-style operations;
- flattened ResultT- and StateT-shaped algorithms;
- adding several concrete carrier layers through staged functions.

The important property is that the consumer has a finite number of carrier
operations at finite concrete types. That describes most application and
standard-library code.

## Use let boundaries to regain polymorphism

Ordinary HM generalizes let-bound non-expansive values. Staging an operation as
a lambda therefore lets later occurrences specialize independently:

```wm
let resultStage = (transform) => {
  Monad.lift Result transform
};

let incremented = resultStage(increment)(Ok(1));
let labelled = resultStage(addLabel)(Ok("item"));
```

Eta expansion is useful when a function application would otherwise remain
monomorphic under the value restriction:

```wm
let resultStage = (transform) => {
  specializeLift Result transform
};
```

Prefer this explicit lambda at a reusable boundary instead of adding a language
feature to generalize arbitrary applications.

### Keep varying dependencies as arguments

A local stage can itself be generalized when it does not close over a
monomorphic carrier parameter:

```wm
let consumeCarriers = (numberCarrier, textCarrier) => {
  let stage = (transform) => {
    (carrier) => {
      specializeLift carrier transform
    }
  };

  (
    stage(increment)(numberCarrier)(Ok(1)),
    stage(addBang)(textCarrier)(Ok("hello")),
  )
};
```

Each occurrence of `stage` gets a fresh transform and carrier type. By contrast,
this closes over one monomorphic parameter:

```wm
let consumeCarrier = (carrier) => {
  let stage = (transform) => {
    specializeLift carrier transform
  };

  -- Every use of stage shares this invocation's one carrier type.
  ...
};
```

The practical rule is simple: if a local helper must vary independently, pass
the varying value as an argument rather than capturing it.

## Records are generalized as whole values

A let-bound record may contain an operation whose type variables are generalized
with the record:

```wm
record StagedCarrier<Stage> = {
  stage: Stage,
};

let resultStagedCarrier = .{
  stage = (transform) => {
    Monad.lift Result transform
  },
};

let numberResult = resultStagedCarrier.stage(increment)(Ok(1));
let textResult = resultStagedCarrier.stage(addBang)(Ok("hello"));
```

The `stage` field is not a rank-2 polymorphic field. Instead, each occurrence of
the let-bound `resultStagedCarrier` instantiates the entire record scheme afresh.
This distinction matters when designing APIs:

- separate occurrences of a let-bound record may use unrelated types;
- a record received once as a function parameter has one monomorphic
  instantiation inside that invocation;
- passing the let-bound record twice gives two independently instantiated
  parameters.

The same rule makes records containing operations such as `map` useful without
requiring polymorphic record fields.

For the current standard carriers, this example's `stage` has the same useful
shape as the existing `fn` Kleisli adapter. A `stage` name may be convenient in
a specialized API, but whole-record generalization does not require adding a
duplicate operation to every carrier.

## Flatten nested carrier code

Code does not need a generic `Compose<F, G, A>` type to manipulate a concrete
nested shape. Specialize each layer in stages:

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

let resultTaskStage = (transform) => {
  nestWith Result Task transform
};
```

At use sites this has an ordinary concrete shape such as:

```txt
Result<Task<A, TaskError>, ResultError>
```

More layers can be added with another staged function. This is preferable to a
general transformer or constructor-composition framework while the program only
uses a small, known stack.

Error injection follows the same design. `Monad.liftError` accepts a carrier,
an ordinary error constructor, and a transformation:

```wm
let fetchUser = Monad.liftError Task JavaScriptFailure fetchUserProcedure;
let validate = Monad.liftError Task ValidationFailure validateProcedure;
```

The constructors may originate from the application error ADT, while the
generic lifting operation remains ordinary record passing and currying.

## Use one operation slot per incompatible use

A function parameter is monomorphic inside one invocation. If an algorithm uses
the same conceptual operation at types that do not unify, give those uses
separate parameters:

```wm
let lift2WithSlots = (andThenLeft, andThenRight, succeed) => {
  (left, right, combine) => {
    andThenLeft(left, (leftValue) => {
      andThenRight(right, (rightValue) => {
        succeed(combine(leftValue, rightValue))
      })
    })
  }
};

let combined = lift2WithSlots(
  Result.andThen,
  Result.andThen,
  Result.succeed,
)(Ok(2), Ok(" items"), combineLabel);
```

The two `Result.andThen` occurrences are independently instantiated at the call
site. This is finite flattening: the consumer states how many differently typed
uses it has instead of requiring one rank-2 operation.

Use this only when destructuring one carrier record cannot infer the desired
heterogeneous types. Most consumers use each operation at one specialization
and should accept the smaller record directly.

## What this replaces in Workman

For Workman's current goals, these patterns cover the common reasons to request:

- **interfaces or traits:** pass a record containing the required operations;
- **typeclasses:** pass the carrier record explicitly, with no instance search;
- **SML functors:** write an ordinary function that accepts the record and
  returns a specialized function or record;
- **higher-kinded parameters:** flatten the consumer around its concrete input
  and output carrier shapes;
- **monad-transformer machinery:** stage the small number of carrier layers the
  application actually uses.

Consequently, Workman should not plan to add these larger systems merely to make
carrier code generic. Files and imports provide namespaces; explicit export
records provide capabilities; ordinary functions provide specialization.

This keeps abstraction visible in source code and avoids introducing:

- a second type/module language;
- implicit instance resolution and coherence rules;
- associated-type or higher-kinded unification machinery;
- functor application, sharing constraints, and generated module identities;
- overlapping ways to express the same carrier pipeline.

## Boundaries

The design has real limits. They are useful diagnostics, not immediate feature
requests.

### One parameter cannot be polymorphic at several types

This does not typecheck in ordinary rank-1 HM when the two calls require
different instantiations:

```wm
let consume = (stage) => {
  (
    stage(numberTransform),
    stage(textTransform),
  )
};
```

Use separate parameters, move `stage` behind a let boundary, or pass the values
it would capture as explicit arguments.

### A passed record does not have polymorphic fields

Calling `carrier.stage` at `Number` and `String` through one carrier parameter
has the same limitation. Separate occurrences of a top-level carrier value work;
one already-instantiated parameter does not.

### Some abstractions preserve a constructor as data

First-class natural transformations, fully generic `Free<F, A>` or `Fix<F>`, and
libraries that must store an operation for arbitrary future instantiations may
need a different representation. A specialized datatype, an eliminator-style
API, or a Church encoding can often keep the useful program rank-1, but these
choices make the abstraction more specialized and elimination-oriented.

That trade-off is acceptable for occasional library code. It does not justify
adding higher-kinded types to routine application code.

### Type-growing recursion still fails

Recursion that changes its own carrier type at every call would require an
infinite type, for example repeatedly changing `A` into `List<A>`. Staging does
not make that a finite rank-1 program.

## When to reconsider

Reconsider stronger abstraction only if real Workman libraries repeatedly need
all of the following:

1. one value must be consumed at several unrelated type instantiations inside a
   single function call;
2. finite operation slots or staged let bindings make the public API materially
   worse;
3. specialization cannot be moved to the consumer;
4. the abstraction must remain first-class rather than being represented by an
   eliminator or concrete datatype.

Until then, the smaller design is the better fit: specialize consumers, pass
explicit records, and let ordinary HM generalization do the work.

## Working examples

- [`examples/carrier_flattening.wm`](../examples/carrier_flattening.wm) contains
  the practical carrier, staging, record, traversal, and nested-layer
  experiments.
- [`examples/traverse_carrier/main.wm`](../examples/traverse_carrier/main.wm)
  uses the standard `Traverse.with` API with `Result` and `Task`.
- [`examples/carrier_recursive_flattening.wm`](../examples/carrier_recursive_flattening.wm)
  records the less common recursive `Fix` and `Free` boundary experiments.
- [`examples/carrier_church_free.wm`](../examples/carrier_church_free.wm) shows an
  eliminator-oriented Free program and generic bind. It is evidence about the
  boundary, not the default application architecture.
