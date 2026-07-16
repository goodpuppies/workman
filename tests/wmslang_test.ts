import { assertEquals, assertThrows } from "@std/assert";
import { resolveModuleBindingFacts } from "../src/binding_facts.ts";
import { compileLibraryFile, coreVirtual } from "../src/compiler.ts";
import { CompilerIdAllocator } from "../src/ids.ts";
import { inferModule } from "../src/infer.ts";
import { parse } from "../src/parser.ts";
import { standardInferOptions } from "../src/standard_library.ts";
import type { GpuElaborationInput } from "../src/wmslang/dto.ts";
import {
  loadWmslangCompiler,
  validateGpuCompilationOutput,
  validateGpuElaborationInput,
} from "../src/wmslang/loader.ts";
import { normalizeGpuModule, normalizeGpuProgramH0 } from "../src/wmslang/normalize.ts";

const compilerFixture = new URL("../tooling/wmslang/compiler.wm", import.meta.url).pathname;

Deno.test("H0 normalization produces stable binding, type, expression, and span tables", async () => {
  const input = await h0Input();

  assertEquals(input.roots, [{ regionId: 0, functionId: 0, bindingId: 1 }]);
  assertEquals(input.functions, [{
    id: 0,
    regionId: 0,
    bindingId: 1,
    name: "tint",
    params: [{ bindingId: 0, name: "color", typeId: 0 }],
    resultTypeId: 1,
    bodyExprId: 0,
    spanId: 4,
    capability: "gpu-only",
  }]);
  assertEquals(input.bindings, [
    {
      id: 0,
      name: "color",
      typeId: 0,
      definitionExprId: -1,
      spanId: -1,
      scope: "parameter",
    },
    {
      id: 1,
      name: "tint",
      typeId: 2,
      definitionExprId: -1,
      spanId: -1,
      scope: "module",
    },
  ]);
  assertEquals(
    input.types.map((type) => ({
      id: type.id,
      kind: type.kind,
      representation: type.representation,
      params: type.params,
      result: type.result,
    })),
    [
      { id: 0, kind: "number", representation: "abstract", params: [], result: -1 },
      { id: 1, kind: "number", representation: "abstract", params: [], result: -1 },
      { id: 2, kind: "function", representation: "", params: [0], result: 1 },
      { id: 3, kind: "number", representation: "f32", params: [], result: -1 },
      { id: 4, kind: "number", representation: "abstract", params: [], result: -1 },
    ],
  );
  assertEquals(
    input.expressions.map((expr) => ({
      id: expr.id,
      kind: expr.kind,
      typeId: expr.typeId,
      bindingId: expr.bindingId,
      operator: expr.operator,
      numberValue: expr.numberValue,
      children: expr.children,
      capability: expr.capability,
    })),
    [
      {
        id: 0,
        kind: "block",
        typeId: 1,
        bindingId: -1,
        operator: "",
        numberValue: 0,
        children: [1],
        capability: "gpu",
      },
      {
        id: 1,
        kind: "binary",
        typeId: 4,
        bindingId: -1,
        operator: "*",
        numberValue: 0,
        children: [2, 3],
        capability: "gpu",
      },
      {
        id: 2,
        kind: "var",
        typeId: 0,
        bindingId: 0,
        operator: "",
        numberValue: 0,
        children: [],
        capability: "gpu",
      },
      {
        id: 3,
        kind: "number",
        typeId: 3,
        bindingId: -1,
        operator: "",
        numberValue: 0.5,
        children: [],
        capability: "gpu",
      },
    ],
  );
  assertEquals(input.spans.map(({ id, path, start, end }) => ({ id, path, start, end })), [
    { id: 0, path: "/test/main.wm", start: 30, end: 35 },
    { id: 1, path: "/test/main.wm", start: 38, end: 41 },
    { id: 2, path: "/test/main.wm", start: 30, end: 41 },
    { id: 3, path: "/test/main.wm", start: 22, end: 43 },
    { id: 4, path: "/test/main.wm", start: 11, end: 43 },
  ]);
});

Deno.test("generated Workman wmslang library returns validated typed H0 tables", async () => {
  const js = await compileLibraryFile(compilerFixture);
  const compiler = await loadGeneratedCompiler(js);
  const input = await h0Input();
  const output = compiler.compileGpu(input);

  assertEquals(output.schemaVersion, 1);
  assertEquals(output.functions, [{ ...input.functions[0], capability: "gpu-only" }]);
  assertEquals(output.captures, []);
  assertEquals(output.rootSpecializations, [{ regionId: 0, specializationId: 0 }]);
  assertEquals(output.calls, []);
  assertEquals(
    output.specializations.map((specialization) => ({
      id: specialization.id,
      functionId: specialization.functionId,
      name: specialization.name,
      paramRepresentations: specialization.paramRepresentations,
      resultRepresentation: specialization.resultRepresentation,
    })),
    [{
      id: 0,
      functionId: 0,
      name: "tint__gpu_f32_to_f32",
      paramRepresentations: ["f32"],
      resultRepresentation: "f32",
    }],
  );
  assertEquals(output.specializations[0].typeFacts, [
    { typeId: 0, representation: "f32" },
    { typeId: 1, representation: "f32" },
    { typeId: 3, representation: "f32" },
    { typeId: 4, representation: "f32" },
  ]);
  assertEquals(output.irFunctions, [{
    specializationId: 0,
    functionId: 0,
    bindingId: input.functions[0].bindingId,
    name: "tint__gpu_f32_to_f32",
    params: [{
      bindingId: input.functions[0].params[0].bindingId,
      name: "color",
      typeId: input.functions[0].params[0].typeId,
      representation: "f32",
    }],
    resultTypeId: input.functions[0].resultTypeId,
    resultRepresentation: "f32",
    bodyExprId: 0,
    spanId: input.functions[0].spanId,
  }]);
  assertEquals(
    output.irExpressions.map((expression) => ({
      id: expression.id,
      sourceExprId: expression.sourceExprId,
      kind: expression.kind,
      representation: expression.representation,
      valueKind: expression.valueKind,
      children: expression.children,
      callTargetSpecializationId: expression.callTargetSpecializationId,
    })),
    [
      {
        id: 0,
        sourceExprId: 0,
        kind: "block",
        representation: "f32",
        valueKind: "none",
        children: [1],
        callTargetSpecializationId: -1,
      },
      {
        id: 1,
        sourceExprId: 1,
        kind: "binary",
        representation: "f32",
        valueKind: "none",
        children: [2, 3],
        callTargetSpecializationId: -1,
      },
      {
        id: 2,
        sourceExprId: 2,
        kind: "var",
        representation: "f32",
        valueKind: "local",
        children: [],
        callTargetSpecializationId: -1,
      },
      {
        id: 3,
        sourceExprId: 3,
        kind: "number",
        representation: "f32",
        valueKind: "literal",
        children: [],
        callTargetSpecializationId: -1,
      },
    ],
  );
  assertEquals(output.types.length, input.types.length);
  assertEquals(output.types[input.functions[0].params[0].typeId].representation, "f32");
  assertEquals(output.expressions, input.expressions);
  assertEquals(output.diagnostics, []);

  const hostFfi = compiler.compileGpu({
    ...input,
    expressions: input.expressions.map((expression) =>
      expression.id === 1 ? { ...expression, capability: "host-ffi" as const } : expression
    ),
  });
  assertEquals(hostFfi.diagnostics, [{
    code: "gpu.host-ffi",
    message: "host FFI expression cannot execute in a GPU region",
    spanId: 2,
  }]);

  const duplicate = compiler.compileGpu({
    ...input,
    functions: [input.functions[0], input.functions[0]],
  });
  assertEquals(duplicate.diagnostics, [{
    code: "gpu.duplicate-function-id",
    message: "duplicate function ID in GPU elaboration input",
    spanId: 4,
  }]);

  const vectorInput = await gpuInput(
    "let color = (t) => { @gpu; (0.2 + t, 0.4, 0.8) };",
  );
  const vectorOutput = compiler.compileGpu(vectorInput);
  const vectorFunction = vectorOutput.functions[0];
  assertEquals(vectorOutput.types[vectorFunction.params[0].typeId].representation, "f32");
  assertEquals(vectorOutput.types[vectorFunction.resultTypeId], {
    ...vectorInput.types[vectorFunction.resultTypeId],
    representation: "f32",
  });
  assertEquals(vectorOutput.types[vectorFunction.resultTypeId].kind, "vector");
  assertEquals(vectorOutput.types[vectorFunction.resultTypeId].width, 3);
  assertEquals(
    vectorOutput.irExpressions.find((expression) => expression.kind === "tuple")!.representation,
    "f32",
  );

  const broadcastInput = await gpuInput(
    "let scale = (x) => { @gpu; (x, x, x) * 0.5 };",
  );
  const broadcastOutput = compiler.compileGpu(broadcastInput);
  const broadcastFunction = broadcastOutput.functions[0];
  assertEquals(
    broadcastOutput.types[broadcastFunction.params[0].typeId].representation,
    "f32",
  );
  assertEquals(broadcastOutput.types[broadcastFunction.resultTypeId].representation, "f32");
  assertEquals(broadcastOutput.types[broadcastFunction.resultTypeId].kind, "vector");

  const flowInput = await gpuInput(`
    let flow = (x) => {
      @gpu;
      let y = x + 0.5;
      if (x > 0) { y } else { y * 2 }
    };
  `);
  const flowOutput = compiler.compileGpu(flowInput);
  const yBinding = flowInput.bindings.find((binding) => binding.name === "y")!;
  assertEquals(
    flowOutput.irExpressions.filter((expression) =>
      expression.kind === "var" && expression.bindingId === yBinding.id
    ).map((expression) => [expression.valueKind, expression.representation]),
    [["local", "f32"], ["local", "f32"]],
  );
  assertEquals(flowOutput.irExpressions.some((expression) => expression.kind === "let"), true);
  assertEquals(flowOutput.irExpressions.some((expression) => expression.kind === "if"), true);
  const flowIrIds = new Set(flowOutput.irExpressions.map((expression) => expression.id));
  assertEquals(
    flowOutput.irExpressions.every((expression) =>
      expression.children.every((childId) => flowIrIds.has(childId))
    ),
    true,
  );

  const defaultedInput = await gpuInput("let twice = (x) => { @gpu; x + x };");
  const defaultedOutput = compiler.compileGpu(defaultedInput);
  assertEquals(
    defaultedOutput.types[defaultedOutput.functions[0].params[0].typeId].representation,
    "i32",
  );

  const isolatedInput = await gpuInput(`
    let integerMath = (x) => { @gpu; x + x };
    let floatMath = (x) => { @gpu; x * 0.5 };
  `);
  const isolatedOutput = compiler.compileGpu(isolatedInput);
  const integerMath = isolatedOutput.functions.find((fn) => fn.name === "integerMath")!;
  const floatMath = isolatedOutput.functions.find((fn) => fn.name === "floatMath")!;
  assertEquals(isolatedOutput.types[integerMath.params[0].typeId].representation, "i32");
  assertEquals(isolatedOutput.types[integerMath.resultTypeId].representation, "i32");
  assertEquals(isolatedOutput.types[floatMath.params[0].typeId].representation, "f32");
  assertEquals(isolatedOutput.types[floatMath.resultTypeId].representation, "f32");

  const perRootCaptureInput = await gpuInput(`
    let gain = 0.5;
    let first = (x) => { @gpu; x * gain };
    let second = (x) => { @gpu; x + gain };
  `);
  const perRootCaptureOutput = compiler.compileGpu(perRootCaptureInput);
  assertEquals(
    perRootCaptureOutput.captures.map((capture) => [capture.regionId, capture.category]),
    [[0, "constant"], [1, "constant"]],
  );

  const callGraphInput = await gpuInput(`
    let helper = (x) => { x * 0.5 };
    let unused = (x) => { Panic("CPU-only helper") };
    let shade = (x) => { @gpu; helper(x) };
  `);
  assertEquals(callGraphInput.functions.map((fn) => [fn.name, fn.capability]), [
    ["shade", "gpu-only"],
    ["helper", "candidate"],
    ["unused", "candidate"],
  ]);
  const callGraphOutput = compiler.compileGpu(callGraphInput);
  assertEquals(callGraphOutput.functions.map((fn) => [fn.name, fn.capability]), [
    ["shade", "gpu-only"],
    ["helper", "gpu-eligible"],
    ["unused", "cpu-only"],
  ]);
  const shade = callGraphOutput.functions.find((fn) => fn.name === "shade")!;
  const helper = callGraphOutput.functions.find((fn) => fn.name === "helper")!;
  assertEquals(callGraphOutput.types[shade.params[0].typeId].representation, "f32");
  assertEquals(callGraphOutput.types[shade.resultTypeId].representation, "f32");
  assertEquals(callGraphOutput.types[helper.params[0].typeId].representation, "f32");
  assertEquals(callGraphOutput.types[helper.resultTypeId].representation, "f32");
  assertEquals(callGraphOutput.diagnostics, []);
  const callGraphCall = callGraphOutput.calls[0];
  const callGraphIrCall = callGraphOutput.irExpressions.find((expression) =>
    expression.specializationId === callGraphCall.callerSpecializationId &&
    expression.sourceExprId === callGraphCall.expressionId
  )!;
  assertEquals(callGraphIrCall.callTargetSpecializationId, callGraphCall.targetSpecializationId);
  assertEquals(
    callGraphOutput.irExpressions.find((expression) =>
      expression.specializationId === callGraphCall.callerSpecializationId &&
      expression.valueKind === "function"
    )!.bindingId,
    callGraphInput.functions.find((fn) => fn.name === "helper")!.bindingId,
  );

  const specializedInput = await gpuInput(`
    let helper = (x) => { x + 0 };
    let integerA = (x) => { @gpu; helper(x) };
    let integerB = (x) => { @gpu; helper(x + 1) };
    let floating = (x) => { @gpu; helper(x) * 0.5 };
  `);
  const specializedOutput = compiler.compileGpu(specializedInput);
  const helperFunctionId = specializedInput.functions.find((fn) => fn.name === "helper")!.id;
  const helperSpecializations = specializedOutput.specializations.filter(
    (specialization) => specialization.functionId === helperFunctionId,
  );
  assertEquals(
    helperSpecializations.map((specialization) => [
      specialization.paramRepresentations,
      specialization.resultRepresentation,
    ]),
    [
      [["i32"], "i32"],
      [["f32"], "f32"],
    ],
  );
  const helperParamTypeId = specializedInput.functions.find((fn) => fn.id === helperFunctionId)!
    .params[0].typeId;
  assertEquals(specializedOutput.types[helperParamTypeId].representation, "abstract");
  assertEquals(
    helperSpecializations.map((specialization) => {
      const irFunction = specializedOutput.irFunctions.find((fn) =>
        fn.specializationId === specialization.id
      )!;
      const paramReference = specializedOutput.irExpressions.find((expression) =>
        expression.specializationId === specialization.id &&
        expression.bindingId === irFunction.params[0].bindingId && expression.kind === "var"
      )!;
      return [irFunction.params[0].representation, paramReference.representation];
    }),
    [
      ["i32", "i32"],
      ["f32", "f32"],
    ],
  );
  assertEquals(specializedOutput.rootSpecializations.length, 3);
  const specializationsById = new Map(
    specializedOutput.specializations.map((specialization) => [specialization.id, specialization]),
  );
  assertEquals(
    specializedOutput.calls.map((call) =>
      specializationsById.get(call.targetSpecializationId)!.paramRepresentations[0]
    ),
    ["i32", "i32", "f32"],
  );

  const recursiveInput = await gpuInput(`
    let rec descend = (x) => {
      if (x <= 0) { x } else { descend(x - 1) }
    };
    let shade = (x) => { @gpu; descend(x) };
  `);
  const recursiveOutput = compiler.compileGpu(recursiveInput);
  const descendFunctionId = recursiveInput.functions.find((fn) => fn.name === "descend")!.id;
  const descendSpecialization = recursiveOutput.specializations.find(
    (specialization) => specialization.functionId === descendFunctionId,
  )!;
  assertEquals(recursiveOutput.specializations.length, 2);
  assertEquals(
    recursiveOutput.calls.map((call) => call.targetSpecializationId),
    [descendSpecialization.id, descendSpecialization.id],
  );
  assertEquals(recursiveOutput.diagnostics, []);
  assertEquals(
    recursiveOutput.irExpressions.find((expression) =>
      expression.specializationId === descendSpecialization.id &&
      expression.callTargetSpecializationId === descendSpecialization.id
    )?.kind,
    "call",
  );

  const mutualInput = await gpuInput(`
    let rec even = (x) => {
      if (x <= 0) { true } else { odd(x - 1) }
    } and odd = (x) => {
      if (x <= 0) { false } else { even(x - 1) }
    };
    let shade = (x) => { @gpu; even(x) };
  `);
  const mutualOutput = compiler.compileGpu(mutualInput);
  assertEquals(mutualOutput.specializations.length, 3);
  assertEquals(mutualOutput.calls.length, 3);
  assertEquals(mutualOutput.diagnostics.map(({ code }) => code), ["gpu.mutual-recursion"]);

  const captureInput = await gpuInput(`
    let gain = 0.5;
    let identity = (x) => { x };
    let exposure = identity(1.0);
    let label = "CPU-only";
    let shade = (x) => {
      @gpu;
      let ignored = label;
      x * gain + exposure
    };
  `);
  const captureOutput = compiler.compileGpu(captureInput);
  assertEquals(captureNames(captureInput, captureOutput.captures), [
    ["gain", "constant"],
    ["exposure", "uniform"],
    ["label", "illegal"],
  ]);
  assertEquals(captureOutput.diagnostics.map(({ code }) => code), ["gpu.illegal-capture"]);
  const captureKinds = new Map(
    captureOutput.irExpressions.filter((expression) => expression.kind === "var").map(
      (expression) => [
        captureInput.bindings.find((binding) => binding.id === expression.bindingId)?.name,
        expression.valueKind,
      ],
    ),
  );
  assertEquals(captureKinds.get("gain"), "capture");
  assertEquals(captureKinds.get("exposure"), "capture");
  assertEquals(captureKinds.get("label"), "capture");
  assertEquals(captureKinds.get("x"), "local");

  const functionValueInput = await gpuInput(`
    let helper = (x) => { x };
    let shade = (x) => { @gpu; let selected = helper; x };
  `);
  const functionValueOutput = compiler.compileGpu(functionValueInput);
  assertEquals(captureNames(functionValueInput, functionValueOutput.captures), [
    ["helper", "illegal"],
  ]);
  assertEquals(functionValueOutput.diagnostics.map(({ code }) => code), [
    "gpu.illegal-capture",
  ]);
});

Deno.test("whole-program final analysis shares binding identity with Core and the GPU DTO", async () => {
  const analysis = await coreVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", "let tint = (color) => { @gpu; color * 0.5 }; "]]),
  );
  const module = analysis.core.modules.get("/test/main.wm")!;
  const h0Input = normalizeGpuProgramH0(analysis.graph, analysis.results, analysis.bindings);
  const gpuBinding = h0Input.roots[0].bindingId;

  assertEquals(analysis.gpuInput.root, {
    functionId: -1,
    selectorSpanId: -1,
    environmentId: -1,
  });
  assertEquals(h0Input.functions[0].bindingId, gpuBinding);
  assertEquals(module.bindings.exports.get("tint"), gpuBinding);
  assertEquals(analysis.bindings.get("/test/main.wm"), module.bindings);

  const crossModule = await coreVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/lib.wm",
        "let helper = (x) => { x * 0.5 }; let unused = (x) => { x + 1 };",
      ],
      [
        "/test/main.wm",
        'from "./lib.wm" import { helper }; let shade = (x) => { @gpu; helper(x) };',
      ],
    ]),
  );
  const helperBinding = crossModule.bindings.get("/test/lib.wm")!.exports.get("helper")!;
  const crossModuleH0 = normalizeGpuProgramH0(
    crossModule.graph,
    crossModule.results,
    crossModule.bindings,
  );
  const helperFunction = crossModuleH0.functions.find((fn) => fn.name === "helper")!;
  assertEquals(helperFunction.bindingId, helperBinding);

  const compiler = await loadGeneratedCompiler(await compileLibraryFile(compilerFixture));
  const output = compiler.compileGpu(crossModuleH0);
  assertEquals(output.functions.map((fn) => [fn.name, fn.capability]), [
    ["shade", "gpu-only"],
    ["helper", "gpu-eligible"],
    ["unused", "cpu-only"],
  ]);
  assertEquals(captureNames(crossModuleH0, output.captures), [
    ["helper", "function"],
  ]);
  assertEquals(
    output.specializations.map((specialization) => [
      specialization.name,
      specialization.paramRepresentations,
      specialization.resultRepresentation,
    ]),
    [
      ["shade__gpu_f32_to_f32", ["f32"], "f32"],
      ["helper__gpu_f32_to_f32", ["f32"], "f32"],
    ],
  );
  assertEquals(output.calls, [{
    callerSpecializationId: output.rootSpecializations[0].specializationId,
    expressionId: crossModuleH0.expressions.find((expression) => expression.kind === "call")!.id,
    targetSpecializationId: output.specializations.find((specialization) =>
      specialization.name.startsWith("helper__gpu_")
    )!.id,
  }]);
  const crossModuleHelperSpec = output.specializations.find((specialization) =>
    specialization.name.startsWith("helper__gpu_")
  )!;
  const crossModuleHelperSources = output.irExpressions
    .filter((expression) => expression.specializationId === crossModuleHelperSpec.id)
    .map((expression) => crossModuleH0.spans.find((span) => span.id === expression.spanId)?.path);
  assertEquals(new Set(crossModuleHelperSources), new Set(["/test/lib.wm"]));

  const capturedConstant = await coreVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/lib.wm",
        'let gain = 0.5; let unusedLabel = "CPU-only"; let helper = (x) => { x * gain };',
      ],
      [
        "/test/main.wm",
        'from "./lib.wm" import { helper }; let shade = (x) => { @gpu; helper(x) };',
      ],
    ]),
  );
  const capturedH0 = normalizeGpuProgramH0(
    capturedConstant.graph,
    capturedConstant.results,
    capturedConstant.bindings,
  );
  const capturedOutput = compiler.compileGpu(capturedH0);
  assertEquals(captureNames(capturedH0, capturedOutput.captures), [
    ["gain", "constant"],
    ["helper", "function"],
  ]);
  assertEquals(capturedOutput.diagnostics, []);
});

Deno.test("wmslang boundary rejects incompatible and malformed DTOs", async () => {
  const input = await h0Input();
  assertThrows(
    () => validateGpuElaborationInput({ ...input, schemaVersion: 2 }),
    Error,
    "unsupported GPU elaboration input schema version 2",
  );

  const malformed = "data:text/javascript," + encodeURIComponent(
    "export const compileGpu = () => ({ schemaVersion: 1, functions: [], captures: [], specializations: [], rootSpecializations: [], calls: [], irFunctions: [], irExpressions: [], types: [], expressions: [], diagnostics: [{}] });",
  );
  const compiler = await loadWmslangCompiler(malformed);
  assertThrows(() => compiler.compileGpu(input), Error, "GPU diagnostic code must be a string");

  const emptyOutput = {
    schemaVersion: 1 as const,
    functions: [],
    captures: [],
    specializations: [],
    rootSpecializations: [],
    calls: [],
    irFunctions: [],
    irExpressions: [],
    types: [],
    expressions: [],
    diagnostics: [],
  };
  assertEquals(validateGpuCompilationOutput(emptyOutput), emptyOutput);
  assertThrows(
    () =>
      validateGpuCompilationOutput({
        ...emptyOutput,
        rootSpecializations: [{ regionId: 0, specializationId: 99 }],
      }),
    Error,
    "GPU root specialization specializationId references missing id 99",
  );
});

function h0Input(): Promise<GpuElaborationInput> {
  return gpuInput("let tint = (color) => { @gpu; color * 0.5 };");
}

async function gpuInput(source: string): Promise<GpuElaborationInput> {
  const module = await parse(source);
  const result = inferModule(module, new Map(), await standardInferOptions());
  const bindings = resolveModuleBindingFacts(module, new CompilerIdAllocator());
  return normalizeGpuModule(module, result, bindings, "/test/main.wm");
}

async function loadGeneratedCompiler(source: string) {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/wmslang.generated.mjs`;
  await Deno.writeTextFile(path, source);
  try {
    return await loadWmslangCompiler(`${new URL(`file://${path}`).href}?${crypto.randomUUID()}`);
  } finally {
    // Imported ES modules remain alive after the file is removed.
    await Deno.remove(dir, { recursive: true });
  }
}

function captureNames(
  input: GpuElaborationInput,
  captures: { bindingId: number; category: string }[],
): [string, string][] {
  const names = new Map(input.bindings.map((binding) => [binding.id, binding.name]));
  return captures.map((capture) => [names.get(capture.bindingId) ?? "<missing>", capture.category]);
}
