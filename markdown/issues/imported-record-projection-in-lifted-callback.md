# Issue: Imported Record Projection Falls Through to FFI in Lifted Callbacks

Status: open

Discovered while moving the `wmthree` FPS state into a pure Workman module.

## Summary

An unannotated parameter introduced inside `Monad.lift Result` does not currently recover an
imported Workman record type from its later carrier use. A nested field projection on that parameter
is left as an unresolved JavaScript FFI property path instead of being solved as an ordinary Workman
record projection.

The resulting diagnostic is misleading:

```txt
cannot resolve JS FFI property controls.quit for receiver type Game
unresolved JS FFI obligation in readQuit:
  (Result<Game, 'a>) => Result<?ffi#2:controls.quit, 'a>
```

No JavaScript value is involved. `Game` and `Controls` are Workman records.

## Minimal Reproduction

Module:

```wm
-- game.wm
record Controls = { quit: Bool };
record Game = { controls: Controls };

let initialGame = () => {
  .{ controls = .{ quit = false } }
};
```

Consumer:

```wm
from "./game.wm" import { Controls, Game, initialGame };

let lift = Monad.lift;

let readQuit = lift Result (game) => {
  Ok(game.controls.quit)
};

let value = readQuit(Ok(initialGame()));
```

`wm check` leaves `game.controls.quit` as an unresolved `?ffi` property obligation even though the
application of `readQuit` establishes the carrier value as `Result<Game, E>`.

## Expected Behavior

The lifted function should infer equivalently to:

```txt
readQuit : Result<Game, E> -> Result<Bool, E>
```

The projection should resolve through the imported declarations:

```txt
Game.controls : Controls
Controls.quit : Bool
```

It should never enter JS FFI resolution.

## Observed Cases

### Local records work

Defining `Controls` and `Game` in the consumer module allows the unannotated lifted form to infer.

```wm
record Controls = { quit: Bool };
record Game = { controls: Controls };

let readQuit = Monad.lift Result (game) => {
  Ok(game.controls.quit)
};
```

### An explicit imported parameter type works

Importing both record declarations and annotating the lifted parameter resolves the projection:

```wm
from "./game.wm" import { Controls, Game };

let readQuit = Monad.lift Result (game: Game) => {
  Ok(game.controls.quit)
};
```

This is valid pure Workman type evidence, not an FFI cast.

### Direct nested projection requires the nested record import

Importing only `Game` is insufficient for direct nested projection:

```wm
from "./game.wm" import { Game };

let readQuit = (game: Game) => {
  game.controls.quit
};
```

The compiler knows `Game.controls : Controls`, but without the imported `Controls` declaration it
cannot establish that `Controls` is a record. The direct form reports:

```txt
Controls is not a record type
```

Importing both `Game` and `Controls` makes this direct annotated form work.

## Current Workaround

Keep the imported state representation opaque and export pure queries from its defining module:

```wm
-- game.wm
let shouldQuit = (game: Game) => {
  game.controls.quit
};

let cameraX = (game: Game) => { game.x };
let cameraZ = (game: Game) => { game.z };
```

Consumer:

```wm
from "./game.wm" import { initialGame, shouldQuit, cameraX, cameraZ };

let advance = Monad.lift Result (game) => {
  if (shouldQuit(game)) {
    Ok(FrameDone(game))
  } else {
    useCamera(cameraX(game), cameraZ(game))
  }
};
```

This workaround has useful module-design properties:

- callers do not depend on nested record representation
- the lifted callback remains annotation-free
- no unresolved property access reaches FFI inference

Importing every nested record type and annotating the lifted parameter is also a valid workaround
when direct field access is desirable.

## Likely Boundary

The failure appears to involve the interaction of three mechanisms:

1. `Monad.lift Result` initially gives its callback a generic carried value.
2. Record projection inference does not select the imported `Game` record from the later
   `readQuit(Ok(initialGame()))` constraint.
3. The unresolved dotted access shares syntax and inference machinery with JS receiver access, so
   it survives as `?ffi controls.quit` and delayed FFI resolution eventually reports the failure.

The exact repair point still needs investigation. The important constraint is that the fix must use
real HM/imported-record evidence. It must not make annotations act as JS casts or allow unresolved
FFI obligations to become generic values.

## Candidate Regression Tests

Add focused tests for:

1. An imported one-level record projection inside an unannotated lifted callback.
2. An imported nested record projection with all record declarations imported.
3. The same nested projection with the lifted function constrained only by later carrier use.
4. A direct annotated nested projection with and without the nested record declaration imported.
5. A genuine unresolved JS property access in the same shape, confirming it remains an FFI
   obligation and still fails when no static JS evidence exists.

## Non-Goals

- Treating Workman annotations as general FFI receiver evidence.
- Falling back to `Js.Object` or `Js.Value` when record inference misses.
- Automatically importing every declaration from another module without an explicit module-policy
  decision.
- Special-casing `Monad.lift` by surface spelling rather than fixing the underlying inference flow.
