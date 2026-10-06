# Grain-style nominal record projection

## Decision

Workman record values remain nominal. A literal such as `.{ x = 1 }` infers one declared nominal
record identity from its shape and context; it does not construct a structural record.

Field projection now follows Grain's nominal-label model. When the receiver type is not yet known,
the compiler looks up the declared records that own the label, selects one identity, and unifies the
receiver with that complete nominal record.

```wm
record Point = { x: Number };

let getX = (point) => {
  point.x
};
```

`getX` has type `Point -> Number`, rather than an open type resembling
`{ x: Number, ... } -> Number`.

If several records own a label, Workman selects the first candidate and emits an ambiguity warning.
An annotation resolves the ambiguity:

```wm
record Point = { x: Number };
record Offset = { x: Number };

let pointX = (value: Point) => { value.x };
let offsetX = (value: Offset) => { value.x };
```

The annotation selects an identity; it does not coerce one nominal record into another.

## Motivation

The former implementation represented an inferred projection as a mutable structural row. That row
could be unified with a nominal record without retaining the nominal identity. Generalization and
instantiation could then copy the row and allow it to accumulate fields from another record.

For example, the compiler accepted the equivalent of:

```wm
record HasX = { x: Void -> Number };
record HasY = { y: Void -> String };

let passX = (value) => {
  let xf = value.x;
  value
};

let onlyX: HasX = .{ x = () => { 1 } };
let claimed = passX(onlyX);
let result: String = claimed.y();
```

The generated JavaScript then failed because `claimed` had no `y` field. Committing projection to a
nominal owner makes `passX` return `HasX`, so the `claimed.y` projection is rejected statically.

## Carrier impact

The ordinary carrier style remains supported. `Result.carrier` and `Task.carrier` are separate
instantiations of the shared nominal `Monad.Carrier` record. The `fn` label therefore makes
`Monad.via` nominally polymorphic over `Carrier`'s type parameters:

```wm
let via = Monad.via;

let fetch = via Task (request) => {
  fetchRequest(request)
};

let validate = via Result (response) => {
  validateResponse(response)
};
```

Each occurrence instantiates `via` independently. Currying and eta expansion continue to provide the
normal HM reuse pattern:

```wm
let viaResult = (transform) => {
  Monad.via Result transform
};
```

`Vec2` and similar fixed-shape carriers remain nominal `Monad.Applicative` records containing
`succeed`, `map`, and `map2`. They do not need the larger monadic shape.

Labels owned by both `Monad.Carrier` and `Monad.Applicative`, such as `map`, are genuinely
ambiguous. Library code should use an annotation when declaration order is not the intended choice.

## Expressiveness change

Plain HM let-polymorphism still generalizes the parameters of a selected nominal constructor. It
does not generalize over nominal identity. Consequently, one inferred projection function no longer
accepts unrelated records merely because they contain compatible fields:

```wm
record Point = { x: Number };
record Offset = { x: Number };

let getX = (value) => { value.x }; -- selects one nominal owner
```

The usual alternatives are small nominally annotated functions, eta-expanded specializations, or
passing the operation itself as a function. This covers the carrier usage in the current examples.

## Migration experience

Applying the rule to the current examples required only local disambiguation:

- The actor example annotates its proxy as `SubApi` because both `MainApi` and `SubApi` own `LOG`.
- Asteroids annotates `Bullet` and `Asteroid` values where `pos` alone would otherwise select
  `Ship`.
- Tuiman annotates `Geometry.Rect` and `Model` at functions that begin with labels shared by other
  nominal records.
- Foreign values in Weather and the webhook example use explicit pipe-member syntax such as
  `response :> .status` and `controller :> .abort()`.

No Result/Task carrier call sites needed helper functions or changes. `Monad.via`, `viaError`,
`map`, `mapErr`, `Traverse.with`, and the smaller Vector/Pair applicative carriers retain their
intended uses.

## FFI boundary

TypeScript and JavaScript member inference is a separate boundary. It uses the internal `ffi` type
mechanism and the shared JS member elaboration. Grain-style record selection applies to Workman record
labels and must not turn an unresolved JavaScript member into an arbitrary Workman record label.

JavaScript members support name-rooted dotted paths such as `response.ok` and
`response.headers.get("content-type")`. Computed expression receivers remain
explicit: `"hello" :> .length` and `makeResponse() :> .ok`. Both foreign spellings
lower through the same `FfiGet`/`FfiCall` inference and reflection path.

Known foreign receivers must not be constrained to a Workman record merely because
one of its labels matches. Unknown receivers still use the existing nominal-label
selection when a Workman label is available; annotate ambiguous receivers. Unknown
member labels may become delayed foreign obligations, never unrestricted structural
rows. The structural-row escape described by the earlier migration remains rejected.
See [JavaScript member access](js-member-access.md) for the syntax and implementation rule.

The internal `struct` type and its remaining FFI-handling branches are not removed by this change.
They should eventually be replaced by explicitly foreign delayed-member obligations.

## Future work

- Remove the now-dead pure-record structural-row paths from `Ty`, unification, diagnostics,
  provenance, semantic types, GPU specialization, and FFI conversion.
- Replace remaining internal structural FFI representations with explicitly foreign delayed-member
  obligations.
- Improve contextual lambda inference so an expected nominal API type can resolve a field before an
  ambiguity warning, particularly for actor proxies.
- Annotate standard-library operations whose labels are shared by `Carrier` and `Applicative`.
- Update the generic-programming documentation so it describes nominal operation records rather than
  promising arbitrary structural record interfaces.
- Consider constrained nominal polymorphism later if real programs need types such as
  `HasField<R, fn, F> => R -> F`. This is not part of the current record model.
