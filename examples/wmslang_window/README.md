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

Close the window through the window manager to exit. The example currently uses the Linux
X11/Wayland `SDL_SysWMInfo` layouts. Before running it, provide an x86-64 SDL2 shared library at
`examples/wmslang_window/SDL2.so`; a symlink to the system SDL2 library is sufficient. Shared
libraries are intentionally ignored and are not distributed with the repository.
