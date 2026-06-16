import type { Expr, TypeExpr } from "../../ast.ts";
import type { InferResult } from "../../infer.ts";
import { recordExprFact, resolveFfiFact } from "../../infer/type_facts.ts";
import { prune, solveFfi, typeFromAst } from "../../types.ts";
import type { ResolveOptions } from "./types.ts";
import { rewriteExprCalls } from "../receiver/rewrite_expr.ts";
import { inferredType, knownTyToTypeExpr } from "./receiver_models.ts";
import {
  addVariants,
  type FfiBinding,
  type FfiElaboration,
  type FfiVariant,
  memberVariants,
  prependReceiver,
  refsForCallbackArg,
  selectVariant,
} from "../shared.ts";
import { jsGlobalTypeRef, type JsMemberType, type JsTypeRef } from "../reflect/types.ts";

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
    type: prependReceiver(variant.type, receiverType),
    resultRef: variant.resultRef,
    callbackParamRefs: variant.callbackParamRefs?.map((item) => ({
      argIndex: item.argIndex + 1,
      params: item.params,
    })),
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
  const variant = selectVariant(bindings.get(surfaceName)?.variants ?? [], [receiver]);
  if (!variant) return { kind: "FfiGet", receiver, path };
  solveReflectedFfiValue(original, variant, result);
  selected.add(variant.internalName);
  return {
    kind: "Call",
    callee: { kind: "Var", name: variant.internalName },
    args: [receiver],
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
  const variants = memberVariants(member).map((variant) => ({
    type: prependReceiver(variant.type, receiverType),
    resultRef: variant.resultRef,
    callbackParamRefs: variant.callbackParamRefs?.map((item) => ({
      argIndex: item.argIndex + 1,
      params: item.params,
    })),
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
  const allArgs = [receiver, ...args];
  const argTypes = [
    receiverType,
    ...args.map((arg) => {
      const type = inferredType(result, arg);
      return type ? knownTyToTypeExpr(type) : undefined;
    }),
  ];
  const variant = selectVariant(ffi.bindings.get(surfaceName)?.variants ?? [], allArgs, argTypes);
  if (!variant) return { kind: "FfiCall", receiver, path, args };
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
          index + 1,
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
  };
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
    resultRef?: JsTypeRef;
    callbackParamRefs?: { params: JsTypeRef[] }[];
  }[],
  foreignTypeRefs: Map<string, JsTypeRef>,
) {
  for (const variant of variants) {
    rememberForeignTypeNames(variant.type, foreignTypeRefs);
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
