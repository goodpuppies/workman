import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import { checkFile, compileFile, coreFile } from "../src/compiler.ts";

Deno.test("SDL window example keeps the complete WebGPU presentation path in Workman", async () => {
  const javaScript = await compileFile(
    fileURLToPath(new URL("../examples/wmslang_window/src/main.wm", import.meta.url)),
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

Deno.test("SDL feedback example compiles explicit resize and texture retirement", async () => {
  const javaScript = await compileFile(
    fileURLToPath(new URL("../examples/wmslang_feedback_window/main.wm", import.meta.url)),
  );

  assertStringIncludes(javaScript, "__wm_gpu_texture_2d");
  assertStringIncludes(javaScript, "__wm_gpu_sampled_texture_2d");
  assertStringIncludes(javaScript, "__wm_gpu_render_target_2d");
  assertStringIncludes(javaScript, "__wm_gpu_destroy_texture_2d");
  assertStringIncludes(javaScript, "__wm_gpu_validate_render_target");
  assertStringIncludes(javaScript, '__wm_js_member("Reflect" + "." + "set")');
  assertStringIncludes(javaScript, "resizeFrame");
  assertStringIncludes(javaScript, "frameLoop");
});

Deno.test("jelly raymarcher port typechecks heterogeneous multi-value shader flow", async () => {
  const results = await checkFile(
    fileURLToPath(new URL("../examples/wmslang_window/src/jelly_shader.wm", import.meta.url)),
  );
  const main = results.get("examples/wmslang_window/src/jelly_shader.wm") ??
    results.get(
      fileURLToPath(new URL("../examples/wmslang_window/src/jelly_shader.wm", import.meta.url)),
    );
  if (!main) throw new Error("missing jelly shader analysis");
  assertEquals(main.warnings, []);
  assertEquals(
    [...main.env.keys()].filter((name) =>
      ["jellyShade", "fragmentForUniforms"].includes(name)
    ).length,
    2,
  );
});

Deno.test("jelly host module drives the imported fragment without GPU-only leakage", async () => {
  const path = fileURLToPath(
    new URL("../examples/wmslang_window/src/jelly_main.wm", import.meta.url),
  );
  const results = await checkFile(path);
  const main = results.get("examples/wmslang_window/src/jelly_main.wm") ??
    results.get(path);
  if (!main) throw new Error("missing jelly host analysis");
  assertEquals(main.warnings, []);
  // Full compile: the fragment selection lives in the shader module while
  // host code lives here. Synthetic per-instance bindings must clear every
  // module's ids, or host functions get misflagged as GPU-only.
  const compiled = await coreFile(path);
  const artifacts = [...compiled.core.shaderArtifacts.values()];
  assertEquals(artifacts.length, 1);
  assertEquals(artifacts[0].vertexEntry, "wm_vertex");
  assertEquals(artifacts[0].fragmentEntry, "wm_fragment");
});
