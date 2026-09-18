import * as Raylib from "raylib";

type Shader = ReturnType<typeof Raylib.H.LoadShaderFromMemory>;

// wmslang emits one whole-program GLSL string: a `#version 460` header, shared
// helpers, a fullscreen-triangle vertex `main`, then the fragment entry as a
// second `main`. Desktop raylib drives an OpenGL 3.3 context and loads shaders
// per stage, so the vertex half cannot be used as-is: it needs Vulkan-flavored
// builtins (`gl_VertexIndex`, `GL_ARB_shader_draw_parameters`) and a 4.6
// context. The fragment half only needs `gl_FragCoord`, which any vertex stage
// supplies, so this adapter keeps everything from the shared helpers onward,
// drops the 460-only header lines, and re-targets the fragment at `#version
// 330`. raylib substitutes its own default vertex shader when the vertex
// source is null (see `loadFragmentShader`).
export function fragmentStage(source: string): string {
  const kept: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("#version") ||
      trimmed.startsWith("#extension") ||
      trimmed.startsWith("#line") ||
      trimmed === "layout(column_major) uniform;" ||
      trimmed === "layout(column_major) buffer;"
    ) {
      continue;
    }
    kept.push(line);
  }
  const mainStart = kept.findIndex((line) => line.trim() === "void main()");
  const anchor = kept.findIndex((line) => line.includes("gl_Position"));
  if (mainStart === -1 || anchor === -1 || anchor < mainStart) {
    throw new Error("wmslang GLSL has no fullscreen-triangle vertex main to remove");
  }
  let mainClose = -1;
  for (let index = anchor; index < kept.length; index += 1) {
    if (kept[index].trim() === "}") {
      mainClose = index;
      break;
    }
  }
  if (mainClose === -1) {
    throw new Error("wmslang GLSL vertex main never closes");
  }
  kept.splice(mainStart, mainClose - mainStart + 1);
  return ["#version 330", ...kept].join("\n");
}

// The raylib `Shader` struct carries a native uniform-location pointer, which
// has no Workman value representation. Shaders therefore stay on this side of
// the FFI boundary and Workman holds an opaque numeric handle. `null` selects
// raylib's default vertex shader; only the wmslang fragment stage is loaded.
const shaders = new Map<number, Shader>();
let nextHandle = 1;

export function loadFragmentShader(fsCode: string): number {
  const shader = Raylib.H.LoadShaderFromMemory(null, fsCode);
  if (!Raylib.H.IsShaderValid(shader)) {
    throw new Error("raylib rejected the wmslang fragment shader");
  }
  const handle = nextHandle;
  nextHandle += 1;
  shaders.set(handle, shader);
  return handle;
}

export function beginShader(handle: number): void {
  const shader = shaders.get(handle);
  if (!shader) throw new Error(`unknown shader handle ${handle}`);
  Raylib.H.BeginShaderMode(shader);
}

export function endShader(): void {
  Raylib.H.EndShaderMode();
}

export function unloadShader(handle: number): void {
  const shader = shaders.get(handle);
  if (!shader) throw new Error(`unknown shader handle ${handle}`);
  shaders.delete(handle);
  Raylib.H.UnloadShader(shader);
}
