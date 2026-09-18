# wmslang shader in raylib

A wmslang fragment shader running inside raylib on the desktop OpenGL 3.3
build (`../libraylib.so`). The Mandelbrot source is the compiler's own
`static_mandelbrot.wm` acceptance shader, inlined verbatim, so the example
tracks a source known to compile through the whole pipeline.

run from the repo root:

```sh
deno run -A src/main.ts run examples/raylib/wmslang_shader/main.wm
```

Close the window or press ESC to exit.

## The seam

```wm
let whole = Gpu.shaderSource(mandelbrotFragment, Gpu.ShaderTarget.GLSL);
match(fragmentStage(whole)) {
  Ok(staged) => { loadFragmentShader(staged) }
}
```

`Gpu.shaderSource` yields Slang's whole-program GLSL: one string with a
`#version 460` header, shared helpers, a fullscreen-triangle vertex `main`,
then the fragment entry as a second `main`. That shape fits WebGPU-style
whole-module loading, not raylib's per-stage `LoadShaderFromMemory(vs, fs)`,
so `glsl_stage.ts` adapts it:

- drops the `#version 460`, `GL_ARB_shader_draw_parameters`,
  `layout(column_major)`, and `#line` header lines,
- excises the vertex `main` (it needs Vulkan-flavored builtins and a 4.6
  context),
- re-targets the remainder at `#version 330`.

The fragment half only needs `gl_FragCoord`, which any vertex stage supplies,
so the example loads it with a `null` vertex source and raylib substitutes
its default vertex shader. The HUD text draws after `endShader`, showing the
shader scoping.

## Current constraints

- Uniform-free shaders only. With uniforms, Slang emits a
  `layout(binding = N)` uniform block, which needs GLSL 420pack — beyond a
  stock 3.3 context. A 4.3+ raylib build (or a UBO rewrite in the adapter)
  would lift this.
- No `null` literal crosses the Workman FFI boundary, and the raylib `Shader`
  struct carries a native pointer with no Workman representation, so shaders
  stay inside `glsl_stage.ts` behind opaque numeric handles. Workman owns the
  shader *source* (a `String` artifact projection); the helper owns loading
  and lifetime.
- `fragmentStage` matches on Slang's pinned emission shape (`void main` +
  `gl_Position` for the vertex stage). A compiler-side per-stage GLSL entry
  would replace the string surgery.

## Files

- `main.wm` — window setup, shader load, frame loop, cleanup. Follows the
  `orbital` example's `Result|...|` frame-batch and `AppError` conventions.
- `glsl_stage.ts` — whole-program GLSL to `#version 330` fragment stage, plus
  the shader-handle registry over the `raylib` bindings.
