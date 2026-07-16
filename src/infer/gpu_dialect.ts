import type { Expr } from "../ast.ts";
import { addGpuConstraint, instantiate, NumberTy, prune, tuple, type Ty } from "../types.ts";
import type { InferContext, TypingDialect } from "./context.ts";
import { constrainAt } from "./provenance.ts";

export const gpuTypingDialect: TypingDialect = {
  domain: "gpu",
  inferProjection: inferGpuProjection,
  inferBinary: inferGpuBinary,
};

const vectorLanes = new Map([
  ["x", 0],
  ["y", 1],
  ["z", 2],
  ["w", 3],
]);

function inferGpuProjection(
  expr: Extract<Expr, { kind: "Var" }>,
  context: InferContext,
): Ty | undefined {
  const parts = expr.name.split(".");
  if (parts.length !== 2) return undefined;
  const index = vectorLanes.get(parts[1]);
  const scheme = context.env.get(parts[0]);
  if (index === undefined || !scheme) return undefined;
  const receiver = instantiate(scheme);
  const resolved = prune(receiver);
  if (resolved.tag === "var") {
    addGpuConstraint(receiver, (bound) => assertProjectedVector(bound, index, expr));
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

function assertProjectedVector(type: Ty, index: number, expr: Expr): void {
  const items = vectorItems(type);
  if (!items || index >= items.length || !items.every(isNumber)) {
    throw new Error(
      `GPU vector projection ${expr.kind === "Var" ? expr.name : ""} is out of bounds`,
    );
  }
}

function inferGpuBinary(
  expr: Extract<Expr, { kind: "Binary" }>,
  left: Ty,
  right: Ty,
  context: InferContext,
): Ty | undefined {
  if (expr.op !== "+" && expr.op !== "-" && expr.op !== "*" && expr.op !== "/") {
    return undefined;
  }
  const leftItems = vectorItems(left);
  const rightItems = vectorItems(right);
  const leftType = prune(left);
  const rightType = prune(right);
  if (leftType.tag === "var" && rightItems) {
    const result = tuple(Array.from({ length: rightItems.length }, () => NumberTy));
    constrainAt(left, result, expr, undefined, [], context.provenance, {
      message: `GPU operator ${expr.op} left vector shape`,
      node: expr.node,
      span: expr.node?.span,
    });
    rightItems.forEach((operand, index) => {
      constrainNumericOperand(expr, operand, `right component ${index}`, context);
    });
    return result;
  }
  if (rightType.tag === "var" && leftItems) {
    const result = tuple(Array.from({ length: leftItems.length }, () => NumberTy));
    constrainAt(right, result, expr, undefined, [], context.provenance, {
      message: `GPU operator ${expr.op} right vector shape`,
      node: expr.node,
      span: expr.node?.span,
    });
    leftItems.forEach((operand, index) => {
      constrainNumericOperand(expr, operand, `left component ${index}`, context);
    });
    return result;
  }
  if (leftType.tag === "var" && isNumber(rightType)) {
    addGpuConstraint(left, assertNumericShape);
    return left;
  }
  if (rightType.tag === "var" && isNumber(leftType)) {
    addGpuConstraint(right, assertNumericShape);
    return right;
  }
  if (!leftItems && !rightItems) return undefined;
  if (leftItems && rightItems && leftItems.length !== rightItems.length) return undefined;

  const width = leftItems?.length ?? rightItems?.length;
  if (!width) return undefined;
  const leftOperands = leftItems ?? Array.from({ length: width }, () => left);
  const rightOperands = rightItems ?? Array.from({ length: width }, () => right);
  leftOperands.forEach((operand, index) => {
    constrainNumericOperand(expr, operand, `left component ${index}`, context);
  });
  rightOperands.forEach((operand, index) => {
    constrainNumericOperand(expr, operand, `right component ${index}`, context);
  });
  return tuple(Array.from({ length: width }, () => NumberTy));
}

function isNumber(type: Ty): boolean {
  const target = prune(type);
  return target.tag === "prim" && target.name === "Number";
}

function assertNumericShape(type: Ty): void {
  const target = prune(type);
  if (isNumber(target)) return;
  if (
    target.tag === "tuple" && target.items.length >= 2 && target.items.length <= 4 &&
    target.items.every(isNumber)
  ) return;
  throw new Error("GPU arithmetic expects a Number or a homogeneous numeric tuple of width 2-4");
}

function vectorItems(type: Ty): Ty[] | undefined {
  const resolved = prune(type);
  return resolved.tag === "tuple" && resolved.items.length >= 2 && resolved.items.length <= 4
    ? resolved.items
    : undefined;
}

function constrainNumericOperand(
  expr: Extract<Expr, { kind: "Binary" }>,
  operand: Ty,
  role: string,
  context: InferContext,
): void {
  constrainAt(operand, NumberTy, expr, undefined, [], context.provenance, {
    message: `GPU operator ${expr.op} ${role}`,
    node: expr.node,
    span: expr.node?.span,
  });
}
