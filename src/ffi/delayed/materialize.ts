import type { Expr, TypeExpr } from "../../ast.ts";
import { diagnosticError } from "../../diagnostics.ts";
import type { InferResult } from "../../infer.ts";
import { recordExprFact, resolveFfiFact } from "../../infer/type_facts.ts";
import { prune, solveFfi, typeFromAst } from "../../types.ts";
import type { ResolveOptions } from "./types.ts";
import { rewriteExprCalls } from "../receiver/rewrite_expr.ts";
import { inferredType, knownTyToTypeExpr, typeExprKey } from "./receiver_models.ts";
import {
  addVariants,
  type FfiBinding,
  type FfiElaboration,
  ffiOverloadMessage,
  type FfiVariant,
  isArrayLikeTypeName,
  memberVariants,
  refsForCallbackArg,
  selectVariant,
} from "../shared.ts";
import {
  jsGlobalTypeRef,
  type JsMemberType,
  jsRefDeepCall,
  type JsTypeRef,
} from "../reflect/types.ts";

type ResolveExpr = (
  expr: Expr,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
) => Expr;

export function materializeReceiverProperty(
  original: Extract<Expr, { kind: "FfiGet" }>,
  receiver: Expr,
  path: string[],
  receiverType: TypeExpr,
  member: JsMemberType,
  surfaceName: string,
  bindings: Map<string, FfiBinding>,
  foreignTypeRefs: Map<string, JsTypeRef>,
  result: InferResult,
  selected: Set<string>,
): Expr {
  const variants = memberVariants(member).map((variant) => ({
    type: variant.type,
    receiverType,
    resultRef: variant.resultRef,
    callbackParamRefs: variant.callbackParamRefs,
  }));
  rememberVariantForeignTypeRefs(variants, foreignTypeRefs);
  addVariants(
    bindings,
    surfaceName,
    path.at(-1)!,
    { kind: "JsReceiver", path },
    variants,
    true,
    undefined,
  );
  const variant = selectVariant(bindings.get(surfaceName)?.variants ?? [], []);
  if (!variant) return { kind: "FfiGet", receiver, path };
  solveReflectedFfiValue(original, variant, result);
  selected.add(variant.internalName);
  return {
    kind: "Call",
    callee: { kind: "Var", name: variant.internalName },
    args: [receiver],
    node: original.node,
  };
}

export function materializeReceiverCall(
  original: Extract<Expr, { kind: "FfiCall" }>,
  receiver: Expr,
  path: string[],
  args: Expr[],
  receiverType: TypeExpr,
  member: JsMemberType,
  surfaceName: string,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
  resolveExpr: ResolveExpr,
): Expr {
  const argTypes = args.map((arg) => {
    const type = inferredType(result, arg);
    return type ? knownTyToTypeExpr(type) : undefined;
  });
  const variants = memberVariants(member).map((variant) => ({
    type: resolveTypeVarsFromArgs(
      resolveArrayLikeParams(variant.type, argTypes),
      argTypes,
    ),
    receiverType,
    resultRef: variant.resultRef,
    callbackParamRefs: variant.callbackParamRefs,
  }));
  rememberVariantForeignTypeRefs(variants, ffi.foreignTypeRefs);
  addVariants(
    ffi.bindings,
    surfaceName,
    path.at(-1)!,
    { kind: "JsReceiver", path },
    variants,
    true,
    undefined,
  );
  const variant = selectVariant(ffi.bindings.get(surfaceName)?.variants ?? [], args, argTypes);
  if (!variant) {
    throw diagnosticError(
      new Error(receiverOverloadMessage(path.join("."), variants, args.length)),
      original.node,
    );
  }
  solveReflectedFfiValue(original, variant, result);
  selected.add(variant.internalName);
  return {
    kind: "Call",
    callee: { kind: "Var", name: variant.internalName },
    args: [
      receiver,
      ...args.map((arg, index) =>
        resolveDelayedCallArg(
          arg,
          index,
          variant,
          ffi,
          result,
          selected,
          options,
          valueRefs,
          resolveExpr,
        )
      ),
    ],
    node: original.node,
  };
}

export function materializeBindingCall(
  original: Extract<Expr, { kind: "FfiBindingCall" }>,
  args: Expr[],
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
  resolveExpr: ResolveExpr,
): Expr {
  const binding = ffi.bindings.get(original.name);
  if (!binding) {
    throw diagnosticError(new Error(`unknown JS FFI binding ${original.name}`), original.node);
  }
  const argTypes = args.map((arg) => {
    const type = inferredType(result, arg);
    return type ? knownTyToTypeExpr(type) : undefined;
  });
  addResolvedArrayLikeVariants(binding, argTypes, ffi.bindings);
  let variant = selectVariant(binding.variants, args, argTypes);
  if (!variant) {
    throw diagnosticError(
      new Error(ffiOverloadMessage(original.name, binding.variants, args)),
      original.node,
    );
  }
  variant = specializeDeepBindingCall(binding, variant, args, ffi);
  solveReflectedFfiValue(original, variant, result);
  selected.add(variant.internalName);
  return {
    kind: "Call",
    callee: { kind: "Var", name: variant.internalName },
    args: args.map((arg, index) =>
      resolveDelayedCallArg(
        arg,
        index,
        variant,
        ffi,
        result,
        selected,
        options,
        valueRefs,
        resolveExpr,
      )
    ),
    node: original.node,
  };
}

export function solveBindingCallType(
  original: Extract<Expr, { kind: "FfiBindingCall" }>,
  args: Expr[],
  ffi: FfiElaboration,
  result: InferResult,
): void {
  const binding = ffi.bindings.get(original.name);
  if (!binding) return;
  const argTypes = args.map((arg) => {
    const type = inferredType(result, arg);
    return type ? knownTyToTypeExpr(type) : undefined;
  });
  if (binding.variants.length > 1 && argTypes.some((type) => !type)) return;
  addResolvedArrayLikeVariants(binding, argTypes, ffi.bindings);
  let variant = selectVariant(binding.variants, args, argTypes);
  if (!variant) return;
  variant = specializeDeepBindingCall(binding, variant, args, ffi);
  solveReflectedFfiValue(original, variant, result);
}

function specializeDeepBindingCall(
  binding: FfiBinding,
  variant: FfiVariant,
  args: Expr[],
  ffi: FfiElaboration,
): FfiVariant {
  if (!variant.deep || !variant.callRef) return variant;
  const reflected = jsRefDeepCall(variant.callRef, args);
  if (!reflected) return variant;
  ffi.deepRecords ??= new Map();
  for (const record of reflected.records) ffi.deepRecords.set(record.name, record);
  const base = variant.fallible ? unwrapFallibleType(variant.type) : variant.type;
  const type = replaceCallResult(base, reflected.type);
  const existing = findVariantByType(binding, variant.fallible ? fallibleTypeKey(type) : type);
  if (existing) return existing;
  addVariants(
    ffi.bindings,
    binding.surfaceName,
    variant.memberName,
    variant.target,
    [{
      type,
      receiverType: variant.receiverType,
      resultRef: variant.resultRef,
      callRef: variant.callRef,
      callbackParamRefs: variant.callbackParamRefs,
      deep: true,
    }],
    variant.fallible,
    variant.node,
  );
  return binding.variants.at(-1) ?? variant;
}

function receiverOverloadMessage(
  name: string,
  variants: { type: TypeExpr }[],
  visibleArgCount: number,
): string {
  const arities = [...new Set(variants.map(receiverVisibleArity).filter(isNumber))].sort();
  return `cannot determine JS FFI overload for ${name} with ${visibleArgCount} arguments${
    arities.length ? `; available arities: ${arities.join(", ")}` : ""
  }`;
}

function receiverVisibleArity(variant: { type: TypeExpr }): number | undefined {
  return variant.type.kind === "TFn" ? variant.type.params.length : 0;
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

function findVariantByType(binding: FfiBinding, type: TypeExpr): FfiVariant | undefined {
  const key = typeExprKey(type);
  return binding.variants.find((variant) => typeExprKey(variant.type) === key);
}

function replaceCallResult(type: TypeExpr, result: TypeExpr): TypeExpr {
  if (type.kind === "TFn") return { ...type, result };
  return result;
}

function addResolvedArrayLikeVariants(
  binding: FfiBinding,
  argTypes: (TypeExpr | undefined)[],
  bindings: Map<string, FfiBinding>,
) {
  const existing = new Set(binding.variants.map((variant) => typeExprKey(variant.type)));
  for (const variant of [...binding.variants]) {
    const base = variant.fallible ? unwrapFallibleType(variant.type) : variant.type;
    const type = resolveArrayLikeParams(base, argTypes);
    const key = typeExprKey(variant.fallible ? fallibleTypeKey(type) : type);
    if (existing.has(key)) continue;
    addVariants(
      bindings,
      binding.surfaceName,
      variant.memberName,
      variant.target,
      [{
        type,
        receiverType: variant.receiverType,
        resultRef: variant.resultRef,
        callRef: variant.callRef,
        callbackParamRefs: variant.callbackParamRefs,
        deep: variant.deep,
      }],
      variant.fallible,
      variant.node,
    );
    existing.add(key);
  }
}

function fallibleTypeKey(type: TypeExpr): TypeExpr {
  if (type.kind !== "TFn") return resultType(type);
  return { ...type, result: resultType(type.result) };
}

function resultType(type: TypeExpr): TypeExpr {
  if (
    type.kind === "TName" &&
    (type.name === "Result" || type.name === "Task") &&
    type.args.length === 2
  ) {
    return type;
  }
  return {
    kind: "TName",
    name: "Result",
    args: [type, { kind: "TName", name: "Js.Error", args: [] }],
  };
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

function resolveTypeVarsFromArgs(
  type: TypeExpr,
  argTypes: (TypeExpr | undefined)[],
): TypeExpr {
  if (type.kind !== "TFn") return type;
  const subst = new Map<string, TypeExpr>();
  type.params.forEach((param, index) => collectTypeVarBindings(param, argTypes[index], subst));
  return subst.size ? substituteTypeVars(type, subst) : concretizeTypeVars(type);
}

function collectTypeVarBindings(
  expected: TypeExpr,
  actual: TypeExpr | undefined,
  subst: Map<string, TypeExpr>,
) {
  if (!actual) return;
  if (expected.kind === "TVar") {
    subst.set(expected.name, actual);
    return;
  }
  if (expected.kind === "TName" && actual.kind === "TName" && expected.name === actual.name) {
    expected.args.forEach((arg, index) => collectTypeVarBindings(arg, actual.args[index], subst));
    return;
  }
  if (expected.kind === "TTuple" && actual.kind === "TTuple") {
    expected.items.forEach((item, index) =>
      collectTypeVarBindings(item, actual.items[index], subst)
    );
    return;
  }
  if (expected.kind === "TFn" && actual.kind === "TFn") {
    expected.params.forEach((param, index) =>
      collectTypeVarBindings(param, actual.params[index], subst)
    );
    collectTypeVarBindings(expected.result, actual.result, subst);
  }
}

function substituteTypeVars(type: TypeExpr, subst: Map<string, TypeExpr>): TypeExpr {
  switch (type.kind) {
    case "TVar":
      return subst.get(type.name) ?? type;
    case "TName":
      return { ...type, args: type.args.map((arg) => substituteTypeVars(arg, subst)) };
    case "TTuple":
      return { ...type, items: type.items.map((item) => substituteTypeVars(item, subst)) };
    case "TFn":
      return {
        ...type,
        params: type.params.map((param) => substituteTypeVars(param, subst)),
        result: substituteTypeVars(type.result, subst),
      };
  }
}

function concretizeTypeVars(type: TypeExpr): TypeExpr {
  switch (type.kind) {
    case "TVar":
      return { kind: "TName", name: "Js.Value", args: [] };
    case "TName":
      return { ...type, args: type.args.map(concretizeTypeVars) };
    case "TTuple":
      return { ...type, items: type.items.map(concretizeTypeVars) };
    case "TFn":
      return {
        ...type,
        params: type.params.map(concretizeTypeVars),
        result: concretizeTypeVars(type.result),
      };
  }
}

// Resolve an array-like obligation (`Js.ArrayLike`, possibly inside `Option`) against the
// concrete call argument: the obligation leaf becomes the argument's concrete array-like type
// (e.g. `Uint8Array`), so a `Uint8Array` argument satisfies a buffer-source parameter. The
// surrounding structure is preserved, so `Option<Js.ArrayLike>` becomes `Option<Uint8Array>`
// and only `Some(uint8)` satisfies it — a bare `Uint8Array` does not slip past the Option.
// Arguments that do not supply a matching array-like leave the obligation in place, keeping
// the boundary type-safe by rejecting them.
export function resolveArrayLikeParams(
  type: TypeExpr,
  argTypes: (TypeExpr | undefined)[],
): TypeExpr {
  if (type.kind !== "TFn") return type;
  return {
    ...type,
    params: type.params.map((param, index) => resolveArrayLikeParam(param, argTypes[index])),
  };
}

function resolveArrayLikeParam(param: TypeExpr, arg: TypeExpr | undefined): TypeExpr {
  if (param.kind === "TName" && param.name === "Js.ArrayLike") {
    return arg && isArrayLikeArg(arg) ? arg : param;
  }
  if (param.kind === "TName" && param.name === "Option" && param.args.length === 1) {
    const inner = resolveArrayLikeParam(param.args[0], optionElement(arg));
    return inner === param.args[0] ? param : { ...param, args: [inner] };
  }
  return param;
}

// The obligation leaf inside an `Option` is resolved against the argument's `Option` element,
// so it only narrows when the argument is itself optional (`Some(arraylike)`).
function optionElement(arg: TypeExpr | undefined): TypeExpr | undefined {
  return arg?.kind === "TName" && arg.name === "Option" && arg.args.length === 1
    ? arg.args[0]
    : undefined;
}

function isArrayLikeArg(type: TypeExpr): boolean {
  return isArrayLikeTypeName(type);
}

export function solveReflectedFfiValue(
  original: Expr,
  variant: FfiVariant,
  result: InferResult,
): void {
  const inferred = inferredType(result, original);
  const value = resultValueType(inferred);
  if (!value) return;
  const placeholder = prune(value.type);
  if (!placeholder || placeholder.tag !== "ffi") return;
  const variantResult = callResultTypeExpr(variant.type);
  const reflected = value.wrapped ? unwrapResultTypeExpr(variantResult) : variantResult;
  if (!reflected) return;
  const materializedType = materializeReflectedType(reflected, result);
  if (!materializedType) return;
  solveFfi(placeholder, materializedType);
  resolveFfiFact(result.facts, placeholder.id, materializedType);
  recordExprFact(result.facts, original, {
    subject: "ffi-reflected",
    instantiated: inferred,
    origin: { source: "reflected-ffi", name: variant.internalName },
  });
}

function materializeReflectedType(
  reflected: TypeExpr,
  result: InferResult,
) {
  try {
    return typeFromAst(reflected, result.typeEnv, new Map(), { allowFreeVars: false });
  } catch {
    return undefined;
  }
}

function resultValueType(
  type: ReturnType<typeof inferredType>,
): { type: ReturnType<typeof prune>; wrapped: boolean } | undefined {
  const target = type ? prune(type) : undefined;
  if (target?.tag === "ffi") return { type: target, wrapped: false };
  if (target?.tag === "named" && target.name === "Result" && target.args.length === 2) {
    return { type: prune(target.args[0]), wrapped: true };
  }
  return undefined;
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

function rememberVariantForeignTypeRefs(
  variants: {
    type: TypeExpr;
    receiverType?: TypeExpr;
    resultRef?: JsTypeRef;
    callbackParamRefs?: { params: JsTypeRef[] }[];
  }[],
  foreignTypeRefs: Map<string, JsTypeRef>,
) {
  for (const variant of variants) {
    rememberForeignTypeNames(variant.type, foreignTypeRefs);
    if (variant.receiverType) rememberForeignTypeNames(variant.receiverType, foreignTypeRefs);
    if (variant.resultRef?.type) rememberForeignTypeNames(variant.resultRef.type, foreignTypeRefs);
    for (const callback of variant.callbackParamRefs ?? []) {
      for (const ref of callback.params) {
        if (ref.type) rememberForeignTypeNames(ref.type, foreignTypeRefs, ref);
      }
    }
  }
}

function rememberForeignTypeNames(
  type: TypeExpr,
  foreignTypeRefs: Map<string, JsTypeRef>,
  ref?: JsTypeRef,
) {
  switch (type.kind) {
    case "TName":
      if (type.args.length === 0 && isReflectedForeignTypeName(type.name)) {
        const typeRef = ref ?? jsGlobalTypeRef(type.name);
        foreignTypeRefs.set(type.name, typeRef);
        foreignTypeRefs.set(typeRef.key, typeRef);
      }
      for (const arg of type.args) rememberForeignTypeNames(arg, foreignTypeRefs);
      break;
    case "TTuple":
      for (const item of type.items) rememberForeignTypeNames(item, foreignTypeRefs);
      break;
    case "TFn":
      for (const param of type.params) rememberForeignTypeNames(param, foreignTypeRefs);
      rememberForeignTypeNames(type.result, foreignTypeRefs);
      break;
    case "TVar":
      break;
  }
}

function isReflectedForeignTypeName(typeName: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(typeName) &&
    !builtInTypeNames.has(typeName) &&
    !typeName.startsWith("Js.");
}

const builtInTypeNames = new Set([
  "Bool",
  "Number",
  "Option",
  "Result",
  "String",
  "Void",
]);

function resolveDelayedCallArg(
  arg: Expr,
  argIndex: number,
  variant: FfiVariant,
  ffi: FfiElaboration,
  result: InferResult,
  selected: Set<string>,
  options: ResolveOptions,
  valueRefs: Map<string, JsTypeRef>,
  resolveExpr: ResolveExpr,
): Expr {
  const callbackRefs = variant.callbackParamRefs?.find((item) => item.argIndex === argIndex);
  const localValueRefs = refsForCallbackArg(new Map(valueRefs), arg, callbackRefs?.params);
  const rewritten = rewriteExprCalls(
    arg,
    ffi.bindings,
    selected,
    localValueRefs,
    new Map(),
    ffi.foreignTypeRefs,
  );
  return resolveExpr(rewritten, ffi, result, selected, options, localValueRefs);
}
