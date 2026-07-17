# wmslang SDL/WebGPU window

This example compiles a Workman Mandelbrot fragment through wmslang and Slang, creates an SDL2
window, attaches Deno's `UnsafeWindowSurface`, and presents the generated WGSL directly with WebGPU.
There is no CPU pixel readback and SDL does not compile or render the shader.

The complete WebGPU presentation path is also Workman: adapter/device acquisition, canvas-context
configuration, pipeline construction, render-pass encoding, queue submission, presentation, and
cleanup live in `webgpu_present.wm`. The example has no TypeScript shim.

From the `wm-mini` repository root:

```sh
deno run -A src/main.ts run examples/wmslang_window/src/main.wm
```

V3 also includes a GLML-derived warped-noise acceptance shader using the ordinary pinned Slang
builtins (`floor`, `sin`, `frac`, `dot`, `length`, `pow`, `smoothstep`, and friends):

```sh
deno run -A src/main.ts run examples/wmslang_window/src/warped_noise_shader.wm
```

The second V3 acceptance entry ports GLML's torus raymarcher. Mouse movement rotates the camera and
the immutable frame loop passes the resulting rotation and time through the V2 uniform record. Its
V5 path uses a genuine `i32` recursion counter and an explicit `Gpu.f32` conversion for the adaptive
hit threshold while distance calculations remain `f32`:

```sh
deno run -A src/main.ts run examples/wmslang_window/src/raymarch_shader.wm
```

Close the window through the window manager to exit. The example currently uses the Linux
X11/Wayland `SDL_SysWMInfo` layouts. Before running it, provide an x86-64 SDL2 shared library at
`examples/wmslang_window/SDL2.so`; a symlink to the system SDL2 library is sufficient. Shared
libraries are intentionally ignored and are not distributed with the repository.
