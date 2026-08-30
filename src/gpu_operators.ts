import type { Expr } from "./ast.ts";

export const GPU_OPERATOR_IDS = {
  negate: "gpu.operator.negate",
  not: "gpu.operator.not",
  add: "gpu.operator.add",
  subtract: "gpu.operator.subtract",
  multiply: "gpu.operator.multiply",
  divide: "gpu.operator.divide",
  remainder: "gpu.operator.remainder",
  lessThan: "gpu.operator.less-than",
  lessThanOrEqual: "gpu.operator.less-than-or-equal",
  greaterThan: "gpu.operator.greater-than",
  greaterThanOrEqual: "gpu.operator.greater-than-or-equal",
  equal: "gpu.operator.equal",
  notEqual: "gpu.operator.not-equal",
  and: "gpu.operator.and",
  or: "gpu.operator.or",
} as const;

export type GpuOperatorId = (typeof GPU_OPERATOR_IDS)[keyof typeof GPU_OPERATOR_IDS];
export type OperatorExpr = Extract<Expr, { kind: "Unary" | "Binary" }>;

const unary = new Map<string, GpuOperatorId>([
  ["-", GPU_OPERATOR_IDS.negate],
  ["!", GPU_OPERATOR_IDS.not],
]);

const binary = new Map<string, GpuOperatorId>([
  ["+", GPU_OPERATOR_IDS.add],
  ["-", GPU_OPERATOR_IDS.subtract],
  ["*", GPU_OPERATOR_IDS.multiply],
  ["/", GPU_OPERATOR_IDS.divide],
  ["%", GPU_OPERATOR_IDS.remainder],
  ["<", GPU_OPERATOR_IDS.lessThan],
  ["<=", GPU_OPERATOR_IDS.lessThanOrEqual],
  [">", GPU_OPERATOR_IDS.greaterThan],
  [">=", GPU_OPERATOR_IDS.greaterThanOrEqual],
  ["==", GPU_OPERATOR_IDS.equal],
  ["!=", GPU_OPERATOR_IDS.notEqual],
  ["&&", GPU_OPERATOR_IDS.and],
  ["||", GPU_OPERATOR_IDS.or],
]);

export function gpuOperatorId(expression: OperatorExpr): GpuOperatorId | undefined {
  return expression.kind === "Unary" ? unary.get(expression.op) : binary.get(expression.op);
}
