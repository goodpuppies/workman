import type { Expr, Param } from "../ast.ts";
import {
  diagnosticError,
  type FrontendDiagnostic,
  type FrontendRelatedDiagnostic,
  warningDiagnostic,
} from "../diagnostics.ts";
import {
  BoolTy,
  type Env,
  fn,
  fresh,
  instantiate,
  NumberTy,
  prune,
  quoteType,
  type Scheme,
  show,
  StringTy,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeFromAst,
  type TypeVarScope,
  VoidTy,
} from "../types.ts";
import type { Ty as TyNode } from "../types.ts";
import { isDecl } from "./ast_utils.ts";
import { inferDecl } from "./decl.ts";
import { assertEqualityType } from "./equality.ts";
import { checkExhaustive, mentionsLocalType } from "./exhaustiveness.ts";
import { warnRedundantMatchArms } from "./decl_helpers.ts";
import { assertJsonCompatible, jsonValueTy } from "./json.ts";
import { inferPattern } from "./patterns.ts";
import { constrainAt, rememberProvenance, type TypeProvenance } from "./provenance.ts";
import { inferDottedVar, inferRecordExpr } from "./records.ts";
import { callArg, constrain } from "./shared.ts";

export function inferExpr(
  expr: Expr,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[] = [],
  diagnostics: FrontendDiagnostic[] = [],
  provenance: TypeProvenance = new Map(),
): Ty {
  try {
    return inferExprInner(expr, env, typeEnv, adts, types, warnings, diagnostics, provenance);
  } catch (error) {
    throw diagnosticError(error, expr.node);
  }
}

function inferExprInner(
  expr: Expr,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[] = [],
  diagnostics: FrontendDiagnostic[] = [],
  provenance: TypeProvenance = new Map(),
): Ty {
  let t: Ty;
  switch (expr.kind) {
    case "Int":
    case "Float":
      t = NumberTy;
      break;
    case "String":
      t = StringTy;
      break;
    case "Bool":
      t = BoolTy;
      break;
    case "Void":
      t = VoidTy;
      break;
    case "Var": {
      const scheme = env.get(expr.name);
      if (!scheme) {
        t = inferDottedVar(expr.name, env, typeEnv);
        break;
      }
      t = instantiate(scheme);
      break;
    }
    case "Tuple":
      t = tuple(
        expr.items.map((x) =>
          inferExpr(x, env, typeEnv, adts, types, warnings, diagnostics, provenance)
        ),
      );
      break;
    case "Record":
      t = inferRecordExpr(
        expr,
        typeEnv,
        (value) => inferExpr(value, env, typeEnv, adts, types, warnings, diagnostics, provenance),
      );
      break;
    case "JsonObject":
      for (const field of expr.fields) {
        const valueType = inferExpr(
          field.value,
          env,
          typeEnv,
          adts,
          types,
          warnings,
          diagnostics,
          provenance,
        );
        assertJsonCompatible(valueType, typeEnv, field.value);
      }
      t = jsonValueTy(typeEnv);
      break;
    case "JsonArray":
      for (const item of expr.items) {
        const itemType = inferExpr(
          item,
          env,
          typeEnv,
          adts,
          types,
          warnings,
          diagnostics,
          provenance,
        );
        assertJsonCompatible(itemType, typeEnv, item);
      }
      t = jsonValueTy(typeEnv);
      break;
    case "Lambda": {
      const local = new Map(env);
      const annotationVars: TypeVarScope = new Map();
      const binders = new Set<string>();
      const params = expr.params.map((p) =>
        inferParam(p, local, typeEnv, adts, annotationVars, binders)
      );
      t = fn(
        [callArg(params)],
        inferExpr(expr.body, local, typeEnv, adts, types, warnings, diagnostics, provenance),
      );
      break;
    }
    case "Call":
      t = inferCall(expr, env, typeEnv, adts, types, warnings, diagnostics, provenance);
      break;
    case "If":
      constrain(
        inferExpr(expr.cond, env, typeEnv, adts, types, warnings, diagnostics, provenance),
        BoolTy,
      );
      t = inferExpr(expr.thenExpr, env, typeEnv, adts, types, warnings, diagnostics, provenance);
      constrain(
        t,
        inferExpr(expr.elseExpr, env, typeEnv, adts, types, warnings, diagnostics, provenance),
      );
      break;
    case "Match":
      t = inferMatch(expr, env, typeEnv, adts, types, warnings, diagnostics, provenance);
      break;
    case "Panic":
      constrain(
        inferExpr(expr.message, env, typeEnv, adts, types, warnings, diagnostics, provenance),
        StringTy,
      );
      t = fresh();
      break;
    case "Block":
      t = inferBlock(expr, env, typeEnv, adts, types, warnings, diagnostics, provenance);
      break;
    case "Binary":
      t = inferBinary(expr, env, typeEnv, adts, types, warnings, diagnostics, provenance);
      break;
    case "Unary":
      if (expr.op === "-") {
        constrain(
          inferExpr(expr.value, env, typeEnv, adts, types, warnings, diagnostics, provenance),
          NumberTy,
        );
        t = NumberTy;
      } else {
        constrain(
          inferExpr(expr.value, env, typeEnv, adts, types, warnings, diagnostics, provenance),
          BoolTy,
        );
        t = BoolTy;
      }
      break;
  }
  types.set(expr, t);
  return t;
}

function inferCall(
  expr: Extract<Expr, { kind: "Call" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const result = fresh();
  const isPrintCall = expr.callee.kind === "Var" && expr.callee.name === "print";
  const callee = inferExpr(
    expr.callee,
    env,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  const calleeProvenance = expr.callee.kind === "Var"
    ? (env.get(expr.callee.name)?.provenance ?? [])
    : [];
  const arg = callArg(
    expr.args.map((a) =>
      inferExpr(a, env, typeEnv, adts, types, warnings, diagnostics, provenance)
    ),
  );
  const calleeFn = prune(callee);
  if (calleeFn.tag === "fn" && calleeFn.params.length === 1) {
    const argExpr = expr.args.length === 1 ? expr.args[0] : expr;
    const calleeRelated = callCalleeRelated(expr.callee, calleeFn);
    const callDepth = maxCallDepth([...calleeRelated, ...calleeProvenance]) + 1;
    constrainAt(
      calleeFn.params[0],
      arg,
      argExpr,
      () => `type mismatch expected ${quoteType(calleeFn.params[0])}, got ${quoteType(arg)}`,
      [...calleeRelated, ...calleeProvenance],
      provenance,
      {
        message: "call argument",
        node: expr.node,
        span: expr.node?.span,
        primary: true,
        expectedCallTupleShape: callArity(calleeFn.params[0]),
        actualCallTupleShape: callArity(arg),
        callDepth,
      },
    );
    if (isPrintCall) assertPrintable(arg);
    if (expr.callee.kind === "Var" && env.get(expr.callee.name)?.jsImport) {
      assertJsCompatible(arg);
    }
    constrainAt(result, calleeFn.result, expr);
  } else {
    const callDepth = maxCallDepth([...callCalleeRelated(expr.callee, callee), ...calleeProvenance]) + 1;
    constrainAt(
      callee,
      fn([arg], result),
      expr,
      () => `type mismatch expected ${quoteType(fn([arg], result))}, got ${quoteType(callee)}`,
      [...callCalleeRelated(expr.callee, callee), ...calleeProvenance],
      provenance,
      {
        message: "call argument",
        node: expr.node,
        span: expr.node?.span,
        primary: true,
        expectedCallTupleShape: 1,
        actualCallTupleShape: 1,
        callDepth,
      },
    );
  }
  return result;
}

function assertPrintable(type: Ty) {
  if (containsNamedType(type, "Js.Error")) {
    throw new Error(`print requires an already-handled value, got ${quoteType(type)}`);
  }
}

function assertJsCompatible(type: Ty) {
  const t = prune(type);
  switch (t.tag) {
    case "prim":
    case "var":
      return;
    case "fn":
      t.params.forEach(assertJsCompatible);
      assertJsCompatible(t.result);
      return;
    case "tuple":
      t.items.forEach(assertJsCompatible);
      return;
    case "named":
      if (t.name === "Js.Value" || t.name === "Js.Object" || t.name === "Js.Error") return;
      if (t.name === "Option" && t.args.length === 1) {
        assertJsCompatible(t.args[0]);
        return;
      }
      throw new Error(`cannot pass ${quoteType(t)} to JS FFI call`);
  }
}

function containsNamedType(type: Ty, name: string): boolean {
  const target = prune(type);
  if (target.tag === "named") {
    return target.name === name || target.args.some((arg) => containsNamedType(arg, name));
  }
  if (target.tag === "fn") {
    return target.params.some((param) => containsNamedType(param, name)) ||
      containsNamedType(target.result, name);
  }
  if (target.tag === "tuple") return target.items.some((item) => containsNamedType(item, name));
  return false;
}

function callArity(type: TyNode): number {
  const t = prune(type);
  if (t.tag === "prim" && t.name === "Void") return 0;
  if (t.tag === "tuple") return t.items.length;
  return 1;
}

function maxCallDepth(related: FrontendRelatedDiagnostic[]): number {
  return related.reduce((max, item) => Math.max(max, item.callDepth ?? 0), 0);
}

function inferMatch(
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

function inferBlock(
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
      : inferExpr(s, local, localTypes, adts, types, warnings, diagnostics, provenance)
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

function inferBinary(
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
  const left = inferExpr(expr.left, env, typeEnv, adts, types, warnings, diagnostics, provenance);
  const right = inferExpr(expr.right, env, typeEnv, adts, types, warnings, diagnostics, provenance);
  constrain(
    instantiate(op),
    fn(
      [tuple([left, right])],
      result,
    ),
    rememberProvenance(provenance, {
      message: `operator ${expr.op}: ${quoteType(instantiate(op))}`,
      node: expr.node,
      span: expr.node?.span,
    }),
  );
  if (expr.op === "==" || expr.op === "!=") assertEqualityType(left, typeEnv, adts);
  return result;
}

function callCalleeRelated(callee: Expr, type: Ty): FrontendRelatedDiagnostic[] {
  if (!callee.node) return [];
  return [{
    message: callee.kind === "Var"
      ? `callee ${callee.name}: ${show(type)}`
      : `callee: ${show(type)}`,
    node: callee.node,
    span: callee.node.span,
  }];
}

function inferParam(
  param: Param,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  vars: TypeVarScope,
  binders: Set<string>,
): Ty {
  const expected = param.annotation ? typeFromAst(param.annotation, typeEnv, vars) : fresh();
  return inferPattern(param.pattern, expected, env, typeEnv, adts, binders);
}
