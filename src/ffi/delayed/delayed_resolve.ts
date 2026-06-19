import type { Decl, Expr, TypeExpr } from "../../ast.ts";
import { diagnosticError } from "../../diagnostics.ts";
import type { InferResult } from "../../infer.ts";
import { prune, show, type Ty } from "../../types.ts";
import { materializeReceiverCall, materializeReceiverProperty } from "./materialize.ts";
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
  withCallbackParamRefs,
} from "./receiver_models.ts";
import type { ResolveOptions } from "./types.ts";
import { callArgHint, callHintKey, dynamicReceiverArgType, type FfiElaboration, fn, isDecl, name } from "../shared.ts";
import {
  type JsCallArgHint,
  jsRefCallMember,
  jsRefMember,
  jsRefTypeExpr,
  jsTypeExprValueRef,
  type JsTypeRef,
} from "../reflect/types.ts";
import { typeExprKey as reflectTypeExprKey } from "../reflect/ts_type_expr.ts";
import { callArgHintForReflection, jsTypedArrayMember, receiverTypeThroughObligations } from "./delayed_reflection_hints.ts";

export function resolveDelayedDecl(
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
  if (!receiverType || prune(receiverType).tag === "var") {
    return { ...expr, receiver };
  }
  if (!isJsObjectTy(receiverType)) {
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
  if (!receiverType || prune(receiverType).tag === "var") {
    return {
      ...expr,
      receiver,
      args: expr.args.map((arg) =>
        resolveDelayedExpr(arg, ffi, result, selected, options, valueRefs)
      ),
    };
  }
  if (!isJsObjectTy(receiverType)) {
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
      type: fn(expr.args.map(dynamicReceiverArgType), dynamicCallResultType(inferredType(result, expr))),
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

function dynamicCallResultType(type: Ty | undefined): TypeExpr {
  const target = type ? prune(type) : undefined;
  if (target?.tag === "ffi") {
    for (const constraint of target.constraints ?? []) {
      const constrained = unwrapCarrierTypeExpr(knownTyToTypeExpr(constraint));
      if (constrained && !containsTypeVariable(constrained)) return constrained;
    }
  }
  const known = target ? knownTyToTypeExpr(target) : undefined;
  const candidate = unwrapCarrierTypeExpr(known) ?? known;
  return candidate && !containsTypeVariable(candidate) ? candidate : name("Js.Value");
}

function unwrapCarrierTypeExpr(type: TypeExpr | undefined): TypeExpr | undefined {
  if (
    type?.kind === "TName" &&
    (type.name === "Result" || type.name === "Task") &&
    type.args.length === 2
  ) {
    return type.args[0];
  }
  return undefined;
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
