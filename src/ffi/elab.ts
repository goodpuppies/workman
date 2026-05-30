import type { Decl, Expr, JsImportSpec, JsTarget, Module, Pattern, TypeExpr } from "../ast.ts";
import { diagnosticError } from "../diagnostics.ts";
import {
  type JsCallArgHint,
  jsGlobalMember,
  jsGlobalMembers,
  type JsMemberType,
  jsModuleMember,
  jsModuleMembers,
  jsRefCallMember,
  jsRefMember,
  type JsTypeRef,
} from "./js_types.ts";

export type FfiElaboration = {
  module: Module;
  bindings: Map<string, FfiBinding>;
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
  fallible: boolean;
  node?: JsImportSpec["node"];
};

export function prepareFfiElaboration(module: Module): FfiElaboration {
  const bindings = new Map<string, FfiBinding>();
  for (const decl of module.decls) {
    if (decl.kind !== "JsImportDecl") continue;
    collectFfiDecl(bindings, decl);
  }
  const selected = new Set<string>();
  const refs = new Map<string, JsTypeRef>();
  const resultRefs = new Map<string, JsTypeRef>();
  const rewrittenDecls: Decl[] = [];
  for (const decl of module.decls) {
    if (decl.kind === "JsImportDecl") {
      rewrittenDecls.push(decl);
      continue;
    }
    const rewritten = rewriteDeclCalls(decl, bindings, selected, refs, resultRefs);
    rememberLetRefs(rewritten, bindings, refs, resultRefs);
    rewrittenDecls.push(rewritten);
  }
  const decls = [
    ...generatedReceiverJsImports(bindings, selected),
    ...rewrittenDecls.flatMap((decl) =>
      decl.kind === "JsImportDecl" ? generatedJsImports(decl, bindings, selected) : [decl]
    ),
  ];
  return { module: { ...module, decls }, bindings };
}

function collectFfiDecl(
  bindings: Map<string, FfiBinding>,
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
) {
  if (decl.clause.kind === "Namespace") {
    for (const member of jsTargetMembers(decl.target)) {
      addVariants(
        bindings,
        `${decl.clause.alias}.${member.name}`,
        member.name,
        decl.target,
        memberVariants(member),
        !decl.clause.unsafe,
        decl.node,
      );
    }
    return;
  }
  for (const spec of decl.clause.specs) {
    const reflected = !spec.type;
    const member = spec.type
      ? { name: spec.name, type: spec.type }
      : jsTargetMember(decl.target, spec.name);
    if (!member) continue;
    const localName = spec.alias ?? spec.name;
    const surfaceName = decl.clause.alias ? `${decl.clause.alias}.${localName}` : localName;
    addVariants(
      bindings,
      surfaceName,
      spec.name,
      decl.target,
      memberVariants(member),
      reflected && !decl.clause.unsafe,
      spec.node,
    );
  }
}

function addVariants(
  bindings: Map<string, FfiBinding>,
  surfaceName: string,
  memberName: string,
  target: JsTarget,
  variants: { type: TypeExpr; resultRef?: JsTypeRef }[],
  fallible: boolean,
  node?: JsImportSpec["node"],
) {
  const binding = bindings.get(surfaceName) ?? { surfaceName, variants: [] };
  for (const variant of dedupeVariantSpecs(variants)) {
    const index = binding.variants.length;
    binding.variants.push({
      internalName: ffiInternalName(surfaceName, memberName, index),
      memberName,
      target,
      type: fallible ? fallibleType(variant.type) : variant.type,
      resultRef: variant.resultRef,
      fallible,
      node,
    });
  }
  bindings.set(surfaceName, binding);
}

function generatedJsImports(
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
): Decl[] {
  if (decl.clause.kind === "Namespace") {
    const specs = [...bindings.values()]
      .filter((binding) => binding.surfaceName.startsWith(`${decl.clause.alias}.`))
      .flatMap((binding) =>
        binding.variants
          .filter((variant) => selected.has(variant.internalName))
          .map((variant) => ({
            name: variant.memberName,
            alias: variant.internalName,
            type: variant.type,
            fallible: variant.fallible,
            node: variant.node,
          }))
      );
    if (specs.length === 0) return [];
    return [{
      ...decl,
      clause: {
        kind: "Named",
        specs,
        node: decl.clause.node,
      },
    }];
  }
  const clauseNode = decl.clause.node;
  return decl.clause.specs.flatMap((spec) => {
    const localName = spec.alias ?? spec.name;
    const surfaceName = decl.clause.alias ? `${decl.clause.alias}.${localName}` : localName;
    const binding = bindings.get(surfaceName);
    if (!binding) return [namedJsImportDecl(decl, [spec], clauseNode)];
    const variants = binding.variants;
    if (variants.length === 1 && !decl.clause.alias) {
      return [namedJsImportDecl(
        decl,
        [{ ...spec, type: variants[0].type, fallible: variants[0].fallible }],
        clauseNode,
      )];
    }
    const selectedVariants = variants.filter((variant) => selected.has(variant.internalName));
    if (selectedVariants.length === 0) return [];
    return [namedJsImportDecl(
      decl,
      selectedVariants.map((variant) => ({
        ...spec,
        name: variant.memberName,
        alias: variant.internalName,
        type: variant.type,
        fallible: variant.fallible,
      })),
      clauseNode,
    )];
  });
}

function generatedReceiverJsImports(
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
): Decl[] {
  const variants = [...bindings.values()]
    .flatMap((binding) => binding.variants)
    .filter((variant) =>
      selected.has(variant.internalName) && variant.target.kind === "JsReceiver"
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

function namedJsImportDecl(
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
  specs: JsImportSpec[],
  node: Extract<Decl, { kind: "JsImportDecl" }>["clause"]["node"],
): Extract<Decl, { kind: "JsImportDecl" }> {
  return {
    ...decl,
    clause: { kind: "Named", specs, node },
  };
}

function rewriteDeclCalls(
  decl: Decl,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  resultRefs: Map<string, JsTypeRef>,
): Decl {
  if (decl.kind !== "LetDecl") return decl;
  return {
    ...decl,
    bindings: decl.bindings.map((binding) => ({
      ...binding,
      value: rewriteExprCalls(binding.value, bindings, selected, refs, resultRefs),
    })),
  };
}

function rewriteExprCalls(
  expr: Expr,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  resultRefs: Map<string, JsTypeRef>,
): Expr {
  switch (expr.kind) {
    case "Call": {
      const callee = rewriteExprCalls(expr.callee, bindings, selected, refs, resultRefs);
      const args = expr.args.map((arg) =>
        rewriteExprCalls(arg, bindings, selected, refs, resultRefs)
      );
      if (callee.kind === "Var") {
        const receiver = reflectedReceiverCall(callee.name, args, bindings, selected, refs);
        if (receiver) return { ...expr, callee: receiver.callee, args: receiver.args };
        const variants = bindings.get(callee.name)?.variants ?? [];
        const variant = variants.length > 1 || callee.name.includes(".")
          ? selectVariant(variants, args)
          : undefined;
        if (variant) {
          selected.add(variant.internalName);
          return { ...expr, callee: { ...callee, name: variant.internalName }, args };
        }
        if (variants.length > 0 && (variants.length > 1 || callee.name.includes("."))) {
          throw diagnosticError(
            new Error(ffiOverloadMessage(callee.name, variants, args)),
            expr.node,
          );
        }
      }
      return { ...expr, callee, args };
    }
    case "Tuple":
      return {
        ...expr,
        items: expr.items.map((item) =>
          rewriteExprCalls(item, bindings, selected, refs, resultRefs)
        ),
      };
    case "Record":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: rewriteExprCalls(field.value, bindings, selected, refs, resultRefs),
        })),
      };
    case "JsonObject":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: rewriteExprCalls(field.value, bindings, selected, refs, resultRefs),
        })),
      };
    case "JsonArray":
      return {
        ...expr,
        items: expr.items.map((item) =>
          rewriteExprCalls(item, bindings, selected, refs, resultRefs)
        ),
      };
    case "Lambda":
      return { ...expr, body: rewriteExprCalls(expr.body, bindings, selected, refs, resultRefs) };
    case "If":
      return {
        ...expr,
        cond: rewriteExprCalls(expr.cond, bindings, selected, refs, resultRefs),
        thenExpr: rewriteExprCalls(expr.thenExpr, bindings, selected, refs, resultRefs),
        elseExpr: rewriteExprCalls(expr.elseExpr, bindings, selected, refs, resultRefs),
      };
    case "Match":
      return {
        ...expr,
        value: rewriteExprCalls(expr.value, bindings, selected, refs, resultRefs),
        arms: rewriteMatchArms(expr, bindings, selected, refs, resultRefs),
      };
    case "Panic":
      return {
        ...expr,
        message: rewriteExprCalls(expr.message, bindings, selected, refs, resultRefs),
      };
    case "Block":
      return rewriteBlock(expr, bindings, selected, refs, resultRefs);
    case "Binary":
      return {
        ...expr,
        left: rewriteExprCalls(expr.left, bindings, selected, refs, resultRefs),
        right: rewriteExprCalls(expr.right, bindings, selected, refs, resultRefs),
      };
    case "Unary":
      return { ...expr, value: rewriteExprCalls(expr.value, bindings, selected, refs, resultRefs) };
    default:
      return expr;
  }
}

function jsTargetMembers(target: JsTarget) {
  if (target.kind === "JsGlobal") return jsGlobalMembers(target.path);
  if (target.kind === "JsModule") return jsModuleMembers(target.specifier);
  return [];
}

function rewriteBlock(
  expr: Extract<Expr, { kind: "Block" }>,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  resultRefs: Map<string, JsTypeRef>,
): Expr {
  const localRefs = new Map(refs);
  const localResultRefs = new Map(resultRefs);
  const items = expr.items.map((item) => {
    const rewritten = isDecl(item)
      ? rewriteDeclCalls(item, bindings, selected, localRefs, localResultRefs)
      : rewriteExprCalls(item, bindings, selected, localRefs, localResultRefs);
    if (isDecl(rewritten)) rememberLetRefs(rewritten, bindings, localRefs, localResultRefs);
    return rewritten;
  });
  return {
    ...expr,
    items,
    result: rewriteExprCalls(expr.result, bindings, selected, localRefs, localResultRefs),
  };
}

function rewriteMatchArms(
  expr: Extract<Expr, { kind: "Match" }>,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  resultRefs: Map<string, JsTypeRef>,
): Extract<Expr, { kind: "Match" }>["arms"] {
  const matchedRef = resultRefForExpr(expr.value, bindings, resultRefs);
  return expr.arms.map((arm) => {
    const localRefs = new Map(refs);
    if (matchedRef) {
      for (const binder of okPayloadBinders(arm.pattern)) {
        localRefs.set(binder, matchedRef);
      }
    }
    return {
      ...arm,
      body: rewriteExprCalls(arm.body, bindings, selected, localRefs, resultRefs),
    };
  });
}

function jsTargetMember(target: JsTarget, name: string) {
  if (target.kind === "JsGlobal") return jsGlobalMember(target.path, name);
  if (target.kind === "JsModule") return jsModuleMember(target.specifier, name);
  return undefined;
}

function memberVariants(member: JsMemberType): { type: TypeExpr; resultRef?: JsTypeRef }[] {
  if (member.variants) return member.variants;
  return [member.type, ...(member.overloads ?? [])].map((type) => ({ type }));
}

function reflectedReceiverCall(
  name: string,
  args: Expr[],
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
): { callee: Expr; args: Expr[] } | undefined {
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  const baseName = parts[0];
  const ref = refs.get(baseName);
  if (!ref) return undefined;
  const path = parts.slice(1);
  const member = jsRefCallMember(ref, path, args.map(callArgHint)) ?? jsRefMember(ref, path);
  if (!member) return undefined;
  const surfaceName = `__receiver.${ref.key}.${path.join(".")}`;
  addVariants(
    bindings,
    surfaceName,
    path.at(-1)!,
    { kind: "JsReceiver", path },
    memberVariants(member).map((variant) => ({
      type: prependReceiver(variant.type),
      resultRef: variant.resultRef,
    })),
    true,
  );
  const receiverArg: Expr = { kind: "Var", name: baseName };
  const allArgs = [receiverArg, ...args];
  const variant = selectVariant(bindings.get(surfaceName)?.variants ?? [], allArgs);
  if (!variant) return undefined;
  selected.add(variant.internalName);
  return { callee: { kind: "Var", name: variant.internalName }, args: allArgs };
}

function callArgHint(expr: Expr): JsCallArgHint {
  if (expr.kind === "String") return { kind: "string", value: expr.value };
  if (expr.kind === "Lambda") return { kind: "function", arity: expr.params.length };
  return { kind: "unknown" };
}

function prependReceiver(type: TypeExpr): TypeExpr {
  if (type.kind !== "TFn") return fn([name("Js.Object")], type);
  return { ...type, params: [name("Js.Object"), ...type.params] };
}

function rememberLetRefs(
  decl: Decl,
  bindings: Map<string, FfiBinding>,
  refs: Map<string, JsTypeRef>,
  resultRefs: Map<string, JsTypeRef>,
) {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) {
    if (binding.pattern.kind !== "PVar") continue;
    const ref = resultRefForExpr(binding.value, bindings, resultRefs);
    if (!ref) continue;
    refs.set(binding.pattern.name, ref);
    resultRefs.set(binding.pattern.name, ref);
  }
}

function variantFromCall(expr: Expr, bindings: Map<string, FfiBinding>): FfiVariant | undefined {
  if (expr.kind !== "Call" || expr.callee.kind !== "Var") return undefined;
  const calleeName = expr.callee.name;
  for (const binding of bindings.values()) {
    const found = binding.variants.find((variant) => variant.internalName === calleeName);
    if (found) return found;
  }
  return undefined;
}

function resultRefForExpr(
  expr: Expr,
  bindings: Map<string, FfiBinding>,
  resultRefs: Map<string, JsTypeRef>,
): JsTypeRef | undefined {
  if (expr.kind === "Var") return resultRefs.get(expr.name);
  const callRef = variantFromCall(expr, bindings)?.resultRef;
  if (callRef) return callRef;
  if (expr.kind !== "Match") return undefined;
  const matchedRef = resultRefForExpr(expr.value, bindings, resultRefs);
  if (!matchedRef) return undefined;
  return matchPassThroughsOkPayload(expr) ? matchedRef : undefined;
}

function matchPassThroughsOkPayload(expr: Extract<Expr, { kind: "Match" }>): boolean {
  return expr.arms.some((arm) => {
    const bodyVar = passThroughVar(arm.body);
    if (!bodyVar) return false;
    return okPayloadBinders(arm.pattern).includes(bodyVar);
  });
}

function passThroughVar(expr: Expr): string | undefined {
  if (expr.kind === "Var") return expr.name;
  if (expr.kind === "Block" && expr.items.length === 0 && expr.result.kind === "Var") {
    return expr.result.name;
  }
  return undefined;
}

function okPayloadBinders(pattern: Pattern): string[] {
  if (pattern.kind !== "PCtor" || pattern.name.split(".").at(-1) !== "Ok") return [];
  const payload = pattern.args[0];
  return payload ? patternBinders(payload) : [];
}

function patternBinders(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "PVar":
      return [pattern.name];
    case "PTuple":
      return pattern.items.flatMap(patternBinders);
    case "PRecord":
      return pattern.fields.flatMap((field) => patternBinders(field.pattern));
    case "PCtor":
      return pattern.args.flatMap(patternBinders);
    default:
      return [];
  }
}

function ffiInternalName(surfaceName: string, memberName: string, index: number): string {
  return `__ffi_${sanitize(surfaceName)}_${sanitize(memberName)}_${index}`;
}

function typeCallArity(type: TypeExpr): number | undefined {
  return type.kind === "TFn" ? type.params.length : undefined;
}

function selectVariant(variants: FfiVariant[], args: Expr[]): FfiVariant | undefined {
  return variants
    .filter((candidate) => typeCallArity(candidate.type) === args.length)
    .map((candidate) => ({ candidate, score: callScore(candidate.type, args) }))
    .sort((left, right) => left.score - right.score)[0]?.candidate;
}

function ffiOverloadMessage(name: string, variants: FfiVariant[], args: Expr[]): string {
  const arities = [
    ...new Set(
      variants.map((variant) => typeCallArity(variant.type)).filter(
        (arity): arity is number => arity !== undefined,
      ),
    ),
  ].sort((left, right) => left - right);
  return `cannot determine JS FFI overload for ${name} with ${args.length} arguments${
    arities.length ? `; available arities: ${arities.join(", ")}` : ""
  }`;
}

function callScore(type: TypeExpr, args: Expr[]): number {
  if (type.kind !== "TFn") return Number.POSITIVE_INFINITY;
  return type.params.reduce((score, param, index) => score + argScore(param, args[index]), 0);
}

function argScore(expected: TypeExpr, arg: Expr): number {
  const actual = literalType(arg);
  if (!actual) return 1;
  if (expected.kind === "TName" && expected.name === actual) return 0;
  if (expected.kind === "TName" && expected.name === "Js.Value") return 2;
  return 10;
}

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
  return types.filter((type) => {
    const key = typeKey(type.type);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function name(typeName: string): TypeExpr {
  return { kind: "TName", name: typeName, args: [] };
}

function fn(params: TypeExpr[], result: TypeExpr): TypeExpr {
  return { kind: "TFn", params, result };
}

function fallibleType(type: TypeExpr): TypeExpr {
  if (type.kind !== "TFn") return result(type);
  return { ...type, result: result(type.result) };
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

function isDecl(value: Decl | Expr): value is Decl {
  return "kind" in value &&
    (value.kind === "ImportDecl" || value.kind === "JsImportDecl" || value.kind === "LetDecl" ||
      value.kind === "RecordDecl" || value.kind === "TypeDecl");
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
