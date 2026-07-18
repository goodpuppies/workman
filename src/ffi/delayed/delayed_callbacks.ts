import type { Decl, Expr, TypeExpr } from "../../ast.ts";
import type { InferResult } from "../../infer.ts";
import { hostFfiDescendsInto } from "../../region_traversal.ts";
import { collectExprs } from "../../type_debug_collect.ts";
import { prune } from "../../types.ts";
import {
  ffiCallPromiseElement,
  inferredType,
  jsArrayReceiver,
  jsPromiseMember,
  jsPromiseReceiver,
  jsPromiseReceiverTypeExpr,
  knownTyToTypeExpr,
  promiseCallbackResultType,
  tyToTypeExpr,
  withCallbackParamRefs,
} from "./receiver_models.ts";
import { callArgHint, type FfiElaboration, isDecl, selectVariant } from "../shared.ts";
import {
  type JsCallArgHint,
  jsRefCallMember,
  jsRefTypeExpr,
  jsTypeExprValueRef,
} from "../reflect/types.ts";
import { typeExprKey as reflectTypeExprKey } from "../reflect/ts_type_expr.ts";

export function contextualizeDelayedCallbacks(
  ffi: FfiElaboration,
  result: InferResult,
): FfiElaboration {
  const annotationCount = callbackAnnotationCount(ffi.module);
  const arities = namedLambdaArities(ffi.module.decls);
  const contexts = collectNamedCallbackContexts(ffi.module.decls, result, arities, ffi.bindings);
  const contextual = {
    ...ffi,
    module: {
      ...ffi.module,
      decls: ffi.module.decls.map((decl) =>
        contextualizeDecl(decl, result, arities, contexts, ffi.bindings)
      ),
    },
  };
  return callbackAnnotationCount(contextual.module) === annotationCount ? ffi : contextual;
}

function callbackAnnotationCount(module: FfiElaboration["module"]): number {
  let count = 0;
  for (const expr of collectExprs(module)) {
    if (expr.kind !== "Lambda") continue;
    count += expr.params.filter((param) => param.annotation !== undefined).length;
  }
  return count;
}

function collectNamedCallbackContexts(
  decls: Decl[],
  result: InferResult,
  arities: Map<string, number>,
  bindings: FfiElaboration["bindings"],
): Map<string, TypeExpr[]> {
  const contexts = new Map<string, TypeExpr[]>();
  const visitDecl = (decl: Decl) => {
    if (decl.kind !== "LetDecl") return;
    for (const binding of decl.bindings) visitExpr(binding.value);
  };
  const visitExpr = (expr: Expr) => {
    switch (expr.kind) {
      case "FfiCall":
        collectFfiCallCallbackContexts(expr, result, arities, contexts, new Map());
        visitExpr(expr.receiver);
        expr.args.forEach(visitExpr);
        return;
      case "FfiBindingCall":
        collectFfiBindingCallCallbackContexts(expr, arities, contexts, bindings);
        expr.args.forEach(visitExpr);
        return;
      case "Call":
        visitExpr(expr.callee);
        expr.args.forEach(visitExpr);
        return;
      case "Tuple":
      case "JsonArray":
        expr.items.forEach(visitExpr);
        return;
      case "Record":
      case "JsonObject":
        expr.fields.forEach((field) => visitExpr(field.value));
        return;
      case "Lambda":
        if (!hostFfiDescendsInto(expr)) return;
        visitExpr(expr.body);
        return;
      case "If":
        visitExpr(expr.cond);
        visitExpr(expr.thenExpr);
        visitExpr(expr.elseExpr);
        return;
      case "Match":
        visitExpr(expr.value);
        expr.arms.forEach((arm) => visitExpr(arm.body));
        return;
      case "Panic":
        visitExpr(expr.message);
        return;
      case "Block":
        for (const item of expr.items) {
          if (isDecl(item)) visitDecl(item);
          else visitExpr(item);
        }
        visitExpr(expr.result);
        return;
      case "Binary":
        visitExpr(expr.left);
        visitExpr(expr.right);
        return;
      case "Unary":
        visitExpr(expr.value);
        return;
      case "Pipe":
        visitExpr(expr.left);
        visitExpr(expr.right);
        return;
      case "FfiGet":
        visitExpr(expr.receiver);
        return;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        return;
    }
  };
  decls.forEach(visitDecl);
  return contexts;
}

function collectFfiBindingCallCallbackContexts(
  expr: Extract<Expr, { kind: "FfiBindingCall" }>,
  arities: Map<string, number>,
  contexts: Map<string, TypeExpr[]>,
  bindings: FfiElaboration["bindings"],
) {
  for (const callback of callbackParamTypesForFfiBindingCall(expr, arities, bindings)) {
    const arg = expr.args[callback.argIndex];
    if (arg?.kind !== "Var") continue;
    if (callback.params.length) contexts.set(arg.name, callback.params);
  }
}

function callbackParamTypesForFfiBindingCall(
  expr: Extract<Expr, { kind: "FfiBindingCall" }>,
  arities: Map<string, number>,
  bindings: FfiElaboration["bindings"],
): { argIndex: number; params: TypeExpr[] }[] {
  const binding = bindings.get(expr.name);
  const variant = binding
    ? selectVariant(
      binding.variants,
      expr.args.map((arg) =>
        arg.kind === "Var" && arities.has(arg.name)
          ? {
            ...arg,
            kind: "Lambda" as const,
            params: Array.from({ length: arities.get(arg.name)! }, () => ({
              pattern: { kind: "PWildcard" as const },
            })),
            directives: [],
            body: arg,
          }
          : arg
      ),
    )
    : undefined;
  return (variant?.callbackParamRefs ?? []).map((callback) => ({
    argIndex: callback.argIndex,
    params: callback.params.map((ref) => ref.type).filter((type): type is TypeExpr => !!type),
  }));
}

function collectFfiCallCallbackContexts(
  expr: Extract<Expr, { kind: "FfiCall" }>,
  result: InferResult,
  arities: Map<string, number>,
  contexts: Map<string, TypeExpr[]>,
  localTypes: Map<string, TypeExpr>,
) {
  for (const callback of callbackParamTypesForFfiCall(expr, result, arities, localTypes)) {
    const arg = expr.args[callback.argIndex];
    if (arg?.kind !== "Var") continue;
    if (callback.params.length) contexts.set(arg.name, callback.params);
  }
}

function callbackParamTypesForFfiCall(
  expr: Extract<Expr, { kind: "FfiCall" }>,
  result: InferResult,
  arities: Map<string, number>,
  localTypes: Map<string, TypeExpr> = new Map(),
): { argIndex: number; params: TypeExpr[] }[] {
  const localReceiverType = expr.receiver.kind === "Var"
    ? localTypes.get(expr.receiver.name)
    : undefined;
  const receiverType = localReceiverType ? undefined : inferredType(result, expr.receiver);
  const array = localReceiverType
    ? jsArrayReceiverTypeExpr(localReceiverType)
    : jsArrayReceiver(receiverType);
  const promise = localReceiverType
    ? jsPromiseReceiverTypeExpr(localReceiverType)
    : jsPromiseReceiver(receiverType);
  // Eager inference already contextualizes callback params for these typed members when the
  // receiver type was inferred; reflected annotations would only fight those constraints with
  // broader overloads. Receivers known only through selected FFI bindings still need annotations.
  if (
    !localReceiverType && array && expr.path.length === 1 &&
    eagerTypedArrayMembers.has(expr.path[0])
  ) {
    return [];
  }
  if (
    !localReceiverType && promise && expr.path.length === 1 &&
    eagerTypedPromiseMembers.has(expr.path[0])
  ) {
    return [];
  }
  const ref = array
    ? jsTypeExprValueRef(`array:${reflectTypeExprKey(array.type)}`, array.type)
    : promise
    ? jsTypeExprValueRef(`promise:${reflectTypeExprKey(promise.type)}`, promise.type)
    : undefined;
  if (!ref) return [];
  const member = jsRefCallMember(
    ref,
    expr.path,
    expr.args.map((arg) => callArgHintFromNamedArity(arg, arities)),
  );
  return (member?.variants?.[0]?.callbackParamRefs ?? []).map((callback) => ({
    argIndex: callback.argIndex,
    params: callback.params.map((ref) => ref.type).filter((type): type is TypeExpr => !!type),
  }));
}

const eagerTypedArrayMembers = new Set(["at", "join", "map", "reduce", "filter", "includes"]);
const eagerTypedPromiseMembers = new Set(["then", "catch"]);

function callArgHintFromNamedArity(
  expr: Expr,
  arities: Map<string, number>,
): JsCallArgHint {
  if (expr.kind === "Var") {
    const arity = arities.get(expr.name);
    if (arity !== undefined) return { kind: "function", arity };
  }
  return callArgHint(expr);
}

function namedLambdaArities(decls: Decl[]): Map<string, number> {
  const arities = new Map<string, number>();
  const visitDecl = (decl: Decl) => {
    if (decl.kind !== "LetDecl") return;
    for (const binding of decl.bindings) {
      if (binding.pattern.kind === "PVar" && binding.value.kind === "Lambda") {
        arities.set(binding.pattern.name, binding.value.params.length);
      }
      visitExpr(binding.value);
    }
  };
  const visitExpr = (expr: Expr) => {
    if (expr.kind !== "Block") return;
    for (const item of expr.items) if (isDecl(item)) visitDecl(item);
  };
  decls.forEach(visitDecl);
  return arities;
}

function contextualizeDecl(
  decl: Decl,
  result: InferResult,
  arities: Map<string, number>,
  contexts: Map<string, TypeExpr[]>,
  bindings: FfiElaboration["bindings"],
): Decl {
  if (decl.kind !== "LetDecl") return decl;
  return {
    ...decl,
    bindings: decl.bindings.map((binding) => {
      const value = contextualizeExpr(binding.value, result, arities, new Map(), bindings);
      if (binding.pattern.kind !== "PVar" || binding.value.kind !== "Lambda") return binding;
      if (!hostFfiDescendsInto(binding.value)) return binding;
      const params = contexts.get(binding.pattern.name);
      if (!params) return { ...binding, value };
      return {
        ...binding,
        value: {
          ...value as Extract<Expr, { kind: "Lambda" }>,
          params: (value as Extract<Expr, { kind: "Lambda" }>).params.map((param, index) => ({
            ...param,
            annotation: param.annotation ?? params[index],
          })),
        },
      };
    }),
  };
}

function contextualizeExpr(
  expr: Expr,
  result: InferResult,
  arities: Map<string, number>,
  localTypes: Map<string, TypeExpr> = new Map(),
  bindings: FfiElaboration["bindings"] = new Map(),
): Expr {
  switch (expr.kind) {
    case "FfiCall": {
      const callbackParams = new Map(
        callbackParamTypesForFfiCall(expr, result, arities, localTypes).map((callback) => [
          callback.argIndex,
          callback.params,
        ]),
      );
      return {
        ...expr,
        receiver: contextualizeExpr(expr.receiver, result, arities, localTypes, bindings),
        args: expr.args.map((arg, index) =>
          contextualizeCallbackArg(
            arg,
            callbackParams.get(index),
            result,
            arities,
            localTypes,
            bindings,
          )
        ),
      };
    }
    case "FfiBindingCall": {
      const callbackParams = new Map(
        callbackParamTypesForFfiBindingCall(expr, arities, bindings).map((callback) => [
          callback.argIndex,
          callback.params,
        ]),
      );
      return {
        ...expr,
        args: expr.args.map((arg, index) =>
          contextualizeCallbackArg(
            arg,
            callbackParams.get(index),
            result,
            arities,
            localTypes,
            bindings,
          )
        ),
      };
    }
    case "FfiGet":
      return {
        ...expr,
        receiver: contextualizeExpr(expr.receiver, result, arities, localTypes, bindings),
      };
    case "Call":
      return {
        ...expr,
        callee: contextualizeExpr(expr.callee, result, arities, localTypes, bindings),
        args: expr.args.map((arg) => contextualizeExpr(arg, result, arities, localTypes, bindings)),
      };
    case "Tuple":
      return {
        ...expr,
        items: expr.items.map((item) =>
          contextualizeExpr(item, result, arities, localTypes, bindings)
        ),
      };
    case "Record":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: contextualizeExpr(field.value, result, arities, localTypes, bindings),
        })),
      };
    case "JsonObject":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: contextualizeExpr(field.value, result, arities, localTypes, bindings),
        })),
      };
    case "JsonArray":
      return {
        ...expr,
        items: expr.items.map((item) =>
          contextualizeExpr(item, result, arities, localTypes, bindings)
        ),
      };
    case "Lambda":
      if (!hostFfiDescendsInto(expr)) return expr;
      return {
        ...expr,
        body: contextualizeExpr(expr.body, result, arities, new Map(localTypes), bindings),
      };
    case "If":
      return {
        ...expr,
        cond: contextualizeExpr(expr.cond, result, arities, localTypes, bindings),
        thenExpr: contextualizeExpr(expr.thenExpr, result, arities, localTypes, bindings),
        elseExpr: contextualizeExpr(expr.elseExpr, result, arities, localTypes, bindings),
      };
    case "Match":
      return {
        ...expr,
        value: contextualizeExpr(expr.value, result, arities, localTypes, bindings),
        arms: expr.arms.map((arm) => ({
          ...arm,
          body: contextualizeExpr(arm.body, result, arities, new Map(localTypes), bindings),
        })),
      };
    case "Panic":
      return {
        ...expr,
        message: contextualizeExpr(expr.message, result, arities, localTypes, bindings),
      };
    case "Block": {
      const blockTypes = new Map(localTypes);
      const items = expr.items.map((item) => {
        if (!isDecl(item)) return contextualizeExpr(item, result, arities, blockTypes, bindings);
        const contextual = contextualizeDecl(item, result, arities, new Map(), bindings);
        rememberLetTypes(item, result, blockTypes, bindings);
        return contextual;
      });
      return {
        ...expr,
        items,
        result: contextualizeExpr(expr.result, result, arities, blockTypes, bindings),
      };
    }
    case "Binary":
      return {
        ...expr,
        left: contextualizeExpr(expr.left, result, arities, localTypes, bindings),
        right: contextualizeExpr(expr.right, result, arities, localTypes, bindings),
      };
    case "Unary":
      return {
        ...expr,
        value: contextualizeExpr(expr.value, result, arities, localTypes, bindings),
      };
    case "Pipe":
      return {
        ...expr,
        left: contextualizeExpr(expr.left, result, arities, localTypes, bindings),
        right: contextualizeExpr(expr.right, result, arities, localTypes, bindings),
      };
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
      return expr;
  }
}

function contextualizeCallbackArg(
  arg: Expr,
  params: TypeExpr[] | undefined,
  result: InferResult,
  arities: Map<string, number>,
  localTypes: Map<string, TypeExpr>,
  bindings: FfiElaboration["bindings"],
): Expr {
  if (arg.kind === "Lambda" && !hostFfiDescendsInto(arg)) return arg;
  if (arg.kind !== "Lambda" || !params) {
    return contextualizeExpr(arg, result, arities, localTypes, bindings);
  }
  return {
    ...arg,
    params: arg.params.map((param, index) => ({
      ...param,
      annotation: param.annotation ?? params[index],
    })),
    body: contextualizeExpr(arg.body, result, arities, new Map(localTypes), bindings),
  };
}

function rememberLetTypes(
  decl: Decl,
  result: InferResult,
  localTypes: Map<string, TypeExpr>,
  bindings: FfiElaboration["bindings"],
) {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) {
    if (binding.pattern.kind !== "PVar") continue;
    const type = typeFromSelectedFfiCall(binding.value, bindings) ??
      tyToOptionalTypeExpr(inferredType(result, binding.value));
    if (type) localTypes.set(binding.pattern.name, type);
  }
}

function typeFromSelectedFfiCall(
  expr: Expr,
  bindings: FfiElaboration["bindings"],
): TypeExpr | undefined {
  if (expr.kind !== "Call" || expr.callee.kind !== "Var") return undefined;
  const calleeName = expr.callee.name;
  const variant = [...bindings.values()]
    .flatMap((binding) => binding.variants)
    .find((variant) => variant.internalName === calleeName);
  return unwrapResultTypeExpr(callResultTypeExpr(variant?.type));
}

function callResultTypeExpr(type: TypeExpr | undefined): TypeExpr | undefined {
  return type?.kind === "TFn" ? type.result : type;
}

function unwrapResultTypeExpr(type: TypeExpr | undefined): TypeExpr | undefined {
  if (
    type?.kind === "TName" &&
    (type.name === "Result" || type.name === "Task") &&
    type.args.length === 2
  ) {
    return type.args[0];
  }
  return type;
}

function tyToOptionalTypeExpr(type: ReturnType<typeof inferredType>): TypeExpr | undefined {
  return type ? knownTyToTypeExpr(type) : undefined;
}

function jsArrayReceiverTypeExpr(
  type: TypeExpr | undefined,
): { element: TypeExpr; type: TypeExpr } | undefined {
  if (type?.kind !== "TName" || type.name !== "Js.Array" || type.args.length !== 1) {
    return undefined;
  }
  return { element: type.args[0], type };
}
