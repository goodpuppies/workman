import type { Expr } from "../ast.ts";
import { fresh, instantiate, named, NumberTy, prune, tuple, type Ty } from "../types.ts";
import type { InferContext, TypingDialect } from "./context.ts";
import { constrainAt } from "./provenance.ts";
import { inferDottedVar } from "./records.ts";
import { inferExpr } from "./expr.ts";
import {
  type GpuOperationRow,
  type GpuOperationShape,
  recordGpuBuiltinFact,
  recordGpuOperationFact,
  recordGpuResourceCallFact,
} from "./type_facts.ts";
import {
  WMSLANG_BUILTIN_BLOCKERS,
  WMSLANG_BUILTIN_OVERLOADS,
  type WmslangBuiltinValueType,
} from "../wmslang/builtin_catalog.generated.ts";
import { diagnosticError } from "../diagnostics.ts";

export const gpuTypingDialect: TypingDialect = {
  domain: "gpu",
  inferUnboundVar: inferGpuUnboundVar,
  inferProjection: inferGpuProjection,
  inferTuple: inferGpuTuple,
  inferBinary: inferGpuBinary,
  inferCall: inferGpuBuiltinCall,
};

const builtinOverloadsByName = Map.groupBy(WMSLANG_BUILTIN_OVERLOADS, (overload) => overload.name);
const builtinBlockersByName = new Map(WMSLANG_BUILTIN_BLOCKERS.map((item) => [item.name, item]));
const builtinNames = [...builtinOverloadsByName.keys()];

const vectorLanes = new Map([
  ["x", 0],
  ["y", 1],
  ["z", 2],
  ["w", 3],
]);

function inferGpuUnboundVar(
  expr: Extract<Expr, { kind: "Var" }>,
): Ty | undefined {
  if (!builtinOverloadsByName.has(expr.name) && !builtinBlockersByName.has(expr.name)) {
    return undefined;
  }
  throw diagnosticError(
    new Error(
      `Slang builtin ${expr.name} may only appear as the direct callee of a GPU call; builtin function values, captures, and partial application are not supported`,
    ),
    expr.node,
    "gpu.builtin.first-class",
  );
}

function inferGpuTuple(
  expr: Extract<Expr, { kind: "Tuple" }>,
  items: Ty[],
  context: InferContext,
): Ty | undefined {
  if (items.length < 2 || items.length > 4) return undefined;
  const numeric = items.every((item) => {
    const target = prune(item);
    return isNumber(target) || target.tag === "var";
  });
  if (!numeric) return undefined;
  items.forEach((item, index) => {
    constrainAt(item, NumberTy, expr.items[index], undefined, [], context.provenance, {
      message: `GPU vector tuple component ${index}`,
      node: expr.items[index].node,
      span: expr.items[index].node?.span,
    });
  });
  return tuple(Array.from({ length: items.length }, () => NumberTy));
}

function inferGpuProjection(
  expr: Extract<Expr, { kind: "Var" }>,
  context: InferContext,
): Ty | undefined {
  const parts = expr.name.split(".");
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  const index = vectorLanes.get(parts.at(-1)!);
  if (index === undefined) return undefined;
  const receiver = parts.length === 2
    ? (() => {
      const scheme = context.env.get(parts[0]);
      return scheme ? instantiate(scheme) : undefined;
    })()
    : inferDottedVar(parts.slice(0, -1).join("."), context.env, context.typeEnv);
  if (!receiver) return undefined;
  const resolved = prune(receiver);
  if (resolved.tag === "var") {
    const minimumWidth = Math.max(2, index + 1);
    recordGpuOperationFact(context.facts, {
      kind: "projection",
      identity: `gpu.projection.${parts.at(-1)!}`,
      occurrence: expr,
      args: [receiver],
      result: NumberTy,
      rows: Array.from({ length: 5 - minimumWidth }, (_item, offset) => {
        const width = minimumWidth + offset;
        return { id: width, args: [`f32x${width}` as GpuOperationShape], result: "f32" };
      }),
      determiningArgs: [0],
    });
    return NumberTy;
  }
  const items = vectorItems(receiver);
  if (!items || index >= items.length) return undefined;
  items.forEach((item, lane) => {
    constrainAt(item, NumberTy, expr, undefined, [], context.provenance, {
      message: `GPU vector projection component ${lane}`,
      node: expr.node,
      span: expr.node?.span,
    });
  });
  return NumberTy;
}

function inferGpuBinary(
  expr: Extract<Expr, { kind: "Binary" }>,
  left: Ty,
  right: Ty,
  context: InferContext,
): Ty | undefined {
  if (
    expr.op !== "+" && expr.op !== "-" && expr.op !== "*" && expr.op !== "/" && expr.op !== "%"
  ) {
    return undefined;
  }
  const result = fresh();
  const rows = arithmeticRows();
  if (
    !rows.some((row) =>
      row.args.every((shape, index) => compatibleBuiltinShape([left, right][index], shape))
    )
  ) {
    throw diagnosticError(
      new Error(
        `GPU operation has no exact row for (${[left, right].map(showBuiltinShape).join(", ")})`,
      ),
      expr.node,
      "gpu.operation.overload",
    );
  }
  applyFiniteOperationSkeleton(expr, [left, right], result, rows, context);
  recordGpuOperationFact(context.facts, {
    kind: "operator",
    identity: `gpu.operator.${operatorName(expr.op)}`,
    occurrence: expr,
    args: [left, right],
    result,
    rows,
    determiningArgs: [0, 1],
  });
  return result;
}

function inferGpuBuiltinCall(
  expr: Extract<Expr, { kind: "Call" }>,
  context: InferContext,
): Ty | undefined {
  const resource = inferGpuResourceCall(expr, context);
  if (resource) return resource;
  if (
    expr.callee.kind !== "Var" || context.env.has(expr.callee.name)
  ) return undefined;
  const overloads = builtinOverloadsByName.get(expr.callee.name);
  if (!overloads) {
    const blocker = builtinBlockersByName.get(expr.callee.name);
    if (blocker) {
      throw diagnosticError(
        new Error(ineligibleBuiltinMessage(blocker)),
        expr.callee.node ?? expr.node,
        "gpu.builtin.ineligible",
      );
    }
    const suggestion = nearestBuiltin(expr.callee.name);
    throw diagnosticError(
      new Error(
        `unresolved GPU call ${expr.callee.name}${
          suggestion ? `; did you mean Slang builtin ${suggestion}?` : ""
        }`,
      ),
      expr.callee.node ?? expr.node,
      "gpu.builtin.unresolved",
    );
  }
  const args = expr.args.map((argument) => inferExpr(argument, context));
  const candidates = overloads.filter((overload) => overload.params.length === args.length);
  const compatible = candidates.filter((overload) =>
    overload.params.every((expected, index) => compatibleBuiltinShape(args[index], expected))
  );
  if (compatible.length === 0) {
    throw diagnosticError(
      new Error(
        `Slang builtin ${expr.callee.name} has no exact overload for (${
          args.map(showBuiltinShape).join(", ")
        })`,
      ),
      expr.node,
      "gpu.builtin.overload",
    );
  }
  const result = fresh();
  const rows = uniqueOperationRows(candidates.map((candidate) => ({
    id: candidate.id,
    args: candidate.params.map(hmBuiltinShape),
    result: hmBuiltinShape(candidate.result),
  })));
  applyFiniteOperationSkeleton(expr, args, result, rows, context);
  recordGpuBuiltinFact(context.facts, expr, expr.callee.name);
  recordGpuOperationFact(context.facts, {
    kind: "builtin",
    identity: expr.callee.name,
    occurrence: expr,
    args,
    result,
    rows,
    determiningArgs: args.map((_arg, index) => index),
  });
  return result;
}

function inferGpuResourceCall(
  expr: Extract<Expr, { kind: "Call" }>,
  context: InferContext,
): Ty | undefined {
  if (expr.callee.kind !== "Var") return undefined;
  const parts = expr.callee.name.split(".");
  const method = parts.at(-1);
  if (method !== "Sample" && method !== "Load") return undefined;
  const receiverName = parts.slice(0, -1).join(".");
  const receiver = inferGpuDottedValue(receiverName, context);
  if (!receiver || !isNamed(receiver, "Gpu.SampledTexture2D")) return undefined;
  const rgba = tuple([NumberTy, NumberTy, NumberTy, NumberTy]);
  if (method === "Sample") {
    if (expr.args.length !== 2) {
      throw diagnosticError(
        new Error("Gpu.SampledTexture2D.Sample requires a sampler and normalized f32x2 coordinate"),
        expr.node,
        "gpu.resource.overload",
      );
    }
    const sampler = inferExpr(expr.args[0], context);
    const samplerInfo = context.typeEnv.get("Gpu.Sampler");
    if (!samplerInfo) throw new Error("missing compiler-owned Gpu.Sampler type");
    constrainAt(sampler, named(samplerInfo), expr.args[0], undefined, [], context.provenance, {
      message: "sampled texture sampler",
      node: expr.args[0].node,
      span: expr.args[0].node?.span,
    });
    const coordinate = inferExpr(expr.args[1], context);
    constrainAt(
      coordinate,
      tuple([NumberTy, NumberTy]),
      expr.args[1],
      undefined,
      [],
      context.provenance,
      {
        message: "sampled texture normalized coordinate",
        node: expr.args[1].node,
        span: expr.args[1].node?.span,
      },
    );
    recordGpuResourceCallFact(context.facts, expr, { operation: "sample", receiverName });
    return rgba;
  }
  if (expr.args.length !== 1) {
    throw diagnosticError(
      new Error("Gpu.SampledTexture2D.Load requires one exact i32x3 coordinate"),
      expr.node,
      "gpu.resource.overload",
    );
  }
  const coordinate = inferExpr(expr.args[0], context);
  constrainAt(
    coordinate,
    tuple([NumberTy, NumberTy, NumberTy]),
    expr.args[0],
    undefined,
    [],
    context.provenance,
    {
      message: "sampled texture exact coordinate",
      node: expr.args[0].node,
      span: expr.args[0].node?.span,
    },
  );
  recordGpuResourceCallFact(context.facts, expr, { operation: "load", receiverName });
  return rgba;
}

function inferGpuDottedValue(name: string, context: InferContext): Ty | undefined {
  if (!name.includes(".")) {
    const scheme = context.env.get(name);
    return scheme ? instantiate(scheme) : undefined;
  }
  return inferDottedVar(name, context.env, context.typeEnv);
}

function isNamed(type: Ty, name: string): boolean {
  const target = prune(type);
  return target.tag === "named" && target.name === name;
}

function applyFiniteOperationSkeleton(
  expr: Expr,
  args: Ty[],
  result: Ty,
  availableRows: GpuOperationRow[],
  context: InferContext,
): void {
  const occurrences = [...args, result];
  const rowShapes = availableRows.map((row) => [...row.args, row.result]);
  for (let index = 0; index < occurrences.length; index += 1) {
    const fixed = unique(rowShapes.map((shapes) => shapes[index]));
    if (fixed.length === 1) constrainGpuShape(expr, occurrences[index], fixed[0], context);
  }
  for (let left = 0; left < occurrences.length; left += 1) {
    for (let right = left + 1; right < occurrences.length; right += 1) {
      if (rowShapes.every((shapes) => shapes[left] === shapes[right])) {
        constrainAt(
          occurrences[left],
          occurrences[right],
          expr,
          undefined,
          [],
          context.provenance,
          {
            message: "GPU catalog position equality",
            node: expr.node,
            span: expr.node?.span,
          },
        );
      }
    }
  }
}

function constrainGpuShape(
  expr: Expr,
  actual: Ty,
  expected: GpuOperationShape,
  context: InferContext,
): void {
  constrainAt(actual, semanticBuiltinType(expected), expr, undefined, [], context.provenance, {
    message: `GPU catalog fixed ${expected} position`,
    node: expr.node,
    span: expr.node?.span,
  });
}

function arithmeticRows(): GpuOperationRow[] {
  const shapes: GpuOperationShape[] = ["f32", "f32x2", "f32x3", "f32x4"];
  const rows: GpuOperationRow[] = [{ id: 0, args: ["f32", "f32"], result: "f32" }];
  for (let index = 1; index < shapes.length; index += 1) {
    const vector = shapes[index];
    rows.push(
      { id: rows.length, args: [vector, vector], result: vector },
      { id: rows.length + 1, args: [vector, "f32"], result: vector },
      { id: rows.length + 2, args: ["f32", vector], result: vector },
    );
  }
  return rows;
}

function operatorName(operator: string): string {
  if (operator === "+") return "add";
  if (operator === "-") return "subtract";
  if (operator === "*") return "multiply";
  if (operator === "%") return "remainder";
  return "divide";
}

function ineligibleBuiltinMessage(
  blocker: typeof WMSLANG_BUILTIN_BLOCKERS[number],
): string {
  const labels = blocker.categories.map((category) => {
    switch (category) {
      case "representation":
        return "unsupported type representation or exact-call semantics";
      case "parameter-mode":
        return "ref/out/inout parameter mode";
      case "effect":
        return "effectful or void operation";
      case "stage":
        return "fragment shader stage";
      case "target-capability":
        return "WGSL target capability";
    }
  });
  const example = blocker.sourceSignatures[0];
  return `Slang builtin ${blocker.name} is known but has no V3-eligible overload; blocked by ${
    labels.join(", ")
  }${example ? `. Declaration: ${example}` : ""}`;
}

function compatibleBuiltinShape(type: Ty, expected: WmslangBuiltinValueType): boolean {
  const target = prune(type);
  if (target.tag === "var") return true;
  if (!expected.includes("x")) return isNumber(target);
  const items = vectorItems(target);
  return items?.length === Number(expected.at(-1)) &&
    items.every((item) => prune(item).tag === "var" || isNumber(item));
}

function semanticBuiltinType(type: WmslangBuiltinValueType): Ty {
  if (!type.includes("x")) return NumberTy;
  const width = Number(type.at(-1));
  return tuple(Array.from({ length: width }, () => NumberTy));
}

function hmBuiltinShape(type: WmslangBuiltinValueType): GpuOperationShape {
  return (type.startsWith("i32") ? type.replace("i32", "f32") : type) as GpuOperationShape;
}

function uniqueOperationRows(rows: GpuOperationRow[]): GpuOperationRow[] {
  const unique = new Map<string, GpuOperationRow>();
  for (const row of rows) {
    const key = `${row.args.join(",")}->${row.result}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

function showBuiltinShape(type: Ty): string {
  const target = prune(type);
  if (isNumber(target)) return "f32";
  const items = vectorItems(target);
  if (items?.every(isNumber)) return `f32x${items.length}`;
  return target.tag;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function nearestBuiltin(name: string): string | undefined {
  let nearest: string | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of builtinNames) {
    const next = editDistance(name, candidate);
    if (next < distance || (next === distance && candidate < (nearest ?? candidate))) {
      nearest = candidate;
      distance = next;
    }
  }
  return distance <= Math.max(2, Math.floor(name.length / 3)) ? nearest : undefined;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_item, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[right.length];
}

function isNumber(type: Ty): boolean {
  const target = prune(type);
  return target.tag === "prim" && target.name === "Number";
}

function vectorItems(type: Ty): Ty[] | undefined {
  const resolved = prune(type);
  return resolved.tag === "tuple" && resolved.items.length >= 2 && resolved.items.length <= 4
    ? resolved.items
    : undefined;
}
