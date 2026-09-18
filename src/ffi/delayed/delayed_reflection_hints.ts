import type { Expr, TypeExpr } from "../../ast.ts";
import type { InferResult } from "../../infer.ts";
import { hostFfiDescendsInto } from "../../region_traversal.ts";
import { fn, name } from "../shared.ts";
import { type JsCallArgHint } from "../reflect/types.ts";
import {
  inferredType,
  jsArrayMember,
  jsArrayReceiver,
  knownTyToTypeExpr,
} from "./receiver_models.ts";
import { callArgHint } from "../shared.ts";
import { prune, type Ty } from "../../types.ts";

export function receiverTypeThroughObligations(
  type: Ty | undefined,
  seen = new Set<number>(),
): Ty | undefined {
  if (!type) return undefined;
  const target = prune(type);
  if (target.tag === "named" && target.name === "Result" && target.args.length === 2) {
    return receiverTypeThroughObligations(target.args[0], seen);
  }
  if (target.tag !== "ffi") return target;
  if (seen.has(target.id)) return undefined;
  seen.add(target.id);
  if (target.instance) return receiverTypeThroughObligations(target.instance, seen);
  for (const constraint of target.constraints ?? []) {
    const constrained = receiverTypeThroughObligations(constraint, seen);
    if (constrained) return constrained;
  }
  return undefined;
}

export function jsTypedArrayMember(
  array: NonNullable<ReturnType<typeof jsArrayReceiver>>,
  expr: Extract<Expr, { kind: "FfiCall" }>,
  result: InferResult,
) {
  if (expr.path.length !== 1) return undefined;
  if (expr.path[0] === "at") return jsArrayMember(array, expr.path);
  if (expr.path[0] !== "reduce" || expr.args.length !== 2) return undefined;
  const initial = inferredType(result, expr.args[1]);
  if (!initial) return undefined;
  const accumulator = knownTyToTypeExpr(initial);
  if (!accumulator) return undefined;
  return {
    name: "reduce",
    type: fn([
      fn([accumulator, array.element, name("Number"), array.type], accumulator),
      accumulator,
    ], accumulator),
  };
}

export function callArgHintForReflection(expr: Expr, result: InferResult): JsCallArgHint {
  if (expr.kind === "Var") {
    const occurrenceType = inferredType(result, expr);
    const scheme = occurrenceType ? undefined : result.env.get(expr.name);
    const candidate = occurrenceType ?? scheme?.type;
    const target = candidate ? prune(candidate) : undefined;
    if (target?.tag === "fn") {
      return {
        kind: "function",
        arity: jsFunctionArity(target),
        paramTypes: jsFunctionParamTypes(target),
        resultType: concreteReflectionHint(target.result),
      };
    }
  }
  const base = callArgHint(expr);
  if (base.kind !== "function") return base;
  const resultType = callbackReturnType(expr, result);
  const paramTypes = expr.kind === "Lambda"
    ? expr.params.map((param) => param.annotation).filter((type): type is TypeExpr => !!type)
    : undefined;
  return {
    ...base,
    paramTypes: paramTypes?.length ? paramTypes : undefined,
    resultType: resultType ?? undefined,
  };
}

/** Arguments which HM says remain after a contextually partial FFI call. */
export function contextualFfiCallArgHints(expr: Expr, result: InferResult): JsCallArgHint[] {
  const expected = contextualFfiFunctionConstraint(expr, result);
  return expected ? functionDomain(expected).map(callArgHintForType) : [];
}

export function contextualFfiFunctionConstraint(
  expr: Expr,
  result: InferResult,
): Extract<ReturnType<typeof prune>, { tag: "fn" }> | undefined {
  const inferred = inferredType(result, expr);
  const placeholder = inferred ? prune(inferred) : undefined;
  if (placeholder?.tag !== "ffi") return undefined;
  const functions = (placeholder.constraints ?? [])
    .map(prune)
    .filter((constraint): constraint is Extract<typeof constraint, { tag: "fn" }> =>
      constraint.tag === "fn"
    );
  if (functions.length === 0) return undefined;
  const arities = new Set(functions.map((constraint) => functionDomain(constraint).length));
  return arities.size === 1 ? functions[0] : undefined;
}

export function contextualFfiFunctionArity(expr: Expr, result: InferResult): number | undefined {
  const expected = contextualFfiFunctionConstraint(expr, result);
  return expected ? functionDomain(expected).length : undefined;
}

function functionDomain(type: Extract<ReturnType<typeof prune>, { tag: "fn" }>): Ty[] {
  if (type.params.length !== 1) return type.params;
  const domain = prune(type.params[0]);
  if (domain.tag === "prim" && domain.name === "Void") return [];
  return domain.tag === "tuple" ? domain.items : [domain];
}

function callArgHintForType(type: Ty): JsCallArgHint {
  const target = prune(type);
  if (target.tag !== "fn") return { kind: "unknown" };
  return {
    kind: "function",
    arity: jsFunctionArity(target),
    paramTypes: jsFunctionParamTypes(target),
    resultType: concreteReflectionHint(target.result),
  };
}

function jsFunctionArity(type: Extract<ReturnType<typeof prune>, { tag: "fn" }>): number {
  if (type.params.length !== 1) return type.params.length;
  const param = prune(type.params[0]);
  return param.tag === "tuple" ? param.items.length : type.params.length;
}

function jsFunctionParamTypes(type: Extract<ReturnType<typeof prune>, { tag: "fn" }>): TypeExpr[] {
  const first = type.params.length === 1 ? prune(type.params[0]) : undefined;
  const params = first?.tag === "tuple" ? first.items : type.params;
  const reflected = params.map(concreteReflectionHint);
  return reflected.every((item): item is TypeExpr => !!item) ? reflected : [];
}

function concreteReflectionHint(type: Ty): TypeExpr | undefined {
  const reflected = knownTyToTypeExpr(type);
  return reflected && !containsTypeVariable(reflected) ? reflected : undefined;
}

function containsTypeVariable(type: TypeExpr): boolean {
  switch (type.kind) {
    case "TVar":
      return true;
    case "TName":
      return type.args.some(containsTypeVariable);
    case "TTuple":
      return type.items.some(containsTypeVariable);
    case "TFn":
      return type.params.some(containsTypeVariable) || containsTypeVariable(type.result);
  }
}

function callbackReturnType(expr: Expr, result: InferResult): TypeExpr | undefined {
  if (expr.kind === "Lambda") {
    if (!hostFfiDescendsInto(expr)) return undefined;
    const bodyType = inferredType(result, expr.body);
    return bodyType ? knownTyToTypeExpr(bodyType) : undefined;
  }
  const type = inferredType(result, expr);
  const target = type ? prune(type) : undefined;
  return target?.tag === "fn" ? knownTyToTypeExpr(target.result) : undefined;
}
