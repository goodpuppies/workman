import type { Decl, Expr, JsImportSpec, JsTarget, Module, Param, TypeExpr } from "../ast.ts";
import type {
  JsCallArgHint,
  JsCallbackParamRefs,
  JsMemberType,
  JsTypeRef,
} from "./reflect/types.ts";

export type FfiElaboration = {
  module: Module;
  bindings: Map<string, FfiBinding>;
  foreignTypeRefs: Map<string, JsTypeRef>;
  selected: Set<string>;
};

export type FfiBinding = {
  surfaceName: string;
  variants: FfiVariant[];
  node?: Decl["node"];
};

export type FfiVariant = {
  internalName: string;
  memberName: string;
  target: JsTarget;
  type: TypeExpr;
  resultRef?: JsTypeRef;
  callbackParamRefs?: JsCallbackParamRefs[];
  fallible: boolean;
  node?: JsImportSpec["node"];
};

export function addVariants(
  bindings: Map<string, FfiBinding>,
  surfaceName: string,
  memberName: string,
  target: JsTarget,
  variants: { type: TypeExpr; resultRef?: JsTypeRef; callbackParamRefs?: JsCallbackParamRefs[] }[],
  fallible: boolean,
  node?: JsImportSpec["node"],
) {
  const binding = bindings.get(surfaceName) ?? { surfaceName, variants: [] };
  for (const variant of dedupeVariantSpecs(variants)) {
    rejectFfiTypeVariables(variant.type, surfaceName);
    const index = binding.variants.length;
    binding.variants.push({
      internalName: ffiInternalName(surfaceName, memberName, index),
      memberName,
      target,
      type: fallible ? fallibleType(variant.type) : variant.type,
      resultRef: variant.resultRef,
      callbackParamRefs: variant.callbackParamRefs,
      fallible,
      node,
    });
  }
  bindings.set(surfaceName, binding);
}

function rejectFfiTypeVariables(type: TypeExpr, surfaceName: string): void {
  const variable = firstTypeVariable(type);
  if (!variable) return;
  throw new Error(
    `JS FFI import ${surfaceName} uses generic type '${variable}; FFI signatures must be explicit`,
  );
}

function firstTypeVariable(type: TypeExpr): string | undefined {
  switch (type.kind) {
    case "TName":
      return firstTypeVariableIn(type.args);
    case "TTuple":
      return firstTypeVariableIn(type.items);
    case "TFn":
      return firstTypeVariableIn([...type.params, type.result]);
    case "TVar":
      return type.name;
  }
}

function firstTypeVariableIn(types: TypeExpr[]): string | undefined {
  for (const type of types) {
    const variable = firstTypeVariable(type);
    if (variable) return variable;
  }
  return undefined;
}

export function generatedReceiverJsImports(
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
): Decl[] {
  const variants = [...bindings.values()]
    .flatMap((binding) => binding.variants)
    .filter((variant) =>
      selected.has(variant.internalName) &&
      (variant.target.kind === "JsReceiver" || variant.target.kind === "JsConstructor" ||
        variant.internalName.startsWith("__ffi___call_"))
    );
  return variants.map((variant) => ({
    kind: "JsImportDecl" as const,
    target: variant.target,
    clause: {
      kind: "Named" as const,
      specs: [{
        name: variant.memberName,
        alias: variant.internalName,
        type: variant.type,
        fallible: variant.fallible,
        node: variant.node,
      }],
    },
  }));
}

export function generatedImportInsertionIndex(decls: Decl[]): number {
  let lastTypeDecl = -1;
  for (let index = 0; index < decls.length; index++) {
    const kind = decls[index].kind;
    if (kind === "ForeignTypeDecl" || kind === "RecordDecl" || kind === "TypeDecl") {
      lastTypeDecl = index;
    }
  }
  if (lastTypeDecl !== -1) return lastTypeDecl + 1;
  const firstLet = decls.findIndex((decl) => decl.kind === "LetDecl");
  return firstLet === -1 ? decls.length : firstLet;
}

export function memberVariants(
  member: JsMemberType,
): { type: TypeExpr; resultRef?: JsTypeRef; callbackParamRefs?: JsCallbackParamRefs[] }[] {
  if (member.variants) return member.variants;
  return [member.type, ...(member.overloads ?? [])].map((type) => ({ type }));
}

export function refsForCallbackArg(
  refs: Map<string, JsTypeRef>,
  arg: Expr,
  paramRefs: JsTypeRef[] | undefined,
): Map<string, JsTypeRef> {
  if (arg.kind !== "Lambda" || !paramRefs?.length) return refs;
  const localRefs = new Map(refs);
  for (let index = 0; index < arg.params.length; index++) {
    const binder = paramBinder(arg.params[index]);
    const ref = paramRefs[index];
    if (binder && ref) localRefs.set(binder, ref);
  }
  return localRefs;
}

export function paramBinder(param: Param): string | undefined {
  return param.pattern.kind === "PVar" ? param.pattern.name : undefined;
}

export function callArgHint(expr: Expr): JsCallArgHint {
  if (expr.kind === "String") return { kind: "string", value: expr.value };
  if (expr.kind === "Int" || expr.kind === "Float") return { kind: "number", value: expr.value };
  if (expr.kind === "Lambda") return { kind: "function", arity: expr.params.length };
  return { kind: "unknown" };
}

export function callHintKey(args: Expr[]): string {
  return args.map((arg) => {
    const hint = callArgHint(arg);
    if (hint.kind === "string") return JSON.stringify(hint.value);
    if (hint.kind === "number") return String(hint.value);
    if (hint.kind === "function") return `fn/${hint.arity}`;
    return "?";
  }).join(",");
}

export function dynamicReceiverArgType(arg: Expr, index: number): TypeExpr {
  if (arg.kind !== "Lambda") return name("Js.Value");
  return {
    kind: "TFn",
    params: arg.params.map(() => name("Js.Value")),
    result: name("Js.Value"),
  };
}

export function tvar(name: string): TypeExpr {
  return { kind: "TVar", name };
}

export function nameArgs(typeName: string, args: TypeExpr[]): TypeExpr {
  return { kind: "TName", name: typeName, args };
}

export function prependReceiver(
  type: TypeExpr,
  receiverType: TypeExpr = name("Js.Object"),
): TypeExpr {
  if (type.kind !== "TFn") return fn([receiverType], type);
  return { ...type, params: [receiverType, ...type.params] };
}

export function selectVariant(
  variants: FfiVariant[],
  args: Expr[],
  argTypes: (TypeExpr | undefined)[] = [],
): FfiVariant | undefined {
  return variants
    .filter((candidate) => typeCallArity(candidate.type) === args.length)
    .map((candidate) => ({ candidate, score: callScore(candidate, args, argTypes) }))
    .sort((left, right) => left.score - right.score)[0]?.candidate;
}

export function ffiOverloadMessage(name: string, variants: FfiVariant[], args: Expr[]): string {
  const arities = [...new Set(variants.map((variant) => typeCallArity(variant.type)))].sort();
  return `cannot determine JS FFI overload for ${name} with ${args.length} arguments${
    arities.length ? `; available arities: ${arities.join(", ")}` : ""
  }`;
}

function callScore(
  candidate: FfiVariant,
  args: Expr[],
  argTypes: (TypeExpr | undefined)[],
): number {
  const type = candidate.type;
  if (type.kind !== "TFn") return Number.POSITIVE_INFINITY;
  return type.params.reduce(
    (score, param, index) => score + argScore(param, args[index], candidate, argTypes[index]),
    0,
  );
}

function argScore(
  expected: TypeExpr,
  arg: Expr,
  candidate: FfiVariant,
  actualType?: TypeExpr,
): number {
  const actual = literalType(arg);
  const typeScore = actualType ? typeDistance(expected, actualType) : undefined;
  if (typeScore !== undefined) return typeScore;
  if (actualType) return 10;
  if (arg.kind === "Lambda") return expected.kind === "TFn" ? 0 : 8;
  if (!actual) return unknownArgScore(expected, candidate);
  if (expected.kind === "TName" && expected.name === actual) return 0;
  if (actual === "Js.Value" && expected.kind === "TName" && expected.name === "Js.Object") return 1;
  if (expected.kind === "TName" && expected.name === "Js.Value") return 2;
  return 10;
}

function typeDistance(expected: TypeExpr, actual: TypeExpr): number | undefined {
  if (expected.kind === "TName" && expected.name === "Js.Value") return 4;
  if (expected.kind !== actual.kind) return undefined;
  switch (expected.kind) {
    case "TName":
      if (actual.kind !== "TName" || expected.name !== actual.name) return undefined;
      if (expected.args.length !== actual.args.length) return undefined;
      return sumTypeDistance(expected.args, actual.args);
    case "TTuple":
      if (actual.kind !== "TTuple" || expected.items.length !== actual.items.length) {
        return undefined;
      }
      return sumTypeDistance(expected.items, actual.items);
    case "TFn":
      if (actual.kind !== "TFn" || expected.params.length !== actual.params.length) {
        return undefined;
      }
      return sumTypeDistance([...expected.params, expected.result], [
        ...actual.params,
        actual.result,
      ]);
    case "TVar":
      return 3;
  }
}

function sumTypeDistance(expected: TypeExpr[], actual: TypeExpr[]): number | undefined {
  let score = 0;
  for (let index = 0; index < expected.length; index++) {
    const distance = typeDistance(expected[index], actual[index]);
    if (distance === undefined) return undefined;
    score += distance;
  }
  return score;
}

function unknownArgScore(expected: TypeExpr, candidate: FfiVariant): number {
  if (expected.kind !== "TName") return 2;
  if (candidate.target.kind === "JsConstructor") {
    if (isConcreteForeignName(expected.name)) return 0;
    if (expected.name === "Js.Array" || expected.name === "Js.Promise") return 2;
    if (expected.name === "Js.Object") return 3;
    if (expected.name === "Js.Value") return 4;
  } else {
    if (expected.name === "Js.Array" || expected.name === "Js.Promise") return 0;
    if (expected.name === "Js.Object") return 1;
    if (expected.name === "Js.Value") return 2;
  }
  if (expected.name === "Number" || expected.name === "String" || expected.name === "Bool") {
    return 4;
  }
  return 2;
}

function isConcreteForeignName(typeName: string): boolean {
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

function literalType(expr: Expr): string | undefined {
  switch (expr.kind) {
    case "Int":
    case "Float":
      return "Number";
    case "String":
      return "String";
    case "Bool":
      return "Bool";
    case "Void":
      return "Void";
    case "JsonObject":
    case "JsonArray":
      return "Js.Value";
    default:
      return undefined;
  }
}

function dedupeVariantSpecs<T extends { type: TypeExpr }>(types: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const type of types) {
    const key = typeKey(type.type);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(type);
  }
  return result;
}

export function name(typeName: string): TypeExpr {
  return { kind: "TName", name: typeName, args: [] };
}

export function fn(params: TypeExpr[], result: TypeExpr): TypeExpr {
  return { kind: "TFn", params, result };
}

function fallibleType(type: TypeExpr): TypeExpr {
  if (type.kind !== "TFn") return fallibleValueType(type);
  return { ...type, result: fallibleValueType(type.result) };
}

function isResultType(type: TypeExpr): boolean {
  return type.kind === "TName" && type.name === "Result" && type.args.length === 2;
}

function isTaskType(type: TypeExpr): boolean {
  return type.kind === "TName" && type.name === "Task" && type.args.length === 2;
}

function fallibleValueType(type: TypeExpr): TypeExpr {
  if (isResultType(type) || isTaskType(type)) return type;
  return result(type);
}

function result(ok: TypeExpr): TypeExpr {
  return { kind: "TName", name: "Result", args: [ok, name("Js.Error")] };
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

function ffiInternalName(surfaceName: string, memberName: string, index: number): string {
  return `__ffi_${sanitize(surfaceName)}_${sanitize(memberName)}_${index}`;
}

function typeCallArity(type: TypeExpr): number | undefined {
  return type.kind === "TFn" ? type.params.length : undefined;
}

export function isDecl(value: Decl | Expr): value is Decl {
  return "kind" in value &&
    (value.kind === "ImportDecl" || value.kind === "JsImportDecl" || value.kind === "LetDecl" ||
      value.kind === "RecordDecl" || value.kind === "TypeDecl" || value.kind === "ForeignTypeDecl");
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
