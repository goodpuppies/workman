import ts from "typescript";
import type { TypeExpr } from "../../ast.ts";
import { typeOfSymbol } from "./host.ts";
import type {
  JsCallableVariant,
  JsCallArgHint,
  JsCallbackParamRefs,
  JsMemberType,
  JsTypeRef,
} from "./types.ts";
import { fn, name, option } from "../type_expr.ts";

const maxReflectedRestArity = 8;

export function jsMemberTypeFromTsType(
  checker: ts.TypeChecker,
  type: ts.Type,
  resultRef?: (index: number, signature: ts.Signature) => JsTypeRef | undefined,
  callbackParamRef?: (
    signatureIndex: number,
    paramIndex: number,
    callbackParamIndex: number,
    callbackParamType: ts.Type,
    signature: ts.Signature,
  ) => JsTypeRef | undefined,
): Omit<JsMemberType, "name"> | undefined {
  const variants = dedupeVariants(
    type.getCallSignatures().flatMap((signature, index) =>
      functionVariantsFromSignature(
        checker,
        signature,
        (paramIndex, callbackParamIndex, callbackParamType) =>
          callbackParamRef?.(index, paramIndex, callbackParamIndex, callbackParamType, signature),
      ).map((variant) => ({
        ...variant,
        resultRef: resultRefWithType(
          resultRef?.(index, signature),
          returnTypeOfVariant(variant.type),
        ),
      }))
    ),
  );
  const overloads = variants.map((variant) => variant.type);
  if (variants.length === 0) return undefined;
  return {
    type: variants[0].type,
    overloads: overloads.length > 1 ? overloads : undefined,
    variants,
  };
}

function resultRefWithType(ref: JsTypeRef | undefined, type: TypeExpr): JsTypeRef | undefined {
  return ref ? { ...ref, type } : undefined;
}

function returnTypeOfVariant(type: TypeExpr): TypeExpr {
  return type.kind === "TFn" ? type.result : type;
}

export function typeExprFromTsType(
  checker: ts.TypeChecker,
  type: ts.Type,
  position: "param" | "result" = "result",
): TypeExpr | undefined {
  if (
    position === "param" && /\b(BodyInit|XMLHttpRequestBodyInit)\b/.test(checker.typeToString(type))
  ) {
    return name("String");
  }
  if (position === "param" && checker.typeToString(type) === "ArrayBuffer") {
    return name("ArrayBuffer");
  }
  if (
    position === "param" &&
    /\b(ArrayBuffer|ArrayBufferLike|BufferSource)\b/.test(checker.typeToString(type))
  ) {
    return name("Js.Object");
  }
  if (isTsType(checker, type, "number")) return name("Number");
  if (isTsType(checker, type, "string")) return name("String");
  if (isTsType(checker, type, "boolean")) return name("Bool");
  const awaited = awaitedTypeArgument(checker, type, position);
  if (awaited) return awaited;
  const nullish = nullishUnionParts(type);
  if (nullish) {
    const inner = nullish.value
      ? (typeExprFromTsType(checker, nullish.value, position) ?? name("Js.Value"))
      : name("Js.Value");
    return option(inner);
  }
  if (type.isUnion()) {
    if (position === "param" && type.types.some(isFunctionType)) return name("Js.Value");
    if (type.types.some(isObjectLike)) {
      if (position === "result" && type.types.every(isObjectLike)) return name("Js.Object");
      return position === "param" && type.types.some(isStringLike) && type.types
          .filter(isObjectLike)
          .every((item) => checker.typeToString(item) === "URL")
        ? name("String")
        : name("Js.Value");
    }
    if (position === "param" && type.types.some(isStringLike)) return name("String");
    if (type.types.some(isStringLike)) return name("String");
    const mapped = type.types.map((item) => typeExprFromTsType(checker, item, position));
    if (mapped.some((item) => item?.kind === "TName" && item.name === "Js.Value")) {
      return name("Js.Value");
    }
    if (mapped.some((item) => item?.kind === "TName" && item.name === "String")) {
      return name("String");
    }
  }
  const signature = type.getCallSignatures()[0];
  if (signature) return functionTypeFromSignature(checker, signature);
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint && !isAnyOrUnknown(constraint)) {
      return typeExprFromTsType(checker, constraint, position) ?? name("Js.Value");
    }
    return name("Js.Value");
  }
  if (type.flags & ts.TypeFlags.StringLiteral) return name("String");
  if (type.flags & ts.TypeFlags.NumberLiteral) return name("Number");
  if (type.flags & ts.TypeFlags.BooleanLiteral) return name("Bool");
  if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return name("Void");
  const promised = promiseElementType(checker, type, position);
  if (promised) return { kind: "TName", name: "Task", args: [promised, name("Js.Error")] };
  if (position === "param" && isNumericTypedArray(checker, type)) {
    return { kind: "TName", name: "Js.Array", args: [name("Number")] };
  }
  const arrayElement = arrayElementType(checker, type, position);
  if (arrayElement) return { kind: "TName", name: "Js.Array", args: [arrayElement] };
  const nominal = nominalObjectTypeName(checker, type);
  if (position === "result" && nominal) return name(nominal);
  if (position === "result" && isObjectLike(type)) return name("Js.Object");
  return name("Js.Value");
}

export function nominalObjectTypeName(checker: ts.TypeChecker, type: ts.Type): string | undefined {
  if (!(type.flags & ts.TypeFlags.Object)) return undefined;
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const typeName = symbol?.getName();
  if (!typeName || typeName === "__type" || typeName === "Object") return undefined;
  if (!/^[A-Za-z_$][\w$]*$/.test(typeName)) return undefined;
  if (isNumericTypedArrayName(typeName)) return typeName;
  const text = checker.typeToString(type);
  if (/[<>{}&|()[\],]/.test(text)) return undefined;
  return typeName;
}

function awaitedTypeArgument(
  checker: ts.TypeChecker,
  type: ts.Type,
  position: "param" | "result",
): TypeExpr | undefined {
  const text = checker.typeToString(type);
  if (/^Awaited<.+>$/.test(text)) {
    const awaited = (checker as { getAwaitedType?: (type: ts.Type) => ts.Type | undefined })
      .getAwaitedType?.(type);
    if (awaited && awaited !== type) {
      return typeExprFromTsType(checker, awaited, position) ?? name("Js.Value");
    }
  }
  const match = /^Awaited<([A-Za-z_][A-Za-z0-9_]*)>$/.exec(text);
  if (match) return name("Js.Value");
  if (!/^Awaited<.+>$/.test(text)) return undefined;
  const ref = type as ts.TypeReference;
  const arg = ref.typeArguments?.[0] ?? checker.getTypeArguments(ref)[0];
  return arg ? typeExprFromTsType(checker, arg, position) ?? name("Js.Value") : name("Js.Value");
}

function nullishUnionParts(type: ts.Type): { value?: ts.Type } | undefined {
  if (!type.isUnion()) return undefined;
  const valueTypes = type.types.filter((item) => !isNullish(item));
  if (valueTypes.length === type.types.length) return undefined;
  if (valueTypes.length === 0) return {};
  if (valueTypes.length === 1) return { value: valueTypes[0] };
  return {};
}

function isNullish(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Null) || !!(type.flags & ts.TypeFlags.Undefined);
}

function functionTypeFromSignature(checker: ts.TypeChecker, signature: ts.Signature): TypeExpr {
  return functionVariantsFromSignature(checker, signature)[0].type;
}

export function functionVariantsFromSignature(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  callbackParamRef?: (
    paramIndex: number,
    callbackParamIndex: number,
    callbackParamType: ts.Type,
  ) => JsTypeRef | undefined,
): JsCallableVariant[] {
  const declaration = signature.getDeclaration();
  type ReflectedParam = {
    type: TypeExpr;
    optional: boolean;
    rest: boolean;
    callbackRefs?: JsTypeRef[];
  };
  const parameters: ReflectedParam[] = signature
    .getParameters()
    .flatMap((symbol, index): ReflectedParam[] => {
      const declarationParam = declaration?.parameters[index];
      const type = typeOfSymbol(checker, symbol) ?? checker.getAnyType();
      if (declarationParam?.dotDotDotToken) {
        const element = restElementType(checker, type) ?? checker.getAnyType();
        const callbackRefs = callbackRefsForParam(checker, element, index, callbackParamRef);
        const mapped = paramTypeExpr(checker, element, index, callbackRefs);
        return [{
          type: mapped,
          optional: false,
          rest: true,
          callbackRefs,
        }];
      }
      const optional = !!declarationParam?.questionToken || !!declarationParam?.initializer;
      const callbackRefs = callbackRefsForParam(checker, type, index, callbackParamRef);
      const mapped = stripOptionForOptional(
        paramTypeExpr(checker, type, index, callbackRefs),
        optional,
      );
      return [{
        type: mapped,
        optional,
        rest: false,
        callbackRefs,
      }];
    });
  const result = typeExprFromTsType(checker, checker.getReturnTypeOfSignature(signature)) ??
    name("Js.Value");
  const restIndex = parameters.findIndex((param) => param.rest);
  if (restIndex !== -1) {
    const fixed = parameters.slice(0, restIndex);
    const required = lastRequiredParameter(fixed) + 1;
    const overloads: JsCallableVariant[] = [];
    for (let count = required; count <= maxReflectedRestArity; count++) {
      const params: TypeExpr[] = [];
      for (let index = 0; index < Math.min(count, fixed.length); index++) {
        params.push(fixed[index].type);
      }
      for (let index = params.length; index < count; index++) {
        params.push(restSlotType(parameters[restIndex].type, index));
      }
      overloads.push({
        type: fn(params, result),
        callbackParamRefs: callbackParamRefsForArity(parameters, count),
      });
    }
    return overloads;
  }
  const required = lastRequiredParameter(parameters) + 1;
  const overloads: JsCallableVariant[] = [];
  for (let count = required; count <= parameters.length; count++) {
    overloads.push({
      type: fn(parameters.slice(0, count).map((param) => param.type), result),
      callbackParamRefs: callbackParamRefsForArity(parameters, count),
    });
  }
  return overloads.length ? overloads : [{ type: fn([], result) }];
}

function callbackRefsForParam(
  checker: ts.TypeChecker,
  type: ts.Type,
  paramIndex: number,
  callbackParamRef:
    | ((
      paramIndex: number,
      callbackParamIndex: number,
      callbackParamType: ts.Type,
    ) => JsTypeRef | undefined)
    | undefined,
): JsTypeRef[] | undefined {
  const signature = type.getCallSignatures()[0];
  if (!signature) return undefined;
  return signature.getParameters()
    .map((symbol, callbackParamIndex) => {
      const paramType = typeOfSymbol(checker, symbol) ?? checker.getAnyType();
      return callbackParamRef?.(paramIndex, callbackParamIndex, paramType);
    })
    .filter((ref): ref is JsTypeRef => !!ref);
}

function callbackParamRefsForArity(
  parameters: { callbackRefs?: JsTypeRef[] }[],
  arity: number,
): JsCallbackParamRefs[] | undefined {
  const refs = parameters.slice(0, arity)
    .map((param, argIndex) =>
      param.callbackRefs?.length ? { argIndex, params: param.callbackRefs } : undefined
    )
    .filter((item): item is JsCallbackParamRefs => !!item);
  return refs.length ? refs : undefined;
}

export function callbackParamRefsFromCall(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  args: JsCallArgHint[],
  typeRefFromTsType: (key: string, checker: ts.TypeChecker, type: ts.Type) => JsTypeRef,
  keyPrefix = `call:${call.getStart()}`,
): JsCallbackParamRefs[] | undefined {
  const refs = call.arguments.map((arg, argIndex) => {
    if (args[argIndex]?.kind !== "function" || !ts.isArrowFunction(arg)) return undefined;
    const params = arg.parameters.map((param, callbackParamIndex) => {
      const key = `${keyPrefix}:callback:${argIndex}:${callbackParamIndex}`;
      return typeRefFromTsType(key, checker, checker.getTypeAtLocation(param));
    });
    return params.length ? { argIndex, params } : undefined;
  }).filter((item): item is JsCallbackParamRefs => !!item);
  return refs.length ? refs : undefined;
}

function paramTypeExpr(
  checker: ts.TypeChecker,
  type: ts.Type,
  index: number,
  callbackRefs?: JsTypeRef[],
): TypeExpr {
  if (isAnyOrUnknown(type)) return name("Js.Value");
  const signature = type.getCallSignatures()[0];
  if (signature && signatureHasRest(signature)) {
    return fn(
      [name("Js.Value")],
      typeExprFromTsType(checker, checker.getReturnTypeOfSignature(signature)) ?? name("Void"),
    );
  }
  if (signature) return callbackFunctionTypeFromSignature(checker, signature, callbackRefs);
  return typeExprFromTsType(checker, type, "param") ?? name("Js.Value");
}

function callbackFunctionTypeFromSignature(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  callbackRefs?: JsTypeRef[],
): TypeExpr {
  const params = signature.getParameters().map((symbol, index) => {
    const type = typeOfSymbol(checker, symbol) ?? checker.getAnyType();
    return callbackRefs?.[index]?.type ?? callbackParamTypeExpr(checker, type, index);
  });
  const result = typeExprFromTsType(checker, checker.getReturnTypeOfSignature(signature)) ??
    name("Void");
  return fn(params, result);
}

function callbackParamTypeExpr(checker: ts.TypeChecker, type: ts.Type, index: number): TypeExpr {
  if (isAnyOrUnknown(type)) return name("Js.Value");
  if (isObjectLike(type)) return name("Js.Object");
  return typeExprFromTsType(checker, type, "param") ?? name("Js.Value");
}

function restSlotType(type: TypeExpr, _index: number): TypeExpr {
  return type.kind === "TVar" ? name("Js.Value") : type;
}

function stripOptionForOptional(type: TypeExpr, optional: boolean): TypeExpr {
  return optional && type.kind === "TName" && type.name === "Option" && type.args.length === 1
    ? type.args[0]
    : type;
}

function lastRequiredParameter(parameters: { optional: boolean }[]): number {
  for (let i = parameters.length - 1; i >= 0; i--) {
    if (!parameters[i].optional) return i;
  }
  return -1;
}

export function dedupeVariants(variants: JsCallableVariant[]): JsCallableVariant[] {
  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = typeKey(variant.type);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function typeKey(type: TypeExpr): string {
  switch (type.kind) {
    case "TName":
      return `${type.name}<${type.args.map(typeKey).join(",")}>`;
    case "TVar":
      return `'${type.name}`;
    case "TTuple":
      return `(${type.items.map(typeKey).join(",")})`;
    case "TFn":
      return `(${type.params.map(typeKey).join(",")})->${typeKey(type.result)}`;
  }
}

function restElementType(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
  const ref = type as ts.TypeReference;
  if (ref.typeArguments?.length === 1) return ref.typeArguments[0];
  return checker.getIndexTypeOfType(type, ts.IndexKind.Number);
}

function arrayElementType(
  checker: ts.TypeChecker,
  type: ts.Type,
  position: "param" | "result",
): TypeExpr | undefined {
  if (checker.isArrayType(type)) {
    return typeExprFromArrayElement(checker, restElementType(checker, type));
  }
  if (position !== "param") return undefined;
  const text = checker.typeToString(type);
  if (
    !/\b(ArrayLike|Iterable|Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array)\b/
      .test(text)
  ) {
    return undefined;
  }
  return typeExprFromArrayElement(checker, checker.getIndexTypeOfType(type, ts.IndexKind.Number));
}

function promiseElementType(
  checker: ts.TypeChecker,
  type: ts.Type,
  position: "param" | "result",
): TypeExpr | undefined {
  const promised =
    (checker as { getPromisedTypeOfPromise?: (type: ts.Type) => ts.Type | undefined })
      .getPromisedTypeOfPromise?.(type);
  if (promised) return typeExprFromTsType(checker, promised, position) ?? name("Js.Value");
  const text = checker.typeToString(type);
  if (!/\bPromise(?:Like)?\b/.test(text)) return undefined;
  const ref = type as ts.TypeReference;
  const typeArg = ref.typeArguments?.[0] ?? checker.getTypeArguments(ref)[0];
  return typeArg
    ? typeExprFromTsType(checker, typeArg, position) ?? name("Js.Value")
    : name("Js.Value");
}

function isNumericTypedArray(checker: ts.TypeChecker, type: ts.Type): boolean {
  return isNumericTypedArrayName(checker.typeToString(type));
}

function isNumericTypedArrayName(name: string): boolean {
  return /\b(?:Uint8Array|Uint8ClampedArray|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array)\b/
    .test(name);
}

function typeExprFromArrayElement(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
): TypeExpr {
  if (!type) return name("Js.Value");
  if (type.flags & ts.TypeFlags.TypeParameter) {
    return name("Js.Value");
  }
  return typeExprFromTsType(checker, type, "param") ?? name("Js.Value");
}

function isTsType(checker: ts.TypeChecker, type: ts.Type, expected: string): boolean {
  return checker.typeToString(type) === expected;
}

function isAnyOrUnknown(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Any) || !!(type.flags & ts.TypeFlags.Unknown);
}

function signatureHasRest(signature: ts.Signature): boolean {
  return !!signature.getDeclaration()?.parameters.some((param) => !!param.dotDotDotToken);
}

function isObjectLike(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Object);
}

function isStringLike(type: ts.Type): boolean {
  return !!(type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral));
}

function isFunctionType(type: ts.Type): boolean {
  return type.getCallSignatures().length > 0 || !!(type.flags & ts.TypeFlags.Object) &&
      /^(Function|TimerHandler)$/.test(type.symbol?.getName() ?? "");
}
