# Orbital Run

A small but complete **game** written in Workman, drawn with raylib through the
Deno FFI bindings. It builds on the [orbital sandbox](../orbital) and reuses its
pure `vec` / `rng` / `color` modules.

You pilot a ship caught in a sun's gravity well. Thrust to steer, sweep up the
orbiting energy orbs (each one refuels you and scores a point), and don't fall
into the sun. Clear the field to win.

## Controls

| Key / input        | Action                          |
| ------------------ | ------------------------------- |
| `WASD` / arrows    | Thrust (burns fuel)             |
| Mouse wheel        | Zoom the camera in / out        |
| `Space`            | Launch (from the title screen)  |
| `R`                | Run again (from game over)      |
| `Esc`              | Quit                            |

## raylib 5.5 features used

- **Camera2D** (`BeginMode2D`/`EndMode2D`) for mouse-wheel zoom and a
  proximity-based **screen shake** that rattles harder the closer you skim the
  sun.
- **Additive blend mode** (`BeginBlendMode(BLEND_ADDITIVE)`) so orbs, sparks and
  the corona bloom where they overlap.
- **`DrawRing`** for an animated, counter-rotating sun corona.
- **`DrawCircleGradient`** for soft glows (orbs, ship, sun) instead of stacked
  alpha circles.
- **`DrawRectangleGradientV`** backdrop and **`DrawRectangleRounded`** HUD panels.

All of these take raylib structs (`Vector2`, `Camera2D`, `Rectangle`); Workman
records with matching fields flow straight through the FFI.

## The shape of it

The same pure/impure split as the sandbox, plus a real **scene state machine**:

```workman
type Scene =
  | Title
  | Playing<Game>
  | Over<Game>;
```

The whole app is one immutable value, `App = { scene, rng }`, threaded through a
recursive `loop`. Every frame does exactly three things:

1. **read input** at the FFI boundary (`Result<Input, Js.Error>`),
2. **`advance`** the app — a pure `(App, Input, dt) -> App` that pattern-matches
   the scene and decides the transition,
3. **render** the resulting scene.

Because the transitions live in one `match` over a sum type, "title → playing →
game over → playing" can't be subtly mishandled — the compiler checks every
case. The `rng` is threaded through restarts so each run gets a fresh but
deterministic field.

The simulation itself (`game.wm`) is 100% pure: gravity integration, collision,
collection, scoring, win/lose — all `value -> value`, no FFI, no mutation. Orbs
and the ship orbit on `v = sqrt(G / r)` circular-orbit velocities computed with
the hand-rolled `sqrt` from `vec.wm`.

## Files

| File        | Responsibility                                                    |
| ----------- | ---------------------------------------------------------------- |
| `listx.wm`  | List helpers the stdlib lacks: `filter`, `count`, `isEmpty`.     |
| `game.wm`   | Pure game core: entities, `stepGame`, spawning, win/lose.        |
| `main.wm`   | raylib boundary: input, scene rendering, the frame loop.         |
| (shared)    | `../orbital/{vec,rng,color}.wm`.                                 |

## Running

From the repository root:

```sh
deno run -A src/main.ts run examples/raylib/orbital_run/main.wm
```

Typecheck the whole graph without a window:

```sh
deno run -A src/main.ts check examples/raylib/orbital_run/main.wm
```

## Tuning knobs (in `game.wm`)

- `sunG` — gravitational strength (affects orbit speeds and how hard you fall).
- `sunRadius` / `collectRadius` — crash and pickup distances.
- `thrustAccel`, `maxFuel`, fuel burn rate (`24 * dt`) and refuel (`collected * 22`).
- orb count (`spawnOrbs(9, r)`) and spark count (`spawnSparks(70, r)`).
