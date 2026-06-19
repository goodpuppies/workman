# Orbital Sandbox

A tiny gravity / particle simulation written in **Workman**, drawn with raylib
through the Deno FFI bindings.

A swarm of bodies orbits a central "sun". Hold the **left mouse button** to drag
them toward the cursor, the **right mouse button** to push them away. `Esc`
quits.

## Why this is a nice functional fit

The interesting design choice is the seam between *pure* and *impure*:

- The entire simulation is pure Workman. A frame is just
  `step : (World, Field, dt) -> World`. The `World` is immutable; each frame
  produces a brand new one. No mutation, no globals, no I/O.
- Because the core is pure, it needs nothing from JavaScript — so it grows its
  own `sqrt` (Newton's method), its own deterministic PRNG (Park-Miller MINSTD),
  and its own HSV→RGB color math. All of it is ordinary arithmetic and
  recursion.
- Only `main.wm` touches raylib. Every FFI call returns `Result<_, Js.Error>`,
  so the render path is a thread of `Result|...|` sequences. The pure values are
  passed straight through; only the ones that cross the FFI boundary get
  wrapped.

The frame loop is itself a fold: `loop` recurses, threading the immutable world
forward until the window closes. There is no mutable "game state" anywhere.

## Files

| File        | Responsibility                                              |
| ----------- | ----------------------------------------------------------- |
| `vec.wm`    | Pure 2D vectors: add/sub/scale, length, normalize, `sqrt`.  |
| `rng.wm`    | Pure deterministic random numbers, threaded by hand.        |
| `color.wm`  | Pure HSV→RGB, plus the `Color` record raylib expects.       |
| `sim.wm`    | The simulation: `Body`, `World`, `Field`, `step`, `init`.   |
| `main.wm`   | The only impure module — input, integration call, drawing.  |

## Running

From the repository root (the raylib `.dll` path is resolved from there):

```sh
deno run -A src/main.ts run examples/raylib/orbital/main.wm
```

Typecheck the whole module graph without opening a window:

```sh
deno run -A src/main.ts check examples/raylib/orbital/main.wm
```

## Things to try

- Bump `bodyCount` in `main.wm` (it is just a number).
- Change the spawn `hue` range in `sim.wm` for a different palette.
- Tune `centerG` / the drag factor `0.9995` in `sim.wm` to make orbits tighter,
  looser, or more chaotic.
- Swap the fixed central attractor for a second moving one — the `Field` record
  already supports two attractors.
