# Carrier namespaces in value position

Status: implemented

## Summary

Workman carrier modules should explicitly export an ordinary record named
`carrier`. When a Workman module namespace is used in value position, the name
should resolve to that exported record.

Given:

```wm
from "./task.wm" import * as Task;
```

these two expressions should be equivalent:

```wm
Monad.liftError Task JavaScriptFailure procedure
Monad.liftError Task.carrier JavaScriptFailure procedure
```

The short form is namespace-value resolution sugar. It does not turn the whole
`Task` namespace into a record and it does not synthesize a carrier record.
`Task.carrier` must be an ordinary value explicitly defined and exported by the
module.

## Motivation

Carrier-oriented procedures need to abstract over a small common interface such
as `fn` and `fnError`. Requiring every use to say `Task.carrier` is honest but
slightly noisy:

```wm
let request = Monad.liftError Task.carrier JavaScriptFailure (url) => {
  fetch(url)
};
```

Using the namespace directly is readable:

```wm
let request = Monad.liftError Task JavaScriptFailure (url) => {
  fetch(url)
};
```

Today, an ordinary namespace import introduces qualified members such as
`Task.map`, but it does not introduce an ordinary value named `Task`. `Task` and
`Result` are exceptional because the basis synthesizes partial record values for
them. Those records contain only the members needed by existing uses, which
makes namespace behavior carrier-specific and causes new generic operations to
require more compiler changes.

The proposed rule replaces those exceptions with one uniform and explicit
convention.

## Why this design instead of SML functors

Standard ML keeps structures outside the ordinary value language. A structure
may contain independently polymorphic values, type constructors, datatypes, and
nested structures. An ordinary function therefore cannot receive `Task` as a
value. Generic behavior over a carrier structure would normally be expressed
with a signature and functor, approximately:

```sml
signature CARRIER = sig
  type ('value, 'error) t

  val bind :
    ('value, 'error) t *
    ('value -> ('next, 'error) t) ->
    ('next, 'error) t

  val mapError :
    ('value, 'error) t *
    ('error -> 'nextError) ->
    ('value, 'nextError) t
end

functor MakeLiftError (Carrier : CARRIER) = struct
  fun liftError inject procedure wrapped =
    Carrier.bind (
      wrapped,
      fn value => Carrier.mapError (procedure value, inject)
    )
end

structure TaskLift = MakeLiftError (Task)
```

The exact SML interface can vary, but the important point is that the generic
abstraction is in the module language. The functor receives a structure while
preserving its type-constructor member and the independent type schemes of its
operations.

That machinery solves a broader problem than Workman has here. Carrier lifting
does not need to:

- pass the complete `Task` structure at runtime;
- abstract over a hidden or generative carrier type constructor;
- instantiate one received operation at unrelated types inside one invocation;
- express module sharing or opaque representation constraints.

It needs a small set of value-level operations whose types agree for one
pipeline. An explicit record dictionary expresses exactly that smaller
requirement:

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

and an ordinary function consumes it:

```wm
let liftError = (domain) => {
  (inject) => {
    (procedure) => {
      domain.fnError(inject)(procedure)
    }
  }
};
```

This is related to dictionary-passing implementations of type classes and
traits in other languages: the generic code receives the concrete operations it
uses rather than the entire source-language module abstraction. Workman keeps
that dictionary explicit in the standard-library source instead of asking the
compiler to derive one.

The `Task` to `Task.carrier` resolution rule supplies only the ergonomic part
normally associated with richer abstraction mechanisms. The semantic object
being passed remains the authored record:

```wm
Monad.liftError Task JavaScriptFailure procedure

-- resolves as

Monad.liftError Task.carrier JavaScriptFailure procedure
```

This split is intentional:

- the module retains its independently polymorphic exports;
- the record declares the small interface that may cross into value-level
  generic code;
- ordinary HM inference handles the record and the consuming function;
- namespace-value sugar keeps the common call site concise;
- no carrier-specific compiler object or full module abstraction is required.

## How useful polymorphism is retained

The explicit record does not retain independently polymorphic fields after it
has been passed into an ordinary function. It does retain the polymorphism this
use case needs through ordinary let-generalization.

The `carrier` declaration is generalized as one record binding. Each occurrence
of `Task.carrier`, including an occurrence reached through bare `Task`, receives
a fresh instantiation:

```wm
let fetchUser = Monad.liftError Task JavaScriptFailure fetchUserProcedure;
let validateName = Monad.liftError Task ValidationFailure validateNameProcedure;
```

`fetchUser` and `validateName` may have different input, output, native-error,
and application-error types. They do not share one permanent monomorphic
instantiation merely because both use `Task.carrier`.

Inside either call, the selected carrier record is monomorphic. That makes all
of its operations agree on the types of that pipeline. In this scenario the
restriction supplies useful consistency rather than removing useful
expressiveness.

SML functors, OCaml first-class modules, polymorphic record fields, and similar
features become important when the abstraction must preserve member
polymorphism *inside* the receiver. For example, this function wants to use one
received `succeed` member at two unrelated types:

```wm
let unrelatedUses = (domain) => {
  (
    domain.succeed(1),
    domain.succeed("text"),
  )
};
```

The carrier-record design deliberately does not make that valid. If Workman
develops a concrete need for this shape, it should motivate a separate design
for first-class polymorphic structures or polymorphic fields. Carrier lifting
does not require those features preemptively.

## Alternatives not chosen

Whole-namespace reification was not chosen because it would make a structure
look like an ordinary record without preserving the independent schemes of all
its members.

Synthetic basis values such as the current partial `Task` and `Result` records
were not chosen because every new generic operation requires the compiler and
runtime to be taught another special field.

Carrier-specific helpers such as only `Task.liftError` and `Result.liftError`
were not chosen because their behavior is one generic record operation and
should have one definition in `std/monad.wm`.

Full functor or first-class-module machinery was not chosen because the carrier
pipeline does not need abstract type members, generativity, sharing, or
independent member instantiation inside the generic function.

## Explicit carrier record

A carrier module owns its carrier record:

```wm
-- std/task.wm

let fn = (f) => {
  (task) => {
    task :> Task.andThen(f)
  }
};

let fnError = (inject) => {
  (f) => {
    fn((value) => {
      f(value) :> Task.mapErr(inject)
    })
  }
};

let carrier = .{
  fn = fn,
  fnError = fnError,
  succeed = succeed,
  map = map,
  map2 = map2,
  andThen = andThen,
};
```

`Result` can export a record with the same fields:

```wm
let carrier = .{
  fn = fn,
  fnError = fnError,
};
```

The compiler does not choose the fields, manufacture the record, or infer that
a module is a carrier from its other exports. The module author explicitly opts
into namespace-value use by exporting `carrier`.

## Generic lifting

`Monad.lift` and `Monad.liftError` remain ordinary curried Workman functions:

```wm
let lift = (domain) => {
  (f) => {
    domain.fn(f)
  }
};

let liftError = (domain) => {
  (inject) => {
    (f) => {
      domain.fnError(inject)(f)
    }
  }
};
```

The three arguments to `liftError` are therefore:

1. the carrier dictionary;
2. the error injection function, usually an ADT constructor;
3. the procedure being lifted.

For example:

```wm
type WeatherError =
  | JavaScriptFailure<Js.Error>
  | WeatherFailure<String>;

let request = Monad.liftError Task JavaScriptFailure (url) => {
  fetch(url)
};

let requireOk = Monad.liftError Task WeatherFailure (response) => {
  if (response.ok) {
    Task.succeed(response)
  } else {
    Task.fail("weather request failed")
  }
};
```

After namespace-value resolution, both definitions use the explicitly exported
`Task.carrier` record.

## Namespace semantics

A Workman namespace remains a structure-like static environment:

```wm
Task.map       -- exported value member
Task.Task      -- exported type member, if the module defines one
Task.carrier   -- explicitly exported record value
```

Using the bare namespace in expression position selects its default carrier
value:

```wm
Task           -- resolves as Task.carrier
```

This is not whole-namespace reification. In particular, it does not construct a
record containing every exported value and it does not place exported types in a
runtime object.

The explicit spelling always remains valid. Code may use `Task.carrier` when it
improves clarity or when discussing the dictionary itself.

## Resolution rules

For a Workman source-module namespace alias `Name`:

1. `Name.member` continues to resolve as a qualified namespace member.
2. `Name` in type position continues to follow the existing type grammar and
   does not select a value.
3. `Name` in value position resolves to `Name.carrier`.
4. The selected `carrier` scheme is instantiated exactly as an explicit
   `Name.carrier` occurrence would be.
5. If the namespace does not export `carrier`, resolution fails with a focused
   diagnostic.

Diagnostic:

```text
namespace Http cannot be used as a value; Http does not export carrier
```

A local value and a Workman namespace alias should not silently share the same
name. The existing declaration/import collision rules should be extended to
reject that collision, keeping `Name` and `Name.member` visibly related.

## Scope

This proposal applies to namespaces introduced from Workman source modules:

```wm
from "./task.wm" import * as Task;
```

It also applies to standard-library namespaces once standard modules use the
same module representation and runtime emission path.

It does not apply to JavaScript namespace imports:

```wm
from js.global("Math") import * as Math;
```

A JavaScript namespace represents a foreign runtime object and follows the FFI
object and runtime-validation rules. It is not a Workman structure opting into
the `carrier` convention.

It does not apply to:

- named imports;
- open `import *` declarations without an alias;
- type names or constructors merely sharing a spelling with a namespace;
- arbitrary records that happen to contain a field named `carrier`.

## Standard-library runtime requirement

The source files in `std/` currently provide imported type schemes, while
`emit_prelude.ts` separately contains hand-written JavaScript implementations
of their runtime values. Adding `carrier` only to `std/task.wm` would therefore
make it visible to inference without making it exist at runtime.

Before relying on this design, standard Workman modules should participate in
ordinary runtime emission. The intended boundary is:

- genuine runtime primitives remain in the basis;
- derived operations are written in Workman under `std/`;
- standard module namespaces are emitted from those Workman declarations;
- `Task.carrier`, `Result.carrier`, and `Monad.liftError` have no duplicated
  JavaScript implementation.

Promise-backed task primitives such as `Task.succeed`, `Task.andThen`, and
`Task.mapErr` may remain basis operations. Functions assembled from those
primitives should be ordinary standard-library Workman code.

## Implementation

1. Track Workman namespace aliases as namespaces, rather than only adding their
   exported members as dotted value and type bindings.
2. Teach value-name resolution to select the exported `carrier` binding when a
   namespace alias appears as a bare expression.
3. Preserve that resolution in binding facts and Core lowering so emitted code
   refers to `Name.carrier`, not the complete namespace object.
4. Emit standard Workman modules through the normal module pipeline.
5. Add explicit `carrier` records to `std/task.wm` and `std/result.wm`.
6. Define generic `liftError` in `std/monad.wm`.
7. Remove the synthetic first-class `Task` and `Result` record values from the
   basis type environment.
8. Remove the corresponding derived-operation copies from the JavaScript
   runtime prelude.
9. Migrate carrier examples and documentation to `Monad.lift Task` and
   `Monad.liftError Task Constructor`.

The namespace and standard-library runtime changes landed together, so inferred
standard values and emitted standard values now come from the same Workman
declarations.

## Validation

Focused tests should establish:

- `Monad.lift Task f` resolves and runs as `Monad.lift Task.carrier f`;
- `Monad.liftError Task Inject f` resolves and runs as the explicit form;
- separate namespace occurrences instantiate the carrier record independently;
- the members inside one lifted pipeline remain type-correlated;
- explicit `Task.carrier` remains valid;
- a Workman namespace without `carrier` produces the focused diagnostic;
- a JavaScript namespace is not redirected to `.carrier`;
- namespace/local-value collisions are rejected consistently;
- no generated JavaScript refers to a synthetic partial `Task` or `Result`
  record;
- standard-library behavior comes from emitted Workman declarations rather than
  duplicated prelude implementations.

## Non-goals

This proposal does not add:

- whole-namespace reification;
- SML functors, signatures, generativity, or sharing constraints;
- first-class type members;
- rank-N or impredicative polymorphism;
- polymorphic record fields;
- automatic carrier derivation based on field names;
- a general default export for JavaScript modules.

If Workman later needs functions that receive a structure and instantiate one
of its members at multiple unrelated types, that should be designed separately.
The explicit carrier dictionary deliberately solves the smaller carrier
composition problem using ordinary HM records.
