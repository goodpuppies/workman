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
  freshFfi,
  instantiate,
  named,
  NumberTy,
  prune,
  StringTy,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  type TypeVarScope,
  VoidTy,
} from "../types.ts";
import { assertJsonCompatible, jsonValueTy } from "./json.ts";
import { inferPattern } from "./patterns.ts";
import { type TypeProvenance } from "./provenance.ts";
import { inferDottedVar, inferRecordExpr } from "./records.ts";
import { callArg, constrain } from "./shared.ts";
import { ffiGetResultTy, inferCall } from "./expr_call.ts";
import { inferBinary, inferBlock, inferMatch, inferParam, inferPipe } from "./expr_flow.ts";

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
    return inferExprInner(
      expr,
      env,
      typeEnv,
      adts,
      types,
      warnings,
      diagnostics,
      provenance,
    );
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
        (value) =>
          inferExpr(
            value,
            env,
            typeEnv,
            adts,
            types,
            warnings,
            diagnostics,
            provenance,
          ),
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
    case "FfiGet": {
      const receiver = inferExpr(
        expr.receiver,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      const value =
        jsArrayFfiGetValue(typeEnv, receiver, expr.path) ??
        jsPrimitiveFfiGetValue(receiver, expr.path) ??
        freshFfi("get", receiver, expr.path, [], expr.node);
      t = ffiGetResultTy(
        typeEnv,
        value,
      );
      break;
    }
    case "FfiCall": {
      const receiver = inferExpr(
        expr.receiver,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      const args = expr.args.map((arg) =>
        inferExpr(arg, env, typeEnv, adts, types, warnings, diagnostics, provenance)
      );
      const value =
        jsArrayFfiCallValue(typeEnv, receiver, expr.path, args) ??
        jsPromiseFfiCallValue(typeEnv, receiver, expr.path, args) ??
        jsPrimitiveFfiCallValue(receiver, expr.path, args) ??
        freshFfi("call", receiver, expr.path, args, expr.node);
      t = ffiGetResultTy(
        typeEnv,
        value,
      );
      break;
    }
    case "Lambda": {
      const local = new Map(env);
      const annotationVars: TypeVarScope = new Map();
      const binders = new Set<string>();
      const params = expr.params.map((p) =>
        inferParam(p, local, typeEnv, adts, annotationVars, binders)
      );
      t = fn(
        [callArg(params)],
        inferExpr(
          expr.body,
          local,
          typeEnv,
          adts,
          types,
          warnings,
          diagnostics,
          provenance,
        ),
      );
      break;
    }
    case "Call":
      t = inferCall(
        expr,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "If":
      constrain(
        inferExpr(
          expr.cond,
          env,
          typeEnv,
          adts,
          types,
          warnings,
          diagnostics,
          provenance,
        ),
        BoolTy,
      );
      t = inferExpr(
        expr.thenExpr,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      constrain(
        t,
        inferExpr(
          expr.elseExpr,
          env,
          typeEnv,
          adts,
          types,
          warnings,
          diagnostics,
          provenance,
        ),
      );
      break;
    case "Match":
      t = inferMatch(
        expr,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "Panic":
      constrain(
        inferExpr(
          expr.message,
          env,
          typeEnv,
          adts,
          types,
          warnings,
          diagnostics,
          provenance,
        ),
        StringTy,
      );
      t = fresh();
      break;
    case "Block":
      t = inferBlock(
        expr,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "Binary":
      t = inferBinary(
        expr,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "Unary":
      if (expr.op === "-") {
        constrain(
          inferExpr(
            expr.value,
            env,
            typeEnv,
            adts,
            types,
            warnings,
            diagnostics,
            provenance,
          ),
          NumberTy,
        );
        t = NumberTy;
      } else {
        constrain(
          inferExpr(
            expr.value,
            env,
            typeEnv,
            adts,
            types,
            warnings,
            diagnostics,
            provenance,
          ),
          BoolTy,
        );
        t = BoolTy;
      }
      break;
    case "Pipe":
      t = inferPipe(
        expr,
        env,
        typeEnv,
        adts,
        types,
        warnings,
        diagnostics,
        provenance,
      );
      break;
  }
  types.set(expr, t);
  return t;
}

function jsArrayFfiGetValue(typeEnv: TypeEnv, receiver: Ty, path: string[]): Ty | undefined {
  const array = jsArrayElement(typeEnv, receiver);
  if (!array || path.length !== 1) return undefined;
  if (path[0] === "length") return NumberTy;
  return undefined;
}

function jsArrayFfiCallValue(
  typeEnv: TypeEnv,
  receiver: Ty,
  path: string[],
  args: Ty[],
): Ty | undefined {
  const element = jsArrayElement(typeEnv, receiver);
  if (!element || path.length !== 1) return undefined;
  const member = path[0];
  if (member === "join") return StringTy;
  if (member !== "map" || args.length !== 1) return undefined;
  const mapped = fresh("mapped");
  constrain(args[0], fn([tuple([element, NumberTy, jsArrayTy(typeEnv, element)])], mapped));
  return jsArrayTy(typeEnv, mapped);
}

function jsArrayElement(typeEnv: TypeEnv, receiver: Ty): Ty | undefined {
  const target = prune(receiver);
  if (target.tag !== "named" || target.id !== typeEnv.get("Js.Array")?.id) return undefined;
  return target.args[0];
}

function jsPrimitiveFfiGetValue(receiver: Ty, path: string[]): Ty | undefined {
  const target = prune(receiver);
  if (path.length !== 1 || target.tag !== "prim") return undefined;
  if (target.name === "String" && path[0] === "length") return NumberTy;
  return undefined;
}

function jsPrimitiveFfiCallValue(receiver: Ty, path: string[], args: Ty[]): Ty | undefined {
  const target = prune(receiver);
  if (path.length !== 1 || target.tag !== "prim") return undefined;
  const member = path[0];
  if (target.name === "Number" && member === "toString") {
    if (args.length > 1) return undefined;
    if (args[0]) constrain(args[0], NumberTy);
    return StringTy;
  }
  if (target.name === "String" && member === "slice") {
    if (args.length < 1 || args.length > 2) return undefined;
    constrain(args[0], NumberTy);
    if (args[1]) constrain(args[1], NumberTy);
    return StringTy;
  }
  if (target.name === "String" && member === "padStart") {
    if (args.length !== 2) return undefined;
    constrain(args[0], NumberTy);
    constrain(args[1], StringTy);
    return StringTy;
  }
  return undefined;
}

function jsArrayTy(typeEnv: TypeEnv, element: Ty): Ty {
  const info = typeEnv.get("Js.Array");
  if (!info) throw new Error("unknown type Js.Array");
  return named(info, [element]);
}

function jsPromiseFfiCallValue(
  typeEnv: TypeEnv,
  receiver: Ty,
  path: string[],
  args: Ty[],
): Ty | undefined {
  const element = jsPromiseElement(typeEnv, receiver);
  if (!element || path.length !== 1 || args.length !== 1) return undefined;
  const member = path[0];
  if (member === "then") {
    const mapped = fresh("mapped");
    const expected = fn([element], mapped);
    constrain(jsPromiseCallbackActual(typeEnv, expected, args[0]), expected);
    return jsPromiseTy(typeEnv, jsPromiseElement(typeEnv, mapped) ?? mapped);
  }
  if (member === "catch") {
    return jsPromiseTy(typeEnv, element);
  }
  return undefined;
}

function jsPromiseElement(typeEnv: TypeEnv, receiver: Ty): Ty | undefined {
  const target = prune(receiver);
  if (target.tag !== "named" || target.id !== typeEnv.get("Js.Promise")?.id) return undefined;
  return target.args[0];
}

function jsPromiseTy(typeEnv: TypeEnv, element: Ty): Ty {
  const info = typeEnv.get("Js.Promise");
  if (!info) throw new Error("unknown type Js.Promise");
  return named(info, [element]);
}

function jsPromiseCallbackActual(typeEnv: TypeEnv, expected: Ty, actual: Ty): Ty {
  const expectedFn = prune(expected);
  const actualFn = prune(actual);
  if (
    expectedFn.tag !== "fn" || actualFn.tag !== "fn" ||
    expectedFn.params.length !== 1 || actualFn.params.length !== 1
  ) {
    return actual;
  }
  if (
    !isJsObjectLikeTy(typeEnv, expectedFn.params[0]) || !isJsValueTy(typeEnv, actualFn.params[0])
  ) {
    return actual;
  }
  return fn([expectedFn.params[0]], actualFn.result);
}

function isJsValueTy(typeEnv: TypeEnv, type: Ty): boolean {
  const target = prune(type);
  return target.tag === "named" && target.id === typeEnv.get("Js.Value")?.id;
}

function isJsObjectLikeTy(typeEnv: TypeEnv, type: Ty): boolean {
  const target = prune(type);
  if (target.tag !== "named") return false;
  return target.id === typeEnv.get("Js.Object")?.id ||
    target.id === typeEnv.get("Js.Array")?.id ||
    target.id === typeEnv.get("Js.Promise")?.id ||
    Boolean(target.foreign || typeEnv.get(target.name)?.foreign);
}

