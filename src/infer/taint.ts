import { type Expr, mapPatternExpressions } from "../ast.ts";
import {
  concreteFieldInputs,
  concreteFieldResults,
  outerInputs,
  sequenceType,
  taintedType,
} from "../taint.ts";
import { prune, type Ty } from "../types.ts";
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
      const computed: Expr[] = [];
      expr.arms.forEach((arm) =>
        mapPatternExpressions(arm.pattern, (value) => {
          computed.push(value);
          return value;
        })
      );
      return [expr.value, ...computed];
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

function constructed(args: Expr[], callee: Ty, result: Ty, context: InferContext): Ty {
  const evaluated = concreteFieldResults(callee);
  const signature = prune(callee);
  if (signature.tag !== "fn") return sequenceType(evaluated, result);
  const only = signature.params.length === 1 ? prune(signature.params[0]) : undefined;
  const fields = args.length > 1 && only?.tag === "tuple" ? only.items : signature.params;
  let settled: Ty[] | undefined;
  args.forEach((arg, index) => {
    const type = context.types.get(arg);
    if (!type || !fields[index] || LITERALS.has(arg.kind)) return;
    // As for any input, a variable's binder already linked it.
    concreteFieldInputs(fields[index], type, arg.kind === "Var" ? (settled ??= []) : evaluated);
  });
  return sequenceType(evaluated, result, settled);
}

/**
 * What a record literal's evaluated parts contribute, as a constructor call's arguments would. Add a
 * part before its field is unified, while a generic field is still an unbound variable.
 */
export type RecordInputs = { evaluated: Ty[]; settled: Ty[] };

export function addRecordPart(inputs: RecordInputs, value: Expr, type: Ty, field?: Ty): void {
  if (LITERALS.has(value.kind)) return;
  const out = value.kind === "Var" ? inputs.settled : inputs.evaluated;
  if (field) concreteFieldInputs(field, type, out);
  else outerInputs(type, out);
}

export function taintExpression(expr: Expr, type: Ty, context: InferContext): Ty {
  if (context.dialect.domain === "gpu") return type;
  const tainted = expr.kind === "FfiGet" || expr.kind === "FfiCall" ||
    expr.kind === "FfiBindingCall" || (expr.kind === "Panic" && !expr.hole);
  const result = tainted ? taintedType(type) : type;
  const children = inputs(expr);
  if (!children) return result;
  if (expr.kind === "Call" && expr.callee.kind === "Var") {
    const status = context.env.get(expr.callee.name)?.status;
    if (status === "constructor" || status === "record-constructor") {
      const callee = context.types.get(expr.callee);
      return callee ? constructed(expr.args, callee, result, context) : result;
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
