import type { Expr } from "./ast.ts";
import { isGpuLambda } from "./directives.ts";

export type LambdaExpr = Extract<Expr, { kind: "Lambda" }>;
export type RegionTraversalDecision = "descend" | "opaque";

export type RegionTraversal = {
  enterLambda(lambda: LambdaExpr): RegionTraversalDecision;
};

export const hostFfiRegionTraversal: RegionTraversal = {
  enterLambda: (lambda) => isGpuLambda(lambda) ? "opaque" : "descend",
};

export function hostFfiDescendsInto(lambda: LambdaExpr): boolean {
  return hostFfiRegionTraversal.enterLambda(lambda) === "descend";
}
