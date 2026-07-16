import type { Expr } from "../ast.ts";
import { NumberTy, prune, tuple, type Ty } from "../types.ts";
import type { InferContext, TypingDialect } from "./context.ts";
import { constrainAt } from "./provenance.ts";

export const gpuTypingDialect: TypingDialect = {
  domain: "gpu",
  inferBinary: inferGpuBinary,
};

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
