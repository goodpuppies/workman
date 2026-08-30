# wmslang feedback window

This V5 example is a two-pass Game of Life written entirely in Workman. The update fragment uses
exact `Texture2D.Load` reads from one `rgba16float` texture and renders into the other; the display
fragment samples the result onto the SDL surface. The recursive host loop owns pass ordering and an
immutable `FeedbackPair`, so swapping concrete views never recompiles Workman, Slang, WGSL, or a
pipeline.

Resize events allocate and initialize a fresh pair, reset the simulation to frame zero, resize the
Deno window surface, and explicitly retire the previous textures. Runtime validation rejects using
the sampled physical texture as the current render target.

From the `wm-mini` repository root:

```sh
deno run -A src/main.ts run examples/wmslang_feedback_window/main.wm
```

The example reuses `examples/wmslang_window/SDL2.so`; see the window example README for setup.
