import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import type { Expr } from "../src/ast.ts";
import { inferModule } from "../src/infer.ts";
import type { GpuOperationRow } from "../src/infer/type_facts.ts";
import { parse } from "../src/parser.ts";
import { standardInferOptions } from "../src/standard_library.ts";
import { fn, fresh, NumberTy, prune, show, tuple } from "../src/types.ts";
import {
  canonicalGpuType,
  type GpuFunctionTemplate,
  GpuSpecializationError,
  specializeGpuTemplates,
} from "../src/wmslang/v4_specialize.ts";

const arithmeticRows: GpuOperationRow[] = [
  { id: 0, args: ["f32", "f32"], result: "f32" },
  { id: 1, args: ["f32x2", "f32x2"], result: "f32x2" },
  { id: 2, args: ["f32x3", "f32x3"], result: "f32x3" },
  { id: 3, args: ["f32x4", "f32x4"], result: "f32x4" },
];

Deno.test("v4 GPU operation skeletons remain ordinary generalized HM", async () => {
  const module = await parse(`
    let shade = (coord) => {
      @gpu;
      let twice = (x) => { x + x };
      let wave = (value) => { sin(value) };
      wave(twice(coord))
    };
  `);
  const result = inferModule(module, new Map(), await standardInferOptions());
  const twice = result.facts.bindings.get("twice")?.at(-1)?.general;
  const wave = result.facts.bindings.get("wave")?.at(-1)?.general;
  if (!twice || !wave) throw new Error("missing generalized GPU helper facts");
  assertEquals(twice.vars.length, 2);
  assertEquals(wave.vars.length, 1);
  assertEquals(show(twice.type), "('a) => 'b");
  assertEquals(show(wave.type).replaceAll(/'\w+/g, "'a"), "('a) => 'a");
  assertEquals(result.facts.gpuOperations.size, 2);
  assertEquals(
    [...result.facts.gpuOperations.values()].map((operation) => operation.kind),
    ["operator", "builtin"],
  );
});

Deno.test("v4 catalog skeletons contribute only universal HM equalities", async () => {
  const module = await parse(`
    let shade = (coord) => {
      @gpu;
      let floored = (x) => { floor(x) };
      let magnitude = (x) => { length(x) };
      let dotted = (x, y) => { dot(x, y) };
      let crossed = (x, y) => { cross(x, y) };
      let bent = (incident, normal, eta) => { refract(incident, normal, eta) };
      let eased = (minimum, maximum, x) => { smoothstep(minimum, maximum, x) };
      (coord.x, coord.y, 0.0, 1.0)
    };
  `);
  const result = inferModule(module, new Map(), await standardInferOptions());
  const scheme = (name: string) => {
    const binding = result.facts.bindings.get(name)?.at(-1)?.general;
    if (!binding) throw new Error(`missing ${name} scheme`);
    return show(binding.type).replaceAll(/'\w+/g, "'a");
  };
  assertEquals(scheme("floored"), "('a) => 'a");
  assertEquals(scheme("magnitude"), "('a) => Number");
  assertEquals(scheme("dotted"), "(('a, 'a)) => Number");
  assertEquals(
    scheme("crossed"),
    "(((Number, Number, Number), (Number, Number, Number))) => (Number, Number, Number)",
  );
  assertEquals(scheme("bent"), "(('a, 'a, Number)) => 'a");
  assertEquals(scheme("eased"), "(('a, 'a, 'a)) => 'a");
});

Deno.test("v4 GPU operators see Result payloads and retain a separate carrier plan", async () => {
  const module = await parse(`
    let shade = (coord) => {
      @gpu;
      let lifted = Ok((1.0, 2.0, 3.0)) + 0.5;
      (coord.x, coord.y, 0.0, 1.0)
    };
    let fragment = Gpu.fragment(shade);
  `);
  const result = inferModule(module, new Map(), await standardInferOptions());
  const operation = [...result.facts.gpuOperations.values()].find((item) =>
    item.identity === "gpu.operator.add"
  );
  if (!operation) throw new Error("missing lifted GPU operator fact");
  assertEquals(operation.args.map(show), ["(Number, Number, Number)", "Number"]);
  assertEquals(prune(operation.result).tag, "var");
  const carrier = result.facts.primitiveCarriers.get(operation.occurrence);
  assertEquals(carrier?.carrier, "Result");
  assertEquals(carrier?.operands, ["wrapped", "pure"]);
  assertEquals(prune(carrier!.payloadResult) === prune(operation.result), true);
  assertEquals(
    show(result.facts.bindings.get("lifted")?.at(-1)?.general?.type!),
    "Result<'a, 'b>",
  );
});

Deno.test("v4 Result carrier plans preserve two wrapped operands and one error type", async () => {
  const module = await parse(`
    let shade = (coord) => {
      @gpu;
      let lifted = Ok((1.0, 2.0)) + Ok(0.5);
      (coord.x, coord.y, 0.0, 1.0)
    };
  `);
  const result = inferModule(module, new Map(), await standardInferOptions());
  const carrier = [...result.facts.primitiveCarriers.values()].find((plan) =>
    plan.operands.every((operand) => operand === "wrapped")
  );
  if (!carrier) throw new Error("missing two-sided Result carrier plan");
  const operation = result.facts.gpuOperations.get(carrier.occurrence);
  assertEquals(operation?.args.map(show), ["(Number, Number)", "Number"]);
  assertEquals(carrier.operands, ["wrapped", "wrapped"]);
  assertEquals(
    show(result.facts.bindings.get("lifted")?.at(-1)?.general?.type!),
    "Result<'a, 'b>",
  );
});

Deno.test("v4 specialization freshens one helper body for scalar and vector seeds", () => {
  const x = fresh();
  const bodyResult = fresh();
  const twiceExpr = expression("Binary");
  const twice: GpuFunctionTemplate = {
    bindingId: 2,
    name: "twice",
    params: [x],
    result: bodyResult,
    occurrenceTypes: new Map([[twiceExpr, bodyResult]]),
    operations: [{
      kind: "operator",
      identity: "gpu.operator.add",
      occurrence: twiceExpr,
      args: [x, x],
      result: bodyResult,
      rows: arithmeticRows,
      determiningArgs: [0, 1],
    }],
    calls: [],
  };

  const scalarResult = fresh();
  const vectorResult = fresh();
  const scalarCall = expression("Call") as Extract<Expr, { kind: "Call" }>;
  const vectorCall = expression("Call") as Extract<Expr, { kind: "Call" }>;
  const rgba = tuple([NumberTy, NumberTy, NumberTy, NumberTy]);
  const root: GpuFunctionTemplate = {
    bindingId: 1,
    name: "root",
    params: [],
    result: rgba,
    occurrenceTypes: new Map([[scalarCall, scalarResult], [vectorCall, vectorResult]]),
    operations: [],
    calls: [
      {
        occurrence: scalarCall,
        targetBindingId: 2,
        args: [NumberTy],
        result: scalarResult,
        staticFunctionArgs: [undefined],
      },
      {
        occurrence: vectorCall,
        targetBindingId: 2,
        args: [tuple([NumberTy, NumberTy, NumberTy])],
        result: vectorResult,
        staticFunctionArgs: [undefined],
      },
    ],
  };

  const instances = specializeGpuTemplates({
    rootBindingId: 1,
    rootArgs: [],
    rootResult: rgba,
    templates: new Map([[1, root], [2, twice]]),
  });
  assertEquals(instances.map((instance) => instance.seedKey), [
    "1<>",
    "2<Number>",
    "2<(Number,Number,Number)>",
  ]);
  assertEquals(canonicalGpuType(instances[0].occurrenceTypes.get(scalarCall)!), "Number");
  assertEquals(
    canonicalGpuType(instances[0].occurrenceTypes.get(vectorCall)!),
    "(Number,Number,Number)",
  );
  assertEquals(instances[1].operations[0].row.id, 0);
  assertEquals(instances[2].operations[0].row.id, 2);
  assertEquals(prune(instances[1].params[0]) === prune(instances[2].params[0]), false);
  assertEquals(prune(instances[1].result) === prune(instances[2].result), false);
});

Deno.test("v4 specialization worklist lets one selected row make the next selectable", () => {
  const x = fresh();
  const sum = fresh();
  const add = expression("Binary");
  const floor = expression("Call");
  const rows: GpuOperationRow[] = [
    { id: 10, args: ["f32"], result: "f32" },
    { id: 11, args: ["f32x2"], result: "f32x2" },
    { id: 12, args: ["f32x3"], result: "f32x3" },
    { id: 13, args: ["f32x4"], result: "f32x4" },
  ];
  const rounded: GpuFunctionTemplate = {
    bindingId: 3,
    name: "rounded",
    params: [x],
    result: sum,
    occurrenceTypes: new Map([[add, sum], [floor, sum]]),
    operations: [
      {
        kind: "operator",
        identity: "gpu.operator.add",
        occurrence: add,
        args: [x, NumberTy],
        result: sum,
        rows: [
          { id: 0, args: ["f32", "f32"], result: "f32" },
          { id: 1, args: ["f32x3", "f32"], result: "f32x3" },
        ],
        determiningArgs: [0, 1],
      },
      {
        kind: "builtin",
        identity: "floor",
        occurrence: floor,
        args: [sum],
        result: sum,
        rows,
        determiningArgs: [0],
      },
    ],
    calls: [],
  };
  const vector = tuple([NumberTy, NumberTy, NumberTy]);
  const instances = specializeGpuTemplates({
    rootBindingId: 3,
    rootArgs: [vector],
    rootResult: fresh(),
    templates: new Map([[3, rounded]]),
  });
  assertEquals(instances[0].operations.map((operation) => operation.row.id), [1, 12]);
  assertEquals(canonicalGpuType(instances[0].result), "(Number,Number,Number)");
});

Deno.test("v4 seed keys deduplicate fresh call-result variables", () => {
  const x = fresh();
  const sum = fresh();
  const add = expression("Binary");
  const twice: GpuFunctionTemplate = {
    bindingId: 2,
    name: "twice",
    params: [x],
    result: sum,
    occurrenceTypes: new Map([[add, sum]]),
    operations: [{
      kind: "operator",
      identity: "gpu.operator.add",
      occurrence: add,
      args: [x, x],
      result: sum,
      rows: arithmeticRows,
      determiningArgs: [0, 1],
    }],
    calls: [],
  };
  const firstResult = fresh();
  const secondResult = fresh();
  const firstCall = expression("Call") as Extract<Expr, { kind: "Call" }>;
  const secondCall = expression("Call") as Extract<Expr, { kind: "Call" }>;
  const vector = tuple([NumberTy, NumberTy, NumberTy]);
  const root: GpuFunctionTemplate = {
    bindingId: 1,
    name: "root",
    params: [],
    result: NumberTy,
    occurrenceTypes: new Map([[firstCall, firstResult], [secondCall, secondResult]]),
    operations: [],
    calls: [firstCall, secondCall].map((occurrence, index) => ({
      occurrence,
      targetBindingId: 2,
      args: [vector],
      result: index === 0 ? firstResult : secondResult,
      staticFunctionArgs: [undefined],
    })),
  };
  const instances = specializeGpuTemplates({
    rootBindingId: 1,
    rootArgs: [],
    rootResult: NumberTy,
    templates: new Map([[1, root], [2, twice]]),
  });
  assertEquals(instances.map((instance) => instance.seedKey), [
    "1<>",
    "2<(Number,Number,Number)>",
  ]);
  assertEquals(
    canonicalGpuType(instances[0].occurrenceTypes.get(firstCall)!),
    canonicalGpuType(vector),
  );
  assertEquals(
    canonicalGpuType(instances[0].occurrenceTypes.get(secondCall)!),
    canonicalGpuType(vector),
  );
});

Deno.test("v4 specialization IDs are independent of call discovery order", () => {
  const specialize = (shapes: ("scalar" | "vector")[]) => {
    const x = fresh();
    const sum = fresh();
    const add = expression("Binary");
    const twice: GpuFunctionTemplate = {
      bindingId: 2,
      name: "twice",
      params: [x],
      result: sum,
      occurrenceTypes: new Map([[add, sum]]),
      operations: [{
        kind: "operator",
        identity: "gpu.operator.add",
        occurrence: add,
        args: [x, x],
        result: sum,
        rows: arithmeticRows,
        determiningArgs: [0, 1],
      }],
      calls: [],
    };
    const calls = shapes.map((shape) => {
      const occurrence = expression("Call") as Extract<Expr, { kind: "Call" }>;
      const result = fresh();
      return {
        occurrence,
        targetBindingId: 2,
        args: [shape === "scalar" ? NumberTy : tuple([NumberTy, NumberTy, NumberTy])],
        result,
        staticFunctionArgs: [undefined],
      };
    });
    const root: GpuFunctionTemplate = {
      bindingId: 1,
      name: "root",
      params: [],
      result: NumberTy,
      occurrenceTypes: new Map(calls.map((call) => [call.occurrence, call.result])),
      operations: [],
      calls,
    };
    return specializeGpuTemplates({
      rootBindingId: 1,
      rootArgs: [],
      rootResult: NumberTy,
      templates: new Map([[1, root], [2, twice]]),
    }).map((instance) => ({
      id: instance.id,
      seed: instance.seedKey,
      result: canonicalGpuType(instance.result),
      rows: instance.operations.map((operation) => operation.row.id),
    }));
  };
  assertEquals(specialize(["scalar", "vector"]), specialize(["vector", "scalar"]));
});

Deno.test("v4 rejects polymorphic recursion instead of creating another seed", () => {
  const recursiveCall = expression("Call") as Extract<Expr, { kind: "Call" }>;
  const vector2 = tuple([NumberTy, NumberTy]);
  const vector3 = tuple([NumberTy, NumberTy, NumberTy]);
  const process: GpuFunctionTemplate = {
    bindingId: 1,
    name: "process",
    params: [vector2],
    result: vector2,
    occurrenceTypes: new Map([[recursiveCall, vector3]]),
    operations: [],
    calls: [{
      occurrence: recursiveCall,
      targetBindingId: 1,
      args: [vector3],
      result: vector3,
      staticFunctionArgs: [undefined],
    }],
  };
  const error = assertThrows(() =>
    specializeGpuTemplates({
      rootBindingId: 1,
      rootArgs: [vector2],
      rootResult: vector2,
      templates: new Map([[1, process]]),
    })
  );
  assertStringIncludes(String(error), "polymorphic recursion is not supported");
});

Deno.test("v4 rejects dynamic and returned function values before shader IR", () => {
  const dynamic: GpuFunctionTemplate = {
    bindingId: 1,
    name: "dynamic",
    params: [fn([NumberTy], NumberTy)],
    result: NumberTy,
    occurrenceTypes: new Map(),
    operations: [],
    calls: [],
  };
  const dynamicError = assertThrows(() =>
    specializeGpuTemplates({
      rootBindingId: 1,
      rootArgs: [fn([NumberTy], NumberTy)],
      rootResult: NumberTy,
      templates: new Map([[1, dynamic]]),
    })
  );
  assertStringIncludes(String(dynamicError), "runtime function value");

  const returned: GpuFunctionTemplate = {
    bindingId: 2,
    name: "returned",
    params: [],
    result: fn([NumberTy], NumberTy),
    occurrenceTypes: new Map(),
    operations: [],
    calls: [],
  };
  const returnedError = assertThrows(() =>
    specializeGpuTemplates({
      rootBindingId: 2,
      rootArgs: [],
      rootResult: fresh(),
      templates: new Map([[2, returned]]),
    })
  );
  assertStringIncludes(String(returnedError), "returns a function value");
});

Deno.test("v4 distinguishes ambiguous rows from insufficient argument context", () => {
  const specializeOperation = (
    argument: ReturnType<typeof fresh> | typeof NumberTy,
    rows: GpuOperationRow[],
  ) => {
    const occurrence = expression("Call");
    const result = fresh();
    const template: GpuFunctionTemplate = {
      bindingId: 1,
      name: "operation",
      params: [],
      result: NumberTy,
      occurrenceTypes: new Map([[occurrence, result]]),
      operations: [{
        kind: "builtin",
        identity: "testOperation",
        occurrence,
        args: [argument],
        result,
        rows,
        determiningArgs: [0],
      }],
      calls: [],
    };
    try {
      specializeGpuTemplates({
        rootBindingId: 1,
        rootArgs: [],
        rootResult: NumberTy,
        templates: new Map([[1, template]]),
      });
      throw new Error("expected specialization failure");
    } catch (error) {
      if (!(error instanceof GpuSpecializationError)) throw error;
      return error;
    }
  };
  const ambiguous = specializeOperation(NumberTy, [
    { id: 1, args: ["f32"], result: "f32" },
    { id: 2, args: ["f32"], result: "f32x2" },
  ]);
  assertEquals(ambiguous.code, "gpu.operation.ambiguous");
  assertStringIncludes(ambiguous.message, "multiple exact rows");

  const insufficient = specializeOperation(fresh(), [
    { id: 1, args: ["f32"], result: "f32" },
    { id: 2, args: ["f32x2"], result: "f32" },
  ]);
  assertEquals(insufficient.code, "gpu.operation.unresolved");
  assertStringIncludes(insufficient.message, "remains unresolved");
});

Deno.test("v4 does not select an operation backward from its expected result", () => {
  const argument = fresh();
  const result = fresh();
  const occurrence = expression("Call");
  const template: GpuFunctionTemplate = {
    bindingId: 1,
    name: "mapped",
    params: [],
    result,
    occurrenceTypes: new Map([[occurrence, result]]),
    operations: [{
      kind: "builtin",
      identity: "hypotheticalMapping",
      occurrence,
      args: [argument],
      result,
      rows: [
        { id: 1, args: ["f32"], result: "f32x2" },
        { id: 2, args: ["f32x2"], result: "f32" },
      ],
      determiningArgs: [0],
    }],
    calls: [],
  };
  const error = (() => {
    try {
      specializeGpuTemplates({
        rootBindingId: 1,
        rootArgs: [],
        rootResult: NumberTy,
        templates: new Map([[1, template]]),
      });
      throw new Error("expected specialization failure");
    } catch (caught) {
      if (!(caught instanceof GpuSpecializationError)) throw caught;
      return caught;
    }
  })();
  assertEquals(error.code, "gpu.operation.unresolved");
  assertEquals(prune(argument).tag, "var");
});

function expression(kind: Expr["kind"]): Expr {
  return { kind } as Expr;
}
