import type { Expr, Param } from "../ast.ts";
import { diagnosticError, type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import {
  type Env,
  fn,
  fresh,
  instantiate,
  prune,
  quoteType,
  type Scheme,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
} from "../types.ts";
import { isDecl } from "./ast_utils.ts";
import { inferDecl } from "./decl.ts";
import { assertEqualityType } from "./equality.ts";
import { checkExhaustive, mentionsLocalType } from "./exhaustiveness.ts";
import { warnRedundantMatchArms } from "./decl_helpers.ts";
import { inferPattern } from "./patterns.ts";
import { constrainAt, rememberProvenance, type TypeProvenance } from "./provenance.ts";
import { callArg, constrain } from "./shared.ts";
import { inferExpr } from "./expr.ts";
import { callArity } from "./expr_call.ts";

export function inferMatch(
  expr: Extract<Expr, { kind: "Match" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const valueType = inferExpr(
    expr.value,
    env,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  const result = fresh();
  for (const arm of expr.arms) {
    const local = new Map(env);
    inferPattern(arm.pattern, valueType, local, typeEnv, adts);
    const armType = inferExpr(
      arm.body,
      local,
      typeEnv,
      adts,
      types,
      warnings,
      diagnostics,
      provenance,
    );
    constrainAt(result, armType, arm.body, undefined, [], provenance, {
      message: "match arm result",
      node: arm.body.node,
      span: arm.body.node?.span,
    });
  }
  const armPatterns = expr.arms.map((arm) => arm.pattern);
  warnRedundantMatchArms(armPatterns, valueType, typeEnv, adts, warnings, diagnostics);
  const exhaustiveWarning = checkExhaustive(armPatterns, valueType, typeEnv, adts);
  if (exhaustiveWarning) {
    warnings.push(exhaustiveWarning);
    diagnostics.push(warningDiagnostic(exhaustiveWarning, expr.node, "pattern.non-exhaustive"));
  }
  return result;
}

export function inferBlock(
  expr: Extract<Expr, { kind: "Block" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const local = new Map(env);
  const localTypes = new Map(typeEnv);
  const outerTypeIds = new Set([...typeEnv.values()].map((info) => info.id));
  expr.items.forEach((s) =>
    isDecl(s)
      ? inferDecl(
        s,
        local,
        new Map(),
        localTypes,
        new Map(),
        adts,
        types,
        warnings,
        diagnostics,
        new Set([...localTypes.values()].map((info) => info.id)),
        provenance,
      )
      : inferExpr(
        s,
        local,
        localTypes,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      )
  );
  const result = inferExpr(
    expr.result,
    local,
    localTypes,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  if (mentionsLocalType(result, outerTypeIds)) throw new Error("local type escapes scope");
  return result;
}

export function inferBinary(
  expr: Extract<Expr, { kind: "Binary" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const result = fresh();
  const op: Scheme | undefined = env.get(expr.op);
  if (!op) throw new Error(`unknown operator ${expr.op}`);
  const left = inferExpr(
    expr.left,
    env,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  const right = inferExpr(
    expr.right,
    env,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  rejectEscapedUnresolvedFfi(expr.left, left, typeEnv);
  rejectEscapedUnresolvedFfi(expr.right, right, typeEnv);
  if (expr.op === "++") {
    rejectUnresolvedFfiResultOperand(expr.left, left, typeEnv);
    rejectUnresolvedFfiResultOperand(expr.right, right, typeEnv);
  }
  constrain(
    instantiate(op),
    fn([tuple([left, right])], result),
    rememberProvenance(provenance, {
      message: `operator ${expr.op}: ${quoteType(instantiate(op))}`,
      node: expr.node,
      span: expr.node?.span,
    }),
  );
  if (expr.op === "==" || expr.op === "!=") assertEqualityType(left, typeEnv, adts);
  return result;
}

function rejectEscapedUnresolvedFfi(expr: Expr, type: Ty, typeEnv: TypeEnv) {
  if (expr.kind !== "FfiGet" && expr.kind !== "FfiCall") return;
  if (!isResultType(type, typeEnv)) return;
  const kind = expr.kind === "FfiGet" ? "property" : "method";
  throw diagnosticError(
    new Error(
      `cannot infer JS FFI ${kind} ${
        expr.path.join(".")
      } for unconstrained receiver; unresolved JS FFI access is not a generic value`,
    ),
    expr.node,
  );
}

function rejectUnresolvedFfiResultOperand(expr: Expr, type: Ty, typeEnv: TypeEnv) {
  const value = resultValueType(type, typeEnv);
  if (!value || !containsTypeVar(value)) return;
  throw diagnosticError(
    new Error(
      "cannot use unresolved JS FFI result as a String; unresolved JS FFI access is not a generic value",
    ),
    expr.node,
  );
}

function isResultType(type: Ty, typeEnv: TypeEnv): boolean {
  return !!resultValueType(type, typeEnv);
}

function resultValueType(type: Ty, typeEnv: TypeEnv): Ty | undefined {
  const resolved = prune(type);
  const result = typeEnv.get("Result");
  if (!result || resolved.tag !== "named" || resolved.id !== result.id) return undefined;
  return resolved.args[0];
}

function containsTypeVar(type: Ty): boolean {
  const resolved = prune(type);
  if (resolved.tag === "var") return true;
  if (resolved.tag === "fn") {
    return resolved.params.some(containsTypeVar) || containsTypeVar(resolved.result);
  }
  if (resolved.tag === "tuple") return resolved.items.some(containsTypeVar);
  if (resolved.tag === "named") return resolved.args.some(containsTypeVar);
  return false;
}

export function inferParam(
  param: Param,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  binders: Set<string>,
): Ty {
  const expected = fresh();
  return inferPattern(param.pattern, expected, env, typeEnv, adts, binders);
}

export function inferPipe(
  expr: Extract<Expr, { kind: "Pipe" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const leftType = inferExpr(
    expr.left,
    env,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  const right = expr.right;

  if (right.kind === "Call") {
    const calleeType = inferExpr(
      right.callee,
      env,
      typeEnv,
      adts,
      types,
      warnings,
      diagnostics,
      provenance,
    );
    const argTypes = right.args.map((a) =>
      inferExpr(a, env, typeEnv, adts, types, warnings, diagnostics, provenance)
    );
    const allArgs = [leftType, ...argTypes];
    return constrainPipe(expr, calleeType, callArg(allArgs), provenance);
  }

  const calleeType = inferExpr(
    right,
    env,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  return constrainPipe(expr, calleeType, leftType, provenance);
}

function constrainPipe(
  expr: Extract<Expr, { kind: "Pipe" }>,
  calleeType: Ty,
  argType: Ty,
  provenance: TypeProvenance,
): Ty {
  const result = fresh();
  constrainAt(
    calleeType,
    fn([argType], result),
    expr,
    () =>
      `type mismatch expected ${quoteType(fn([argType], result))}, got ${quoteType(calleeType)}`,
    [],
    provenance,
    {
      message: "pipe argument",
      node: expr.node,
      span: expr.node?.span,
      primary: true,
      expectedCallTupleShape: callArity(argType),
      actualCallTupleShape: callArity(argType),
      callDepth: 0,
    },
  );
  return result;
}
