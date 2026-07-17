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

Deno.test("signed integer uniforms are reflected and packed without float coercion", async () => {
  const source = `
    record Uniforms = { count: Number, offset: (Number, Number) };
    let shade = (uniforms: Uniforms) => {
      (_coord) => {
        @gpu;
        let count = uniforms.count + 1;
        let offset = uniforms.offset + (2, 3);
        let amount = Gpu.f32(count + offset.x) / 255.0;
        (amount, 0.0, 0.0, 1.0)
      }
    };
    let current: Uniforms = .{ count = 41, offset = (5, 7) };
    let fragment = Gpu.fragment(shade(current));
    let main = () => { print(Gpu.uniformBytes(fragment)) };
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
        name: "count",
        declaredIndex: 0,
        representation: "i32",
        offset: 0,
        byteLength: 4,
      },
      {
        name: "offset",
        declaredIndex: 1,
        representation: "i32x2",
        offset: 8,
        byteLength: 8,
      },
    ],
  });
  assertStringIncludes(hostJavaScript, "view.setInt32");

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
      "[41, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 7, 0, 0, 0]\n",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("sampled resources are terminally reflection-checked into artifact layout", async () => {
  const source = `
    record Inputs = {
      resolution: (Number, Number),
      previous: Gpu.SampledTexture2D,
      sampler: Gpu.Sampler
    };
    let shade = (inputs: Inputs) => {
      (coord) => {
        @gpu;
        inputs.previous.Sample(inputs.sampler, coord / inputs.resolution)
      }
    };
    let texture: Gpu.SampledTexture2D = Panic("not evaluated by compilation");
    let sampler: Gpu.Sampler = Panic("not evaluated by compilation");
    let current: Inputs = .{
      resolution = (640.0, 480.0),
      previous = texture,
      sampler = sampler
    };
    let fragment = Gpu.fragment(shade(current));
  `;
  const compiled = await coreVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const artifact = [...compiled.core.shaderArtifacts.values()][0];
  assertEquals(artifact.resourceLayout, {
    recordName: "Inputs",
    group: 0,
    bindings: [
      {
        name: "previous",
        declaredIndex: 1,
        binding: 1,
        kind: "sampled-texture-2d",
      },
      { name: "sampler", declaredIndex: 2, binding: 2, kind: "sampler" },
    ],
  });
  assertEquals(artifact.uniformLayout?.fields.map((field) => field.name), ["resolution"]);
  assertStringIncludes(artifact.wgsl, "@binding(1) @group(0)");
  assertStringIncludes(artifact.wgsl, "@binding(2) @group(0)");
  assertStringIncludes(emitCoreProgram(compiled.core), '"resourceLayout"');
});

Deno.test("compiler-owned texture wrappers validate binding, aliasing, and lifetime", async () => {
  const source = `
    from js.global import unsafe {
      wmFakeDevice: Js.Object,
      wmOtherDevice: Js.Object
    };
    record Inputs = { previous: Gpu.SampledTexture2D, sampler: Gpu.Sampler };
    let shade = (inputs: Inputs) => {
      (coord) => { @gpu; inputs.previous.Sample(inputs.sampler, coord / (4.0, 4.0)) }
    };
    let fragmentFor = (inputs: Inputs) => { Gpu.fragment(shade(inputs)) };
    let main = () => {
      match(Gpu.texture2D(wmFakeDevice, 4, 4)) {
        Err(_) => { print("texture-error") },
        Ok(texture) => {
          match(Gpu.sampledTexture2D(texture)) {
            Err(_) => { print("sampled-error") },
            Ok(sampled) => {
              match(Gpu.renderTarget2D(texture)) {
                Err(_) => { print("target-error") },
                Ok(target) => {
                  match(Gpu.nearestSampler(wmFakeDevice)) {
                    Err(_) => { print("sampler-error") },
                    Ok(sampler) => {
                      match(Gpu.linearSampler(wmFakeDevice)) {
                        Err(_) => { print("linear-sampler-error") },
                        Ok(linearSampler) => {
                          let inputs: Inputs = .{ previous = sampled, sampler = sampler };
                          let linearInputs: Inputs = .{
                            previous = sampled,
                            sampler = linearSampler
                          };
                          let fragment = fragmentFor(inputs);
                          let linearFragment = fragmentFor(linearInputs);
                          print(
                            Gpu.artifactIdentity(fragment) ==
                              Gpu.artifactIdentity(linearFragment)
                          );
                          match(Gpu.bindGroupEntries(fragment, wmFakeDevice, None)) {
                            Err(_) => { print("binding-error") },
                            Ok(_) => { print("bound") }
                          };
                          match(Gpu.bindGroupEntries(fragment, wmOtherDevice, None)) {
                            Err(_) => { print("cross-device") },
                            Ok(_) => { print("cross-device-missed") }
                          };
                          match(Gpu.bindGroupEntries(linearFragment, wmFakeDevice, None)) {
                            Err(_) => { print("linear-binding-error") },
                            Ok(_) => { print("linear-bound") }
                          };
                          match(Gpu.texture2D(wmFakeDevice, 8, 8)) {
                            Err(_) => { print("replacement-error") },
                            Ok(replacement) => {
                              match(Gpu.sampledTexture2D(replacement)) {
                                Err(_) => { print("replacement-view-error") },
                                Ok(replacementSampled) => {
                                  let replacementInputs: Inputs = .{
                                    previous = replacementSampled,
                                    sampler = sampler
                                  };
                                  let replacementFragment = fragmentFor(replacementInputs);
                                  print(
                                    Gpu.artifactIdentity(fragment) ==
                                      Gpu.artifactIdentity(replacementFragment)
                                  );
                                  match(
                                    Gpu.bindGroupEntries(
                                      replacementFragment,
                                      wmFakeDevice,
                                      None
                                    )
                                  ) {
                                    Err(_) => { print("replacement-binding-error") },
                                    Ok(_) => { print("replacement-bound") }
                                  };
                                  match(Gpu.destroyTexture2D(replacement)) {
                                    Err(_) => { print("replacement-destroy-error") },
                                    Ok(_) => { print("replacement-destroyed") }
                                  }
                                }
                              }
                            }
                          };
                          match(Gpu.renderTargetView(target)) {
                            Err(_) => { print("view-error") },
                            Ok(_) => { print("view") }
                          };
                          match(Gpu.validateRenderTarget(fragment, target, wmFakeDevice)) {
                            Err(_) => { print("alias") },
                            Ok(_) => { print("alias-missed") }
                          };
                          match(Gpu.destroyTexture2D(texture)) {
                            Err(_) => { print("destroy-error") },
                            Ok(_) => { print("destroyed") }
                          };
                          match(Gpu.bindGroupEntries(fragment, wmFakeDevice, None)) {
                            Err(_) => { print("dead") },
                            Ok(_) => { print("dead-missed") }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };
  `;
  const javaScript = await compileVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const directory = await Deno.makeTempDir();
  await Deno.writeTextFile(`${directory}/program.mjs`, javaScript);
  await Deno.writeTextFile(
    `${directory}/runner.mjs`,
    `globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2, COPY_DST: 4 };
const rawTexture = () => ({ createView: (descriptor = {}) => ({ descriptor }), destroy() {} });
globalThis.wmFakeDevice = {
  queue: { submit() {} },
  createTexture() { return rawTexture(); },
  createSampler(descriptor) { return { descriptor }; },
  createCommandEncoder() {
    return {
      beginRenderPass() { return { end() {} }; },
      finish() { return {}; },
    };
  },
};
globalThis.wmOtherDevice = { ...globalThis.wmFakeDevice };
await import("./program.mjs");
`,
  );
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", `${directory}/runner.mjs`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0);
    assertEquals(new TextDecoder().decode(output.stderr), "");
    assertEquals(
      new TextDecoder().decode(output.stdout),
      "true\nbound\ncross-device\nlinear-bound\ntrue\nreplacement-bound\nreplacement-destroyed\nview\nalias\ndestroyed\ndead\n",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("multiple fragment roots materialize independently while equal roots deduplicate", async () => {
  const distinctSource = `
    let red = (_coord) => { @gpu; (1.0, 0.0, 0.0, 1.0) };
    let blue = (_coord) => { @gpu; (0.0, 0.0, 1.0, 1.0) };
    let first = Gpu.fragment(red);
    let second = Gpu.fragment(blue);
    let main = () => {
      print(Gpu.artifactIdentity(first) != Gpu.artifactIdentity(second))
    };
  `;
  const distinctFiles = new Map([["/test/distinct.wm", distinctSource]]);
  const distinctAnalysis = await analyzeVirtual("/test/distinct.wm", distinctFiles);
  const distinct = await coreVirtual(
    "/test/distinct.wm",
    distinctFiles,
  );
  assertEquals(distinctAnalysis.gpuSlices.length, 2);
  assertEquals(distinct.core.shaderArtifacts.size, 2);

  const sharedSource = `
    let red = (_coord) => { @gpu; (1.0, 0.0, 0.0, 1.0) };
    let first = Gpu.fragment(red);
    let second = Gpu.fragment(red);
    let main = () => {
      print(Gpu.artifactIdentity(first) == Gpu.artifactIdentity(second))
    };
  `;
  const sharedFiles = new Map([["/test/shared.wm", sharedSource]]);
  const sharedAnalysis = await analyzeVirtual("/test/shared.wm", sharedFiles);
  const shared = await coreVirtual(
    "/test/shared.wm",
    sharedFiles,
  );
  assertEquals(sharedAnalysis.fragmentSelections.selectors.length, 2);
  assertEquals(sharedAnalysis.gpuSlices.length, 1);
  assertEquals(sharedAnalysis.gpuSlices[0].selectors.length, 2);
  assertEquals(shared.core.shaderArtifacts.size, 1);
});

Deno.test("signed integer uniform packing rejects host values outside i32 range", async () => {
  const source = `
    record Uniforms = { count: Number };
    let shade = (uniforms: Uniforms) => {
      (_coord) => {
        @gpu;
        let count = uniforms.count + 1;
        (Gpu.f32(count) / 255.0, 0.0, 0.0, 1.0)
      }
    };
    let current: Uniforms = .{ count = 2147483648 };
    let fragment = Gpu.fragment(shade(current));
    let main = () => { print(Gpu.uniformBytes(fragment)) };
  `;
  const compiled = await coreVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const hostJavaScript = emitCoreProgram(compiled.core);
  const directory = await Deno.makeTempDir();
  const path = `${directory}/main.mjs`;
  await Deno.writeTextFile(path, hostJavaScript);
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code === 0, false);
    assertStringIncludes(
      new TextDecoder().decode(output.stderr),
      "shader environment field count is outside signed i32 range",
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
