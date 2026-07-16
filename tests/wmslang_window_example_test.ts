import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileFile } from "../src/compiler.ts";

Deno.test("SDL window example keeps the complete WebGPU presentation path in Workman", async () => {
  const javaScript = await compileFile(
    new URL("../examples/wmslang_window/src/main.wm", import.meta.url).pathname,
  );

  assertStringIncludes(javaScript, '__wm_js_member("navigator" + "." + "gpu")');
  assertStringIncludes(javaScript, "UnsafeWindowSurface_getContext__webgpu");
  assertStringIncludes(javaScript, "GPUDevice_createRenderPipeline");
  assertStringIncludes(javaScript, "__wm_gpu_artifact_identity");
  assertStringIncludes(javaScript, "GPUQueue_writeBuffer");
  assertStringIncludes(javaScript, "GPUCommandEncoder_beginRenderPass");
  assertStringIncludes(javaScript, "UnsafeWindowSurface_present");
  assertStringIncludes(javaScript, "SDL_PollEvent");
  assertStringIncludes(javaScript, "SDL_SetRelativeMouseMode");
  assertStringIncludes(javaScript, "getInt32");
  assertStringIncludes(javaScript, "__wm_bind_shader_artifact");
  assertEquals(javaScript.includes("webgpu_present.ts"), false);
  assertEquals(javaScript.includes("mandelbrotShade"), false);
  assertEquals(javaScript.includes("escapeIterations"), false);
  assertEquals(javaScript.includes("const Inside"), false);
  assertEquals(javaScript.includes("const Escaped"), false);
});
