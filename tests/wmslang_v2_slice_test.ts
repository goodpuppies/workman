import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { analyzeVirtual, compileLibraryFile } from "../src/compiler.ts";
import {
  loadWmslangSliceCompiler,
  validateGpuSliceCompilationOutput,
  validateGpuSliceElaborationInput,
  WmslangNumericDiagnosticError,
} from "../src/wmslang/v2_loader.ts";
import {
  GpuSliceNormalizationError,
  normalizeGpuSliceProgram,
} from "../src/wmslang/v2_normalize.ts";
import { WmslangSemanticError } from "../src/wmslang/materialize.ts";
import { loadDefaultWmslangSlangBackend } from "../src/wmslang/slang_backend.ts";
import { GPU_SLICE_SCHEMA_VERSION } from "../src/wmslang/v2_dto.ts";
import {
  WMSLANG_BUILTIN_CATALOG_IDENTITY,
  WMSLANG_BUILTIN_CATALOG_SCHEMA_VERSION,
  WMSLANG_BUILTIN_OVERLOADS,
} from "../src/wmslang/builtin_catalog.generated.ts";

Deno.test("schema v2 normalizes the static Mandelbrot vertical slice", async () => {
  const source = await acceptanceBlock("static_mandelbrot.wm");
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const input = normalizeGpuSliceProgram(analysis);
  validateGpuSliceElaborationInput(input);

  assertEquals(input.schemaVersion, GPU_SLICE_SCHEMA_VERSION);
  assertEquals(input.builtinCatalog.identity, {
    schemaVersion: WMSLANG_BUILTIN_CATALOG_SCHEMA_VERSION,
    ...WMSLANG_BUILTIN_CATALOG_IDENTITY,
  });
  assertEquals(input.builtinCatalog.overloads, WMSLANG_BUILTIN_OVERLOADS);
  assertEquals(input.sourcePath, "/test/main.wm");
  assertEquals(input.root.functionId, 0);
  assertEquals(input.functions.map((fn) => fn.name), [
    "mandelbrotShade",
    "escapeIterations",
  ]);
  assertEquals(input.functions.map((fn) => fn.bindingId >= 0), [true, true]);
  assertEquals(input.functions.map((fn) => fn.recursionGroupId >= 0), [false, true]);

  assertEquals(input.adts.map((adt) => adt.name), ["Escape"]);
  assertEquals(
    input.constructors.map((ctor) => ({
      name: ctor.name,
      tag: ctor.tag,
      payload: ctor.payloadTypeId,
    })),
    [
      { name: "Inside", tag: 0, payload: -1 },
      { name: "Escaped", tag: 1, payload: 0 },
    ],
  );
  assertEquals(input.types[0].kind, "number");
  assertEquals(input.types.some((type) => type.kind === "adt"), true);
  assertEquals(input.types.some((type) => type.kind === "tuple"), true);
  assertEquals(
    input.types.some((type) =>
      !new Set([
        "number",
        "bool",
        "void",
        "tuple",
        "function",
        "adt",
      ]).has(type.kind)
    ),
    false,
  );

  assertEquals(
    new Set(input.expressions.map((expr) => expr.kind)),
    new Set([
      "number",
      "var",
      "tuple",
      "call",
      "constructor",
      "if",
      "match",
      "block",
      "binary",
    ]),
  );
  assertEquals(input.expressions.every((expr) => expr.semanticId === ""), true);
  assertEquals(
    input.expressions.every((expr) =>
      expr.operatorId === "" || expr.operatorId.startsWith("gpu.operator.")
    ),
    true,
  );

  assertEquals(input.recursionGroups.length, 1);
  assertEquals(input.recursionGroups[0].memberFunctionIds, [1]);
  assertEquals(
    input.recursiveReferences.map((reference) => reference.relation),
    ["external", "self"],
  );
  assertEquals(
    input.recursiveReferences.every((reference) => reference.invocation === "call"),
    true,
  );

  assertEquals(
    input.patterns.some((pattern) => pattern.context === "parameter" && pattern.kind === "binding"),
    true,
  );
  assertEquals(
    input.patterns.some((pattern) => pattern.context === "let" && pattern.kind === "tuple"),
    true,
  );
  assertEquals(
    input.patterns.filter((pattern) =>
      pattern.context === "match" && pattern.kind === "constructor"
    ).length,
    2,
  );
  assertEquals(input.matches.length, 1);
  assertEquals(input.matches[0].armIds.length, 2);
});

Deno.test("schema v2 enforces lexical GPU helper ownership", async () => {
  await assertRejects(
    () =>
      analysisFor(`
      let make = (hostValue) => {
        Gpu.fragment((_coord) => { @gpu; Gpu.color((hostValue, 0.0, 0.0, 1.0)) })
      };
    `),
    GpuSliceNormalizationError,
    "receive hostValue as a parameter",
  );

  await assertRejects(
    () =>
      analysisFor(`
        let hostHelper = (value) => { @gpu; value * value };
        let shade = (coord) => {
          @gpu;
          let (x, _y) = coord;
          (hostHelper(x), 0.0, 0.0, 1.0)
        };
        let fragment = Gpu.fragment(shade);
      `),
    GpuSliceNormalizationError,
    "outside the selected lexical GPU island",
  );

  await assertRejects(
    () =>
      analysisFor(`
        let shade = (coord) => {
          @gpu;
          let (x, _y) = coord;
          let localHelper = (value) => { value + x };
          (localHelper(1.0), 0.0, 0.0, 1.0)
        };
        let fragment = Gpu.fragment(shade);
      `),
    GpuSliceNormalizationError,
    "receive x as a parameter",
  );

  await assertRejects(
    () =>
      analysisFor(`
        let shade = (coord) => {
          @gpu;
          let localHelper = (value) => { value };
          let escaped = localHelper;
          let (x, _y) = coord;
          (x, 0.0, 0.0, 1.0)
        };
        let fragment = Gpu.fragment(shade);
      `),
    GpuSliceNormalizationError,
    "may not escape as values",
  );

  const multiple = await analysisFor(`
      let a = (coord) => { @gpu; Gpu.color((0.0, 0.0, 0.0, 1.0)) };
      let b = (coord) => { @gpu; Gpu.color((1.0, 1.0, 1.0, 1.0)) };
      let first = Gpu.fragment(a);
      let second = Gpu.fragment(b);
    `);
  assertEquals(multiple.gpuSlices.length, 2);

  const virtualFs = new Map([
    ["/test/helper.wm", `let shadePart = (x) => { x * x };`],
    [
      "/test/main.wm",
      `
        from "./helper.wm" import { shadePart };
        let shade = (coord) => {
          @gpu;
          let (x, _y) = coord;
          Gpu.color((shadePart(x), 0.0, 0.0, 1.0))
        };
        let fragment = Gpu.fragment(shade);
      `,
    ],
  ]);
  await assertRejects(
    () => analyzeVirtual("/test/main.wm", virtualFs),
    GpuSliceNormalizationError,
    "first-order helper declared inside",
  );
});

Deno.test("schema v2 loader rejects dangling semantic references", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
    let shade = (_coord) => { @gpu; Gpu.color((1.0, 0.0, 0.0, 1.0)) };
    let fragment = Gpu.fragment(shade);
  `),
  );
  validateGpuSliceElaborationInput(input);

  assertThrows(
    () =>
      validateGpuSliceElaborationInput({
        ...input,
        root: { ...input.root, functionId: 999 },
      }),
    Error,
    "references missing id 999",
  );
  assertThrows(
    () =>
      validateGpuSliceElaborationInput({
        ...input,
        expressions: input.expressions.map((expression, index) =>
          index === 0 ? { ...expression, typeId: 999 } : expression
        ),
      }),
    Error,
    "references missing id 999",
  );
  assertThrows(
    () =>
      validateGpuSliceElaborationInput({
        ...input,
        types: input.types.map((type, index) => index === 0 ? { ...type, kind: "f32" } : type),
      }),
    Error,
    "semantic type kind",
  );
});

Deno.test("schema v2 round-trips through the real Workman wmslang ABI", async () => {
  const input = normalizeGpuSliceProgram(
    await analyzeVirtual(
      "/test/main.wm",
      new Map([["/test/main.wm", await acceptanceBlock("static_mandelbrot.wm")]]),
    ),
  );
  const compilerSource = await compileLibraryFile(
    new URL("../tooling/wmslang/compiler.wm", import.meta.url).pathname,
  );
  const compiler = await loadGeneratedSliceCompiler(compilerSource);

  const typeOutput = compiler.elaborateGpuSliceTypes(input);
  const output = compiler.compileGpuSlice(input);

  assertEquals(output.schemaVersion, GPU_SLICE_SCHEMA_VERSION);
  assertEquals(output.program, input);
  assertEquals(typeOutput.shaderTypes, output.shaderTypes);
  assertEquals("slangSource" in typeOutput, false);
  assertEquals(typeOutput.typeEvidence, output.typeEvidence);
  assertEquals(typeOutput.occurrences, output.occurrences);
  assertEquals(
    typeOutput.occurrences.length,
    input.expressions.length + input.patterns.length + input.functions.length,
  );
  assertEquals(output.program.types.some((type) => type.kind === "number"), true);
  assertEquals(output.shaderTypes.some((type) => type.kind === "f32"), true);
  assertEquals(output.shaderTypes.some((type) => type.kind === "vector"), true);
  assertEquals(output.typeEvidence.length, input.types.length);
  assertEquals(output.diagnostics, []);
  const semanticTypesById = new Map(input.types.map((type) => [type.id, type]));
  const numericSemanticType = (typeId: number) => {
    const type = semanticTypesById.get(typeId);
    return type?.kind === "number" ||
      (type?.kind === "tuple" && type.items.length >= 2 && type.items.length <= 4 &&
        type.items.every((item) => semanticTypesById.get(item)?.kind === "number"));
  };
  assertEquals(
    output.occurrences.filter((occurrence) =>
      occurrence.kind !== "function" && numericSemanticType(occurrence.typeId) &&
      occurrence.representation === ""
    ),
    [],
  );
  assertEquals(output.irFunctions.map((fn) => fn.name), [
    "mandelbrotShade",
    "escapeIterations",
  ]);
  assertEquals(
    new Set<string>(output.irExpressions.map((expression) => expression.kind)).has("block"),
    false,
  );
  assertEquals(output.irExpressions.some((expression) => expression.kind === "let"), true);
  assertEquals(output.irExpressions.some((expression) => expression.kind === "match"), true);
  const tailCall = output.irExpressions.find((expression) => expression.kind === "tail-call")!;
  const sourceTailCall = input.expressions.find((expression) =>
    expression.id === tailCall.sourceExprId
  )!;
  const irById = new Map(output.irExpressions.map((expression) => [expression.id, expression]));
  assertEquals(
    tailCall.children.map((id) => irById.get(id)!.sourceExprId),
    sourceTailCall.children,
  );
  assertEquals(tailCall.targetFunctionId, tailCall.functionId);
  assertEquals(output.irMatchArms.length, 2);
  assertEquals(
    output.irMatchArms.map((arm) => arm.sourceArmId),
    input.matchArms.map((arm) => arm.id),
  );
  assertEquals(output.adtLayouts, [{
    id: 0,
    typeId: input.types.find((type) => type.kind === "adt")!.id,
    typeNameId: input.adts[0].typeNameId,
    fieldIds: [0],
    spanId: input.adts[0].spanId,
  }]);
  assertEquals(
    output.adtFields.map((field) => ({
      constructorId: field.constructorId,
      tag: field.tag,
      typeId: field.typeId,
    })),
    [{ constructorId: input.constructors[1].id, tag: 1, typeId: 0 }],
  );

  const recursiveFunction = output.loweredFunctions.find((fn) => fn.recursive)!;
  assertEquals(output.loweredFunctions.map((fn) => fn.functionId), [0, 1]);
  assertEquals(recursiveFunction.functionId, 1);
  assertEquals(recursiveFunction.physicalParamLocalIds.length, 5);
  assertEquals(recursiveFunction.loopParamLocalIds.length, 5);
  assertEquals(
    output.loweredLocals.filter((local) => local.mutable).map((local) => local.kind),
    [
      "join",
      "loop-parameter",
      "loop-parameter",
      "loop-parameter",
      "loop-parameter",
      "loop-parameter",
    ],
  );
  assertEquals(
    output.loweredOperations.some((operation) =>
      operation.kind === "call" && operation.targetFunctionId === operation.functionId
    ),
    false,
  );
  assertEquals(output.loweredStatements.filter((statement) => statement.kind === "loop").length, 1);

  const tailContinue = output.loweredStatements.find((statement) => statement.kind === "continue")!;
  assertEquals(tailContinue.targetLocalIds, recursiveFunction.loopParamLocalIds);
  const loweredAtoms = new Map(output.loweredAtoms.map((atom) => [atom.id, atom]));
  const loweredLocals = new Map(output.loweredLocals.map((local) => [local.id, local]));
  assertEquals(
    tailContinue.valueAtomIds.map((atomId) =>
      loweredLocals.get(loweredAtoms.get(atomId)!.localId)!.kind
    ),
    ["tail-next", "tail-next", "tail-next", "tail-next", "tail-next"],
  );
  const continueBlock = output.loweredBlocks.find((block) =>
    block.statementIds.includes(tailContinue.id)
  )!;
  const statementsById = new Map(
    output.loweredStatements.map((statement) => [statement.id, statement]),
  );
  assertEquals(
    continueBlock.statementIds.slice(-6).map((id) => {
      const statement = statementsById.get(id)!;
      return statement.kind === "let" ? statement.reason : statement.kind;
    }),
    ["tail-next", "tail-next", "tail-next", "tail-next", "tail-next", "continue"],
  );

  const loweredSwitch = output.loweredStatements.find((statement) => statement.kind === "switch")!;
  const loweredCases = new Map(output.loweredCases.map((gpuCase) => [gpuCase.id, gpuCase]));
  assertEquals(loweredSwitch.layoutId, 0);
  assertEquals(loweredSwitch.caseIds.map((id) => loweredCases.get(id)!.tag), [0, 1]);
  assertEquals(
    output.loweredOperations.filter((operation) => operation.kind === "payload").map((
      operation,
    ) => ({
      constructorId: operation.constructorId,
      layoutId: operation.layoutId,
      fieldId: operation.fieldId,
    })),
    [{ constructorId: input.constructors[1].id, layoutId: 0, fieldId: 0 }],
  );
  assertEquals(
    output.loweredOperations.filter((operation) => operation.kind === "construct").map((
      operation,
    ) => operation.layoutId),
    [0, 0],
  );
  assertEquals(output.slangSource.includes("struct wm_adt_0"), true);
  assertEquals(output.slangSource.includes("switch (wm_l_13.tag)"), true);
  assertEquals(output.slangSource.includes("wm_l_13.wm_p_0"), true);
  assertEquals(output.slangSource.includes("bool wm_done_1 = false;"), true);
  assertEquals(output.slangSource.includes("while (!wm_done_1)"), true);
  assertEquals(output.slangSource.includes("wm_result_1 ="), true);
  assertEquals(output.slangSource.includes("wm_done_1 = true;"), true);
  assertEquals(output.slangSource.includes("return wm_result_1;"), true);
  assertEquals(output.slangSource.includes('[shader("vertex")]'), true);
  assertEquals(output.slangSource.includes('[shader("fragment")]'), true);
  assertEquals(output.slangSource.includes("wm_vertex"), true);
  assertEquals(output.slangSource.includes("wm_fragment"), true);
  assertEquals(
    ["ConstantBuffer", "Texture", "Sampler", "RWStructuredBuffer", "vk::binding"].some((token) =>
      output.slangSource.includes(token)
    ),
    false,
  );
  assertEquals((output.slangSource.match(/wm_f_1\(/g) ?? []).length, 2);
});

Deno.test("schema v2 emits the deterministic flat-color Slang golden", async () => {
  const input = normalizeGpuSliceProgram(
    await analyzeVirtual(
      "/test/main.wm",
      new Map([[
        "/test/main.wm",
        await acceptanceBlock("flat_color.wm"),
      ]]),
    ),
  );
  const compiler = await realSliceCompiler();
  const output = compiler.compileGpuSlice(input);
  const golden = await Deno.readTextFile(
    new URL("./goldens/wmslang_flat_color.slang", import.meta.url),
  );

  assertEquals(output.slangSource, golden);
  assertEquals(compiler.compileGpuSlice(input).slangSource, golden);
});

Deno.test("schema v2 lowers GLML-style vector arithmetic and scalar broadcasts", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (uv) => {
        @gpu;
        let resolution = (1280.0, 720.0);
        let centered = (uv * 2.0 - resolution) / resolution.y;
        let reverse = (2.0 * uv) / resolution.y;
        let (x, y) = centered + reverse;
        (x / 1280.0, y / 720.0, 0.0, 1.0)
      };

      let fragment = Gpu.fragment(shade);
    `),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(input);

  assertEquals(output.diagnostics, []);
  const shaderTypesById = new Map(output.shaderTypes.map((type) => [type.id, type]));
  assertEquals(
    output.shaderTypes
      .filter((type) =>
        type.kind === "vector" &&
        type.items.every((item) => shaderTypesById.get(item)?.kind === "f32")
      )
      .map((type) => type.items.length),
    [
      2,
      4,
    ],
  );
  assertEquals(input.expressions.some((expression) => expression.kind === "copy"), false);
  assertEquals(input.expressions.filter((expression) => expression.kind === "project").length, 2);
  assertEquals(output.slangSource.includes("float2 wm_f_0"), false);
  assertEquals(output.slangSource.includes("float4 wm_f_0(float2"), true);
  assertEquals(output.slangSource.includes(" * float(2)"), true);
  assertEquals(output.slangSource.includes("float(2) * "), true);
  assertEquals(output.slangSource.includes(" - "), true);
  assertEquals(output.slangSource.includes(".x"), true);
  assertEquals(output.slangSource.includes(".y"), true);
  assertEquals(output.slangSource.includes("wm_tuple_"), false);
  const binaryOperations = output.loweredOperations.filter((operation) =>
    operation.kind === "binary"
  );
  assertEquals(
    binaryOperations.filter((operation) => operation.operatorId === "gpu.operator.multiply").length,
    2,
  );
  assertEquals(
    binaryOperations.filter((operation) => operation.operatorId === "gpu.operator.subtract").length,
    1,
  );
  assertEquals(
    binaryOperations.filter((operation) =>
      operation.operatorId === "gpu.operator.multiply" ||
      operation.operatorId === "gpu.operator.subtract"
    ).every((operation) =>
      output.shaderTypes.find((type) => type.id === operation.typeId)?.kind === "vector"
    ),
    true,
  );
});

Deno.test("schema v2 tuple destructuring preserves vector lane order", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (coord) => {
        @gpu;
        let (u, v) = coord;
        let pair = (u, v) * 1.0;
        let (first, second) = pair;
        (first, second, 0.0, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(input);

  assertEquals(output.diagnostics, []);
  assertEquals(
    output.loweredOperations.filter((operation) => operation.kind === "project").map((operation) =>
      operation.index
    ),
    [0, 1, 0, 1],
  );
  assertEquals(
    [...output.slangSource.matchAll(/ = wm_l_\d+\.(x|y);/g)].map((match) => match[1]),
    ["x", "y", "x", "y"],
  );
});

Deno.test("schema v2 lowers one curried nominal-record environment to uniforms", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      record Uniforms = { resolution: (Number, Number), time: Number };
      record FrameState = { resolution: (Number, Number), time: Number, quit: Bool };

      let shade = (uniforms: Uniforms) => {
        (coord) => {
          @gpu;
          let uv = (coord * 2.0 - uniforms.resolution) / uniforms.resolution.y;
          (uv.x + uniforms.time, uv.y, 0.0, 1.0)
        }
      };

      let current: Uniforms = .{ resolution = (1280.0, 720.0), time = 0.25 };
      let fragment = Gpu.fragment(shade(current));
    `),
  );
  validateGpuSliceElaborationInput(input);

  assertEquals(input.root.environmentId, 0);
  assertEquals(input.environments.map((environment) => environment.name), ["Uniforms"]);
  assertEquals(
    input.environmentFields.map((field) => [field.name, field.declaredIndex]),
    [["resolution", 0], ["time", 1]],
  );
  assertEquals(
    input.expressions.filter((expression) => expression.kind === "uniform").map((expression) =>
      expression.index
    ),
    [0, 0, 1],
  );

  const output = (await realSliceCompiler()).compileGpuSlice(input);
  assertEquals(output.diagnostics, []);
  assertEquals(output.slangSource.includes("struct wm_environment"), true);
  assertEquals(output.slangSource.includes("float2 wm_u_0;"), true);
  assertEquals(output.slangSource.includes("float wm_u_1;"), true);
  assertEquals(output.slangSource.includes("[[vk::binding(0, 0)]]"), true);
  assertEquals(
    output.slangSource.includes("ConstantBuffer<wm_environment> wm_uniforms;"),
    true,
  );
  assertEquals(output.slangSource.includes("wm_uniforms.wm_u_0"), true);
  assertEquals(output.slangSource.includes("wm_uniforms.wm_u_1"), true);
});

Deno.test("schema v2 keeps the curried environment boundary closed", async () => {
  await assertRejects(
    () =>
      analysisFor(`
        record ExpectedUniforms = { time: Number };
        record WrongUniforms = { time: Number };
        let shade = (uniforms: ExpectedUniforms) => {
          (_coord) => { @gpu; (uniforms.time, 0.0, 0.0, 1.0) }
        };
        let wrong: WrongUniforms = .{ time = 1.0 };
        let fragment = Gpu.fragment(shade(wrong));
      `),
    Error,
    "type mismatch",
  );

  await assertRejects(
    () =>
      analysisFor(`
        record Uniforms = { time: Number };
        let shade = (uniforms: Uniforms) => {
          @gpu;
          (_coord) => { @gpu; (uniforms.time, 0.0, 0.0, 1.0) }
        };
        let current: Uniforms = .{ time = 1.0 };
        let fragment = Gpu.fragment(shade(current));
    `),
    Error,
    "shader factory requires one host parameter",
  );

  await assertRejects(
    () =>
      analysisFor(`
        record Uniforms = { time: Number };
        let hostOffset = 0.25;
        let shade = (uniforms: Uniforms) => {
          (_coord) => {
            @gpu;
            (uniforms.time + hostOffset, 0.0, 0.0, 1.0)
          }
        };
        let current: Uniforms = .{ time = 1.0 };
        let fragment = Gpu.fragment(shade(current));
      `),
    GpuSliceNormalizationError,
    "instead of capturing it",
  );

  await assertRejects(
    () =>
      analysisFor(`
        record Uniforms = { enabled: Bool };
        let shade = (uniforms: Uniforms) => {
          (_coord) => {
            @gpu;
            if (uniforms.enabled) { (1.0, 0.0, 0.0, 1.0) } else { (0.0, 0.0, 0.0, 1.0) }
          }
        };
        let current: Uniforms = .{ enabled = true };
        let fragment = Gpu.fragment(shade(current));
      `),
    GpuSliceNormalizationError,
    "must be Number or a homogeneous Number tuple",
  );
});

Deno.test("schema v2 vector rules do not leak into host code or resize widths", async () => {
  await assertRejects(
    () => analysisFor(`let host = (1.0, 2.0) + (3.0, 4.0);`),
    Error,
  );
  await assertRejects(
    () =>
      analysisFor(`
        let shade = (coord) => {
          @gpu;
          let wrongWidth = coord + (1.0, 2.0, 3.0);
          let (x, y, _z) = wrongWidth;
          (x, y, 0.0, 1.0)
        };
        let fragment = Gpu.fragment(shade);
      `),
    Error,
  );
});

Deno.test("schema v2 IR rejects a direct self-call outside tail position", async () => {
  const input = normalizeGpuSliceProgram(
    await analyzeVirtual(
      "/test/main.wm",
      new Map([["/test/main.wm", await acceptanceBlock("non_tail_recursion.wm")]]),
    ),
  );
  const compiler = await realSliceCompiler();
  const output = compiler.compileGpuSlice(input);

  assertEquals(output.diagnostics.map((diagnostic) => diagnostic.code), [
    "gpu.recursion.non-tail",
  ]);
  assertEquals(
    output.diagnostics[0].spanId,
    input.recursiveReferences.find((reference) => reference.relation === "self")!.spanId,
  );
  assertEquals(output.diagnostics[0].related, [{
    spanId: input.functions.find((fn) => fn.name === "nonTail")!.spanId,
    label: "recursive function declared here",
  }]);
  const semanticError = new WmslangSemanticError(output.diagnostics, input.spans);
  assertEquals(semanticError.diagnostics, output.diagnostics);
  assertEquals(semanticError.sourceDiagnostics[0].primary.id, output.diagnostics[0].spanId);
  assertEquals(
    semanticError.sourceDiagnostics[0].related[0].span.id,
    input.functions.find((fn) => fn.name === "nonTail")!.spanId,
  );
  assertEquals(semanticError.message.includes("recursive function declared here"), true);
  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        diagnostics: [{
          ...output.diagnostics[0],
          related: [{ spanId: 999, label: "missing evidence" }],
        }],
      }),
    Error,
    "references missing id 999",
  );
  assertEquals(output.irExpressions.some((expression) => expression.kind === "tail-call"), false);
  assertEquals(
    output.irExpressions.some((expression) =>
      expression.kind === "call" && expression.targetFunctionId === expression.functionId
    ),
    true,
  );
  assertEquals(output.slangSource, "");
});

Deno.test("schema v2 IR requires complete constructor coverage", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      type Shade = Dark | Light;

      let shade = (coord) => {
        @gpu;
        let choose = match(value) => {
          Dark => { 0.0 }
        };
        let (_x, _y) = coord;
        Gpu.color((choose(Dark), 0.0, 0.0, 1.0))
      };

      let fragment = Gpu.fragment(shade);
    `),
  );
  const compiler = await realSliceCompiler();
  const output = compiler.compileGpuSlice(input);

  assertEquals(output.diagnostics.map((diagnostic) => diagnostic.code), [
    "gpu.pattern.non-exhaustive",
  ]);
  assertEquals(output.irExpressions.filter((expression) => expression.kind === "match").length, 1);
});

Deno.test("schema v2 output validation rejects a dangling functional IR edge", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (_coord) => { @gpu; Gpu.color((1.0, 0.0, 0.0, 1.0)) };
      let fragment = Gpu.fragment(shade);
    `),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(input);
  const parent = output.irExpressions.find((expression) => expression.children.length > 0)!;

  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        irExpressions: output.irExpressions.map((expression) =>
          expression.id === parent.id ? { ...expression, children: [999] } : expression
        ),
      }),
    Error,
    "references missing id 999",
  );

  const operation = output.loweredOperations.find((candidate) => candidate.args.length > 0)!;
  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        loweredOperations: output.loweredOperations.map((candidate) =>
          candidate.id === operation.id ? { ...candidate, args: [999] } : candidate
        ),
      }),
    Error,
    "references missing id 999",
  );

  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        shaderTypes: output.shaderTypes.map((type, index) =>
          index === 0 ? { ...type, kind: "bool" } : type
        ),
      }),
    Error,
    "disagrees with semantic source shape",
  );

  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        typeEvidence: output.typeEvidence.map((fact, index) =>
          index === 0 ? { ...fact, reason: "semantic-shape" } : fact
        ),
      }),
    Error,
    "evidence disagrees",
  );

  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        occurrences: output.occurrences.map((occurrence, index) =>
          index === 0 ? { ...occurrence, typeId: 999 } : occurrence
        ),
      }),
    Error,
    "disagrees with its semantic source row",
  );
});

Deno.test("schema v2 executes a trailing-semicolon expression exactly once", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (coord) => {
        @gpu;
        let touch = (x) => { x + 1.0; };
        let (x, _y) = coord;
        touch(x);
        Gpu.color((x, 0.0, 0.0, 1.0))
      };

      let fragment = Gpu.fragment(shade);
    `),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(input);

  assertEquals(input.expressions.filter((expression) => expression.kind === "binary").length, 1);
  assertEquals(output.irExpressions.filter((expression) => expression.kind === "binary").length, 1);
  assertEquals(
    output.irExpressions.every((expression) =>
      expression.kind !== "void" || expression.children.length === 0
    ),
    true,
  );
  assertEquals(output.diagnostics, []);
});

Deno.test("schema v5 preserves numeric literal representation evidence through lowering", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (_coord) => {
        @gpu;
        let integerEvidence = 7;
        let floatEvidence = 8.5;
        integerEvidence;
        floatEvidence;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };

      let fragment = Gpu.fragment(shade);
    `),
  );
  validateGpuSliceElaborationInput(input);

  const sourceKinds = new Map(
    input.expressions
      .filter((expression) => expression.kind === "number")
      .map((expression) => [expression.numberValue, expression.numberKind]),
  );
  assertEquals(sourceKinds.get(7), "i32");
  assertEquals(sourceKinds.get(8.5), "f32");
  assertEquals(
    input.expressions
      .filter((expression) => expression.kind !== "number")
      .every((expression) => expression.numberKind === ""),
    true,
  );

  const integer = input.expressions.find((expression) => expression.numberValue === 7)!;
  const output = (await realSliceCompiler()).compileGpuSlice(input);
  validateGpuSliceCompilationOutput(output);
  const occurrenceEvidence = new Map(
    output.occurrences
      .filter((occurrence) => occurrence.kind === "expression")
      .map((occurrence) => [occurrence.sourceId, occurrence.representationEvidence]),
  );
  assertEquals(occurrenceEvidence.get(integer.id), "i32");
  assertEquals(
    occurrenceEvidence.get(
      input.expressions.find((expression) => expression.numberValue === 8.5)!.id,
    ),
    "f32",
  );
  const occurrenceRepresentations = new Map(
    output.occurrences
      .filter((occurrence) => occurrence.kind === "expression")
      .map((occurrence) => [occurrence.sourceId, occurrence.representation]),
  );
  assertEquals(occurrenceRepresentations.get(integer.id), "i32");
  assertEquals(
    occurrenceRepresentations.get(
      input.expressions.find((expression) => expression.numberValue === 8.5)!.id,
    ),
    "f32",
  );
  const integerOccurrence = output.occurrences.find((occurrence) =>
    occurrence.kind === "expression" && occurrence.sourceId === integer.id
  )!;
  const floatOccurrence = output.occurrences.find((occurrence) =>
    occurrence.kind === "expression" &&
    occurrence.sourceId ===
      input.expressions.find((expression) => expression.numberValue === 8.5)!.id
  )!;
  assertEquals(
    output.shaderTypes.find((type) => type.id === integerOccurrence.shaderTypeId)?.kind,
    "i32",
  );
  assertEquals(
    output.shaderTypes.find((type) => type.id === floatOccurrence.shaderTypeId)?.kind,
    "f32",
  );
  const irKinds = new Map(
    output.irExpressions
      .filter((expression) => expression.kind === "number")
      .map((expression) => [expression.numberValue, expression.numberKind]),
  );
  const loweredKinds = new Map(
    output.loweredAtoms
      .filter((atom) => atom.kind === "number")
      .map((atom) => [atom.numberValue, atom.numberKind]),
  );
  assertEquals(irKinds.get(7), "i32");
  assertEquals(irKinds.get(8.5), "f32");
  assertEquals(loweredKinds.get(7), "i32");
  assertEquals(loweredKinds.get(8.5), "f32");
  const integerAtom = output.loweredAtoms.find((atom) => atom.numberValue === 7)!;
  assertEquals(
    output.shaderTypes.find((type) => type.id === integerAtom.typeId)?.kind,
    "i32",
  );
  assertEquals(output.slangSource.includes("int(7)"), true);
  assertEquals(output.slangSource.includes("float(8.5)"), true);

  assertThrows(
    () =>
      validateGpuSliceElaborationInput({
        ...input,
        expressions: input.expressions.map((expression) =>
          expression.id === integer.id ? { ...expression, numberKind: "" } : expression
        ),
      }),
    Error,
    "wrong numberKind",
  );
  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        occurrences: output.occurrences.map((occurrence) =>
          occurrence.kind === "expression" && occurrence.sourceId === integer.id
            ? { ...occurrence, representationEvidence: "f32" }
            : occurrence
        ),
      }),
    Error,
    "wrong representation evidence",
  );
  assertThrows(
    () =>
      validateGpuSliceCompilationOutput({
        ...output,
        occurrences: output.occurrences.map((occurrence) =>
          occurrence.kind === "expression" && occurrence.sourceId === integer.id
            ? { ...occurrence, representation: "f32" }
            : occurrence
        ),
      }),
    Error,
    "contradicts its evidence",
  );
});

Deno.test("schema v5 validates signed i32 literals only in reachable GPU code", async () => {
  const accepted = normalizeGpuSliceProgram(
    await analysisFor(`
      let hostOnly = 9007199254740991;
      let shade = (_coord) => {
        @gpu;
        let minimum = -2147483648;
        minimum;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);
    `),
  );
  assertEquals(
    accepted.expressions.some((expression) =>
      expression.kind === "number" &&
      (expression.numberValue === -2_147_483_648 || expression.numberValue === 2_147_483_648)
    ),
    true,
  );
  const acceptedOutput = (await realSliceCompiler()).compileGpuSlice(accepted);
  assertEquals(acceptedOutput.slangSource.includes("int(2147483648)"), false);
  assertEquals(acceptedOutput.slangSource.includes("-2147483648"), true);

  for (const literal of ["2147483648", "-2147483649", "9007199254740991"]) {
    const error = await assertRejects(
      () =>
        analysisFor(`
          let shade = (_coord) => {
            @gpu;
            Gpu.color((${literal}, 0.0, 0.0, 1.0))
          };
          let fragment = Gpu.fragment(shade);
        `).then(normalizeGpuSliceProgram),
      GpuSliceNormalizationError,
      "outside signed i32 range",
    );
    assertEquals(error.code, "gpu.numeric.range");
  }
});

Deno.test("schema v5 lowers exact i32 scalar/vector arithmetic and rejects mixed flow", async () => {
  const compiler = await realSliceCompiler();
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (_coord) => {
        @gpu;
        let scalar = ((7 + 3) * 2 - 1) % 5;
        let vector = (1, 2) + (3, 4);
        scalar;
        vector;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);
    `),
  );
  const output = compiler.compileGpuSlice(input);
  assertEquals(output.diagnostics, []);
  assertEquals(output.slangSource.includes("int2"), true);
  assertEquals(output.slangSource.includes("int(7)"), true);
  assertEquals(output.slangSource.includes(" % int(5)"), true);
  assertEquals(
    output.irExpressions
      .filter((expression) => expression.kind === "binary")
      .every((expression) =>
        ["i32", "vector"].includes(
          output.shaderTypes.find((type) => type.id === expression.typeId)?.kind ?? "",
        )
      ),
    true,
  );

  const mixed = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (_coord) => {
        @gpu;
        let invalid = 1 + 1.0;
        invalid;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);
    `),
  );
  const conflict = assertThrows(
    () => compiler.compileGpuSlice(mixed),
    WmslangNumericDiagnosticError,
    "conflicting GPU numeric representations",
  );
  assertEquals(conflict.diagnostic.code, "gpu.numeric.conflict");
  assertEquals(conflict.diagnostic.related.length, 1);
  assertEquals(conflict.diagnostic.related[0].spanId === conflict.diagnostic.spanId, false);
  assertEquals(
    conflict.diagnostic.related[0].label.includes("representation originates here"),
    true,
  );
});

Deno.test("schema v5 selects verified pure i32 Slang builtin overloads", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (_coord) => {
        @gpu;
        let integerScalar = abs(-7);
        let integerVector = max((1, 4), (3, 2));
        let floatScalar = abs(-7.0);
        integerScalar;
        integerVector;
        floatScalar;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);
    `),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(input);
  const selected = output.builtinSelections.map((selection) =>
    WMSLANG_BUILTIN_OVERLOADS.find((overload) => overload.id === selection.overloadId)!
  );
  assertEquals(
    selected.map((overload) => [overload.name, overload.params, overload.result]),
    [
      ["abs", ["i32"], "i32"],
      ["max", ["i32x2", "i32x2"], "i32x2"],
      ["abs", ["f32"], "f32"],
    ],
  );
  assertEquals(output.slangSource.includes("int wm_l_"), true);
  assertEquals(output.slangSource.includes("int2 wm_l_"), true);
  assertEquals(output.slangSource.includes("float wm_l_"), true);
  assertEquals(output.slangSource.includes(" = abs("), true);
  assertEquals(output.slangSource.includes(" = max("), true);
});

Deno.test("schema v5 preserves explicit numeric conversions through IR and Slang", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (_coord) => {
        @gpu;
        let integer = Gpu.i32(3.5);
        let float = Gpu.f32(integer);
        let repaired = Gpu.f32(1) + 1.0;
        integer;
        Gpu.color((float + repaired, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);
    `),
  );
  assertEquals(
    input.expressions
      .filter((expression) => expression.kind === "convert")
      .map((expression) => expression.semanticId),
    ["gpu.i32", "gpu.f32", "gpu.f32"],
  );

  const output = (await realSliceCompiler()).compileGpuSlice(input);
  assertEquals(output.diagnostics, []);
  assertEquals(
    output.irExpressions.filter((expression) => expression.kind === "convert").length,
    3,
  );
  assertEquals(
    output.loweredOperations
      .filter((operation) => operation.kind === "convert")
      .map((operation) => operation.semanticId),
    ["gpu.i32", "gpu.f32", "gpu.f32"],
  );
  assertEquals(output.slangSource.includes("int(float(3.5))"), true);
  assertEquals(output.slangSource.includes("float(int(1))"), true);
});

Deno.test("schema v5 never defaults an unresolved numeric flow, with or without annotation", async () => {
  const compiler = await realSliceCompiler();
  for (const annotation of ["", ": Number"]) {
    const input = normalizeGpuSliceProgram(
      await analysisFor(`
        record Uniforms = { value: Number };
        let shade = (uniforms: Uniforms) => {
          (_coord) => {
            @gpu;
            let value${annotation} = uniforms.value;
            value;
            Gpu.color((0.0, 0.0, 0.0, 1.0))
          }
        };
        let current: Uniforms = .{ value = 42 };
        let fragment = Gpu.fragment(shade(current));
      `),
    );
    const unresolved = assertThrows(
      () => compiler.compileGpuSlice(input),
      WmslangNumericDiagnosticError,
      "GPU numeric representation has insufficient context",
    );
    assertEquals(unresolved.diagnostic.code, "gpu.numeric.unresolved");
    assertEquals(unresolved.diagnostic.related, []);
  }
});

Deno.test("schema v5 freshens one HM helper for independent i32 and f32 instances", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      let shade = (_coord) => {
        @gpu;
        let twice = (value) => { value + value };
        let integer = twice(2);
        let float = twice(2.0);
        integer;
        float;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);
    `),
  );
  const output = (await realSliceCompiler()).compileGpuSlice(input);
  const helpers = output.irFunctions.filter((fn) => fn.name.startsWith("twice"));
  assertEquals(helpers.length, 2);
  assertEquals(
    helpers.map((fn) => output.shaderTypes.find((type) => type.id === fn.resultTypeId)?.kind)
      .sort(),
    ["f32", "i32"],
  );
  assertEquals(output.slangSource.includes("int wm_f_"), true);
  assertEquals(output.slangSource.includes("float wm_f_"), true);
});

Deno.test("schema v5 lowers sampled texture Sample and Load through the resource ABI", async () => {
  const input = normalizeGpuSliceProgram(
    await analysisFor(`
      record Inputs = {
        resolution: (Number, Number),
        previous: Gpu.SampledTexture2D,
        sampler: Gpu.Sampler
      };
      let shade = (inputs: Inputs) => {
        (coord) => {
          @gpu;
          let uv = coord / inputs.resolution;
          let sampled = inputs.previous.Sample(inputs.sampler, uv);
          let loaded = inputs.previous.Load((0, 0, 0));
          (sampled.x + loaded.x * 0.0, sampled.y, sampled.z, 1.0)
        }
      };
      let texture: Gpu.SampledTexture2D = Panic("not evaluated by shader compilation");
      let sampler: Gpu.Sampler = Panic("not evaluated by shader compilation");
      let current: Inputs = .{
        resolution = (640.0, 480.0),
        previous = texture,
        sampler = sampler
      };
      let fragment = Gpu.fragment(shade(current));
    `),
  );
  validateGpuSliceElaborationInput(input);
  assertEquals(
    input.environmentFields.map((field) => [field.name, field.kind, field.binding]),
    [
      ["resolution", "uniform", 0],
      ["previous", "sampled-texture-2d", 1],
      ["sampler", "sampler", 2],
    ],
  );
  assertEquals(
    input.expressions
      .filter((expression) => expression.kind === "resource-call")
      .map((expression) => expression.resourceOperation),
    ["sample", "load"],
  );

  const output = (await realSliceCompiler()).compileGpuSlice(input);
  assertEquals(output.diagnostics, []);
  assertEquals(
    output.irExpressions
      .filter((expression) => expression.kind === "resource-call")
      .map((expression) => expression.resourceOperation),
    ["sample", "load"],
  );
  assertEquals(
    output.loweredOperations
      .filter((operation) => operation.kind === "resource-call")
      .map((operation) => operation.resourceOperation),
    ["sample", "load"],
  );
  assertEquals(output.slangSource.includes("ConstantBuffer<wm_environment> wm_uniforms"), true);
  assertEquals(output.slangSource.includes("Texture2D<float4> wm_r_1"), true);
  assertEquals(output.slangSource.includes("SamplerState wm_r_2"), true);
  assertEquals(output.slangSource.includes(".Sample("), true);
  assertEquals(output.slangSource.includes(".Load("), true);
  const compiled = (await loadDefaultWmslangSlangBackend()).compile(output.slangSource);
  assertEquals(compiled.resourceLayout, {
    group: 0,
    bindings: [
      { name: "wm_r_1", binding: 1, kind: "sampled-texture-2d" },
      { name: "wm_r_2", binding: 2, kind: "sampler" },
    ],
  });
  assertEquals(compiled.wgsl.includes("@binding(1) @group(0)"), true);
  assertEquals(compiled.wgsl.includes("@binding(2) @group(0)"), true);
});

Deno.test("schema v5 rejects declared resources omitted by the linked shader", async () => {
  const error = await assertRejects(
    () =>
      analysisFor(`
        record Inputs = {
          previous: Gpu.SampledTexture2D,
          sampler: Gpu.Sampler
        };
        let shade = (inputs: Inputs) => {
          (_coord) => {
            @gpu;
            inputs.previous.Load((0, 0, 0))
          }
        };
        let texture: Gpu.SampledTexture2D = Panic("not evaluated by shader compilation");
        let sampler: Gpu.Sampler = Panic("not evaluated by shader compilation");
        let current: Inputs = .{ previous = texture, sampler = sampler };
        let fragment = Gpu.fragment(shade(current));
      `).then(normalizeGpuSliceProgram),
    GpuSliceNormalizationError,
    "sampler is declared but never used",
  );
  assertEquals(error.code, "gpu.type.unsupported");
});

async function analysisFor(source: string) {
  return await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
}

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

async function realSliceCompiler() {
  return await loadGeneratedSliceCompiler(
    await compileLibraryFile(
      new URL("../tooling/wmslang/compiler.wm", import.meta.url).pathname,
    ),
  );
}

async function loadGeneratedSliceCompiler(source: string) {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/wmslang.generated.mjs`;
  await Deno.writeTextFile(path, source);
  try {
    return await loadWmslangSliceCompiler(
      `${new URL(`file://${path}`).href}?${crypto.randomUUID()}`,
    );
  } finally {
    // Imported ES modules remain alive after the file is removed.
    await Deno.remove(dir, { recursive: true });
  }
}
