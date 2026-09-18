import type { Expr } from "./ast.ts";

export type InvocationPlan = Readonly<{
  /** Authored expression that owns the invocation result and semantic facts. */
  occurrence: Extract<Expr, { kind: "Call" | "Pipe" }>;
  callee: Expr;
  args: readonly Expr[];
  mode: "call" | "pipe-stage" | "pipe-insert" | "pipe-curried-stage";
}>;

export function callInvocationPlan(
  expression: Extract<Expr, { kind: "Call" }>,
): InvocationPlan {
  return {
    occurrence: expression,
    callee: expression.callee,
    args: expression.args,
    mode: "call",
  };
}

/**
 * Interpret Workman's pipe syntax once, without manufacturing replacement AST
 * nodes. Consumers retain the authored Pipe for source identity and use this
 * plan for its application and currying behavior.
 */
export function pipeInvocationPlan(
  expression: Extract<Expr, { kind: "Pipe" }>,
): InvocationPlan {
  const stage = expression.right;
  if (
    stage.kind === "Call" &&
    (stage.applicationStyle === "space" || stage.grouped === true)
  ) {
    return {
      occurrence: expression,
      callee: stage,
      args: [expression.left],
      mode: "pipe-curried-stage",
    };
  }
  if (stage.kind === "Call") {
    return {
      occurrence: expression,
      callee: stage.callee,
      args: [expression.left, ...stage.args],
      mode: "pipe-insert",
    };
  }
  return {
    occurrence: expression,
    callee: stage,
    args: [expression.left],
    mode: "pipe-stage",
  };
}
