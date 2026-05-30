import ts from "typescript";
import type { TypeExpr } from "../ast.ts";

export type JsMemberType = {
  name: string;
  type: TypeExpr;
  overloads?: TypeExpr[];
  variants?: JsCallableVariant[];
};

export type JsCallableVariant = {
  type: TypeExpr;
  resultRef?: JsTypeRef;
};

export type JsTypeRef = {
  key: string;
  source: string;
  expr: string;
};

export type JsCallArgHint =
  | { kind: "string"; value: string }
  | { kind: "function"; arity: number }
  | { kind: "unknown" };

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  strictNullChecks: true,
  skipLibCheck: true,
};

const memberCache = new Map<string, JsMemberType | undefined>();
const namespaceCache = new Map<string, JsMemberType[]>();
const nodeTypesPath = new URL(import.meta.resolve("npm:@types/node/index.d.ts")).pathname;
const maxReflectedRestArity = 8;
const denoTypesFile = "/__wm_deno_types.d.ts";
let denoTypesCache: string | undefined;

export function jsGlobalMembers(path: string): JsMemberType[] {
  const target = jsGlobalSource(path);
  const cached = namespaceCache.get(target.key);
  if (cached) return cached;
  const reflected = reflectSource(
    target.key,
    target.source,
    (checker, sourceFile) => {
      const target = findVariable(sourceFile, "__wm_target")?.initializer;
      if (!target) return [];
      const members: JsMemberType[] = [];
      for (const symbol of checker.getTypeAtLocation(target).getProperties()) {
        const type = typeOfSymbol(checker, symbol);
        const mapped = type ? jsMemberTypeFromTsType(checker, type) : undefined;
        if (mapped?.type.kind === "TFn") members.push({ name: symbol.getName(), ...mapped });
      }
      return members;
    },
  );
  namespaceCache.set(target.key, reflected);
  return reflected;
}

export function jsGlobalMember(path: string, name: string): JsMemberType | undefined {
  return jsTargetMember(jsGlobalSource(path), name);
}

export function jsModuleMembers(specifier: string): JsMemberType[] {
  const target = jsModuleSource(specifier);
  const cached = namespaceCache.get(target.key);
  if (cached) return cached;
  const reflected = reflectSource(
    target.key,
    target.source,
    (checker, sourceFile) => {
      const target = findVariable(sourceFile, "__wm_target")?.initializer;
      if (!target) return [];
      const members: JsMemberType[] = [];
      for (const symbol of checker.getTypeAtLocation(target).getProperties()) {
        const type = typeOfSymbol(checker, symbol);
        const mapped = type ? jsMemberTypeFromTsType(checker, type) : undefined;
        if (mapped?.type.kind === "TFn") members.push({ name: symbol.getName(), ...mapped });
      }
      return members;
    },
  );
  namespaceCache.set(target.key, reflected);
  return reflected;
}

export function jsModuleMember(specifier: string, name: string): JsMemberType | undefined {
  return jsTargetMember(jsModuleSource(specifier), name);
}

export function jsRefMember(ref: JsTypeRef, path: string[]): JsMemberType | undefined {
  const key = `${ref.key}.${path.join(".")}`;
  if (memberCache.has(key)) return memberCache.get(key);
  const access = propertyPath(ref.expr, path);
  const reflected = reflectSource(
    key,
    `${ref.source}\nconst __wm_member = ${access};`,
    (checker, sourceFile) => {
      const member = findVariable(sourceFile, "__wm_member")?.initializer;
      if (!member) return undefined;
      const mapped = jsMemberTypeFromTsType(
        checker,
        checker.getTypeAtLocation(member),
        (index) =>
          returnTypeRef(`${key}:return:${index}`, ref.source, `ReturnType<typeof ${access}>`),
      );
      return mapped ? { name: path.at(-1)!, ...mapped } : undefined;
    },
  );
  memberCache.set(key, reflected);
  return reflected;
}

export function jsRefCallMember(
  ref: JsTypeRef,
  path: string[],
  args: JsCallArgHint[],
): JsMemberType | undefined {
  const literalKey = args
    .map((arg) =>
      arg.kind === "string"
        ? JSON.stringify(arg.value)
        : arg.kind === "function"
        ? `fn/${arg.arity}`
        : "?"
    )
    .join(",");
  const key = `${ref.key}.${path.join(".")}(${literalKey})`;
  if (memberCache.has(key)) return memberCache.get(key);
  const access = propertyPath(ref.expr, path);
  const argExprs = args.map((arg, index) =>
    arg.kind === "string"
      ? JSON.stringify(arg.value)
      : arg.kind === "function"
      ? functionArgExpr(index, arg.arity)
      : `__wm_arg_${index}`
  );
  const argDecls = args
    .map((arg, index) => arg.kind === "unknown" ? `declare const __wm_arg_${index}: any;` : "")
    .filter((line) => line.length > 0)
    .join("\n");
  const callExpr = `${access}(${argExprs.join(", ")})`;
  const reflected = reflectSource(
    key,
    `${ref.source}\n${argDecls}\nconst __wm_call_result = ${callExpr};`,
    (checker, sourceFile) => {
      const call = findCallInitializer(sourceFile, "__wm_call_result");
      if (!call) return undefined;
      const signature = checker.getResolvedSignature(call);
      if (!signature) return undefined;
      const type = functionTypeFromCall(checker, call, signature, args);
      return {
        name: path.at(-1)!,
        type,
        variants: [{
          type,
          resultRef: returnTypeRef(
            `${key}:return`,
            `${ref.source}\n${argDecls}\nconst __wm_call_result = ${callExpr};`,
            "typeof __wm_call_result",
          ),
        }],
      };
    },
  );
  memberCache.set(key, reflected);
  return reflected;
}

function functionTypeFromCall(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  signature: ts.Signature,
  args: JsCallArgHint[],
): TypeExpr {
  const signatureParams = signature.getParameters();
  const params = call.arguments.map((arg, index) => {
    if (args[index]?.kind === "function") {
      return typeExprFromTsType(checker, checker.getTypeAtLocation(arg), "param") ??
        name("Js.Value");
    }
    if (args[index]?.kind === "string") return name("String");
    const symbolType = signatureParams[index]
      ? typeOfSymbol(checker, signatureParams[index])
      : undefined;
    return symbolType
      ? typeExprFromTsType(checker, symbolType, "param") ?? name("Js.Value")
      : name("Js.Value");
  });
  const result = typeExprFromTsType(checker, checker.getReturnTypeOfSignature(signature)) ??
    name("Js.Value");
  return fn(params, result);
}

function functionArgExpr(index: number, arity: number): string {
  const params = Array.from(
    { length: arity },
    (_, paramIndex) => `__wm_cb_${index}_${paramIndex}`,
  );
  return `(${params.join(", ")}) => undefined`;
}

function jsTargetMember(target: JsReflectionSource, name: string): JsMemberType | undefined {
  const key = `${target.key}.${name}`;
  if (memberCache.has(key)) return memberCache.get(key);
  const access = propertyPath("__wm_target", [name]);
  const reflected = reflectSource(
    key,
    `${target.source}\nconst __wm_member = ${access};`,
    (checker, sourceFile) => {
      const member = findVariable(sourceFile, "__wm_member")?.initializer;
      if (!member) return undefined;
      const mapped = jsMemberTypeFromTsType(
        checker,
        checker.getTypeAtLocation(member),
        (index) =>
          returnTypeRef(`${key}:return:${index}`, target.source, `ReturnType<typeof ${access}>`),
      );
      return mapped ? { name, ...mapped } : undefined;
    },
  );
  memberCache.set(key, reflected);
  return reflected;
}

type JsReflectionSource = { key: string; source: string };

function jsGlobalSource(path: string): JsReflectionSource {
  if (path === "Deno") {
    return {
      key: "global:Deno",
      source: `/// <reference path="${denoTypesFile}" />\nconst __wm_target = Deno;`,
    };
  }
  return { key: `global:${path}`, source: `const __wm_target = ${path};` };
}

function jsModuleSource(specifier: string): JsReflectionSource {
  return {
    key: `module:${specifier}`,
    source: `/// <reference path="${nodeTypesPath}" />\nimport * as __wm_target from ${
      JSON.stringify(specifier)
    };`,
  };
}

function reflectSource<T>(
  label: string,
  source: string,
  read: (
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
  ) => T,
): T {
  const fileName = `/__wm_js_reflect_${sanitize(label)}.ts`;
  const extraFiles = source.includes(denoTypesFile)
    ? new Map([[denoTypesFile, denoTypesSource()]])
    : new Map<string, string>();
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === fileName
      ? ts.createSourceFile(name, source, languageVersion, true)
      : extraFiles.has(name)
      ? ts.createSourceFile(name, extraFiles.get(name)!, languageVersion, true)
      : originalGetSourceFile.call(
        host,
        name,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
  const program = ts.createProgram([fileName], compilerOptions, host);
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) throw new Error(`cannot reflect JS target ${label}`);
  return read(program.getTypeChecker(), sourceFile);
}

function denoTypesSource(): string {
  if (denoTypesCache !== undefined) return denoTypesCache;
  const output = new Deno.Command(Deno.execPath(), {
    args: ["types"],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!output.success) {
    const message = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`cannot load Deno type declarations${message ? `: ${message}` : ""}`);
  }
  denoTypesCache = new TextDecoder().decode(output.stdout);
  return denoTypesCache;
}

function findVariable(sourceFile: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function findCallInitializer(
  sourceFile: ts.SourceFile,
  name: string,
): ts.CallExpression | undefined {
  const initializer = findVariable(sourceFile, name)?.initializer;
  return initializer && ts.isCallExpression(initializer) ? initializer : undefined;
}

function typeOfSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | undefined {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : undefined;
}

function jsMemberTypeFromTsType(
  checker: ts.TypeChecker,
  type: ts.Type,
  resultRef?: (index: number, signature: ts.Signature) => JsTypeRef | undefined,
): Omit<JsMemberType, "name"> | undefined {
  const variants = dedupeVariants(
    type.getCallSignatures().flatMap((signature, index) =>
      functionTypesFromSignature(checker, signature).map((type) => ({
        type,
        resultRef: resultRef?.(index, signature),
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

function typeExprFromTsType(
  checker: ts.TypeChecker,
  type: ts.Type,
  position: "param" | "result" = "result",
): TypeExpr | undefined {
  const nullish = nullishUnionParts(type);
  if (nullish) {
    const inner = nullish.value
      ? (typeExprFromTsType(checker, nullish.value, position) ?? name("Js.Value"))
      : name("Js.Value");
    return option(inner);
  }
  if (type.isUnion()) {
    if (type.types.some(isObjectLike)) {
      return position === "param" && type.types.some(isStringLike) && type.types
          .filter(isObjectLike)
          .every((item) => checker.typeToString(item) === "URL")
        ? name("String")
        : name("Js.Value");
    }
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
  if (isTsType(checker, type, "number")) return name("Number");
  if (isTsType(checker, type, "string")) return name("String");
  if (isTsType(checker, type, "boolean")) return name("Bool");
  if (type.flags & ts.TypeFlags.StringLiteral) return name("String");
  if (type.flags & ts.TypeFlags.NumberLiteral) return name("Number");
  if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return name("Void");
  if (position === "result" && isObjectLike(type)) return name("Js.Object");
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint) {
      return typeExprFromTsType(checker, constraint, position) ?? name("Js.Value");
    }
  }
  return name("Js.Value");
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
  return functionTypesFromSignature(checker, signature)[0];
}

function functionTypesFromSignature(checker: ts.TypeChecker, signature: ts.Signature): TypeExpr[] {
  const declaration = signature.getDeclaration();
  type ReflectedParam = { type: TypeExpr; optional: boolean; rest: boolean };
  const parameters: ReflectedParam[] = signature
    .getParameters()
    .flatMap((symbol, index): ReflectedParam[] => {
      const declarationParam = declaration?.parameters[index];
      const type = typeOfSymbol(checker, symbol) ?? checker.getAnyType();
      if (declarationParam?.dotDotDotToken) {
        const element = restElementType(checker, type) ?? checker.getAnyType();
        const mapped = paramTypeExpr(checker, element, index);
        return [{ type: mapped, optional: false, rest: true }];
      }
      const optional = !!declarationParam?.questionToken || !!declarationParam?.initializer;
      const mapped = stripOptionForOptional(paramTypeExpr(checker, type, index), optional);
      return [{
        type: mapped,
        optional,
        rest: false,
      }];
    });
  const result = typeExprFromTsType(checker, checker.getReturnTypeOfSignature(signature)) ??
    name("Js.Value");
  const restIndex = parameters.findIndex((param) => param.rest);
  if (restIndex !== -1) {
    const fixed = parameters.slice(0, restIndex);
    const required = lastRequiredParameter(fixed) + 1;
    const overloads: TypeExpr[] = [];
    for (let count = required; count <= maxReflectedRestArity; count++) {
      const params: TypeExpr[] = [];
      for (let index = 0; index < Math.min(count, fixed.length); index++) {
        params.push(fixed[index].type);
      }
      for (let index = params.length; index < count; index++) {
        params.push(restSlotType(parameters[restIndex].type, index));
      }
      overloads.push(fn(params, result));
    }
    return overloads;
  }
  const required = lastRequiredParameter(parameters) + 1;
  const overloads: TypeExpr[] = [];
  for (let count = required; count <= parameters.length; count++) {
    overloads.push(fn(parameters.slice(0, count).map((param) => param.type), result));
  }
  return overloads.length ? overloads : [fn([], result)];
}

function paramTypeExpr(checker: ts.TypeChecker, type: ts.Type, index: number): TypeExpr {
  if (isAnyOrUnknown(type)) return varType(`a${index}`);
  const signature = type.getCallSignatures()[0];
  if (signature && signatureHasRest(signature)) {
    return fn(
      [name("Js.Value")],
      typeExprFromTsType(checker, checker.getReturnTypeOfSignature(signature)) ?? name("Void"),
    );
  }
  return typeExprFromTsType(checker, type, "param") ?? name("Js.Value");
}

function restSlotType(type: TypeExpr, index: number): TypeExpr {
  return type.kind === "TVar" ? varType(`a${index}`) : type;
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

function dedupeTypes(types: TypeExpr[]): TypeExpr[] {
  const seen = new Set<string>();
  return types.filter((type) => {
    const key = typeKey(type);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeVariants(variants: JsCallableVariant[]): JsCallableVariant[] {
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
  const numberIndex = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  return numberIndex;
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

function returnTypeRef(key: string, source: string, typeExpr: string): JsTypeRef {
  const suffix = sanitize(key);
  const typeName = `__wm_return_${suffix}`;
  const expr = `__wm_ref_${suffix}`;
  return {
    key,
    source: `${source}\ntype ${typeName} = ${typeExpr};\ndeclare const ${expr}: ${typeName};`,
    expr,
  };
}

function propertyPath(base: string, path: string[]): string {
  return path.reduce((expr, part) => `${expr}[${JSON.stringify(part)}]`, base);
}

function name(name: string): TypeExpr {
  return { kind: "TName", name, args: [] };
}

function option(inner: TypeExpr): TypeExpr {
  return { kind: "TName", name: "Option", args: [inner] };
}

function varType(name: string): TypeExpr {
  return { kind: "TVar", name };
}

function fn(params: TypeExpr[], result: TypeExpr): TypeExpr {
  return { kind: "TFn", params, result };
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
