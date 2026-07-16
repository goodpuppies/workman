# Conceptual SDL2 mouse-driven Mandelbrot

Status: executable end-to-end acceptance example in `examples/wmslang_window`. The restricted
factory, normalized environment, uniform-read IR, Slang reflection reconciliation, immutable byte
packing, renderer upload, SDL2 mouse state, and GPU-local Mandelbrot recursion are connected.

The example demonstrates three independent functional loops:

1. SDL2 events are drained by a CPU tail-recursive function into immutable application state.
2. The CPU frame loop builds a nominal environment record and applies the shader factory once per
   frame.
3. Mandelbrot escape iteration is a GPU-local tail-recursive function lowered to a shader loop.

Applying the shader factory does not compile a new shader. Every bound fragment shares one artifact,
WGSL module, render pipeline, and reflected uniform layout. Only the environment bytes change.

Mouse input is not recursion "over the fragment." SDL polling and the frame loop are CPU
tail-recursive state machines. They produce a new immutable `FrameState`, then a new environment
record and bound-fragment value. The GPU independently maps the already-bound fragment function over
pixels; only `escapeIterations` is GPU recursion.

```text
SDL_PollEvent
  -> CPU drainEvents(state)
  -> immutable FrameState(center, scale, time, resolution)
  -> uniformsFrom(state)
  -> fragmentFor(uniforms)
  -> bound fragment (same artifact, freshly packed bytes)
  -> queue.writeBuffer
  -> draw: GPU invokes coord -> color for every pixel
```

## SDL2 mouse event boundary

The current window example already uses `SDL_PollEvent`. The mouse extension follows the working
`wmthree/src/engine/sdl_runtime.wm` layout: SDL event kind `1024` is `SDL_MOUSEMOTION`, and signed
relative motion is read from byte offsets 28 and 32 of `SDL_MouseMotionEvent`.

```workman
type NativeEvent =
  | QuitEvent
  | MouseEvent<Number, Number>
  | IgnoredEvent
  | NoEvent;

let sdlQuit = 256;
let sdlMousemotion = 1024;

let classifyEvent = (eventView, kind) => {
  if (kind == sdlQuit) {
    Ok(QuitEvent)
  } else {
    if (kind == sdlMousemotion) {
      Result|
        eventView.getInt32(28) :> denoResult,
        eventView.getInt32(32) :> denoResult
      | :> Result.map((dx, dy) => { MouseEvent(dx, dy) })
    } else {
      Ok(IgnoredEvent)
    }
  }
};
```

The SDL wrapper may call `SDL_SetRelativeMouseMode(1)` after creating the window, as `wmthree` does,
so movement remains available when the pointer reaches a window edge. This is host FFI behavior and
never enters the shader graph.

## Curried shader

The nominal record is simultaneously:

- the CPU value accepted by the outer shader factory;
- the stable schema of the one generated uniform block;
- the contextual shader environment visible to the inner lambda;
- the generic environment identity carried by the bound fragment and renderer.

```workman
type Escape = Inside | Escaped<Number>;

record MandelbrotUniforms = {
  resolution: (Number, Number),
  center: (Number, Number),
  scale: Number,
  time: Number
};

let mandelbrotShade = (uniforms: MandelbrotUniforms) => {
  (coord) => {
    @gpu;

    let rec escapeIterations = (cx, cy, zx, zy, remaining) => {
      if (remaining <= 0.0) {
        Inside
      } else {
        let magnitudeSquared = zx * zx + zy * zy;
        if (magnitudeSquared > 4.0) {
          Escaped(remaining)
        } else {
          let nextX = zx * zx - zy * zy + cx;
          let nextY = 2.0 * zx * zy + cy;
          escapeIterations(cx, cy, nextX, nextY, remaining - 1.0)
        }
      }
    };

    let pixel = (coord * 2.0 - uniforms.resolution) / uniforms.resolution.y;
    let c = pixel * uniforms.scale + uniforms.center;
    let escape = escapeIterations(c.x, c.y, 0.0, 0.0, 128.0);

    match(escape) {
      Inside => {
        (0.015, 0.02, 0.04, 1.0)
      },
      Escaped(remaining) => {
        let amount = remaining / 128.0;
        let pulse = 0.85 + uniforms.time * 0.001;
        (amount * pulse, 0.18 * amount, 1.0 - amount, 1.0)
      }
    }
  }
};

let fragmentFor = (uniforms: MandelbrotUniforms) => {
  Gpu.fragment(mandelbrotShade(uniforms))
};
```

The small linear time term is only a placeholder for an animated palette; a later math-intrinsic
slice can replace it with a bounded periodic function.

The chained record-plus-lane spelling `uniforms.resolution.y` is GPU-only sugar for a uniform field
read followed by lane projection. It does not change the reflected uniform layout.

The outer `mandelbrotShade` and `fragmentFor` functions are host-owned. The inner lambda alone is
GPU-owned. `escapeIterations` is local to that island and is never assigned a CPU interpretation.

## Immutable CPU state

Mouse motion pans the complex-plane center. Host code uses scalar arithmetic; tuple-vector lifting
remains GPU-only.

```workman
record FrameState = {
  quit: Bool,
  resolution: (Number, Number),
  center: (Number, Number),
  scale: Number,
  time: Number
};

let initialState: FrameState = .{
  quit = false,
  resolution = (960.0, 640.0),
  center = (-0.5, 0.0),
  scale = 1.0,
  time = 0.0
};

let panByMouse = (state: FrameState, dx: Number, dy: Number) => {
  let (centerX, centerY) = state.center;
  let (_, height) = state.resolution;
  let worldPerPixel = state.scale * 2.0 / height;
  .{
    ..state,
    center = (
      centerX - dx * worldPerPixel,
      centerY - dy * worldPerPixel
    )
  }
};

let uniformsFrom = (state: FrameState) => {
  let uniforms: MandelbrotUniforms = .{
    resolution = state.resolution,
    center = state.center,
    scale = state.scale,
    time = state.time
  };
  uniforms
};
```

No `Gpu.withValue` operation appears. `uniformsFrom(nextState)` creates an ordinary immutable record;
`mandelbrotShade(...)` turns it into the environment of a bound GPU function.

## Tail-recursive SDL event drain

One frame should consume all currently queued events rather than render once per event. The event
drain carries state explicitly and stops at `NoEvent`, quit, error, or a defensive host-side event
limit.

```workman
type PollStep = PollAgain<FrameState> | PollDone<FrameState>;

let applyNativeEvent = (state: FrameState, event: NativeEvent) => {
  match(event) {
    QuitEvent => { PollDone(.{ ..state, quit = true }) },
    MouseEvent(Var(dx), Var(dy)) => {
      PollAgain(panByMouse(state, dx, dy))
    },
    IgnoredEvent => { PollAgain(state) },
    NoEvent => { PollDone(state) }
  }
};

let rec drainEvents = (native: NativeRuntime, state: FrameState, remaining: Number) => {
  if (remaining <= 0) {
    Ok(state)
  } else {
    match(pollNative(native)) {
      Err(error) => { Err(error) },
      Ok(event) => {
        match(applyNativeEvent(state, event)) {
          PollDone(done) => { Ok(done) },
          PollAgain(next) => { drainEvents(native, next, remaining - 1) }
        }
      }
    }
  }
};
```

This recursion is ordinary CPU Workman and follows the existing stack-safe direct-tail-call path. It
has no relationship to shader tail-call lowering beyond sharing the source-language concept.

## Bound-fragment frame loop

The implemented presentation API accepts an initial bound fragment when creating the renderer and a
new bound fragment for every draw:

```text
createFragmentRenderer :
  (NativeSurface, Gpu.Fragment<U>) -> Task<FragmentRenderer<U>, Js.Error>

renderFragment :
  (FragmentRenderer<U>, Gpu.Fragment<U>) -> Result<Void, Js.Error>
```

The renderer creates the pipeline once from the artifact identity. `renderFragment` validates that
the next value has the same compiler-generated factory/schema identity, uploads its already packed
immutable bytes, and draws.

```workman
let rec frameLoop = (
  native: NativeRuntime,
  renderer: FragmentRenderer<MandelbrotUniforms>,
  state: FrameState
) => {
  match(drainEvents(native, state, 256)) {
    Err(error) => { Err(NativeFailure(error)) },
    Ok(inputState) => {
      if (inputState.quit) {
        Ok(void)
      } else {
        let nextState = .{ ..inputState, time = inputState.time + 0.016 };
        let boundFragment = fragmentFor(uniformsFrom(nextState));

        Result|
          renderFragment(renderer, boundFragment) :> Result.mapErr(HostFailure),
          presentNative(native) :> Result.mapErr(NativeFailure),
          delayNative(native, 16) :> Result.mapErr(NativeFailure)
        | :> Result.andThen((_) => {
          frameLoop(native, renderer, nextState)
        })
      }
    }
  }
};

let runWindow = (native: NativeRuntime) => {
  let initialFragment = fragmentFor(uniformsFrom(initialState));
  createFragmentRenderer(nativeSurface(native), initialFragment)
    :> Task.andThen((renderer) => {
      frameLoop(native, renderer, initialState) :> Task.fromResult
    })
};
```

The actual window example uses this bound-fragment contract. Packing bytes remain compiler/runtime
machinery; application code constructs only ordinary immutable records and passes opaque fragments.

## Compiler interpretation

| Source construct | Domain/phase | Meaning |
| --- | --- | --- |
| `drainEvents` | CPU | Stack-safe SDL event loop |
| `FrameState` update | CPU | Immutable application transition |
| `uniformsFrom` | CPU | Ordinary nominal record construction |
| `mandelbrotShade(uniforms)` | CPU/runtime boundary | Immutable bound GPU function; no compilation |
| inner `@gpu` lambda | GPU | One statically compiled fragment root |
| `escapeIterations` | GPU | Direct self-tail call lowered to a shader loop |
| `fragmentFor` | compile-time selection + runtime construction | Stable artifact identity plus freshly packed environment bytes |
| `renderFragment` | host runtime effect | Validate identity, `queue.writeBuffer`, draw |

The compiler must prove that all calls to `fragmentFor` select the same shader-factory binding and
nominal environment schema. Runtime values such as mouse position and time are absent from shader
and pipeline cache keys.

## Deliberately omitted

- scroll-wheel zoom and mouse buttons;
- resize-event handling and dynamic surface reconfiguration;
- multiple uniform blocks or bind groups;
- textures, storage buffers, and samplers;
- implicit host capture outside the one factory parameter;
- static specialization based on environment values;
- exact renderer cleanup/error plumbing, which remains the responsibility of the real window
  example.
