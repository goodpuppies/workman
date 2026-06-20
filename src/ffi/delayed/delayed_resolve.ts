import type { Decl, Expr, TypeExpr } from "../../ast.ts";
import { diagnosticError } from "../../diagnostics.ts";
import type { InferResult } from "../../infer.ts";
import { prune, show, type Ty } from "../../types.ts";
import {
  materializeBindingCall,
  materializeReceiverCall,
  materializeReceiverProperty,
  resolveArrayLikeParams,
} from "./materialize.ts";
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
import {
  callArgHint,
  callHintKey,
  dynamicReceiverArgType,
  type FfiElaboration,
  fn,
  isDecl,
  name,
} from "../shared.ts";
import {
  type JsCallArgHint,
  jsRefCallMember,
  jsRefDeepCall,
  jsRefMember,
  jsRefTypeExpr,
  jsTypeExprValueRef,
  type JsTypeRef,
} from "../reflect/types.ts";
import { typeExprKey as reflectTypeExprKey } from "../reflect/ts_type_expr.ts";
import {
  callArgHintForReflection,
  jsTypedArrayMember,
  receiverTypeThroughObligations,
} from "./delayed_reflection_hints.ts";
import { addVariants, type FfiBinding, type FfiVariant, selectVariant } from "../shared.ts";

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
    case "FfiBindingCall":
      return resolveDelayedFfiBindingCall(expr, ffi, result, selected, options, valueRefs);
    case "Call":
      if (expr.callee.kind === "Var") {
        const deep = resolveDeepReflectedCall(expr, ffi, result, selected, valueRefs);
        if (deep) return deep;
        const directArrayLike = resolveDirectArrayLikeCall(
          expr,
          ffi,
          result,
          selected,
          options,
          valueRefs,
        );
        if (directArrayLike) return directArrayLike;
      }
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

function resolveDelayedFfiBindingCall(
  expr: Extract<Expr, { kind: "FfiBindingCall" }>,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Expr {
  return materializeBindingCall(
    expr,
    expr.args.map((arg) => resolveDelayedExpr(arg, ffi, result, selected, options, valueRefs)),
    ffi,
    result,
    selected,
    options,
    valueRefs,
    resolveDelayedExpr,
  );
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
    const deepRecordProperty = deepRecordReceiverProperty(
      expr,
      receiver,
      ffi,
      result,
      selected,
    );
    if (deepRecordProperty) return deepRecordProperty;
    return { ...expr, receiver };
  }
  if (options.dynamicFallback === false) {
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
    const deepRecordCall = deepRecordReceiverCall(
      expr,
      receiver,
      ffi,
      result,
      selected,
      options,
      valueRefs,
    );
    if (deepRecordCall) return deepRecordCall;
    return {
      ...expr,
      receiver,
      args: expr.args.map((arg) =>
        resolveDelayedExpr(arg, ffi, result, selected, options, valueRefs)
      ),
    };
  }
  const recordCall = recordReceiverCall(
    expr,
    receiver,
    receiverType,
    ffi,
    result,
    selected,
    options,
    valueRefs,
  );
  if (recordCall) return recordCall;
  if (options.dynamicFallback === false) {
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
      type: fn(
        expr.args.map(dynamicReceiverArgType),
        dynamicCallResultType(inferredType(result, expr)),
      ),
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

function recordReceiverCall(
  expr: Extract<Expr, { kind: "FfiCall" }>,
  receiver: Expr,
  receiverType: Ty | undefined,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Expr | undefined {
  if (receiver.kind !== "Var" || !receiverType) return undefined;
  const target = prune(receiverType);
  if (target.tag !== "named" || !target.recordFields) return undefined;
  const member = recordPathMember(target, expr.path);
  if (!member || member.kind !== "TFn") return undefined;
  const receiverTypeExpr = knownTyToTypeExpr(target);
  if (!receiverTypeExpr) return undefined;
  return materializeReceiverCall(
    expr,
    receiver,
    expr.path,
    expr.args,
    receiverTypeExpr,
    { name: expr.path.at(-1)!, type: flattenTupledParams(member) },
    `__deep_record.${typeExprKey(receiverTypeExpr)}.${expr.path.join(".")}`,
    ffi,
    result,
    selected,
    options,
    valueRefs,
    resolveDelayedExpr,
  );
}

function deepRecordReceiverProperty(
  expr: Extract<Expr, { kind: "FfiGet" }>,
  receiver: Expr,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
): Expr | undefined {
  const match = uniqueDeepRecordMember(ffi, expr.path);
  if (!match) return undefined;
  return materializeReceiverProperty(
    expr,
    receiver,
    expr.path,
    match.receiverType,
    { name: expr.path.at(-1)!, type: match.member },
    `__deep_record.${typeExprKey(match.receiverType)}.${expr.path.join(".")}`,
    ffi.bindings,
    ffi.foreignTypeRefs,
    result,
    selected,
  );
}

function deepRecordReceiverCall(
  expr: Extract<Expr, { kind: "FfiCall" }>,
  receiver: Expr,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Expr | undefined {
  const match = uniqueDeepRecordMember(ffi, expr.path);
  if (!match || match.member.kind !== "TFn") return undefined;
  return materializeReceiverCall(
    expr,
    receiver,
    expr.path,
    expr.args,
    match.receiverType,
    { name: expr.path.at(-1)!, type: flattenTupledParams(match.member) },
    `__deep_record.${typeExprKey(match.receiverType)}.${expr.path.join(".")}`,
    ffi,
    result,
    selected,
    options,
    valueRefs,
    resolveDelayedExpr,
  );
}

function uniqueDeepRecordMember(
  ffi: FfiElaboration,
  path: string[],
): { receiverType: TypeExpr; member: TypeExpr } | undefined {
  const matches: { receiverType: TypeExpr; member: TypeExpr }[] = [];
  for (const record of ffi.deepRecords?.values() ?? []) {
    const member = recordTypeExprPathMember(ffi, record, path);
    if (!member) continue;
    matches.push({
      receiverType: { kind: "TName", name: record.name, args: [] },
      member,
    });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function recordTypeExprPathMember(
  ffi: FfiElaboration,
  record: Extract<Decl, { kind: "RecordDecl" }>,
  path: string[],
): TypeExpr | undefined {
  let currentRecord: Extract<Decl, { kind: "RecordDecl" }> | undefined = record;
  let current: TypeExpr | undefined;
  for (const [index, part] of path.entries()) {
    if (!currentRecord) return undefined;
    current = currentRecord.fields.find((field) => field.name === part)?.type;
    if (!current) return undefined;
    if (index === path.length - 1) return current;
    currentRecord = current.kind === "TName" ? ffi.deepRecords?.get(current.name) : undefined;
  }
  return current;
}

// Workman represents a multi-argument function as a single tuple parameter
// (`(a, b) => r` is `fn([(a, b)], r)`), whereas the FFI receiver pipeline
// (`prependReceiver`/`selectVariant`) works with flat positional parameters like the
// reflected-receiver path produces. Flatten a lone tuple parameter so a deep-record method
// matches its call's argument arity.
function flattenTupledParams(type: TypeExpr): TypeExpr {
  if (
    type.kind === "TFn" && type.params.length === 1 && type.params[0].kind === "TTuple"
  ) {
    return { ...type, params: type.params[0].items };
  }
  return type;
}

function recordPathMember(
  type: Extract<Ty, { tag: "named" }>,
  path: string[],
): TypeExpr | undefined {
  let current: Ty = type;
  for (const part of path) {
    const target = prune(current);
    if (target.tag !== "named" || !target.recordFields) return undefined;
    const found = target.recordFields.find((field) => field.name === part);
    if (!found) return undefined;
    current = found.type;
  }
  return knownTyToTypeExpr(current);
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

function resolveDeepReflectedCall(
  expr: Extract<Expr, { kind: "Call" }>,
  ffi: FfiElaboration,
  _result: InferResult,
  selected: Set<string>,
  _valueRefs: Map<string, JsTypeRef>,
): Expr | undefined {
  if (expr.callee.kind !== "Var") return undefined;
  const binding = ffi.bindings.get(expr.callee.name);
  const directVariants = binding?.variants.filter((variant) => variant.deep && variant.callRef) ??
    [];
  const found = directVariants.length === 0
    ? findVariantByInternalName(ffi.bindings, expr.callee.name)
    : undefined;
  const variants = directVariants.length > 0
    ? directVariants
    : found?.variant.deep && found.variant.callRef
    ? [found.variant]
    : [];
  if (variants.length === 0) return undefined;
  const original = variants.find((variant) => typeCallArity(variant.type) === expr.args.length);
  if (!original?.callRef) return undefined;
  const reflected = jsRefDeepCall(original.callRef, expr.args);
  if (!reflected) return undefined;
  ffi.deepRecords ??= new Map();
  for (const record of reflected.records) ffi.deepRecords.set(record.name, record);
  const surfaceName = found?.surfaceName ?? expr.callee.name;
  addVariants(
    ffi.bindings,
    surfaceName,
    original.memberName,
    original.target,
    [{
      type: replaceCallResult(
        original.fallible ? unwrapFallibleType(original.type) : original.type,
        reflected.type,
      ),
      receiverType: original.receiverType,
      callRef: original.callRef,
      deep: true,
    }],
    original.fallible,
    original.node,
  );
  const specialized = lastVariant(ffi.bindings.get(surfaceName)?.variants ?? []);
  if (!specialized) return undefined;
  selected.add(specialized.internalName);
  return {
    ...expr,
    callee: { kind: "Var", name: specialized.internalName },
  };
}

// Direct FFI binding calls (global/namespace members, constructors) pick their variant at
// elaboration time, before argument types exist, so an array-like obligation in that variant's
// signature is never narrowed there. In the delayed pass the inferred argument types are
// available, so resolve the obligation on the already-selected variant: when the argument is a
// concrete array-like, the parameter becomes that type; otherwise the obligation stays and
// unification safely rejects a non-array-like argument. The elaboration-chosen overload is left
// untouched — this only narrows, it does not re-select.
function resolveDirectArrayLikeCall(
  expr: Extract<Expr, { kind: "Call" }>,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
): Expr | undefined {
  if (expr.callee.kind !== "Var") return undefined;
  const found = findVariantByInternalName(ffi.bindings, expr.callee.name);
  if (!found || !typeMentionsArrayLike(found.variant.type)) return undefined;
  const { surfaceName, variant } = found;
  const argTypes = expr.args.map((arg) => {
    const type = inferredType(result, arg);
    return type ? knownTyToTypeExpr(type) : undefined;
  });
  const base = variant.fallible ? unwrapFallibleType(variant.type) : variant.type;
  const resolved = resolveArrayLikeParams(base, argTypes);
  if (typeExprKey(resolved) === typeExprKey(base)) return undefined;
  addVariants(
    ffi.bindings,
    surfaceName,
    variant.memberName,
    variant.target,
    [{
      type: resolved,
      receiverType: variant.receiverType,
      resultRef: variant.resultRef,
      callRef: variant.callRef,
      callbackParamRefs: variant.callbackParamRefs,
      deep: variant.deep,
    }],
    variant.fallible,
    variant.node,
  );
  const specialized = lastVariant(ffi.bindings.get(surfaceName)?.variants ?? []);
  if (!specialized) return undefined;
  selected.add(specialized.internalName);
  return {
    ...expr,
    callee: { kind: "Var", name: specialized.internalName },
    args: expr.args.map((arg) =>
      resolveDelayedExpr(arg, ffi, result, selected, options, valueRefs)
    ),
  };
}

function findVariantByInternalName(
  bindings: Map<string, FfiBinding>,
  internalName: string,
): { surfaceName: string; variant: FfiVariant } | undefined {
  for (const binding of bindings.values()) {
    const variant = binding.variants.find((item) => item.internalName === internalName);
    if (variant) return { surfaceName: binding.surfaceName, variant };
  }
  return undefined;
}

function typeMentionsArrayLike(type: TypeExpr): boolean {
  switch (type.kind) {
    case "TName":
      return type.name === "Js.ArrayLike" || type.args.some(typeMentionsArrayLike);
    case "TTuple":
      return type.items.some(typeMentionsArrayLike);
    case "TFn":
      return type.params.some(typeMentionsArrayLike) || typeMentionsArrayLike(type.result);
    case "TVar":
      return false;
  }
}

function lastVariant(variants: FfiVariant[]): FfiVariant | undefined {
  return variants.at(-1);
}

function typeCallArity(type: TypeExpr): number {
  if (type.kind !== "TFn") return 1;
  return type.params.length === 1 && type.params[0].kind === "TTuple"
    ? type.params[0].items.length
    : type.params.length;
}

function replaceCallResult(type: TypeExpr, result: TypeExpr): TypeExpr {
  return type.kind === "TFn" ? { ...type, result } : result;
}

function unwrapFallibleType(type: TypeExpr): TypeExpr {
  if (
    type.kind === "TFn" &&
    type.result.kind === "TName" &&
    (type.result.name === "Result" || type.result.name === "Task") &&
    type.result.args.length === 2
  ) {
    return { ...type, result: type.result.args[0] };
  }
  return type;
}
