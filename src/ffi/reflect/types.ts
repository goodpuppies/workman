import ts from "typescript";
import type { Decl, Expr, TypeExpr } from "../../ast.ts";
import {
  callbackParamRefsFromCall,
  dedupeVariants,
  functionVariantsFromSignature,
  jsMemberTypeFromTsType,
  nominalObjectTypeName,
  typeExprFromTsType,
} from "./type_mapping.ts";
import {
  findCallInitializer,
  findDeclaredValue,
  findVariable,
  jsGlobalSource,
  jsModuleSource,
  type JsReflectionSource,
  reflectSource,
  typeOfSymbol,
} from "./host.ts";
import type {
  JsCallableVariant,
  JsCallArgHint,
  JsCallbackParamRefs,
  JsMemberType,
  JsTypeRef,
} from "./type_refs.ts";
export type * from "./type_refs.ts";
import { tsTypeFromTypeExpr, typeExprKey } from "./ts_type_expr.ts";
import { functionArgExpr, functionTypeFromCall } from "./call_signature.ts";
import { fn, name, varType } from "../type_expr.ts";

const memberCache = new Map<string, JsMemberType | undefined>();
const namespaceCache = new Map<string, JsMemberType[]>();
const refTypeCache = new Map<string, TypeExpr | undefined>();
const deepCallCache = new Map<string, DeepReflection | undefined>();

export type DeepReflection = {
  type: TypeExpr;
  records: Extract<Decl, { kind: "RecordDecl" }>[];
};

export function jsGlobalMembers(path: string): JsMemberType[] {
  const target = jsGlobalSource(path);
  const cached = namespaceCache.get(target.key);
  if (cached) return cached;
  const reflected = reflectSource(
    target.key,
    target.source,
    (checker, sourceFile) => {
      const target = findVariable(sourceFile, "__wm_target")?.initializer ??
        findDeclaredValue(sourceFile, "__wm_target");
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
      const target = findVariable(sourceFile, "__wm_target")?.initializer ??
        findDeclaredValue(sourceFile, "__wm_target");
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

export function jsGlobalValueRef(name: string): JsTypeRef {
  return {
    key: `global-value:${name}`,
    source: `const __wm_ref_${sanitize(name)} = ${name};`,
    expr: `__wm_ref_${sanitize(name)}`,
  };
}

export function jsGlobalRootNamespaceRef(): JsTypeRef {
  return {
    key: "global:namespace",
    source: "const __wm_target = globalThis;",
    expr: "__wm_target",
    type: name("Js.Object"),
  };
}

export function jsGlobalNamespaceRef(path: string): JsTypeRef {
  const target = jsGlobalSource(path);
  return {
    key: `${target.key}:namespace`,
    source: target.source,
    expr: "__wm_target",
    type: name("Js.Object"),
  };
}

export function jsModuleNamespaceRef(specifier: string): JsTypeRef {
  const target = jsModuleSource(specifier);
  return {
    key: `${target.key}:namespace`,
    source: target.source,
    expr: "__wm_target",
    type: name("Js.Object"),
  };
}

export function jsTypeExprValueRef(key: string, type: TypeExpr): JsTypeRef {
  const refName = `__wm_ref_${sanitize(key)}`;
  return {
    key,
    source: `declare const ${refName}: ${tsTypeFromTypeExpr(type)};`,
    expr: refName,
    type,
  };
}

export function jsGlobalMemberValueRef(path: string, name: string): JsTypeRef {
  return jsTargetMemberValueRef(jsGlobalSource(path), name);
}

export function jsModuleMemberValueRef(specifier: string, name: string): JsTypeRef {
  return jsTargetMemberValueRef(jsModuleSource(specifier), name);
}

function jsTargetMemberValueRef(target: JsReflectionSource, name: string): JsTypeRef {
  const key = `${target.key}.${name}:value`;
  const refName = `__wm_ref_${sanitize(key)}`;
  return {
    key,
    source: `${target.source}\nconst ${refName} = ${propertyPath("__wm_target", [name])};`,
    expr: refName,
  };
}

export function jsGlobalValueMember(name: string): JsMemberType | undefined {
  const ref = jsGlobalValueRef(name);
  const key = `${ref.key}:call`;
  if (memberCache.has(key)) return memberCache.get(key);
  const reflected = reflectSource(
    key,
    ref.source,
    (checker, sourceFile) => {
      const value = findVariable(sourceFile, ref.expr)?.initializer;
      if (!value) return undefined;
      const mapped = jsMemberTypeFromTsType(
        checker,
        checker.getTypeAtLocation(value),
        (index) =>
          returnTypeRef(`${key}:return:${index}`, ref.source, `ReturnType<typeof ${ref.expr}>`),
        (index, paramIndex, callbackParamIndex, callbackParamType) =>
          typeRefFromTsType(
            `${key}:callback:${index}:${paramIndex}:${callbackParamIndex}`,
            checker,
            callbackParamType,
            ref.source,
          ),
      );
      return mapped ? { name, ...mapped } : undefined;
    },
  );
  memberCache.set(key, reflected);
  return reflected;
}

export function jsPrimitiveValueRef(name: "String" | "Number" | "Bool"): JsTypeRef {
  const tsType = name === "String" ? "string" : name === "Number" ? "number" : "boolean";
  const suffix = `primitive_${tsType}`;
  return {
    key: `primitive:${tsType}`,
    source: `declare const __wm_ref_${suffix}: ${tsType};`,
    expr: `__wm_ref_${suffix}`,
    type: { kind: "TName", name, args: [] },
  };
}

export function jsGlobalTypeRef(name: string): JsTypeRef {
  return typeRefFromSource(`global-type:${name}`, "", name);
}

export function jsGlobalMemberTypeRef(path: string, name: string): JsTypeRef {
  const target = jsGlobalSource(path);
  return typeRefFromSource(`global-type:${path}.${name}`, target.source, `${path}.${name}`);
}

export function jsModuleTypeRef(specifier: string, name: string): JsTypeRef {
  const target = jsModuleSource(specifier);
  return typeRefFromSource(
    `module-type:${specifier}.${name}`,
    target.source,
    `__wm_target.${name}`,
  );
}

export function jsConstructMember(ref: JsTypeRef): JsMemberType | undefined {
  const key = `${ref.key}.new`;
  if (memberCache.has(key)) return memberCache.get(key);
  const reflected = reflectSource(
    key,
    ref.source,
    (checker, sourceFile) => {
      const ctor = findVariable(sourceFile, ref.expr)?.initializer ??
        findDeclaredValue(sourceFile, ref.expr);
      if (!ctor) return undefined;
      const variants = dedupeVariants(
        checker.getTypeAtLocation(ctor).getConstructSignatures().flatMap((signature, index) =>
          functionVariantsFromSignature(
            checker,
            signature,
            (paramIndex, callbackParamIndex, callbackParamType) =>
              typeRefFromTsType(
                `${key}:callback:${index}:${paramIndex}:${callbackParamIndex}`,
                checker,
                callbackParamType,
                ref.source,
              ),
          ).map((variant) => ({
            ...variant,
            resultRef: constructReturnRef(
              `${key}:return:${index}`,
              ref.source,
              ref.expr,
              ref,
            ),
          }))
        ),
      );
      if (variants.length === 0) return undefined;
      return {
        name: "new",
        type: variants[0].type,
        overloads: variants.length > 1 ? variants.map((variant) => variant.type) : undefined,
        variants,
      };
    },
  );
  memberCache.set(key, reflected);
  return reflected;
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
      const propertyType = checker.getTypeAtLocation(member);
      const mapped = jsMemberTypeFromTsType(
        checker,
        propertyType,
        (index) =>
          returnTypeRef(`${key}:return:${index}`, ref.source, `ReturnType<typeof ${access}>`),
        (index, paramIndex, callbackParamIndex, callbackParamType) =>
          typeRefFromTsType(
            `${key}:callback:${index}:${paramIndex}:${callbackParamIndex}`,
            checker,
            callbackParamType,
            ref.source,
          ),
      );
      if (mapped) return { name: path.at(-1)!, ...mapped };
      const type = typeExprFromTsType(checker, propertyType) ?? name("Js.Value");
      return {
        name: path.at(-1)!,
        type,
        variants: [{
          type,
          resultRef: returnTypeRef(`${key}:property`, ref.source, `typeof ${access}`),
        }],
      };
    },
  );
  memberCache.set(key, reflected);
  return reflected;
}

export function jsRefTypeExpr(ref: JsTypeRef): TypeExpr | undefined {
  if (ref.type) return ref.type;
  const key = `${ref.key}:type`;
  if (refTypeCache.has(key)) return refTypeCache.get(key);
  const reflected = reflectSource(
    key,
    ref.source,
    (checker, sourceFile) => {
      const value = findVariable(sourceFile, ref.expr)?.initializer ??
        findDeclaredValue(sourceFile, ref.expr);
      if (!value) return undefined;
      const symbol = checker.getSymbolAtLocation(value);
      const type = symbol
        ? checker.getTypeOfSymbolAtLocation(symbol, value)
        : checker.getTypeAtLocation(value);
      return typeExprFromTsType(checker, type, "param");
    },
  );
  refTypeCache.set(key, reflected);
  return reflected;
}

export function jsRefCallMember(
  ref: JsTypeRef,
  path: string[],
  args: JsCallArgHint[],
): JsMemberType | undefined {
  return jsRefCallTarget(ref, path, args, path.at(-1) ?? "call");
}

export function jsRefCall(ref: JsTypeRef, args: JsCallArgHint[]): JsMemberType | undefined {
  return jsRefCallTarget(ref, [], args, "call");
}

export function jsRefDeepCall(
  ref: JsTypeRef,
  args: Expr[],
): DeepReflection | undefined {
  const argExprs = args.map(tsLiteralExprFromWorkman);
  if (argExprs.some((arg) => arg === undefined)) return undefined;
  const key = `${ref.key}:deep(${argExprs.join(",")})`;
  if (deepCallCache.has(key)) return deepCallCache.get(key);
  const callExpr = `${ref.expr}(${argExprs.join(", ")})`;
  const source = `${ref.source}\nconst __wm_deep_result = ${callExpr};`;
  const reflected = reflectSource(
    key,
    source,
    (checker, sourceFile) => {
      const result = findVariable(sourceFile, "__wm_deep_result");
      if (!result) return undefined;
      const records: Extract<Decl, { kind: "RecordDecl" }>[] = [];
      const type = deepTypeExprFromTsType(
        checker,
        checker.getTypeAtLocation(result.name),
        key,
        ["Result"],
        records,
        0,
      );
      return type ? { type, records } : undefined;
    },
  );
  deepCallCache.set(key, reflected);
  return reflected;
}

function jsRefCallTarget(
  ref: JsTypeRef,
  path: string[],
  args: JsCallArgHint[],
  name: string,
): JsMemberType | undefined {
  const literalKey = args
    .map((arg) =>
      arg.kind === "string"
        ? JSON.stringify(arg.value)
        : arg.kind === "number"
        ? String(arg.value)
        : arg.kind === "function"
        ? `fn/${arg.arity}:${arg.paramTypes?.map(typeExprKey).join(",") ?? "?"}:${
          arg.resultType ? typeExprKey(arg.resultType) : "?"
        }`
        : arg.kind === "ref"
        ? `ref/${arg.ref.key}`
        : "?"
    )
    .join(",");
  const key = `${ref.key}.${path.join(".")}(${literalKey})`;
  if (memberCache.has(key)) return memberCache.get(key);
  const access = propertyPath(ref.expr, path);
  const argExprs = args.map((arg, index) =>
    arg.kind === "string"
      ? JSON.stringify(arg.value)
      : arg.kind === "number"
      ? String(arg.value)
      : arg.kind === "function"
      ? functionArgExpr(index, arg)
      : `__wm_arg_${index}`
  );
  const argSources = args
    .filter((arg): arg is Extract<JsCallArgHint, { kind: "ref" }> => arg.kind === "ref")
    .map((arg) => arg.ref.source)
    .join("\n");
  const argDecls = args
    .flatMap((arg, index) => {
      if (arg.kind === "unknown") return [`declare const __wm_arg_${index}: any;`];
      if (arg.kind === "number") return [];
      if (arg.kind === "function") {
        return [
          `declare const __wm_cb_return_${index}: ${
            arg.resultType ? tsTypeFromTypeExpr(arg.resultType) : "any"
          };`,
        ];
      }
      if (arg.kind === "ref") return [`declare const __wm_arg_${index}: typeof ${arg.ref.expr};`];
      return [];
    })
    .filter((line) => line.length > 0)
    .join("\n");
  const callExpr = `${access}(${argExprs.join(", ")})`;
  const reflected = reflectSource(
    key,
    `${ref.source}\n${argSources}\n${argDecls}\nconst __wm_call_result = ${callExpr};`,
    (checker, sourceFile) => {
      const call = findCallInitializer(sourceFile, "__wm_call_result");
      if (!call) return undefined;
      const signature = checker.getResolvedSignature(call);
      if (!signature) return undefined;
      const type = functionTypeFromCall(checker, call, signature, args);
      const callbackParamRefs = callbackParamRefsFromCall(
        checker,
        call,
        args,
        typeRefFromTsType,
        key,
      );
      return {
        name,
        type,
        variants: [{
          type,
          callbackParamRefs,
          resultRef: returnTypeRef(
            `${key}:return`,
            `${ref.source}\n${argSources}\n${argDecls}\nconst __wm_call_result = ${callExpr};`,
            "typeof __wm_call_result",
          ),
        }],
      };
    },
  );
  memberCache.set(key, reflected);
  return reflected;
}

function deepTypeExprFromTsType(
  checker: ts.TypeChecker,
  type: ts.Type,
  key: string,
  path: string[],
  records: Extract<Decl, { kind: "RecordDecl" }>[],
  depth: number,
): TypeExpr | undefined {
  const callable = jsMemberTypeFromTsType(checker, type);
  const callableType = widestCallableType(callable);
  if (callableType) return callableType;
  const shallow = typeExprFromTsType(checker, type);
  if (shallow && !(shallow.kind === "TName" && shallow.name === "Js.Object")) return shallow;
  if (depth >= 3 || !isFiniteObjectForDeepReflection(checker, type)) return shallow;
  const fields = type.getProperties()
    .map((symbol) => {
      const fieldType = typeOfSymbol(checker, symbol);
      if (!fieldType) return undefined;
      const field = deepTypeExprFromTsType(
        checker,
        fieldType,
        key,
        [...path, symbol.getName()],
        records,
        depth + 1,
      );
      return field ? { name: symbol.getName(), type: field } : undefined;
    })
    .filter((field): field is { name: string; type: TypeExpr } => !!field);
  if (fields.length === 0) return shallow;
  const name = deepRecordName(key, path);
  if (!records.some((record) => record.name === name)) {
    records.push({
      kind: "RecordDecl",
      exported: true,
      name,
      params: [],
      fields,
    });
  }
  return { kind: "TName", name, args: [] };
}

function widestCallableType(member: Omit<JsMemberType, "name"> | undefined): TypeExpr | undefined {
  const variants = member?.variants?.map((variant) => variant.type) ??
    (member ? [member.type, ...(member.overloads ?? [])] : []);
  return variants
    .filter((type): type is Extract<TypeExpr, { kind: "TFn" }> => type.kind === "TFn")
    .sort((left, right) => right.params.length - left.params.length)[0];
}

function isFiniteObjectForDeepReflection(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  const props = type.getProperties();
  if (props.length === 0 || props.length > 32) return false;
  const text = checker.typeToString(type);
  return !/\b(globalThis|Window|Document|ObjectConstructor|ArrayConstructor)\b/.test(text);
}

function deepRecordName(key: string, path: string[]): string {
  return `__Deep_${sanitize(`${key}_${path.join("_")}`)}`;
}

function tsLiteralExprFromWorkman(expr: Expr): string | undefined {
  switch (expr.kind) {
    case "String":
      return JSON.stringify(expr.value);
    case "Int":
    case "Float":
      return String(expr.value);
    case "Bool":
      return expr.value ? "true" : "false";
    case "Void":
      return "undefined";
    case "JsonArray":
      return `(${`[${expr.items.map(tsLiteralExprFromWorkman).join(", ")}]`} as const)`;
    case "JsonObject":
      return `(${
        `{${expr.fields.map((field) => {
          const value = tsLiteralExprFromWorkman(field.value);
          return value === undefined ? undefined : `${JSON.stringify(field.key)}: ${value}`;
        }).join(", ")}}`
      } as const)`;
    case "Record": {
      const fields = expr.fields.map((field) => {
        if (field.kind !== "Field") return undefined;
        const value = tsLiteralExprFromWorkman(field.value);
        return value === undefined ? undefined : `${JSON.stringify(field.name)}: ${value}`;
      });
      if (fields.some((field) => field === undefined)) return undefined;
      return `({${fields.join(", ")}} as const)`;
    }
    default:
      return undefined;
  }
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
        (index, paramIndex, callbackParamIndex, callbackParamType) =>
          typeRefFromTsType(
            `${key}:callback:${index}:${paramIndex}:${callbackParamIndex}`,
            checker,
            callbackParamType,
            target.source,
          ),
      );
      return mapped ? { name, ...mapped } : undefined;
    },
  );
  memberCache.set(key, reflected);
  return reflected;
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

function typeRefFromTsType(
  key: string,
  checker: ts.TypeChecker,
  type: ts.Type,
  source = "",
): JsTypeRef {
  const nominal = nominalObjectTypeName(checker, type);
  if (nominal) {
    const ref = typeRefFromSource(`global-type:${nominal}`, source, nominal);
    return { ...ref, type: { kind: "TName", name: nominal, args: [] } };
  }
  const suffix = sanitize(key);
  const typeName = `__wm_type_${suffix}`;
  const expr = `__wm_ref_${suffix}`;
  return {
    key,
    source: `${source}\ntype ${typeName} = ${
      checker.typeToString(type)
    };\ndeclare const ${expr}: ${typeName};`,
    expr,
    type: typeExprFromTsType(checker, type, "param"),
  };
}

function typeRefFromSource(key: string, source: string, typeExpr: string): JsTypeRef {
  const suffix = sanitize(key);
  const typeName = `__wm_type_${suffix}`;
  const expr = `__wm_ref_${suffix}`;
  return {
    key,
    source: `${source}\ntype ${typeName} = ${typeExpr};\ndeclare const ${expr}: ${typeName};`,
    expr,
  };
}

function constructReturnRef(
  key: string,
  source: string,
  ctorExpr: string,
  ref: JsTypeRef,
): JsTypeRef {
  const canonical = canonicalConstructorTypeRef(ref);
  if (canonical) return canonical;
  return returnTypeRef(key, source, `ReturnType<() => InstanceType<typeof ${ctorExpr}>>`);
}

function canonicalConstructorTypeRef(ref: JsTypeRef): JsTypeRef | undefined {
  if (ref.key.startsWith("global-value:")) {
    const name = ref.key.slice("global-value:".length);
    return jsGlobalTypeRef(name);
  }
  const globalMember = /^global:(.+)\.([^.:]+):value$/.exec(ref.key);
  if (globalMember) {
    return jsGlobalMemberTypeRef(globalMember[1], globalMember[2]);
  }
  return undefined;
}

function propertyPath(base: string, path: string[]): string {
  return path.reduce((expr, part) => `${expr}[${JSON.stringify(part)}]`, base);
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
