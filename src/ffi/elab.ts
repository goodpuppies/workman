import type { Decl, Expr, JsImportSpec, JsTarget, Module, TypeExpr } from "../ast.ts";
import { jsGlobalMember, jsGlobalMembers, jsModuleMember, jsModuleMembers } from "./js_types.ts";

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
  node?: JsImportSpec["node"];
};

export function prepareFfiElaboration(module: Module): FfiElaboration {
  const bindings = new Map<string, FfiBinding>();
  for (const decl of module.decls) {
    if (decl.kind !== "JsImportDecl") continue;
    collectFfiDecl(bindings, decl);
  }
  const selected = new Set<string>();
  const rewrittenDecls = module.decls.map((decl) =>
    decl.kind === "JsImportDecl" ? decl : rewriteDeclCalls(decl, bindings, selected)
  );
  const decls = rewrittenDecls.flatMap((decl) =>
    decl.kind === "JsImportDecl" ? generatedJsImports(decl, bindings, selected) : [decl]
  );
  return { module: { ...module, decls }, bindings };
}

function collectFfiDecl(
  bindings: Map<string, FfiBinding>,
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
) {
  if (decl.clause.kind === "Namespace") {
    for (const member of jsTargetMembers(decl.target)) {
      addVariants(bindings, `${decl.clause.alias}.${member.name}`, member.name, decl.target, [
        member.type,
        ...(member.overloads ?? []),
      ], decl.node);
    }
    return;
  }
  for (const spec of decl.clause.specs) {
    const member = spec.type
      ? { name: spec.name, type: spec.type }
      : jsTargetMember(decl.target, spec.name);
    if (!member) continue;
    const localName = spec.alias ?? spec.name;
    const surfaceName = decl.clause.alias ? `${decl.clause.alias}.${localName}` : localName;
    addVariants(bindings, surfaceName, spec.name, decl.target, [
      member.type,
      ...("overloads" in member ? member.overloads ?? [] : []),
    ], spec.node);
  }
}

function addVariants(
  bindings: Map<string, FfiBinding>,
  surfaceName: string,
  memberName: string,
  target: JsTarget,
  types: TypeExpr[],
  node?: JsImportSpec["node"],
) {
  const binding = bindings.get(surfaceName) ?? { surfaceName, variants: [] };
  for (const type of dedupeTypeExprs(types)) {
    const index = binding.variants.length;
    binding.variants.push({
      internalName: ffiInternalName(surfaceName, memberName, index),
      memberName,
      target,
      type,
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
      return [namedJsImportDecl(decl, [{ ...spec, type: variants[0].type }], clauseNode)];
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
      })),
      clauseNode,
    )];
  });
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
): Decl {
  if (decl.kind !== "LetDecl") return decl;
  return {
    ...decl,
    bindings: decl.bindings.map((binding) => ({
      ...binding,
      value: rewriteExprCalls(binding.value, bindings, selected),
    })),
  };
}

function rewriteExprCalls(
  expr: Expr,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
): Expr {
  switch (expr.kind) {
    case "Call": {
      const callee = rewriteExprCalls(expr.callee, bindings, selected);
      const args = expr.args.map((arg) => rewriteExprCalls(arg, bindings, selected));
      if (callee.kind === "Var") {
        const variants = bindings.get(callee.name)?.variants ?? [];
        const variant = variants.length > 1 || callee.name.includes(".")
          ? variants.find((candidate) => typeCallArity(candidate.type) === args.length)
          : undefined;
        if (variant) {
          selected.add(variant.internalName);
          return { ...expr, callee: { ...callee, name: variant.internalName }, args };
        }
      }
      return { ...expr, callee, args };
    }
    case "Tuple":
      return {
        ...expr,
        items: expr.items.map((item) => rewriteExprCalls(item, bindings, selected)),
      };
    case "Record":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: rewriteExprCalls(field.value, bindings, selected),
        })),
      };
    case "JsonObject":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: rewriteExprCalls(field.value, bindings, selected),
        })),
      };
    case "JsonArray":
      return {
        ...expr,
        items: expr.items.map((item) => rewriteExprCalls(item, bindings, selected)),
      };
    case "Lambda":
      return { ...expr, body: rewriteExprCalls(expr.body, bindings, selected) };
    case "If":
      return {
        ...expr,
        cond: rewriteExprCalls(expr.cond, bindings, selected),
        thenExpr: rewriteExprCalls(expr.thenExpr, bindings, selected),
        elseExpr: rewriteExprCalls(expr.elseExpr, bindings, selected),
      };
    case "Match":
      return {
        ...expr,
        value: rewriteExprCalls(expr.value, bindings, selected),
        arms: expr.arms.map((arm) => ({
          ...arm,
          body: rewriteExprCalls(arm.body, bindings, selected),
        })),
      };
    case "Block":
      return {
        ...expr,
        items: expr.items.map((item) =>
          isDecl(item)
            ? rewriteDeclCalls(item, bindings, selected)
            : rewriteExprCalls(item, bindings, selected)
        ),
        result: rewriteExprCalls(expr.result, bindings, selected),
      };
    case "Binary":
      return {
        ...expr,
        left: rewriteExprCalls(expr.left, bindings, selected),
        right: rewriteExprCalls(expr.right, bindings, selected),
      };
    case "Unary":
      return { ...expr, value: rewriteExprCalls(expr.value, bindings, selected) };
    default:
      return expr;
  }
}

function jsTargetMembers(target: JsTarget) {
  return target.kind === "JsGlobal"
    ? jsGlobalMembers(target.path)
    : jsModuleMembers(target.specifier);
}

function jsTargetMember(target: JsTarget, name: string) {
  return target.kind === "JsGlobal"
    ? jsGlobalMember(target.path, name)
    : jsModuleMember(target.specifier, name);
}

function ffiInternalName(surfaceName: string, memberName: string, index: number): string {
  return `__ffi_${sanitize(surfaceName)}_${sanitize(memberName)}_${index}`;
}

function typeCallArity(type: TypeExpr): number | undefined {
  return type.kind === "TFn" ? type.params.length : undefined;
}

function dedupeTypeExprs(types: TypeExpr[]): TypeExpr[] {
  const seen = new Set<string>();
  return types.filter((type) => {
    const key = typeKey(type);
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

function isDecl(value: Decl | Expr): value is Decl {
  return "kind" in value &&
    (value.kind === "ImportDecl" || value.kind === "JsImportDecl" || value.kind === "LetDecl" ||
      value.kind === "RecordDecl" || value.kind === "TypeDecl");
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
