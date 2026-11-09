import ts from "typescript-api";
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
import { foreignCallableIdentity } from "./callable_identity.ts";

const maxReflectedRestArity = 8;

type ReflectedParam = {
  type: TypeExpr;
  optional: boolean;
  rest: boolean;
  callbackRefs?: JsTypeRef[];
};

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
  checker: ts.TypeChecker,
  foreign: ts.Type,
  signature: ts.Signature,
): JsTypeRef | undefined {
  const generic = type.kind === "TName" && type.name === nominalObjectTypeName(checker, foreign)
    ? nominalGenericConstructor(checker, foreign)
    : undefined;
  return ref
    ? {
      ...ref,
      generic,
      type,
      // A generic named only by a parameter needs its arity declared too. Other parameter types
      // keep the identity they get where they are imported.
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
  // Buffer-source parameters (ArrayBuffer/BufferSource/AllowSharedBufferSource/typed-array
  // views, including `| null` unions which TS flattens to several members) become an
  // array-like obligation rather than an opaque Js.Object. The concrete array-like type is
  // chosen from the call argument during FFI materialization, so the boundary stays type-safe.
  // A nullable buffer source keeps Workman's `T | null` => Option modelling as
  // Option<Js.ArrayLike>. Checked before the generic nullish/union handling because that path
  // collapses multi-member unions to Js.Value.
  if (position === "param") {
    const bufferSource = bufferSourceParamExpr(checker, type);
    if (bufferSource) return bufferSource;
  }
  if (isAnyOrUnknown(type)) return name("Js.Value");
  if (type.flags & ts.TypeFlags.Never) return name("JsNever");
  if (type.flags & ts.TypeFlags.Conditional) return name("Js.Value");
  if (isTsType(checker, type, "number")) return name("Number");
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
  if (type.isUnion()) {
    const promisedUnion = promisedOrValueUnionType(checker, type, position);
    if (promisedUnion) return promisedUnion;
    if (type.types.some(isObjectLike)) {
      return position === "param" && type.types.some(isStringLike) && type.types
          .filter(isObjectLike)
          .every((item) => checker.typeToString(item) === "URL")
        ? name("String")
        : position === "param"
        ? name("Js.Value")
        : undefined;
    }
    if (position === "param" && type.types.some(isStringLike)) return name("String");
    const mapped = type.types.map((item) => typeExprFromTsType(checker, item, position));
    if (mapped.some((item) => !item)) return undefined;
    const first = mapped[0];
    if (first && mapped.every((item) => typeKey(item!) === typeKey(first))) return first;
    return undefined;
  }
  const signature = type.getCallSignatures()[0];
  const callable = position === "result" ? foreignCallableIdentity(checker, type) : undefined;
  if (callable) return name(callable.name);
  if (signature) return functionTypeFromSignature(checker, signature);
  if (type.flags & ts.TypeFlags.TypeParameter) {
    // Polymorphic `this` returns (for example Ora.start(): this) are represented by
    // TypeScript as type parameters whose symbol still points at the owning interface/class.
    // Preserve that nominal receiver instead of collapsing it to Js.Value.
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
  if (type.flags & ts.TypeFlags.StringLiteral) return name("String");
  if (type.flags & ts.TypeFlags.NumberLiteral) return name("Number");
  if (type.flags & ts.TypeFlags.BooleanLiteral) return name("Bool");
  if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return name("Void");
  const promised = promiseElementType(checker, type, position);
  if (promised) {
    return { kind: "TName", name: "Task", args: [promised, name("Js.Error")], ffiPromise: true };
  }
  if (position === "param" && isNumericTypedArray(checker, type)) {
    return { kind: "TName", name: "Js.Array", args: [name("Number")] };
  }
  const arrayElement = arrayElementType(checker, type, position);
  if (arrayElement) return { kind: "TName", name: "Js.Array", args: [arrayElement] };
  /* if (/^(?:Deno\.)?DynamicLibrary<.+>$/.test(checker.typeToString(type))) {
    return name("Js.Object");
  } */
  const nominal = nominalObjectTypeName(checker, type);
  if (nominal === "DynamicLibrary") return name("Js.Object");
  if (nominal) {
    const generic = nominalGenericConstructor(checker, type);
    if (generic) {
      // Written without arguments, a parameter names no instantiation to preserve. It accepts
      // subclasses as a non-generic class parameter does, and the concrete call is checked by
      // TypeScript when it is resolved.
      if (position === "param" && usesOnlyDefaultTypeArguments(checker, type)) {
        return name("Js.Value");
      }
      // Uninstantiated declaration signatures are discovery seeds only. Concrete
      // calls are resolved again with HM arguments before these slots escape.
      const args = checker.getTypeArguments(type as ts.TypeReference).slice(0, generic.arity)
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
  // Anonymous inline object literals (no nominal identity, e.g. `{ enabled; type }`) have no
  // honest named Workman representation and cannot be asserted back into a foreign type, so a
  // `Js.Object` recovery is acceptable here. Named static types keep their nominal ref and are
  // left unresolved rather than silently collapsed to opaque (ffi-principles.md #7).
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

function nominalTypeParameterObjectName(type: ts.Type): string | undefined {
  const symbol = type.getSymbol();
  const typeName = symbol?.getName();
  if (!symbol || !typeName || !/^[A-Za-z_$][\w$]*$/.test(typeName)) return undefined;
  return symbol.declarations?.some((declaration) =>
      ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)
    )
    ? typeName
    : undefined;
}

function opaqueTupleAliasTypeName(type: ts.Type): string | undefined {
  const symbol = type.aliasSymbol;
  const declaration = symbol?.declarations?.find(ts.isTypeAliasDeclaration);
  if (!declaration || !ts.isTupleTypeNode(declaration.type)) return undefined;
  const typeName = symbol?.getName();
  return typeName && /^[A-Za-z_$][\w$]*$/.test(typeName) ? typeName : undefined;
}

function enumTypeExpr(type: ts.Type): TypeExpr | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declaration = symbol?.declarations?.find(ts.isEnumDeclaration);
  if (!declaration) return undefined;
  const kinds = new Set(
    declaration.members.map((member) =>
      member.initializer && ts.isStringLiteralLike(member.initializer) ? "string" : "number"
    ),
  );
  if (kinds.size !== 1) return undefined;
  return name(kinds.has("string") ? "String" : "Number");
}

function promisedOrValueUnionType(
  checker: ts.TypeChecker,
  type: ts.UnionType,
  position: "param" | "result",
): TypeExpr | undefined {
  if (position !== "result" || type.types.length !== 2) return undefined;
  const promised = type.types.find((item) =>
    /\bPromise(?:Like)?</.test(checker.typeToString(item))
  );
  const value = type.types.find((item) => item !== promised);
  if (!promised || !value) return undefined;
  const promisedValue = promiseElementType(checker, promised, position);
  const directValue = typeExprFromTsType(checker, value, position);
  if (!promisedValue || !directValue || typeKey(promisedValue) !== typeKey(directValue)) {
    return undefined;
  }
  return { kind: "TName", name: "Task", args: [directValue, name("Js.Error")], ffiPromise: true };
}

export function nominalObjectTypeName(checker: ts.TypeChecker, type: ts.Type): string | undefined {
  if (!(type.flags & ts.TypeFlags.Object)) return undefined;
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const typeName = symbol?.getName();
  if (!typeName || typeName === "__type" || typeName === "Object") return undefined;
  if (!/^[A-Za-z_$][\w$]*$/.test(typeName)) return undefined;
  if (isNumericTypedArrayName(typeName)) return typeName;
  if (
    symbol?.declarations?.some((decl) =>
      ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl)
    )
  ) {
    return typeName;
  }
  const text = checker.typeToString(type);
  if (/[<>{}&|()[\],]/.test(text)) return undefined;
  return typeName;
}

export function nominalGenericConstructor(
  checker: ts.TypeChecker,
  type: ts.Type,
): JsTypeRef["generic"] {
  if (!(type.flags & ts.TypeFlags.Object)) return undefined;
  if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) return undefined;
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declaration = symbol?.declarations?.find((decl) =>
    ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl)
  );
  if (!declaration || !symbol) return undefined;
  const arity = declaration.typeParameters?.length ?? 0;
  if (!arity || isNumericTypedArrayName(symbol.getName())) return undefined;
  const qualified = checker.getFullyQualifiedName(symbol);
  const expression = qualified.replace(/^("(?:[^"\\]|\\.)+")\./, "import($1).")
    .replace(/^global\./, "");
  const requiredArity = declaration.typeParameters!.filter((param) => !param.default).length;
  return { key: `generic-type:${expression}`, expression, arity, requiredArity };
}

function usesOnlyDefaultTypeArguments(checker: ts.TypeChecker, type: ts.Type): boolean {
  const reference = type as ts.TypeReference;
  const parameters = reference.target.typeParameters ?? [];
  const args = checker.getTypeArguments(reference);
  return parameters.length > 0 && parameters.every((parameter, index) => {
    const declared = checker.getDefaultFromTypeParameter(parameter);
    return declared !== undefined && args[index] === declared;
  });
}

function containsTypeParameter(type: ts.Type): boolean {
  if (type.flags & ts.TypeFlags.TypeParameter) return true;
  if (type.isUnionOrIntersection()) return type.types.some(containsTypeParameter);
  if (type.flags & ts.TypeFlags.Conditional) {
    const conditional = type as ts.ConditionalType;
    return containsTypeParameter(conditional.checkType) ||
      containsTypeParameter(conditional.extendsType);
  }
  return false;
}

/** A global type has one identity however it is reached, so it uses the key its import gets. */
function nestedNominalKey(checker: ts.TypeChecker, type: ts.Type, expression: string): string {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const qualified = symbol && checker.getFullyQualifiedName(symbol).replace(/^global\./, "");
  return qualified && !qualified.startsWith('"')
    ? `global-type:${qualified}`
    : `nominal-type:${expression}`;
}

/** Nominal identities below a generic result (for example an Effect's error). */
export function nestedForeignTypeRefs(
  checker: ts.TypeChecker,
  type: ts.Type,
  source: string,
  includeType = false,
  rootExpression?: string,
): JsTypeRef[] {
  const refs: JsTypeRef[] = [];
  const seen = new Set<ts.Type>();
  const visit = (current: ts.Type, expression?: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    // `Object3D | null`, as an optional parameter reads.
    if (current.isUnion()) return current.types.forEach((item) => visit(item));
    const callable = foreignCallableIdentity(checker, current);
    if (callable) {
      const expr = `__wm_nested_callable_${refs.length}`;
      const actualType = expression ??
        checker.typeToString(
          current,
          undefined,
          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType,
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
        ts.TypeFormatFlags.UseFullyQualifiedType,
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
    if (
      current.flags & ts.TypeFlags.Object &&
      (current as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
    ) {
      const tuple = checker.isTupleType(current);
      checker.getTypeArguments(current as ts.TypeReference).forEach((item, index) =>
        visit(item, expression && tuple ? `${expression}[${index}]` : undefined)
      );
    }
  };
  if (includeType) {
    visit(type, rootExpression);
  } else if (
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
  ) {
    const tuple = checker.isTupleType(type);
    checker.getTypeArguments(type as ts.TypeReference).forEach((item, index) =>
      visit(item, rootExpression && tuple ? `${rootExpression}[${index}]` : undefined)
    );
  } else if (foreignCallableIdentity(checker, type)) {
    visit(type, rootExpression);
  }
  return refs;
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
      return typeExprFromTsType(checker, awaited, position);
    }
  }
  const match = /^Awaited<([A-Za-z_][A-Za-z0-9_]*)>$/.exec(text);
  if (match) return undefined;
  if (!/^Awaited<.+>$/.test(text)) return undefined;
  const ref = type as ts.TypeReference;
  const arg = ref.typeArguments?.[0] ?? checker.getTypeArguments(ref)[0];
  return arg ? typeExprFromTsType(checker, arg, position) : undefined;
}

function nullishUnionParts(
  type: ts.Type,
): { value?: ts.Type; values?: ts.Type[] } | undefined {
  if (!type.isUnion()) return undefined;
  const valueTypes = type.types.filter((item) => !isNullish(item));
  if (valueTypes.length === type.types.length) return undefined;
  if (valueTypes.length === 0) return {};
  if (valueTypes.length === 1) return { value: valueTypes[0] };
  return { values: valueTypes };
}

function isNullish(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Null) || !!(type.flags & ts.TypeFlags.Undefined);
}

function denoPointerTypeExpr(checker: ts.TypeChecker, type: ts.Type): TypeExpr | undefined {
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

// Maps a buffer-source parameter type to an array-like obligation, preserving nullability as
// Option. Returns undefined for anything that is not (entirely) a buffer source. A union is a
// buffer source only when every non-null member is one of the buffer type names; this
// deliberately excludes unions that merely mention a buffer alongside other shapes (e.g.
// `ArrayLike<number> | ArrayBuffer` on the Uint8Array constructor), which keep their broader
// mapping.
function bufferSourceParamExpr(checker: ts.TypeChecker, type: ts.Type): TypeExpr | undefined {
  const members = type.isUnion() ? type.types : [type];
  const nonNull = members.filter((item) => !isNullish(item));
  if (nonNull.length === 0 || !nonNull.every((item) => isBufferSourceLeaf(checker, item))) {
    return undefined;
  }
  const obligation = name("Js.ArrayLike");
  return nonNull.length === members.length ? obligation : option(obligation);
}

function isBufferSourceLeaf(checker: ts.TypeChecker, type: ts.Type): boolean {
  const own = bufferSourceTypeName(checker, type);
  if (own && bufferSourceTypeNames.has(own)) return true;
  if (type.isUnion()) {
    return type.types.every((item) => isNullish(item) || isBufferSourceLeaf(checker, item));
  }
  return false;
}

function bufferSourceTypeName(checker: ts.TypeChecker, type: ts.Type): string | undefined {
  const alias = type.aliasSymbol?.getName();
  if (alias) return alias;
  const symbol = type.getSymbol()?.getName();
  if (symbol && symbol !== "__type") return symbol;
  const text = checker.typeToString(type);
  return /^[A-Za-z_$][\w$]*$/.test(text) ? text : undefined;
}

function functionTypeFromSignature(
  checker: ts.TypeChecker,
  signature: ts.Signature,
): TypeExpr | undefined {
  return functionVariantsFromSignature(checker, signature)[0]?.type;
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
  const parameters: ReflectedParam[] = signature
    .getParameters()
    .flatMap((symbol, index): ReflectedParam[] => {
      const declarationParam = declaration?.parameters[index];
      const type = typeOfSymbol(checker, symbol) ?? checker.getAnyType();
      if (declarationParam?.dotDotDotToken) {
        // A rest parameter typed as a fixed-length tuple (e.g. Deno FFI symbols typed as
        // `(...args: ToNativeParameterTypes<T["parameters"]>) => ...`) is really a fixed
        // sequence of positional arguments. `getParameters()` keeps it as a single `args`
        // symbol, so expand the tuple here to recover the real per-parameter types instead
        // of fabricating uniform overloads from a single element type.
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

function tupleRestParams(
  checker: ts.TypeChecker,
  type: ts.Type,
  baseIndex: number,
  callbackParamRef?: (
    paramIndex: number,
    callbackParamIndex: number,
    callbackParamType: ts.Type,
  ) => JsTypeRef | undefined,
): ReflectedParam[] | undefined {
  if (!(type.flags & ts.TypeFlags.Object)) return undefined;
  const ref = type as ts.TypeReference;
  const target = ref.target as (ts.TupleType & ts.ObjectType) | undefined;
  if (!target || !(target.objectFlags & ts.ObjectFlags.Tuple)) return undefined;
  const elements = checker.getTypeArguments(ref);
  const flags = target.elementFlags ?? [];
  // Only expand pure fixed/optional tuples; a nested rest/variadic element is still
  // unbounded, so fall back to the rest-overload handling for those.
  if (
    elements.some((_, index) => flags[index] & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic))
  ) {
    return undefined;
  }
  return elements.map((elementType, elementIndex) => {
    const optional = !!(flags[elementIndex] & ts.ElementFlags.Optional);
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
  checker: ts.TypeChecker,
  type: ts.Type,
  position: "param" | "result",
): TypeExpr | undefined {
  if (!(type.flags & ts.TypeFlags.Object)) return undefined;
  const ref = type as ts.TypeReference;
  const target = ref.target as (ts.TupleType & ts.ObjectType) | undefined;
  if (!target || !(target.objectFlags & ts.ObjectFlags.Tuple)) return undefined;
  const elements = checker.getTypeArguments(ref);
  const flags = target.elementFlags ?? [];
  if (
    elements.some((_, index) =>
      flags[index] &
      (ts.ElementFlags.Optional | ts.ElementFlags.Rest | ts.ElementFlags.Variadic)
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
    checker.getIndexTypeOfType(type, ts.IndexKind.Number),
    "param",
  );
}

function promiseElementType(
  checker: ts.TypeChecker,
  type: ts.Type,
  position: "param" | "result",
): TypeExpr | undefined {
  const promised =
    (checker as { getPromisedTypeOfPromise?: (type: ts.Type) => ts.Type | undefined })
      .getPromisedTypeOfPromise?.(type);
  if (promised) return typeExprFromTsType(checker, promised, position);
  const text = checker.typeToString(type);
  if (!/\bPromise(?:Like)?\b/.test(text)) return undefined;
  const ref = type as ts.TypeReference;
  const typeArg = ref.typeArguments?.[0] ?? checker.getTypeArguments(ref)[0];
  return typeArg ? typeExprFromTsType(checker, typeArg, position) : name("Js.Value");
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
  position: "param" | "result",
): TypeExpr {
  if (!type) return name("Js.Value");
  if (type.flags & ts.TypeFlags.TypeParameter) {
    return name("Js.Value");
  }
  return typeExprFromTsType(checker, type, position) ?? name("Js.Value");
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

function isExplicitDynamicObject(checker: ts.TypeChecker, type: ts.Type): boolean {
  const text = checker.typeToString(type);
  return text === "object" || text === "Object" || text === "{}" ||
    /^(?:Record<string, (?:any|unknown)>|\{ \[.*: string\]: (?:any|unknown); \})$/.test(text);
}

function isStringLike(type: ts.Type): boolean {
  return !!(type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral));
}
