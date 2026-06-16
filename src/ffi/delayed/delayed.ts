import type { Decl, Expr, TypeExpr } from "../../ast.ts";
import { diagnosticError } from "../../diagnostics.ts";
import type { InferResult } from "../../infer.ts";
import { prune, show, type Ty } from "../../types.ts";
import { rejectAnnotatedDynamicCallbacks } from "./annotations.ts";
import { generatedForeignDeclsForRefs, generatedImportInsertionIndex } from "./bindings.ts";
import {
  materializeReceiverCall,
  materializeReceiverProperty,
  solveReflectedFfiValue,
} from "./materialize.ts";
import { setActiveFfiSolve, setActiveRecordFields } from "../receiver/rewrite_expr.ts";
import {
  expressionRefForReceiver,
  ffiCallPromiseElement,
  foreignReceiver,
  foreignTypeRefLookup,
  inferredType,
  isJsObjectTy,
  jsArrayMember,
  jsArrayReceiver,
  jsPromiseMember,
  jsPromiseReceiver,
  jsPromiseReceiverTypeExpr,
  knownTyToTypeExpr,
  promiseCallbackResultType,
  receiverTypeForRef,
  typeExprKey,
  tyToTypeExpr,
  withCallbackParamRefs,
} from "./receiver_models.ts";
import type { ResolveOptions } from "./types.ts";
import {
  callArgHint,
  callHintKey,
  dynamicReceiverArgType,
  type FfiElaboration,
  fn,
  generatedReceiverJsImports,
  isDecl,
  name,
} from "../shared.ts";
import {
  type JsCallArgHint,
  jsRefCallMember,
  jsRefMember,
  jsRefTypeExpr,
  jsTypeExprValueRef,
  type JsTypeRef,
} from "../reflect/types.ts";
import { typeExprKey as reflectTypeExprKey } from "../reflect/ts_type_expr.ts";

export function resolveDelayedFfiElaboration(
  ffi: FfiElaboration,
  result: InferResult,
  options: ResolveOptions = {},
): FfiElaboration {
  const previousRecordFields = setActiveRecordFields(recordFieldNames(ffi.module.decls));
  const previousFfiSolve = setActiveFfiSolve((original, internalName) => {
    const variant = [...ffi.bindings.values()]
      .flatMap((binding) => binding.variants)
      .find((item) => item.internalName === internalName);
    if (variant) solveReflectedFfiValue(original, variant, result);
  });
  try {
    return resolveDelayedFfiElaborationInner(ffi, result, options);
  } finally {
    setActiveRecordFields(previousRecordFields);
    setActiveFfiSolve(previousFfiSolve);
  }
}

function resolveDelayedFfiElaborationInner(
  ffi: FfiElaboration,
  result: InferResult,
  options: ResolveOptions,
): FfiElaboration {
  const selected = new Set<string>();
  const valueRefs = new Map<string, JsTypeRef>();
  const decls: Decl[] = [];
  for (const decl of ffi.module.decls) {
    const resolved = resolveDelayedDecl(decl, ffi, result, selected, options, valueRefs);
    decls.push(resolved);
  }
  const module = {
    ...ffi.module,
    decls,
  };
  rejectAnnotatedDynamicCallbacks(module.decls, ffi.bindings);
  const foreignDeclsFromRefs = generatedForeignDeclsForRefs(module.decls, ffi.foreignTypeRefs);
  const foreignDecls = foreignDeclsFromRefs;
  const imports = generatedReceiverJsImports(ffi.bindings, selected);
  const prefixLength = generatedImportInsertionIndex(module.decls);
  return {
    ...ffi,
    module: imports.length || foreignDecls.length
      ? {
        ...module,
        decls: [
          ...module.decls.slice(0, prefixLength),
          ...foreignDecls,
          ...imports,
          ...module.decls.slice(prefixLength),
        ],
      }
      : module,
    selected: new Set([...ffi.selected, ...selected]),
  };
}

function recordFieldNames(decls: Decl[]): Set<string> {
  const fields = new Set<string>();
  for (const decl of decls) {
    if (decl.kind !== "RecordDecl") continue;
    for (const field of decl.fields) fields.add(field.name);
  }
  return fields;
}

export function contextualizeDelayedCallbacks(
  ffi: FfiElaboration,
  result: InferResult,
): FfiElaboration {
  const arities = namedLambdaArities(ffi.module.decls);
  const contexts = collectNamedCallbackContexts(ffi.module.decls, result, arities);
  return {
    ...ffi,
    module: {
      ...ffi.module,
      decls: ffi.module.decls.map((decl) =>
        contextualizeDecl(decl, result, arities, contexts, ffi.bindings)
      ),
    },
  };
}

function collectNamedCallbackContexts(
  decls: Decl[],
  result: InferResult,
  arities: Map<string, number>,
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

function resolveDelayedDecl(
  decl: Decl,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Decl {
  if (decl.kind !== "LetDecl") return decl;
  return {
    ...decl,
    bindings: decl.bindings.map((binding) => ({
      ...binding,
      value: resolveDelayedExpr(binding.value, ffi, result, selected, options, valueRefs),
    })),
  };
}

function resolveDelayedExpr(
  expr: Expr,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Expr {
  switch (expr.kind) {
    case "FfiGet":
      return resolveDelayedFfiGet(expr, ffi, result, selected, options, valueRefs);
    case "FfiCall":
      return resolveDelayedFfiCall(expr, ffi, result, selected, options, valueRefs);
    case "Call":
      return {
        ...expr,
        callee: resolveDelayedExpr(expr.callee, ffi, result, selected, options, valueRefs),
        args: expr.args.map((arg) =>
          resolveDelayedExpr(arg, ffi, result, selected, options, valueRefs)
        ),
      };
    case "Tuple":
      return {
        ...expr,
        items: expr.items.map((item) =>
          resolveDelayedExpr(item, ffi, result, selected, options, valueRefs)
        ),
      };
    case "Record":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: resolveDelayedExpr(field.value, ffi, result, selected, options, valueRefs),
        })),
      };
    case "JsonObject":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: resolveDelayedExpr(field.value, ffi, result, selected, options, valueRefs),
        })),
      };
    case "JsonArray":
      return {
        ...expr,
        items: expr.items.map((item) =>
          resolveDelayedExpr(item, ffi, result, selected, options, valueRefs)
        ),
      };
    case "Lambda":
      return {
        ...expr,
        body: resolveDelayedExpr(expr.body, ffi, result, selected, options, new Map(valueRefs)),
      };
    case "If":
      return {
        ...expr,
        cond: resolveDelayedExpr(expr.cond, ffi, result, selected, options, valueRefs),
        thenExpr: resolveDelayedExpr(expr.thenExpr, ffi, result, selected, options, valueRefs),
        elseExpr: resolveDelayedExpr(expr.elseExpr, ffi, result, selected, options, valueRefs),
      };
    case "Match":
      return {
        ...expr,
        value: resolveDelayedExpr(expr.value, ffi, result, selected, options, valueRefs),
        arms: expr.arms.map((arm) => ({
          ...arm,
          body: resolveDelayedExpr(arm.body, ffi, result, selected, options, new Map(valueRefs)),
        })),
      };
    case "Panic":
      return {
        ...expr,
        message: resolveDelayedExpr(expr.message, ffi, result, selected, options, valueRefs),
      };
    case "Block": {
      const localValueRefs = new Map(valueRefs);
      const items = expr.items.map((item) => {
        const resolved = isDecl(item)
          ? resolveDelayedDecl(item, ffi, result, selected, options, localValueRefs)
          : resolveDelayedExpr(item, ffi, result, selected, options, localValueRefs);
        return resolved;
      });
      return {
        ...expr,
        items,
        result: resolveDelayedExpr(expr.result, ffi, result, selected, options, localValueRefs),
      };
    }
    case "Binary":
      return {
        ...expr,
        left: resolveDelayedExpr(expr.left, ffi, result, selected, options, valueRefs),
        right: resolveDelayedExpr(expr.right, ffi, result, selected, options, valueRefs),
      };
    case "Unary":
      return {
        ...expr,
        value: resolveDelayedExpr(expr.value, ffi, result, selected, options, valueRefs),
      };
    case "Pipe":
      return {
        ...expr,
        left: resolveDelayedExpr(expr.left, ffi, result, selected, options, valueRefs),
        right: resolveDelayedExpr(expr.right, ffi, result, selected, options, valueRefs),
      };
    default:
      return expr;
  }
}

function resolveDelayedFfiGet(
  expr: Extract<Expr, { kind: "FfiGet" }>,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Expr {
  // Resolve the receiver first: materializing a nested receiver call can solve its FFI
  // placeholder in place, which may reveal a concrete receiver type for this access.
  const receiver = resolveDelayedExpr(expr.receiver, ffi, result, selected, options, valueRefs);
  const receiverType = receiverTypeThroughObligations(inferredType(result, expr.receiver));
  const foreignTypeRefs = foreignTypeRefLookup(ffi.foreignTypeRefs, options.foreignTypeRefs);
  const foreign = receiverType ? foreignReceiver(receiverType, foreignTypeRefs) : undefined;
  if (foreign) {
    const member = jsRefMember(foreign.ref, expr.path);
    if (member) {
      return materializeReceiverProperty(
        expr,
        receiver,
        expr.path,
        foreign.type,
        member,
        `__receiver.${foreign.ref.key}.${expr.path.join(".")}`,
        ffi.bindings,
        ffi.foreignTypeRefs,
        result,
        selected,
      );
    }
    throw diagnosticError(
      new Error(`cannot resolve JS FFI property ${expr.path.join(".")} on ${foreign.ref.key}`),
      expr.node,
    );
  }
  const array = jsArrayReceiver(receiverType);
  const arrayRef = array
    ? jsTypeExprValueRef(`array:${reflectTypeExprKey(array.type)}`, array.type)
    : undefined;
  const arrayMember = arrayRef ? jsRefMember(arrayRef, expr.path) : undefined;
  if (array && arrayMember) {
    return materializeReceiverProperty(
      expr,
      receiver,
      expr.path,
      array.type,
      arrayMember,
      `__dynamic_array.${typeExprKey(array.type)}.${expr.path.join(".")}`,
      ffi.bindings,
      ffi.foreignTypeRefs,
      result,
      selected,
    );
  }
  const expressionRef = expressionRefForReceiver(expr.receiver, receiver, ffi, valueRefs);
  if (expressionRef) {
    const member = jsRefMember(expressionRef, expr.path);
    if (member) {
      return materializeReceiverProperty(
        expr,
        receiver,
        expr.path,
        receiverTypeForRef(expressionRef),
        member,
        `__receiver.${expressionRef.key}.${expr.path.join(".")}`,
        ffi.bindings,
        ffi.foreignTypeRefs,
        result,
        selected,
      );
    }
  }
  if (
    receiverType && isJsObjectTy(receiverType) && expr.path.length === 1 && expr.path[0] === "at"
  ) {
    throw diagnosticError(
      new Error(
        "cannot use typed array method at on opaque Js.Object; assert a Js.Array<T> shape first",
      ),
      expr.node,
    );
  }
  if (!receiverType || !isJsObjectTy(receiverType)) {
    throw diagnosticError(
      new Error(
        `cannot resolve JS FFI property ${expr.path.join(".")} for receiver type ${
          receiverType ? show(receiverType) : "unknown"
        }`,
      ),
      expr.node,
    );
  }
  return materializeReceiverProperty(
    expr,
    receiver,
    expr.path,
    name("Js.Object"),
    { name: expr.path.at(-1)!, type: name("Js.Value") },
    `__dynamic.${expr.path.join(".")}`,
    ffi.bindings,
    ffi.foreignTypeRefs,
    result,
    selected,
  );
}

function resolveDelayedFfiCall(
  expr: Extract<Expr, { kind: "FfiCall" }>,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Expr {
  // Resolve the receiver first: materializing a nested receiver call can solve its FFI
  // placeholder in place, which may reveal a concrete receiver type for this access.
  const receiver = resolveDelayedExpr(expr.receiver, ffi, result, selected, options, valueRefs);
  const receiverType = receiverTypeThroughObligations(inferredType(result, expr.receiver));
  const foreignTypeRefs = foreignTypeRefLookup(ffi.foreignTypeRefs, options.foreignTypeRefs);
  const foreign = receiverType ? foreignReceiver(receiverType, foreignTypeRefs) : undefined;
  if (foreign) {
    const callMember = jsRefCallMember(foreign.ref, expr.path, expr.args.map(callArgHint));
    const member = callMember ?? jsRefMember(foreign.ref, expr.path);
    if (member) {
      return materializeReceiverCall(
        expr,
        receiver,
        expr.path,
        expr.args,
        foreign.type,
        member,
        `__receiver.${foreign.ref.key}.${expr.path.join(".")}${
          callMember ? `(${callHintKey(expr.args)})` : ""
        }`,
        ffi,
        result,
        selected,
        options,
        valueRefs,
        resolveDelayedExpr,
      );
    }
    throw diagnosticError(
      new Error(`cannot resolve JS FFI method ${expr.path.join(".")} on ${foreign.ref.key}`),
      expr.node,
    );
  }
  const array = jsArrayReceiver(receiverType);
  const arrayRef = array
    ? jsTypeExprValueRef(`array:${reflectTypeExprKey(array.type)}`, array.type)
    : undefined;
  const arrayMember = array
    ? jsTypedArrayMember(array, expr, result) ??
      (arrayRef
        ? jsRefCallMember(
          arrayRef,
          expr.path,
          expr.args.map((arg) => callArgHintForReflection(arg, result)),
        )
        : undefined)
    : undefined;
  if (array && arrayMember) {
    return materializeReceiverCall(
      expr,
      receiver,
      expr.path,
      expr.args,
      array.type,
      arrayMember,
      `__dynamic_array.${typeExprKey(array.type)}.${expr.path.join(".")}`,
      ffi,
      result,
      selected,
      options,
      valueRefs,
      resolveDelayedExpr,
    );
  }
  if (
    receiverType && isJsObjectTy(receiverType) && expr.path.length === 1 && expr.path[0] === "at"
  ) {
    throw diagnosticError(
      new Error(
        "cannot use typed array method at on opaque Js.Object; assert a Js.Array<T> shape first",
      ),
      expr.node,
    );
  }
  const expressionRef = expressionRefForReceiver(expr.receiver, receiver, ffi, valueRefs);
  // A reflected receiver ref carries richer member info (callback param refs) than the
  // synthetic promise ref, so prefer it even when the receiver type is already known.
  const expressionPromiseRef = expressionRef
    ? jsPromiseReceiverTypeExpr(jsRefTypeExpr(expressionRef))
    : undefined;
  const promise = expressionPromiseRef ? undefined : jsPromiseReceiver(receiverType);
  const promiseSyntheticRef = promise
    ? jsTypeExprValueRef(`promise:${reflectTypeExprKey(promise.type)}`, promise.type)
    : undefined;
  const promiseReflectedMember = promiseSyntheticRef
    ? jsRefCallMember(
      promiseSyntheticRef,
      expr.path,
      expr.args.map((arg) => callArgHintForReflection(arg, result)),
    )
    : undefined;
  // Prefer the local promise model: it keeps Workman-side element types (records, Js.Dict)
  // that cannot round-trip through TS reflection. Callback param refs still come from the
  // reflected member so callback bodies rewrite against reflected receivers.
  const promiseMember = promise
    ? withCallbackParamRefs(
      jsPromiseMember(
        promise,
        expr.path,
        promiseCallbackResultType(expr.args[0], result),
        ffiCallPromiseElement(inferredType(result, expr)),
      ),
      promiseReflectedMember,
    ) ?? promiseReflectedMember
    : undefined;
  if (promise && promiseMember) {
    return materializeReceiverCall(
      expr,
      receiver,
      expr.path,
      expr.args,
      promise.type,
      promiseMember,
      `__dynamic_promise.${typeExprKey(promise.type)}.${expr.path.join(".")}`,
      ffi,
      result,
      selected,
      options,
      valueRefs,
      resolveDelayedExpr,
    );
  }
  if (expressionRef) {
    const promiseRef = jsPromiseReceiverTypeExpr(jsRefTypeExpr(expressionRef));
    const promiseRefMember = promiseRef
      ? jsRefCallMember(
        expressionRef,
        expr.path,
        expr.args.map((arg) => callArgHintForReflection(arg, result)),
      )
      : undefined;
    if (promiseRef && promiseRefMember) {
      return materializeReceiverCall(
        expr,
        receiver,
        expr.path,
        expr.args,
        promiseRef.type,
        promiseRefMember,
        `__dynamic_promise.${typeExprKey(promiseRef.type)}.${expr.path.join(".")}`,
        ffi,
        result,
        selected,
        options,
        valueRefs,
        resolveDelayedExpr,
      );
    }
    const callMember = jsRefCallMember(expressionRef, expr.path, expr.args.map(callArgHint));
    const member = callMember ?? jsRefMember(expressionRef, expr.path);
    if (member) {
      return materializeReceiverCall(
        expr,
        receiver,
        expr.path,
        expr.args,
        receiverTypeForRef(expressionRef),
        member,
        `__receiver.${expressionRef.key}.${expr.path.join(".")}${
          callMember ? `(${callHintKey(expr.args)})` : ""
        }`,
        ffi,
        result,
        selected,
        options,
        valueRefs,
        resolveDelayedExpr,
      );
    }
  }
  if (!receiverType || !isJsObjectTy(receiverType)) {
    throw diagnosticError(
      new Error(
        `cannot resolve JS FFI method ${expr.path.join(".")} for receiver type ${
          receiverType ? show(receiverType) : "unknown"
        }`,
      ),
      expr.node,
    );
  }
  return materializeReceiverCall(
    expr,
    receiver,
    expr.path,
    expr.args,
    name("Js.Object"),
    {
      name: expr.path.at(-1)!,
      type: fn(expr.args.map(dynamicReceiverArgType), name("Js.Value")),
    },
    `__dynamic.${expr.path.join(".")}`,
    ffi,
    result,
    selected,
    options,
    valueRefs,
    resolveDelayedExpr,
  );
}

function receiverTypeThroughObligations(
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

function jsTypedArrayMember(
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

function callArgHintForReflection(expr: Expr, result: InferResult): JsCallArgHint {
  if (expr.kind === "Var") {
    const scheme = result.env.get(expr.name);
    const target = scheme ? prune(scheme.type) : undefined;
    if (target?.tag === "fn") {
      return {
        kind: "function",
        arity: jsFunctionArity(target),
        paramTypes: jsFunctionParamTypes(target),
        resultType: knownTyToTypeExpr(target.result),
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

function jsFunctionArity(type: Extract<ReturnType<typeof prune>, { tag: "fn" }>): number {
  if (type.params.length !== 1) return type.params.length;
  const param = prune(type.params[0]);
  return param.tag === "tuple" ? param.items.length : type.params.length;
}

function jsFunctionParamTypes(type: Extract<ReturnType<typeof prune>, { tag: "fn" }>): TypeExpr[] {
  if (type.params.length !== 1) {
    return type.params.map(knownTyToTypeExpr).filter((param): param is TypeExpr => !!param);
  }
  const param = prune(type.params[0]);
  return param.tag === "tuple"
    ? param.items.map(knownTyToTypeExpr).filter((item): item is TypeExpr => !!item)
    : type.params.map(knownTyToTypeExpr).filter((item): item is TypeExpr => !!item);
}

function callbackReturnType(expr: Expr, result: InferResult): TypeExpr | undefined {
  if (expr.kind === "Lambda") {
    const bodyType = inferredType(result, expr.body);
    return bodyType ? knownTyToTypeExpr(bodyType) : undefined;
  }
  const type = inferredType(result, expr);
  const target = type ? prune(type) : undefined;
  return target?.tag === "fn" ? knownTyToTypeExpr(target.result) : undefined;
}
