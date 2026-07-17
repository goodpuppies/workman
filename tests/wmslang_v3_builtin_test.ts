import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { analyzeFile, analyzeVirtual, compileLibraryFile } from "../src/compiler.ts";
import {
  WMSLANG_BUILTIN_BLOCKERS,
  WMSLANG_BUILTIN_CATALOG_IDENTITY,
  WMSLANG_BUILTIN_CATALOG_SCHEMA_VERSION,
  WMSLANG_BUILTIN_OVERLOADS,
} from "../src/wmslang/builtin_catalog.generated.ts";
import {
  loadDefaultWmslangSlangBackend,
  WMSLANG_SLANG_VERSION,
  WmslangBackendError,
} from "../src/wmslang/slang_backend.ts";
import { materializeGpuSliceArtifacts } from "../src/wmslang/materialize.ts";
import type { WmslangSlangBackend } from "../src/wmslang/slang_backend.ts";
import {
  loadWmslangSliceCompiler,
  validateGpuSliceElaborationInput,
  type WmslangSliceCompiler,
} from "../src/wmslang/v2_loader.ts";
import { hoverAt } from "../src/lsp/hover.ts";
import { completionAt } from "../src/lsp/completion.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri } from "../src/lsp/validation.ts";

Deno.test("v3 builtin catalog identity is pinned to its Slang-generated source", async () => {
  const source = await Deno.readFile(
    new URL("../research/slang/docs/stdlib-doc.md", import.meta.url),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", source.slice().buffer),
  );
  const sourceSha256 = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  assertEquals(WMSLANG_BUILTIN_CATALOG_IDENTITY, {
    slangVersion: WMSLANG_SLANG_VERSION,
    sourceSha256,
  });
  assertEquals(WMSLANG_BUILTIN_CATALOG_SCHEMA_VERSION, 3);
  assertEquals(
    WMSLANG_BUILTIN_OVERLOADS.map((overload) => overload.id),
    WMSLANG_BUILTIN_OVERLOADS.map((_overload, index) => index),
  );
  for (const name of ["sin", "length", "smoothstep", "frac", "fmod", "dot", "normalize"]) {
    assertEquals(WMSLANG_BUILTIN_OVERLOADS.some((overload) => overload.name === name), true);
  }
  for (const name of ["abs", "clamp", "dot", "max", "min", "sign"]) {
    assertEquals(
      WMSLANG_BUILTIN_OVERLOADS.some((overload) =>
        overload.name === name &&
        [...overload.params, overload.result].every((type) => type.startsWith("i32"))
      ),
      true,
    );
  }
  assertEquals(
    WMSLANG_BUILTIN_OVERLOADS.some((overload) =>
      /\b(out|inout|ref)\b/.test(overload.sourceSignature)
    ),
    false,
  );
});

Deno.test("v3 generated catalog classifies known ineligible Slang declarations", () => {
  const blocker = (name: string) => WMSLANG_BUILTIN_BLOCKERS.find((item) => item.name === name)!;
  assertEquals(blocker("transpose").categories.includes("representation"), true);
  assertEquals(blocker("InterlockedAdd").categories.includes("parameter-mode"), true);
  assertEquals(blocker("InterlockedAdd").categories.includes("effect"), true);
  assertEquals(blocker("ObjectRayDirection").categories.includes("stage"), true);
  assertEquals(blocker("ObjectRayDirection").categories.includes("target-capability"), true);
});

Deno.test("v3 resolves exact Slang builtins through Workman IR and pinned WGSL", async () => {
  const analysis = await builtinAnalysis();
  const compiler = await realSliceCompiler();
  const output = compiler.compileGpuSlice(analysis.gpuInput);

  assertEquals(
    analysis.gpuInput.expressions.filter((expression) => expression.kind === "builtin").map(
      (expression) => expression.builtinName,
    ),
    ["sin", "length", "smoothstep"],
  );
  const irBuiltins = output.irExpressions.filter((expression) => expression.kind === "builtin");
  assertEquals(irBuiltins.map((expression) => expression.builtinName), [
    "sin",
    "length",
    "smoothstep",
  ]);
  assertEquals(irBuiltins.every((expression) => expression.builtinOverloadId >= 0), true);
  assertEquals(
    output.loweredOperations.filter((operation) => operation.kind === "builtin").map((
      operation,
    ) => [operation.builtinName, operation.builtinOverloadId]),
    irBuiltins.map((expression) => [expression.builtinName, expression.builtinOverloadId]),
  );
  assertStringIncludes(output.slangSource, "float2 wm_l_1 = sin(");
  assertStringIncludes(output.slangSource, " = length(");
  assertStringIncludes(output.slangSource, " = smoothstep(");

  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertEquals(artifact.slangVersion, WMSLANG_SLANG_VERSION);
  assertStringIncludes(artifact.wgsl, "@fragment");
});

Deno.test("v3 warped-noise acceptance probe reaches pinned WGSL", async () => {
  const shaderPath = new URL(
    "../examples/wmslang_window/src/warped_noise_shader.wm",
    import.meta.url,
  ).pathname;
  const analysis = await analyzeFile(shaderPath);
  const output = (await realSliceCompiler()).compileGpuSlice(analysis.gpuInput);
  const builtinNames = new Set(
    output.irExpressions
      .filter((expression) => expression.kind === "builtin")
      .map((expression) => expression.builtinName),
  );
  for (
    const name of [
      "floor",
      "fmod",
      "frac",
      "sin",
      "dot",
      "length",
      "max",
      "pow",
      "smoothstep",
      "sqrt",
    ]
  ) {
    assertEquals(builtinNames.has(name), true, `missing emitted ${name} builtin`);
  }
  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertStringIncludes(artifact.wgsl, "@fragment");
});

Deno.test("v3 raymarcher acceptance probe reaches pinned WGSL", async () => {
  const shaderPath = new URL(
    "../examples/wmslang_window/src/raymarch_shader.wm",
    import.meta.url,
  ).pathname;
  const analysis = await analyzeFile(shaderPath);
  const output = (await realSliceCompiler()).compileGpuSlice(analysis.gpuInput);
  const builtinNames = new Set(
    output.irExpressions
      .filter((expression) => expression.kind === "builtin")
      .map((expression) => expression.builtinName),
  );
  for (const name of ["sin", "cos", "clamp", "lerp", "length", "min", "normalize", "smoothstep"]) {
    assertEquals(builtinNames.has(name), true, `missing emitted ${name} builtin`);
  }
  assertEquals(output.irFunctions.some((fn) => fn.name === "march"), true);
  assertEquals(output.program.adts.some((adt) => adt.name === "MarchResult"), true);
  assertEquals(output.shaderTypes.some((type) => type.kind === "i32"), true);
  assertEquals(
    output.irExpressions.some((expression) =>
      expression.kind === "convert" && expression.semanticId === "gpu.f32"
    ),
    true,
  );
  assertStringIncludes(output.slangSource, "int(80)");
  assertStringIncludes(output.slangSource, "int(1)");
  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertStringIncludes(artifact.wgsl, "@fragment");
  assertStringIncludes(artifact.wgsl, "i32");
});

Deno.test("v3 rejects builtin catalog identity or overload drift before elaboration", async () => {
  const input = (await builtinAnalysis()).gpuInput;
  assertThrows(
    () =>
      validateGpuSliceElaborationInput({
        ...input,
        builtinCatalog: {
          ...input.builtinCatalog,
          identity: { ...input.builtinCatalog.identity, slangVersion: "drift" },
        },
      }),
    Error,
    "builtin catalog identity mismatch",
  );
  assertThrows(
    () =>
      validateGpuSliceElaborationInput({
        ...input,
        builtinCatalog: {
          ...input.builtinCatalog,
          identity: {
            ...input.builtinCatalog.identity,
            schemaVersion: input.builtinCatalog.identity.schemaVersion + 1,
          },
        },
      }),
    Error,
    "builtin catalog identity mismatch",
  );
  assertThrows(
    () =>
      validateGpuSliceElaborationInput({
        ...input,
        builtinCatalog: {
          ...input.builtinCatalog,
          overloads: input.builtinCatalog.overloads.slice(1),
        },
      }),
    Error,
    "overloads disagree with the pinned generated catalog",
  );
});

Deno.test("v3 backend drift retains builtin call spans and generated evidence", async () => {
  const analysis = await builtinAnalysis();
  const realCompiler = await realSliceCompiler();
  const realOutput = realCompiler.compileGpuSlice(analysis.gpuInput);
  const brokenSource = `${realOutput.slangSource}\nthis is not Slang;`;
  const compiler = {
    compileGpuSlice: () => ({ ...realOutput, slangSource: brokenSource }),
  } as unknown as WmslangSliceCompiler;
  const backendError = new WmslangBackendError(
    "forced generated builtin drift",
    brokenSource,
    "/wmslang-v1.slang:999: error: forced drift",
  );
  const backend = {
    compile: () => {
      throw backendError;
    },
  } as unknown as WmslangSlangBackend;

  try {
    await materializeGpuSliceArtifacts(analysis, compiler, backend);
    throw new Error("expected forced backend drift");
  } catch (error) {
    assertEquals(error, backendError);
  }
  assertStringIncludes(backendError.backendDiagnostic, "forced drift");
  assertEquals(
    backendError.sourceDiagnostic?.related.some((item) =>
      item.label === "generated Slang builtin sin"
    ),
    true,
  );
});

Deno.test({
  name: "v3 builtin hover uses the Workman-selected overload without Slang or writes",
  permissions: { read: true, write: false, env: true, net: false, run: true, ffi: false },
  async fn() {
    const path = "/test/main.wm";
    const source = `
      let shade = (coord) => {
        @gpu;
        let wave = sin(coord);
        let (x, y) = wave;
        (x, y, 0.0, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const hover = await hoverAt(
      pathToFileUri(path),
      positionOf(source, "sin(coord)"),
      new Map([[path, source]]),
    );
    assertEquals(hover?.contents.value, "```wm\nsin: (f32x2) => f32x2\n```");
  },
});

Deno.test({
  name: "v4 hover lists concrete helper, parameter, and builtin specializations",
  permissions: { read: true, write: false, env: true, net: false, run: true, ffi: false },
  async fn() {
    const path = "/test/multi-hover.wm";
    const source = `
      let shade = (coord) => {
        @gpu;
        let wave = (x) => { sin(x) };
        let scalar = wave(coord.x);
        let vector = wave(coord);
        (scalar, vector.x, vector.y, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const overrides = new Map([[path, source]]);
    const uri = pathToFileUri(path);
    const helper = await hoverAt(uri, positionOf(source, "wave ="), overrides);
    const parameter = await hoverAt(uri, positionOf(source, "x) =>"), overrides);
    const builtin = await hoverAt(uri, positionOf(source, "sin(x)"), overrides);
    assertEquals(
      helper?.contents.value,
      "```wm\nwave\nGPU specializations:\n- (f32) => f32\n- (f32x2) => f32x2\n```",
    );
    assertEquals(
      parameter?.contents.value,
      "```wm\nx\nGPU specializations:\n- f32\n- f32x2\n```",
    );
    assertEquals(
      builtin?.contents.value,
      "```wm\nsin\nGPU specializations:\n- (f32) => f32\n- (f32x2) => f32x2\n```",
    );
  },
});

Deno.test({
  name: "v3 completion is GPU-local, catalog-only, and respects lexical shadowing",
  permissions: { read: true, write: false, env: true, net: false, run: true, ffi: false },
  async fn() {
    const path = "/test/main.wm";
    const source = `
      let hostValue = si;
      let shade = (coord) => {
        @gpu;
        let sin = (value) => { value };
        let hidden = si;
        let visible = smo;
        (coord.x, coord.y, 0.0, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const overrides = new Map([[path, source]]);
    const uri = pathToFileUri(path);
    const host = await completionAt(uri, positionOf(source, "si;"), overrides);
    const hidden = await completionAt(
      uri,
      positionAfter(source, "let hidden = si"),
      overrides,
    );
    const visible = await completionAt(
      uri,
      positionAfter(source, "let visible = smo"),
      overrides,
    );

    assertEquals(host, []);
    assertEquals(hidden.some((item) => item.label === "sin"), false);
    assertEquals(visible.map((item) => item.label), ["smoothstep"]);
    assertStringIncludes(visible[0].detail, "(f32, f32, f32) => f32");
  },
});

Deno.test("v3 lexical helpers shadow Slang builtins inside the GPU island", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `
        let shade = (coord) => {
          @gpu;
          let sin = (value) => { value };
          let wave = sin(coord);
          let (x, y) = wave;
          (x, y, 0.0, 1.0)
        };
        let fragment = Gpu.fragment(shade);
      `,
    ]]),
  );
  assertEquals(
    analysis.gpuInput.expressions.some((expression) => expression.kind === "builtin"),
    false,
  );
  assertEquals(
    analysis.gpuInput.expressions.some((expression) => expression.kind === "call"),
    true,
  );
});

Deno.test("v3 publishes source-local unknown-name and exact-overload diagnostics", async () => {
  const cases = [
    {
      call: "smothstep(0.0, 1.0, coord.x)",
      code: "gpu.builtin.unresolved",
      message: "did you mean Slang builtin smoothstep?",
    },
    {
      call: "length(1.0)",
      code: "gpu.builtin.overload",
      message: "has no exact overload for (f32)",
    },
  ];
  for (const item of cases) {
    const path = `/test/${item.code}.wm`;
    const source = `
      let shade = (coord) => {
        @gpu;
        let value = ${item.call};
        (value, value, value, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const result = await validateUri(
      pathToFileUri(path),
      new Map([[path, source]]),
    );
    assertEquals(result[0].diagnostics[0].code, item.code);
    assertStringIncludes(result[0].diagnostics[0].message, item.message);
  }
});

Deno.test("v3 strict builtin overloads reject widths, Bool, and scalar broadcast", async () => {
  for (
    const call of [
      "dot((1.0, 2.0), (1.0, 2.0, 3.0))",
      "sin(true)",
      "max((1.0, 2.0), 0.0)",
    ]
  ) {
    const path = `/test/strict-${call.slice(0, 3)}-${call.length}.wm`;
    const source = `
      let shade = (coord) => {
        @gpu;
        let rejected = ${call};
        (coord.x, coord.y, 0.0, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const result = await validateUri(pathToFileUri(path), new Map([[path, source]]));
    assertEquals(result[0].diagnostics[0].code, "gpu.builtin.overload");
    assertStringIncludes(result[0].diagnostics[0].message, "has no exact overload");
  }
});

Deno.test("v3 Slang builtin fallback does not leak into host inference", async () => {
  const path = "/test/host.wm";
  const source = "let hostValue = sin(1.0);";
  const result = await validateUri(pathToFileUri(path), new Map([[path, source]]));
  assertEquals(result[0].diagnostics.length, 1);
  assertEquals(String(result[0].diagnostics[0].code).startsWith("gpu.builtin."), false);
  assertStringIncludes(result[0].diagnostics[0].message, "unknown name sin");
});

Deno.test("v3 reports structural reasons for known but ineligible Slang calls", async () => {
  const cases = [
    { call: "transpose(coord)", message: "unsupported type representation" },
    { call: "InterlockedAdd(coord.x, coord.y)", message: "ref/out/inout parameter mode" },
    { call: "GroupMemoryBarrier()", message: "effectful or void operation" },
    { call: "ObjectRayDirection()", message: "fragment shader stage, WGSL target capability" },
  ];
  for (const [index, item] of cases.entries()) {
    const path = `/test/ineligible-${index}.wm`;
    const source = `
      let shade = (coord) => {
        @gpu;
        let value = ${item.call};
        (coord.x, coord.y, 0.0, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const result = await validateUri(pathToFileUri(path), new Map([[path, source]]));
    assertEquals(result[0].diagnostics[0].code, "gpu.builtin.ineligible");
    assertStringIncludes(result[0].diagnostics[0].message, item.message);
  }
});

Deno.test("v3 rejects first-class builtin uses before Slang", async () => {
  const cases = [
    {
      body: "let escaped = sin; (coord.x, coord.y, 0.0, 1.0)",
      code: "gpu.builtin.first-class",
      message: "may only appear as the direct callee",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const path = `/test/builtin-boundary-${index}.wm`;
    const source = `
      let shade = (coord) => {
        @gpu;
        ${item.body}
      };
      let fragment = Gpu.fragment(shade);
    `;
    const result = await validateUri(pathToFileUri(path), new Map([[path, source]]));
    assertEquals(result[0].diagnostics[0].code, item.code);
    assertStringIncludes(result[0].diagnostics[0].message, item.message);
  }
});

Deno.test("v4 GPU annotations check inference but do not provide overload evidence", async () => {
  const helper = (parameter: string) => `
    let shade = (coord) => {
      @gpu;
      let helper = (${parameter}) => { sin(value) };
      let wave = helper(coord);
      (wave.x, wave.y, 0.0, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const inferred = await analyzeVirtual(
    "/test/inferred.wm",
    new Map([["/test/inferred.wm", helper("value")]]),
  );
  const annotated = await analyzeVirtual(
    "/test/annotated.wm",
    new Map([["/test/annotated.wm", helper("value: (Number, Number)")]]),
  );
  assertEquals(
    inferred.gpuInput.expressions.map((expression) => [expression.kind, expression.typeId]),
    annotated.gpuInput.expressions.map((expression) => [expression.kind, expression.typeId]),
  );
  const compiler = await realSliceCompiler();
  const inferredOutput = compiler.compileGpuSlice(inferred.gpuInput);
  const annotatedOutput = compiler.compileGpuSlice(annotated.gpuInput);
  assertEquals(
    inferred.gpuInput.functions.map((fn) => fn.name),
    annotated.gpuInput.functions.map((fn) => fn.name),
  );
  assertEquals(
    inferredOutput.loweredOperations.map((operation) => [
      operation.kind,
      operation.operatorId,
      operation.builtinName,
      operation.builtinOverloadId,
    ]),
    annotatedOutput.loweredOperations.map((operation) => [
      operation.kind,
      operation.operatorId,
      operation.builtinName,
      operation.builtinOverloadId,
    ]),
  );
  assertEquals(inferredOutput.slangSource, annotatedOutput.slangSource);

  const wrongPath = "/test/wrong-annotation.wm";
  const wrong = await validateUri(
    pathToFileUri(wrongPath),
    new Map([[wrongPath, helper("value: Bool")]]),
  );
  assertEquals(wrong[0].diagnostics[0].code, "type.mismatch");
});

Deno.test("v4 annotations cannot rescue an unanchored reachable specialization", async () => {
  const program = (parameter: string) => `
    let shade = (coord) => {
      @gpu;
      let rec loop = (${parameter}) => { loop(x) };
      let ignored = loop(coord.x);
      (coord.x, coord.y, 0.0, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  for (
    const [path, parameter] of [
      ["/test/unanchored-erased.wm", "x"],
      ["/test/unanchored-annotated.wm", "x: Number"],
    ] as const
  ) {
    const result = await validateUri(pathToFileUri(path), new Map([[path, program(parameter)]]));
    const diagnostic = result[0].diagnostics[0];
    assertEquals(diagnostic.code, "gpu.type.unsupported");
    assertStringIncludes(diagnostic.message, "loop<Number> has unresolved result");
    assertEquals(diagnostic.message.toLowerCase().includes("annotation"), false);
  }
});

Deno.test("v4 shader factory environment comes from value flow, not its annotation", async () => {
  const program = (annotation: string) => `
    record Uniforms = { resolution: (Number, Number), time: Number };
    let shade = (uniforms${annotation}) => {
      (coord) => {
        @gpu;
        let uv = coord / uniforms.resolution;
        (uv.x, uv.y, uniforms.time, 1.0)
      }
    };
    let uniforms: Uniforms = .{ resolution = (640.0, 480.0), time = 0.5 };
    let fragment = Gpu.fragment(shade(uniforms));
  `;
  const annotated = await analyzeVirtual(
    "/test/factory-annotated.wm",
    new Map([["/test/factory-annotated.wm", program(": Uniforms")]]),
  );
  const erased = await analyzeVirtual(
    "/test/factory-erased.wm",
    new Map([["/test/factory-erased.wm", program("")]]),
  );
  assertEquals(annotated.gpuInput.environments[0].name, "Uniforms");
  assertEquals(erased.gpuInput.environments[0].name, "Uniforms");
  const compiler = await realSliceCompiler();
  assertEquals(
    compiler.compileGpuSlice(annotated.gpuInput).slangSource,
    compiler.compileGpuSlice(erased.gpuInput).slangSource,
  );
});

Deno.test("v4 specializes one HM helper independently at two vector widths", async () => {
  const source = `
    let shade = (coord) => {
      @gpu;
      let twice = (x) => { x + x };
      let vector2 = twice(coord);
      let vector3 = twice((coord.x, coord.y, 0.5));
      (vector2.x, vector2.y, vector3.z, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const analysis = await analyzeVirtual(
    "/test/multi-shape.wm",
    new Map([["/test/multi-shape.wm", source]]),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(analysis.gpuInput);
  assertEquals(output.irFunctions.map((fn) => fn.name), [
    "shade",
    "twice__Number_Number",
    "twice__Number_Number_Number",
  ]);
  const addOperations = output.loweredOperations.filter((operation) =>
    operation.operatorId === "gpu.operator.add"
  );
  assertEquals(addOperations.length, 2);
  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertStringIncludes(artifact.wgsl, "@fragment");
});

Deno.test("v4 does not emit an unused polymorphic GPU-local helper", async () => {
  const path = "/test/unused-helper.wm";
  const source = `
    let shade = (coord) => {
      @gpu;
      let unused = (x) => { floor(x + 1.0) };
      (coord.x, coord.y, 0.0, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const analysis = await analyzeVirtual(path, new Map([[path, source]]));
  assertEquals(analysis.gpuInput.functions.map((fn) => fn.name), ["shade"]);
  assertEquals(
    analysis.gpuInput.expressions.some((expression) => expression.kind === "builtin"),
    false,
  );
});

Deno.test("v4 preregisters independent monomorphic recursive specializations", async () => {
  const source = `
    let shade = (coord) => {
      @gpu;
      let rec process = (x, remaining) => {
        if (remaining <= 0) { x }
        else { process(x + x, remaining - 1) }
      };
      let scalar = process(coord.x, 2);
      let vector = process(coord, 2);
      (scalar, vector.x, vector.y, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const analysis = await analyzeVirtual(
    "/test/recursive-shapes.wm",
    new Map([["/test/recursive-shapes.wm", source]]),
  );
  assertEquals(analysis.gpuInput.recursionGroups.map((group) => group.memberFunctionIds.length), [
    1,
    1,
  ]);
  const output = (await realSliceCompiler()).compileGpuSlice(analysis.gpuInput);
  assertEquals(output.irFunctions.filter((fn) => fn.name.startsWith("process__")).length, 2);
  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertStringIncludes(artifact.wgsl, "@fragment");
});

Deno.test("v4 eliminates a statically known higher-order function argument", async () => {
  const source = `
    let shade = (coord) => {
      @gpu;
      let apply = (f, x) => { f(x) };
      let double = (x) => { x * 2.0 };
      let value = apply(double, coord.x);
      (value, coord.x, coord.y, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const analysis = await analyzeVirtual(
    "/test/higher-order.wm",
    new Map([["/test/higher-order.wm", source]]),
  );
  const apply = analysis.gpuInput.functions.find((fn) => fn.name === "apply");
  assertEquals(apply?.paramIds.length, 1);
  const output = (await realSliceCompiler()).compileGpuSlice(analysis.gpuInput);
  assertEquals(output.irFunctions.map((fn) => fn.name), ["shade", "apply", "double"]);
  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertStringIncludes(artifact.wgsl, "@fragment");
});

Deno.test("v4 keys higher-order specializations by static function identity", async () => {
  const path = "/test/higher-order-identities.wm";
  const source = `
    let shade = (coord) => {
      @gpu;
      let apply = (f, x) => { f(x) };
      let double = (x) => { x * 2.0 };
      let triple = (x) => { x * 3.0 };
      let first = apply(double, coord.x);
      let second = apply(triple, coord.y);
      (first, second, coord.x, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const analysis = await analyzeVirtual(path, new Map([[path, source]]));
  const applyFunctions = analysis.gpuInput.functions.filter((fn) => fn.name.startsWith("apply__"));
  assertEquals(applyFunctions.length, 2);
  assertEquals(new Set(applyFunctions.map((fn) => fn.name)).size, 2);
  const output = (await realSliceCompiler()).compileGpuSlice(analysis.gpuInput);
  assertEquals(output.irFunctions.filter((fn) => fn.name.startsWith("apply__")).length, 2);
  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertStringIncludes(artifact.wgsl, "@fragment");
});

Deno.test("v4 eliminates a noncapturing inline lambda passed through a helper", async () => {
  const source = `
    let shade = (coord) => {
      @gpu;
      let apply = (f, x) => { f(x) };
      let value = apply((x) => { sin(x) }, coord.x);
      (value, coord.x, coord.y, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const analysis = await analyzeVirtual(
    "/test/inline-higher-order.wm",
    new Map([["/test/inline-higher-order.wm", source]]),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(analysis.gpuInput);
  assertEquals(output.irFunctions.map((fn) => fn.name), ["shade", "lambda", "apply"]);
  const artifact = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertStringIncludes(artifact.wgsl, "@fragment");
});

Deno.test("v4 rejects returned, stored, and dynamically selected functions before shader IR", async () => {
  const cases = [
    {
      path: "/test/returned-function.wm",
      body: `
        let maker = () => { (x) => { x * 2.0 } };
        let escaped = maker();
      `,
      message: "returns a function value",
    },
    {
      path: "/test/dynamic-function.wm",
      body: `
        let apply = (f, x) => { f(x) };
        let double = (x) => { x * 2.0 };
        let triple = (x) => { x * 3.0 };
        let chosen = if (coord.x > 0.0) { double } else { triple };
        let escaped = apply(chosen, coord.x);
      `,
      message: "runtime function value",
    },
    {
      path: "/test/stored-function.wm",
      prefix: "record Holder = { function: (Number) => Number };",
      body: `
        let double = (x) => { x * 2.0 };
        let held: Holder = .{ function = double };
      `,
      message: "may not be stored in records",
    },
  ];
  for (const item of cases) {
    const source = `
      ${"prefix" in item ? item.prefix : ""}
      let shade = (coord) => {
        @gpu;
        ${item.body}
        (coord.x, coord.y, 0.0, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const result = await validateUri(
      pathToFileUri(item.path),
      new Map([[item.path, source]]),
    );
    assertEquals(result[0].diagnostics[0].code, "gpu.function.unsupported");
    assertStringIncludes(result[0].diagnostics[0].message, item.message);
  }
});

Deno.test("v4 failed specialization reports the generic operation and concrete call path", async () => {
  const path = "/test/invalid-specialization.wm";
  const source = `
    record Box = { value: Number };
    let shade = (coord) => {
      @gpu;
      let helper = (x) => { floor(x) };
      let boxed: Box = .{ value = coord.x };
      let bad = helper(boxed);
      (coord.x, coord.y, 0.0, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `;
  const result = await validateUri(pathToFileUri(path), new Map([[path, source]]));
  assertEquals(result[0].diagnostics[0].code, "gpu.operation.overload");
  assertStringIncludes(result[0].diagnostics[0].message, "floor has no shader row for Box");
  assertStringIncludes(result[0].diagnostics[0].message, "shade -> helper");
});

async function builtinAnalysis() {
  return await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `
        let shade = (coord) => {
          @gpu;
          let wave = sin(coord);
          let radius = length(wave);
          let eased = smoothstep(0.0, 1.0, radius);
          let (x, y) = wave;
          (eased, x, y, 1.0)
        };
        let fragment = Gpu.fragment(shade);
      `,
    ]]),
  );
}

let compilerPromise: Promise<WmslangSliceCompiler> | undefined;

async function realSliceCompiler(): Promise<WmslangSliceCompiler> {
  return await (compilerPromise ??= (async () => {
    const source = await compileLibraryFile(
      new URL("../tooling/wmslang/compiler.wm", import.meta.url).pathname,
    );
    return await loadWmslangSliceCompiler(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}#${crypto.randomUUID()}`,
    );
  })());
}

function positionOf(source: string, text: string): { line: number; character: number } {
  const offset = source.indexOf(text);
  if (offset < 0) throw new Error(`missing ${text}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

function positionAfter(source: string, text: string): { line: number; character: number } {
  const position = positionOf(source, text);
  return { line: position.line, character: position.character + text.length };
}
