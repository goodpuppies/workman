import {
  type Checker,
  type ConditionalType,
  ElementFlags,
  IndexKind,
  type ObjectType,
  ObjectFlags,
  type Signature,
  type TupleType,
  type Type,
  TypeFlags,
  TypeFormatFlags,
  type TypeReference,
  type UnionType,
} from "tsrs/sync";
import type { CallExpression } from "tsrs/ast";
import {
  isArrowFunction,
  isClassDeclaration,
  isEnumDeclaration,
  isInterfaceDeclaration,
  isStringLiteralLikeNode,
  isTupleTypeNode,
  isTypeAliasDeclaration,
} from "tsrs/ast/is";
import type { TypeExpr } from "../../ast.ts";
import {
  resolveSignatureDeclaration,
  resolveSymbolDeclarations,
  typeOfSymbol,
} from "./host.ts";
import type {
  JsCallableVariant,
  JsCallArgHint,
  JsCallbackParamRefs,
  JsMemberType,
  JsTypeRef,
} from "./types.ts";
import { fn, name, option } from "../type_expr.ts";
import { foreignCallableIdentity } from "./callable_identity.ts";

const maxReflectedRestArity = 8;

type ReflectedParam = {
  type: TypeExpr;
  optional: boolean;
  rest: boolean;
  callbackRefs?: JsTypeRef[];
};

export function jsMemberTypeFromTsType(
  checker: Checker,
  type: Type,
  resultRef?: (index: number, signature: Signature) => JsTypeRef | undefined,
  callbackParamRef?: (
    signatureIndex: number,
    paramIndex: number,
    callbackParamIndex: number,
    callbackParamType: Type,
    signature: Signature,
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
        genericCall: !!signature.typeParameters?.length,
        resultRef: resultRefWithType(
          resultRef?.(index, signature),
          returnTypeOfVariant(variant.type),
          checker,
          checker.getReturnTypeOfSignature(signature),
          signature,
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

function resultRefWithType(
  ref: JsTypeRef | undefined,
  type: TypeExpr,
  checker: Checker,
  foreign: Type,
  signature: Signature,
): JsTypeRef | undefined {
  const generic = type.kind === "TName" && type.name === nominalObjectTypeName(checker, foreign)
    ? nominalGenericConstructor(checker, foreign)
    : undefined;
  return ref
    ? {
      ...ref,
      generic,
      type,
      nestedTypeRefs: [
        ...nestedForeignTypeRefs(checker, foreign, ref.source),
        ...signature.getParameters().flatMap((symbol) => {
          const parameter = typeOfSymbol(checker, symbol);
          return parameter
            ? nestedForeignTypeRefs(checker, parameter, ref.source, true).filter((item) =>
              item.generic
            )
            : [];
        }),
      ],
    }
    : undefined;
}

function returnTypeOfVariant(type: TypeExpr): TypeExpr {
  return type.kind === "TFn" ? type.result : type;
}

export function typeExprFromTsType(
  checker: Checker,
  type: Type,
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
  if (position === "param") {
    const bufferSource = bufferSourceParamExpr(checker, type);
    if (bufferSource) return bufferSource;
  }
  if (isAnyOrUnknown(type)) return name("Js.Value");
  if (type.flags & TypeFlags.Never) return name("JsNever");
  if (type.flags & TypeFlags.Conditional) return name("Js.Value");
  if (isTsType(checker, type, "number")) return name("Real64.Real");
  if (isTsType(checker, type, "string")) return name("String");
  if (isTsType(checker, type, "boolean")) return name("Bool");
  const enumType = enumTypeExpr(type);
  if (enumType) return enumType;
  const pointer = denoPointerTypeExpr(checker, type);
  if (pointer) return pointer;
  const awaited = awaitedTypeArgument(checker, type, position);
  if (awaited) return awaited;
  const nullish = nullishUnionParts(type);
  if (nullish) {
    const inner = nullish.value ? typeExprFromTsType(checker, nullish.value, position) : undefined;
    if (inner) return option(inner);
    if (nullish.values?.every(isObjectLike)) return option(name("Js.Object"));
    return position === "param" ? option(name("Js.Value")) : undefined;
  }
  if (type.isUnionType()) {
    const unionTypes = type.getTypes();
    const promisedUnion = promisedOrValueUnionType(checker, type, position);
    if (promisedUnion) return promisedUnion;
    if (unionTypes.some(isObjectLike)) {
      return position === "param" && unionTypes.some(isStringLike) && unionTypes
          .filter(isObjectLike)
          .every((item) => checker.typeToString(item) === "URL")
        ? name("String")
        : position === "param"
        ? name("Js.Value")
        : undefined;
    }
    if (position === "param" && unionTypes.some(isStringLike)) return name("String");
    const mapped = unionTypes.map((item) => typeExprFromTsType(checker, item, position));
    if (mapped.some((item) => !item)) return undefined;
    const first = mapped[0];
    if (first && mapped.every((item) => typeKey(item!) === typeKey(first))) return first;
    return position === "result" ? name("Js.Value") : undefined;
  }
  const signature = type.getCallSignatures()[0];
  const callable = position === "result" ? foreignCallableIdentity(checker, type) : undefined;
  if (callable) return name(callable.name);
  if (signature) return functionTypeFromSignature(checker, signature);
  if (type.flags & TypeFlags.TypeParameter) {
    const receiverType = nominalTypeParameterObjectName(type);
    if (position === "result" && receiverType) return name(receiverType);
    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint && !isAnyOrUnknown(constraint)) {
      if (position === "param" && isExplicitDynamicObject(checker, constraint)) {
        return name("Js.Value");
      }
      return typeExprFromTsType(checker, constraint, position);
    }
    return name("Js.Value");
  }
  if (type.flags & TypeFlags.StringLiteral) return name("String");
  if (type.flags & TypeFlags.NumberLiteral) return name("Real64.Real");
  if (type.flags & TypeFlags.BooleanLiteral) return name("Bool");
  if (type.flags & (TypeFlags.Void | TypeFlags.Undefined)) return name("Void");
  const promised = promiseElementType(checker, type, position);
  if (promised) {
    return { kind: "TName", name: "Task", args: [promised, name("Js.Error")], ffiPromise: true };
  }
  if (position === "param" && isNumericTypedArray(checker, type)) {
    const nominal = nominalObjectTypeName(checker, type);
    if (nominal) return name(nominal);
  }
  const arrayElement = arrayElementType(checker, type, position);
  if (arrayElement) return { kind: "TName", name: "Js.Array", args: [arrayElement] };
  const dictionary = position === "result" ? dictionaryTypeExpr(checker, type, position) : undefined;
  if (dictionary) return dictionary;
  const nominal = nominalObjectTypeName(checker, type);
  if (nominal === "DynamicLibrary") return name("Js.Object");
  if (nominal) {
    const generic = nominalGenericConstructor(checker, type);
    if (generic) {
      if (position === "param" && usesOnlyDefaultTypeArguments(checker, type)) {
        return name("Js.Value");
      }
      const args = checker.getTypeArguments(type as TypeReference).slice(0, generic.arity)
        .map((arg) =>
          containsTypeParameter(arg)
            ? name("Js.Value")
            : typeExprFromTsType(checker, arg, position) ?? name("Js.Value")
        );
      if (args.length !== generic.arity || args.some((arg) => !arg)) return undefined;
      return { kind: "TName", name: nominal, args: args as TypeExpr[] };
    }
    if (position === "result") return name(nominal);
  }
  const tuple = fixedTupleTypeExpr(checker, type, position);
  if (tuple) return tuple;
  const opaqueTupleAlias = opaqueTupleAliasTypeName(type);
  if (opaqueTupleAlias) return name(opaqueTupleAlias);
  if (isExplicitDynamicObject(checker, type)) {
    return position === "param" ? name("Js.Value") : name("Js.Object");
  }
  if (
    position === "result" &&
    isObjectLike(type) &&
    !nominal &&
    checker.typeToString(type).trimStart().startsWith("{")
  ) {
    return name("Js.Object");
  }
  return position === "param" ? name("Js.Value") : undefined;
}

function dictionaryTypeExpr(
  checker: Checker,
  type: Type,
  position: "param" | "result",
): TypeExpr | undefined {
  if (!isObjectLike(type) || isExplicitDynamicObject(checker, type)) return undefined;
  if (type.getCallSignatures().length || type.getConstructSignatures().length) return undefined;
  if (checker.getPropertiesOfType(type).length) return undefined;
  const infos = checker.getIndexInfosOfType(type);
  if (infos.length !== 1 || !(infos[0].keyType.flags & TypeFlags.String)) return undefined;
  const value = typeExprFromTsType(checker, infos[0].valueType, position);
  return value ? { kind: "TName", name: "Js.Dict", args: [value] } : undefined;
}

function nominalTypeParameterObjectName(type: Type): string | undefined {
  const symbol = type.getSymbol();
  const typeName = symbol?.name;
  if (!symbol || !typeName || !/^[A-Za-z_$][\w$]*$/.test(typeName)) return undefined;
  return resolveSymbolDeclarations(symbol).some((declaration) =>
      isClassDeclaration(declaration) || isInterfaceDeclaration(declaration)
    )
    ? typeName
    : undefined;
}

function opaqueTupleAliasTypeName(type: Type): string | undefined {
  const symbol = type.getAliasSymbol();
  if (!symbol) return undefined;
  const declaration = resolveSymbolDeclarations(symbol).find(isTypeAliasDeclaration);
  if (!declaration || !isTupleTypeNode(declaration.type)) return undefined;
  const typeName = symbol.name;
  return typeName && /^[A-Za-z_$][\w$]*$/.test(typeName) ? typeName : undefined;
}

function enumTypeExpr(type: Type): TypeExpr | undefined {
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  if (!symbol) return undefined;
  const declaration = resolveSymbolDeclarations(symbol).find(isEnumDeclaration);
  if (!declaration) return undefined;
  const kinds = new Set(
    declaration.members.map((member) =>
      member.initializer && isStringLiteralLikeNode(member.initializer) ? "string" : "number"
    ),
  );
  if (kinds.size !== 1) return undefined;
  return name(kinds.has("string") ? "String" : "Real64.Real");
}

function promisedOrValueUnionType(
  checker: Checker,
  type: UnionType,
  position: "param" | "result",
): TypeExpr | undefined {
  const members = type.getTypes();
  if (position !== "result" || members.length !== 2) return undefined;
  const promised = members.find((item) =>
    /\bPromise(?:Like)?</.test(checker.typeToString(item))
  );
  const value = members.find((item) => item !== promised);
  if (!promised || !value) return undefined;
  const promisedValue = promiseElementType(checker, promised, position);
  const directValue = typeExprFromTsType(checker, value, position);
  if (!promisedValue || !directValue || typeKey(promisedValue) !== typeKey(directValue)) {
    return undefined;
  }
  return { kind: "TName", name: "Task", args: [directValue, name("Js.Error")], ffiPromise: true };
}

export function nominalObjectTypeName(checker: Checker, type: Type): string | undefined {
  if (!(type.flags & TypeFlags.Object)) return undefined;
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const typeName = symbol?.name;
  if (!typeName || typeName === "__type" || typeName === "Object") return undefined;
  if (!/^[A-Za-z_$][\w$]*$/.test(typeName)) return undefined;
  if (isNumericTypedArrayName(typeName)) return typeName;
  if (
    symbol &&
    resolveSymbolDeclarations(symbol).some((decl) =>
      isClassDeclaration(decl) || isInterfaceDeclaration(decl)
    )
  ) {
    return typeName;
  }
  const text = checker.typeToString(type);
  if (/[<>{}&|()[\],]/.test(text)) return undefined;
  return typeName;
}

export function nominalGenericConstructor(
  checker: Checker,
  type: Type,
): JsTypeRef["generic"] {
  if (!(type.flags & TypeFlags.Object)) return undefined;
  if (!((type as ObjectType).objectFlags & ObjectFlags.Reference)) return undefined;
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  if (!symbol) return undefined;
  const declaration = resolveSymbolDeclarations(symbol).find((decl) =>
    isClassDeclaration(decl) || isInterfaceDeclaration(decl)
  );
  if (!declaration) return undefined;
  const arity = declaration.typeParameters?.length ?? 0;
  if (!arity || isNumericTypedArrayName(symbol.name)) return undefined;
  const qualified = checker.getFullyQualifiedName(symbol);
  const expression = qualified.replace(/^("(?:[^"\\]|\\.)+")\./, "import($1).")
    .replace(/^global\./, "");
  const requiredArity = declaration.typeParameters!.filter((param) => !param.defaultType).length;
  return { key: `generic-type:${expression}`, expression, arity, requiredArity };
}

function usesOnlyDefaultTypeArguments(checker: Checker, type: Type): boolean {
  if (!type.isTypeReference()) return false;
  const target = type.getTarget();
  const parameters = target.getTypeParameters() ?? [];
  const args = checker.getTypeArguments(type);
  return parameters.length > 0 && parameters.every((parameter, index) => {
    const declared = checker.getDefaultFromTypeParameter(parameter);
    return declared !== undefined && args[index]?.id === declared.id;
  });
}

function containsTypeParameter(type: Type): boolean {
  if (type.flags & TypeFlags.TypeParameter) return true;
  if (type.isUnionType() || type.isIntersectionType()) {
    return type.getTypes().some(containsTypeParameter);
  }
  if (type.flags & TypeFlags.Conditional) {
    const conditional = type as ConditionalType;
    return containsTypeParameter(conditional.getCheckType()) ||
      containsTypeParameter(conditional.getExtendsType());
  }
  return false;
}

/** A global type has one identity however it is reached, so it uses the key its import gets. */
function nestedNominalKey(checker: Checker, type: Type, expression: string): string {
  if (expression.startsWith("import(")) return `nominal-type:${expression}`;
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const qualified = symbol && checker.getFullyQualifiedName(symbol).replace(/^global\./, "");
  return qualified && !qualified.startsWith('"')
    ? `global-type:${qualified}`
    : `nominal-type:${expression}`;
}

/** Nominal identities below a generic result (for example an Effect's error). */
export function nestedForeignTypeRefs(
  checker: Checker,
  type: Type,
  source: string,
  includeType = false,
  rootExpression?: string,
): JsTypeRef[] {
  const refs: JsTypeRef[] = [];
  const seen = new Set<number>();
  const visit = (current: Type, expression?: string) => {
    if (seen.has(current.id)) return;
    seen.add(current.id);
    if (current.isUnionType()) return current.getTypes().forEach((item) => visit(item));
    const callable = foreignCallableIdentity(checker, current);
    if (callable) {
      const expr = `__wm_nested_callable_${refs.length}`;
      const actualType = expression ??
        checker.typeToString(
          current,
          undefined,
          TypeFormatFlags.NoTruncation | TypeFormatFlags.UseFullyQualifiedType,
        );
      refs.push({
        key: callable.key,
        source: `${source}\ndeclare const ${expr}: ${actualType};`,
        expr,
        type: name(callable.name),
      });
      return;
    }
    const nominal = nominalObjectTypeName(checker, current);
    const mapped = typeExprFromTsType(checker, current);
    if (nominal && mapped?.kind === "TName" && mapped.name === nominal) {
      const generic = nominalGenericConstructor(checker, current);
      const expression = checker.typeToString(
        current,
        undefined,
        TypeFormatFlags.UseFullyQualifiedType,
      );
      const expr = `__wm_nested_type_${refs.length}`;
      refs.push({
        key: generic?.key ?? nestedNominalKey(checker, current, expression),
        source: `${source}\ndeclare const ${expr}: ${expression};`,
        expr,
        generic,
        type: mapped,
      });
    }
    if (dictionaryTypeExpr(checker, current, "result")) {
      const value = checker.getIndexInfosOfType(current)[0].valueType;
      visit(value, expression ? `${expression}[string]` : undefined);
    }
    if (
      current.flags & TypeFlags.Object &&
      (current as ObjectType).objectFlags & ObjectFlags.Reference
    ) {
      const tuple = current.isTupleType();
      checker.getTypeArguments(current as TypeReference).forEach((item, index) =>
        visit(item, expression && tuple ? `${expression}[${index}]` : undefined)
      );
    }
  };
  if (includeType) {
    visit(type, rootExpression);
  } else if (
    type.flags & TypeFlags.Object &&
    (type as ObjectType).objectFlags & ObjectFlags.Reference
  ) {
    const tuple = type.isTupleType();
    checker.getTypeArguments(type as TypeReference).forEach((item, index) =>
      visit(item, rootExpression && tuple ? `${rootExpression}[${index}]` : undefined)
    );
  } else if (foreignCallableIdentity(checker, type)) {
    visit(type, rootExpression);
  } else if (dictionaryTypeExpr(checker, type, "result")) {
    const value = checker.getIndexInfosOfType(type)[0].valueType;
    visit(value, rootExpression ? `${rootExpression}[string]` : undefined);
  }
  return refs;
}

function awaitedTypeArgument(
  checker: Checker,
  type: Type,
  position: "param" | "result",
): TypeExpr | undefined {
  const text = checker.typeToString(type);
  if (/^Awaited<.+>$/.test(text)) {
    const awaited = checker.getAwaitedType(type);
    if (awaited && awaited.id !== type.id) {
      return typeExprFromTsType(checker, awaited, position);
    }
  }
  const match = /^Awaited<([A-Za-z_][A-Za-z0-9_]*)>$/.exec(text);
  if (match) return undefined;
  if (!/^Awaited<.+>$/.test(text)) return undefined;
  const arg = type.isTypeReference() ? checker.getTypeArguments(type)[0] : undefined;
  return arg ? typeExprFromTsType(checker, arg, position) : undefined;
}

function nullishUnionParts(
  type: Type,
): { value?: Type; values?: Type[] } | undefined {
  if (!type.isUnionType()) return undefined;
  const members = type.getTypes();
  const valueTypes = members.filter((item) => !isNullish(item));
  if (valueTypes.length === members.length) return undefined;
  if (valueTypes.length === 0) return {};
  if (valueTypes.length === 1) return { value: valueTypes[0] };
  return { values: valueTypes };
}

function isNullish(type: Type): boolean {
  return !!(type.flags & TypeFlags.Null) || !!(type.flags & TypeFlags.Undefined);
}

function denoPointerTypeExpr(checker: Checker, type: Type): TypeExpr | undefined {
  const text = checker.typeToString(type);
  if (/^(?:Deno\.)?PointerValue(?:<.*>)?$/.test(text)) return option(name("Js.Object"));
  if (/^(?:Deno\.)?PointerObject(?:<.*>)?$/.test(text)) return name("Js.Object");
  return undefined;
}

const bufferSourceTypeNames = new Set([
  "AllowSharedBufferSource",
  "BufferSource",
  "ArrayBufferView",
  "ArrayBufferLike",
  "ArrayBuffer",
  "SharedArrayBuffer",
]);

function bufferSourceParamExpr(checker: Checker, type: Type): TypeExpr | undefined {
  const members = type.isUnionType() ? type.getTypes() : [type];
  const nonNull = members.filter((item) => !isNullish(item));
  if (nonNull.length === 0 || !nonNull.every((item) => isBufferSourceLeaf(checker, item))) {
    return undefined;
  }
  const obligation = name("Js.ArrayLike");
  return nonNull.length === members.length ? obligation : option(obligation);
}

function isBufferSourceLeaf(checker: Checker, type: Type): boolean {
  const own = bufferSourceTypeName(checker, type);
  if (own && bufferSourceTypeNames.has(own)) return true;
  if (type.isUnionType()) {
    return type.getTypes().every((item) => isNullish(item) || isBufferSourceLeaf(checker, item));
  }
  return false;
}

function bufferSourceTypeName(checker: Checker, type: Type): string | undefined {
  const alias = type.getAliasSymbol()?.name;
  if (alias) return alias;
  const symbol = type.getSymbol()?.name;
  if (symbol && symbol !== "__type") return symbol;
  const text = checker.typeToString(type);
  return /^[A-Za-z_$][\w$]*$/.test(text) ? text : undefined;
}

function functionTypeFromSignature(
  checker: Checker,
  signature: Signature,
): TypeExpr | undefined {
  return functionVariantsFromSignature(checker, signature)[0]?.type;
}

export function functionVariantsFromSignature(
  checker: Checker,
  signature: Signature,
  callbackParamRef?: (
    paramIndex: number,
    callbackParamIndex: number,
    callbackParamType: Type,
  ) => JsTypeRef | undefined,
): JsCallableVariant[] {
  const declaration = resolveSignatureDeclaration(signature);
  const parameters: ReflectedParam[] = signature
    .getParameters()
    .flatMap((symbol, index): ReflectedParam[] => {
      const declarationParam = declaration?.parameters[index];
      const type = typeOfSymbol(checker, symbol) ?? checker.getAnyType();
      if (declarationParam?.dotDotDotToken) {
        const tuple = tupleRestParams(checker, type, index, callbackParamRef);
        if (tuple) return tuple;
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
  const result = typeExprFromTsType(checker, checker.getReturnTypeOfSignature(signature));
  if (!result) return [];
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
  checker: Checker,
  type: Type,
  paramIndex: number,
  callbackParamRef:
    | ((
      paramIndex: number,
      callbackParamIndex: number,
      callbackParamType: Type,
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
  checker: Checker,
  call: CallExpression,
  args: JsCallArgHint[],
  typeRefFromTsType: (key: string, checker: Checker, type: Type) => JsTypeRef,
  keyPrefix = `call:${call.getStart()}`,
): JsCallbackParamRefs[] | undefined {
  const refs = call.arguments.map((arg, argIndex) => {
    if (args[argIndex]?.kind !== "function" || !isArrowFunction(arg)) return undefined;
    const params = arg.parameters.map((param, callbackParamIndex) => {
      const key = `${keyPrefix}:callback:${argIndex}:${callbackParamIndex}`;
      return typeRefFromTsType(key, checker, checker.getTypeAtLocation(param));
    });
    return params.length ? { argIndex, params } : undefined;
  }).filter((item): item is JsCallbackParamRefs => !!item);
  return refs.length ? refs : undefined;
}

function paramTypeExpr(
  checker: Checker,
  type: Type,
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
  checker: Checker,
  signature: Signature,
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

function callbackParamTypeExpr(checker: Checker, type: Type, _index: number): TypeExpr {
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

function tupleRestParams(
  checker: Checker,
  type: Type,
  baseIndex: number,
  callbackParamRef?: (
    paramIndex: number,
    callbackParamIndex: number,
    callbackParamType: Type,
  ) => JsTypeRef | undefined,
): ReflectedParam[] | undefined {
  if (!type.isTypeReference()) return undefined;
  const target = type.getTarget() as TupleType | undefined;
  if (!target || !(target.objectFlags & ObjectFlags.Tuple)) return undefined;
  const elements = checker.getTypeArguments(type);
  const flags = target.elementFlags ?? [];
  if (
    elements.some((_, index) => flags[index] & (ElementFlags.Rest | ElementFlags.Variadic))
  ) {
    return undefined;
  }
  return elements.map((elementType, elementIndex) => {
    const optional = !!(flags[elementIndex] & ElementFlags.Optional);
    const callbackRefs = callbackRefsForParam(
      checker,
      elementType,
      baseIndex + elementIndex,
      callbackParamRef,
    );
    const mapped = stripOptionForOptional(
      paramTypeExpr(checker, elementType, baseIndex + elementIndex, callbackRefs),
      optional,
    );
    return { type: mapped, optional, rest: false, callbackRefs };
  });
}

function fixedTupleTypeExpr(
  checker: Checker,
  type: Type,
  position: "param" | "result",
): TypeExpr | undefined {
  if (!type.isTypeReference()) return undefined;
  const target = type.getTarget() as TupleType | undefined;
  if (!target || !(target.objectFlags & ObjectFlags.Tuple)) return undefined;
  const elements = checker.getTypeArguments(type);
  const flags = target.elementFlags ?? [];
  if (
    elements.some((_, index) =>
      flags[index] &
      (ElementFlags.Optional | ElementFlags.Rest | ElementFlags.Variadic)
    )
  ) {
    return undefined;
  }
  const items = elements.map((element) => typeExprFromTsType(checker, element, position));
  if (items.some((item) => !item)) return undefined;
  return {
    kind: "TTuple",
    items: items as TypeExpr[],
  };
}

function restElementType(checker: Checker, type: Type): Type | undefined {
  if (type.isTypeReference()) {
    const args = checker.getTypeArguments(type);
    if (args.length === 1) return args[0];
  }
  return checker.getIndexTypeOfType(type, IndexKind.Number);
}

function arrayElementType(
  checker: Checker,
  type: Type,
  position: "param" | "result",
): TypeExpr | undefined {
  if (checker.isArrayType(type)) {
    return typeExprFromArrayElement(checker, restElementType(checker, type), position);
  }
  if (position !== "param") return undefined;
  const text = checker.typeToString(type);
  if (
    !/\b(ArrayLike|Iterable|Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array)\b/
      .test(text)
  ) {
    return undefined;
  }
  return typeExprFromArrayElement(
    checker,
    checker.getIndexTypeOfType(type, IndexKind.Number),
    "param",
  );
}

function promiseElementType(
  checker: Checker,
  type: Type,
  position: "param" | "result",
): TypeExpr | undefined {
  if ((type.flags & (TypeFlags.Object | TypeFlags.Intersection)) && type.getProperty("then")) {
    const awaited = checker.getAwaitedType(type);
    if (awaited && awaited.id !== type.id) return typeExprFromTsType(checker, awaited, position);
  }
  const text = checker.typeToString(type);
  if (!/\bPromise(?:Like)?\b/.test(text)) return undefined;
  const awaited = checker.getAwaitedType(type);
  if (awaited && awaited.id !== type.id) return typeExprFromTsType(checker, awaited, position);
  const typeArg = type.isTypeReference() ? checker.getTypeArguments(type)[0] : undefined;
  return typeArg ? typeExprFromTsType(checker, typeArg, position) : name("Js.Value");
}

function isNumericTypedArray(checker: Checker, type: Type): boolean {
  return isNumericTypedArrayName(checker.typeToString(type));
}

function isNumericTypedArrayName(name: string): boolean {
  return /\b(?:Uint8Array|Uint8ClampedArray|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array)\b/
    .test(name);
}

function typeExprFromArrayElement(
  checker: Checker,
  type: Type | undefined,
  position: "param" | "result",
): TypeExpr {
  if (!type) return name("Js.Value");
  if (type.flags & TypeFlags.TypeParameter) {
    return name("Js.Value");
  }
  return typeExprFromTsType(checker, type, position) ?? name("Js.Value");
}

function isTsType(checker: Checker, type: Type, expected: string): boolean {
  return checker.typeToString(type) === expected;
}

function isAnyOrUnknown(type: Type): boolean {
  return !!(type.flags & TypeFlags.Any) || !!(type.flags & TypeFlags.Unknown);
}

function signatureHasRest(signature: Signature): boolean {
  return signature.hasRestParameter;
}

function isObjectLike(type: Type): boolean {
  return !!(type.flags & TypeFlags.Object);
}

function isExplicitDynamicObject(checker: Checker, type: Type): boolean {
  const text = checker.typeToString(type);
  return text === "object" || text === "Object" || text === "{}" ||
    /^(?:Record<string, (?:any|unknown)>|\{ \[.*: string\]: (?:any|unknown); \})$/.test(text);
}

function isStringLike(type: Type): boolean {
  return !!(type.flags & (TypeFlags.String | TypeFlags.StringLiteral));
}
