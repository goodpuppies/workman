import type { Expr } from "../ast.ts";
import { concreteFieldResults, sequenceType, taintedType } from "../taint.ts";
import type { Ty } from "../types.ts";
import type { InferContext } from "./context.ts";

const NONE: Ty[] = [];
const LITERALS = new Set<string>(["Int", "Float", "Char", "String", "Bool", "Void"]);

/** Only evaluated children contribute. A lambda's body is latent until application. */
function inputs(expr: Expr): Expr[] | undefined {
  switch (expr.kind) {
    case "FfiGet":
      return [expr.receiver];
    case "FfiCall":
      return [expr.receiver, ...expr.args];
    case "FfiBindingCall":
      return expr.args;
    case "Call":
      return [expr.callee, ...expr.args];
    case "If":
      // Branch results are joined by unification. Only the condition ran before them.
      return [expr.cond];
    case "Match":
      return [expr.value];
    case "Panic":
      return [expr.message];
    case "Ascribed":
    case "Unary":
      return [expr.value];
    case "Binary":
    case "Pipe":
      return [expr.left, expr.right];
    default:
      return undefined;
  }
}

export function taintExpression(expr: Expr, type: Ty, context: InferContext): Ty {
  if (context.dialect.domain === "gpu") return type;
  const tainted = expr.kind === "FfiGet" || expr.kind === "FfiCall" ||
    expr.kind === "FfiBindingCall" || (expr.kind === "Panic" && !expr.recoveryHole);
  const result = tainted ? taintedType(type) : type;
  const children = inputs(expr);
  if (!children) return result;
  if (expr.kind === "Call" && expr.callee.kind === "Var") {
    const status = context.env.get(expr.callee.name)?.status;
    if (status === "constructor" || status === "record-constructor") {
      const callee = context.types.get(expr.callee);
      return callee ? sequenceType(concreteFieldResults(callee), result) : result;
    }
  }
  let dependencies: Ty[] | undefined;
  let settled: Ty[] | undefined;
  for (const child of children) {
    const childType = context.types.get(child);
    if (!childType) continue;
    // A variable's binder already linked it, and literals have nothing to link.
    if (child.kind === "Var" || LITERALS.has(child.kind)) (settled ??= []).push(childType);
    else (dependencies ??= []).push(childType);
  }
  if (!dependencies && !settled) return result;
  return sequenceType(dependencies ?? NONE, result, settled);
}
