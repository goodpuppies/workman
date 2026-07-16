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

Deno.test("curried environment is reflection-checked and packed into a bound fragment", async () => {
  const source = `
    record Uniforms = { resolution: (Number, Number), time: Number };
    let shade = (uniforms: Uniforms) => {
      (coord) => {
        @gpu;
        let uv = (coord * 2.0 - uniforms.resolution) / uniforms.resolution.y;
        (uv.x + uniforms.time, uv.y, 0.0, 1.0)
      }
    };
    let fragmentFor = (uniforms: Uniforms) => { Gpu.fragment(shade(uniforms)) };
    let firstUniforms: Uniforms = .{ resolution = (960.0, 640.0), time = 0.5 };
    let secondUniforms: Uniforms = .{ resolution = (960.0, 640.0), time = 1.5 };
    let first = fragmentFor(firstUniforms);
    let second = fragmentFor(secondUniforms);
    let main = () => {
      print(Gpu.uniformBinding(first));
      print(Gpu.uniformByteLength(first));
      print(Gpu.artifactIdentity(first) == Gpu.artifactIdentity(second));
      print(Gpu.wgsl(first) == Gpu.wgsl(second));
      print(Gpu.uniformBytes(first));
      print(Gpu.uniformBytes(second))
    };
  `;
  const compiled = await coreVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const artifact = [...compiled.core.shaderArtifacts.values()][0];
  const hostJavaScript = emitCoreProgram(compiled.core);

  assertEquals(artifact.uniformLayout, {
    recordName: "Uniforms",
    binding: 0,
    byteLength: 16,
    fields: [
      {
        name: "resolution",
        declaredIndex: 0,
        representation: "f32x2",
        offset: 0,
        byteLength: 8,
      },
      {
        name: "time",
        declaredIndex: 1,
        representation: "f32",
        offset: 8,
        byteLength: 4,
      },
    ],
  });
  assertStringIncludes(artifact.wgsl, "@binding(0) @group(0)");
  assertStringIncludes(hostJavaScript, "__wm_bind_shader_artifact");
  assertStringIncludes(hostJavaScript, "view.setFloat32");

  const directory = await Deno.makeTempDir();
  const path = `${directory}/main.mjs`;
  await Deno.writeTextFile(path, hostJavaScript);
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0);
    assertEquals(new TextDecoder().decode(output.stderr), "");
    assertEquals(
      new TextDecoder().decode(output.stdout),
      "0\n16\ntrue\ntrue\n" +
        "[0, 0, 112, 68, 0, 0, 32, 68, 0, 0, 0, 63, 0, 0, 0, 0]\n" +
        "[0, 0, 112, 68, 0, 0, 32, 68, 0, 0, 192, 63, 0, 0, 0, 0]\n",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("artifact identity includes the shader factory and nominal environment schema", async () => {
  const compile = async (path: string, recordName: string, shaderName: string) => {
    const source = `
      record ${recordName} = { time: Number };
      let ${shaderName} = (uniforms: ${recordName}) => {
        (_coord) => { @gpu; (uniforms.time, 0.0, 0.0, 1.0) }
      };
      let current: ${recordName} = .{ time = 1.0 };
      let fragment = Gpu.fragment(${shaderName}(current));
    `;
    const compiled = await coreVirtual(path, new Map([[path, source]]));
    return [...compiled.core.shaderArtifacts.values()][0];
  };

  const first = await compile("/test/first.wm", "FirstUniforms", "firstShade");
  const second = await compile("/test/second.wm", "SecondUniforms", "secondShade");

  assertEquals(first.wgsl, second.wgsl);
  assertEquals(first.uniformLayout?.fields, second.uniformLayout?.fields);
  assertEquals(first.id === second.id, false);
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

Deno.test("materialization attributes normalized/reflected uniform disagreement", async () => {
  const source = `
    record Uniforms = { time: Number };
    let shade = (uniforms: Uniforms) => {
      (_coord) => { @gpu; (uniforms.time, 0.0, 0.0, 1.0) }
    };
    let current: Uniforms = .{ time = 1.0 };
    let fragment = Gpu.fragment(shade(current));
  `;
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const compiler = {
    compileGpuSlice: () => ({
      diagnostics: [],
      slangSource: "generated uniform source",
      shaderTypes: analysis.gpuInput.types.map((type) => ({
        ...type,
        kind: type.kind === "number" ? "f32" : type.kind === "tuple" ? "vector" : type.kind,
      })),
    }),
  } as unknown as WmslangSliceCompiler;
  const backend = {
    compile: () => ({
      wgsl: "generated wgsl",
      vertexEntry: "wm_vertex",
      fragmentEntry: "wm_fragment",
      slangVersion: "test",
      uniformLayout: { binding: 0, byteLength: 16, fields: [] },
    }),
  } as unknown as WmslangSlangBackend;

  await assertRejects(
    () => materializeGpuSliceArtifacts(analysis, compiler, backend),
    WmslangBackendError,
    "Slang reflection disagrees with the normalized shader environment",
  );
  try {
    await materializeGpuSliceArtifacts(analysis, compiler, backend);
  } catch (error) {
    assertEquals(error instanceof WmslangBackendError, true);
    const backendError = error as WmslangBackendError;
    assertEquals(backendError.code, "gpu.backend.reflection");
    assertStringIncludes(
      backendError.backendDiagnostic,
      "missing from normalization or reflection",
    );
    assertEquals(backendError.sourceDiagnostic?.diagnostic.code, "gpu.backend.reflection");
    assertStringIncludes(backendError.message, "selected shader root");
  }
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
