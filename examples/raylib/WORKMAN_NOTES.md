# Notes from building two raylib projects in Workman

These are findings from writing the [orbital sandbox](./orbital) (a gravity
particle simulation) and [orbital run](./orbital_run) (a small game with a scene
state machine) in `wm-mini`. Both compile, typecheck, and run. They're organized
as "what worked well" and "rough edges / surprises", with minimal repros for the
surprises so they're actionable.

The overall experience was genuinely pleasant: the pure/impure split the
language nudges you toward is a great fit for simulations and games. The core of
each project is pure `state -> state` with no FFI, no mutation, no loops — just
recursion threading an immutable world — and raylib only appears at the edge.

---

## What worked really well

- **Sum types + pattern matching for state machines.** Modeling the game as
  `type Scene = Title | Playing<Game> | Over<Game>` and putting all transitions
  in one `match` is exactly right. Exhaustiveness checking means you can't forget
  a scene. This is the single nicest thing about writing a game here.

- **The pure core / FFI boundary split.** Because the simulation never touches
  JS, it needs nothing from JS — so it grows its own `sqrt` (Newton), PRNG
  (Park-Miller), and HSV→RGB, all as ordinary recursion and arithmetic. That
  code is trivial to reason about and would be trivial to unit-test.

- **`Result|...|` carrier tuple-lift.** Batching a run of fallible FFI calls into
  one `Result<(...), Js.Error>` is excellent ergonomics for a render frame:
  ```workman
  Result|
    Raylib.BeginDrawing(),
    Raylib.H.ClearBackground(bg),
    Raylib.EndDrawing()
  |
  ```
  Reading several inputs at once with `Result|a, b, c, ...|` then destructuring
  `Ok((Var(a), Var(b), ...))` is equally nice.

- **Ambient std namespaces.** `List.map`, `Result.map`, `Result.mapErr`,
  `Result.textOf`, `Monad.lift` are all in scope without imports. `Result.textOf`
  for stringifying any value into HUD text was handy.

- **Structural FFI mapping for records.** A Workman `record Color = { r, g, b, a }`
  is accepted directly where the raylib binding wants its `Color` struct. Passing
  record literals straight to `H.DrawText` / `H.DrawCircle` just works.

- **Cross-module records, types, and constructors** export and import cleanly via
  selective imports (`from "./game.wm" import { Game, Status, Running, ... }`),
  including using an imported record type in another module's `.{ ... }` literal.

- **Records match FFI structs structurally, by field — not by name.** A Workman
  `record Camera2D = { offset: Vec2, target: Vec2, rotation, zoom }` (with `Vec2`
  being my own `{ x, y }`) flows straight into raylib's `BeginMode2D(camera)`,
  and a plain `.{ x, y }` `Vec2` satisfies a `Vector2` parameter in `DrawRing`.
  This made using `Camera2D`, `Rectangle`, gradients, rings and blend modes
  painless — define a record with the right fields and pass it. (Confirmed at
  runtime: camera transforms, additive blend, and rings all render correctly.)

---

## Rough edges and surprises

### 1. Bare identifiers in patterns are pinned — even function params — and trip exhaustiveness

A bare name in a pattern is matched against the in-scope value ("pinning"), not
bound. When the std-library idiom reuses a function parameter name in a pattern:

```workman
let rec filter = match(items, keep) => {
  ([], _) => { [] },
  ([x, ..rest], keep) => { ... }   -- `keep` here is PINNED, not bound
};
```

...the checker emits a (spurious-feeling) `non-exhaustive match: in Cons,
missing: _`. The fix is to use `_` for the already-in-scope param:

```workman
  ([x, ..rest], _) => { if (keep(x)) { ... } else { ... } }   -- keep still in scope
```

Note `std/list.wm`'s own `map`/`foldRight` use the `([head, ..rest], f)` form, so
they likely emit this warning too. Worth either special-casing "pinned to the
identical binding" or documenting the `_` idiom in the guide.

### 2. Two nominal records with identical fields make literals ambiguous

```workman
record Orb   = { pos: Vec2, vel: Vec2, hue: Number };
record Spark = { pos: Vec2, vel: Vec2, hue: Number };

.{ pos = p, vel = v, hue = h }   -- error: ambiguous record type
```

Inference can't choose between two structurally identical nominal records, and
there's no `as` cast (not implemented) nor a return-type annotation to
disambiguate. Workarounds: make them structurally distinct (I added `size` to
`Spark`), or bind through an annotated `let`. A way to write `.{ ... } : Spark`
inline would remove the need to perturb the data model.

### 3. Record literals need the record type imported to resolve

```workman
let field = .{ center = c, centerG = 2200000, mouse = m, mouseG = g };
-- error: no matching record type   (until `Field` is imported)
```

`Field` was defined in `sim.wm` and used in `main.wm` but not imported. The error
`no matching record type` is correct but doesn't hint that the cause is a missing
import of a known record. A "did you mean to import record `Field` from ./sim.wm?"
hint would have saved a guess.

### 4. Match arms must share one type; `Result|...|` arity leaks into the type

Each `Result|...|` produces a tuple whose arity is part of the type, so renderers
that end in lifts of different lengths don't unify:

```
arm 1: Result<(Void, Void, Void, Void, Void), Js.Error>
arm 2: Result<Void, Js.Error>
```

Collapsing the payload fixes it:

```workman
renderTitle()  :> Result.map((_) => { void })
```

Reasonable once you know it, but the first encounter is surprising because both
arms are "just drawing". (The diagnostic here was actually excellent — it printed
both arm types and the differing part.)

### 5. Underscore-prefixed names don't bind in `let` tuple destructuring

In a `let` tuple pattern, a name starting with `_` is lexed as the wildcard `_`
plus leftover characters:

```workman
let (_a, _b) = pair;     -- parse error: Expected "," ... but "a" found
let (__g, __r) = pair;   -- same
let (ga, rb)  = pair;    -- fine
```

Curiously, `_head`-style names *do* work in `match` patterns (see
`aoc2021_day1.wm`), so the two pattern positions disagree. Minor, but a
consistency wart.

### 5b. `rec` is a reserved word and can't be a binding name

`let rec = .{ ... }` fails to parse (`rec` is the recursion keyword from
`let rec`). Easy to trip over when a `Rectangle` is the obvious thing to call
`rec`. A "did you mean a different name? `rec` is reserved" hint would be kind,
but it's a small thing.

### 6. No record spread / update is the main source of boilerplate

With no `.{ ..base, field = v }`, updating one field of a record means rewriting
every field:

```workman
let fueledShip = .{
  pos = ship.pos, vel = ship.vel,
  fuel = clamp(ship.fuel + collected * 22, 0, maxFuel),
  thrusting = ship.thrusting
};
```

For records with several fields (the game `Ship`, `Game`) this is the most
repetitive part of the code by far. Record update syntax would help simulations
specifically, since "new state = old state with a couple fields changed" is the
dominant operation.

---

## Small wishlist (in priority order for this style of code)

1. **Record update syntax** `.{ ..base, field = v }` — biggest quality-of-life win.
2. **Inline record annotation / `as`** to disambiguate identical-shape records.
3. **Friendlier diagnostics** for missing-record-type-import (#3) and pinned-param
   exhaustiveness (#1).
4. **Consistent underscore handling** between `let` destructuring and `match`
   patterns (#5).
