import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { analyzeVirtual, compileVirtual, coreVirtual } from "../src/compiler.ts";
import { emitCoreProgram } from "../src/core/emit_js.ts";
import {
  loadDefaultWmslangSlangBackend,
  WmslangBackendError,
  type WmslangSlangBackend,
} from "../src/wmslang/slang_backend.ts";
import { materializeGpuSliceArtifacts } from "../src/wmslang/materialize.ts";
import type { WmslangSliceCompiler } from "../src/wmslang/v2_loader.ts";

Deno.test("bundled Slang compiles the generated Mandelbrot module to whole-program WGSL", async () => {
  const compiled = await coreVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      await acceptanceBlock("static_mandelbrot.wm"),
    ]]),
  );
  const backend = await loadDefaultWmslangSlangBackend();
  const artifact = [...compiled.core.shaderArtifacts.values()][0];
  const hostJavaScript = emitCoreProgram(compiled.core);

  assertEquals(artifact.vertexEntry, "wm_vertex");
  assertEquals(artifact.fragmentEntry, "wm_fragment");
  assertStringIncludes(artifact.wgsl, "@vertex");
  assertStringIncludes(artifact.wgsl, "fn wm_vertex");
  assertStringIncludes(artifact.wgsl, "@fragment");
  assertStringIncludes(artifact.wgsl, "fn wm_fragment");
  assertStringIncludes(artifact.wgsl, "var wm_done_1_0 : bool = false;");
  assertStringIncludes(artifact.wgsl, "if(!wm_done_1_0)");
  assertStringIncludes(artifact.wgsl, "return wm_result_1_0;");
  assertEquals(artifact.wgsl.includes("wm_f_1_0("), true);
  assertEquals((artifact.wgsl.match(/wm_f_1_0\(/g) ?? []).length, 2);
  assertEquals(artifact.wgsl.includes("@group("), false);
  assertEquals(artifact.wgsl.includes("@binding("), false);
  assertEquals(artifact.id.startsWith("wms-v1-"), true);
  assertEquals(artifact.id.length, "wms-v1-".length + 64);
  assertStringIncludes(hostJavaScript, JSON.stringify(artifact.wgsl));
  assertEquals(hostJavaScript.includes('"id":"wms-v1-'), false);
  assertEquals(hostJavaScript.includes("Gpu.color"), false);
  assertEquals(hostJavaScript.includes("escapeIterations"), false);
  assertEquals(hostJavaScript.includes("const Inside"), false);
  assertEquals(hostJavaScript.includes("const Escaped"), false);
  assertEquals(backend.version, "2026.13.1");
});

Deno.test("bundled Slang failures retain generated source and backend diagnostics", async () => {
  const backend = await loadDefaultWmslangSlangBackend();
  const invalid = '[shader("fragment")] float4 nope( : SV_Target {';

  await assertRejects(
    async () => await Promise.resolve(backend.compile(invalid)),
    WmslangBackendError,
    "load generated module",
  );
  try {
    backend.compile(invalid);
  } catch (error) {
    assertEquals(error instanceof WmslangBackendError, true);
    assertEquals((error as WmslangBackendError).slangSource, invalid);
    assertStringIncludes((error as WmslangBackendError).backendDiagnostic, "/wmslang-v1.slang");
  }
});

Deno.test("materialization attributes backend failures to the selector and shader root", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", await acceptanceBlock("flat_color.wm")]]),
  );
  const backendError = new WmslangBackendError(
    "Slang could not load generated module",
    "broken generated source",
    "/wmslang-v2.slang:1: error: expected declaration",
  );
  const compiler = {
    compileGpuSlice: () => ({ diagnostics: [], slangSource: "broken generated source" }),
  } as unknown as WmslangSliceCompiler;
  const backend = {
    compile: () => {
      throw backendError;
    },
  } as unknown as WmslangSlangBackend;

  await assertRejects(
    () => materializeGpuSliceArtifacts(analysis, compiler, backend),
    WmslangBackendError,
    "load generated module",
  );
  const sourceDiagnostic = backendError.sourceDiagnostic!;
  const root = analysis.gpuInput.functions.find((fn) =>
    fn.id === analysis.gpuInput.root.functionId
  )!;
  assertEquals(sourceDiagnostic.diagnostic.code, "gpu.backend.compile");
  assertEquals(sourceDiagnostic.primary.id, analysis.gpuInput.root.selectorSpanId);
  assertEquals(sourceDiagnostic.related, [{
    label: `selected shader root ${root.name}`,
    span: analysis.gpuInput.spans.find((span) => span.id === root.spanId)!,
  }]);
  assertStringIncludes(backendError.message, `selected shader root ${root.name}`);
  assertStringIncludes(backendError.message, "/test/main.wm:");
});

Deno.test("completed fragment accessors execute through the minimal host descriptor", async () => {
  const source = `${await acceptanceBlock("flat_color.wm")}
    let code = Gpu.wgsl(flatFragment);
    let main = () => {
      print(Gpu.vertexEntryPoint(flatFragment));
      print(Gpu.fragmentEntryPoint(flatFragment))
    };
  `;
  const javaScript = await compileVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const directory = await Deno.makeTempDir();
  const path = `${directory}/main.mjs`;
  await Deno.writeTextFile(path, javaScript);
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0);
    assertEquals(new TextDecoder().decode(output.stderr), "");
    assertEquals(new TextDecoder().decode(output.stdout), "wm_vertex\nwm_fragment\n");
    assertEquals(javaScript.includes("flatShade"), false);
    assertEquals(javaScript.includes('"id":"wms-v1-'), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function acceptanceBlock(name: string): Promise<string> {
  const markdown = await Deno.readTextFile(
    new URL("../markdown/wmslang/v1-acceptance.md", import.meta.url),
  );
  const heading = `\`${name}\``;
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`missing acceptance heading containing ${heading}`);
  const fenced = markdown.indexOf("```workman\n", start);
  const end = markdown.indexOf("```", fenced + 11);
  if (fenced < 0 || end < 0) throw new Error(`missing Workman block for ${name}`);
  return markdown.slice(fenced + 11, end);
}
