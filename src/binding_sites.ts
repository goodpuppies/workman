import type { Binding, Decl, Expr, Module } from "./ast.ts";
import type { BindingFacts } from "./binding_facts.ts";
import type { ModuleId } from "./module_id.ts";

export type ResolvedBindingSiteInput = {
  module: Module;
  bindings: BindingFacts;
  path?: string;
  moduleId?: ModuleId;
};

export type ResolvedBindingSite = {
  binding: Binding;
  recursive: boolean;
  bindings: BindingFacts;
  path?: string;
  moduleId?: ModuleId;
};

export function collectResolvedBindingSites(
  inputs: ResolvedBindingSiteInput[],
): ResolvedBindingSite[] {
  return inputs.flatMap(({ module, bindings, path, moduleId }) =>
    collectDeclBindingSites(module.decls, bindings, path, moduleId)
  );
}

function collectDeclBindingSites(
  decls: Decl[],
  bindings: BindingFacts,
  path?: string,
  moduleId?: ModuleId,
): ResolvedBindingSite[] {
  return decls.flatMap((decl) => collectDeclBindingSite(decl, bindings, path, moduleId));
}

function collectDeclBindingSite(
  decl: Decl,
  bindings: BindingFacts,
  path?: string,
  moduleId?: ModuleId,
): ResolvedBindingSite[] {
  if (decl.kind !== "LetDecl") return [];
  return decl.bindings.flatMap((binding) => [
    { binding, recursive: decl.recursive, bindings, path, moduleId },
    ...collectExprBindingSites(binding.value, bindings, path, moduleId),
  ]);
}

function collectExprBindingSites(
  expr: Expr,
  bindings: BindingFacts,
  path?: string,
  moduleId?: ModuleId,
): ResolvedBindingSite[] {
  switch (expr.kind) {
    case "Tuple":
    case "JsonArray":
      return expr.items.flatMap((item) => collectExprBindingSites(item, bindings, path, moduleId));
    case "Record":
    case "JsonObject":
      return expr.fields.flatMap((field) =>
        collectExprBindingSites(field.value, bindings, path, moduleId)
      );
    case "FfiGet":
      return collectExprBindingSites(expr.receiver, bindings, path, moduleId);
    case "FfiCall":
      return [expr.receiver, ...expr.args].flatMap((item) =>
        collectExprBindingSites(item, bindings, path, moduleId)
      );
    case "FfiBindingCall":
      return expr.args.flatMap((item) => collectExprBindingSites(item, bindings, path, moduleId));
    case "Lambda":
      return collectExprBindingSites(expr.body, bindings, path, moduleId);
    case "Call":
      return [expr.callee, ...expr.args].flatMap((item) =>
        collectExprBindingSites(item, bindings, path, moduleId)
      );
    case "If":
      return [expr.cond, expr.thenExpr, expr.elseExpr].flatMap((item) =>
        collectExprBindingSites(item, bindings, path, moduleId)
      );
    case "Match":
      return [expr.value, ...expr.arms.map((arm) => arm.body)].flatMap((item) =>
        collectExprBindingSites(item, bindings, path, moduleId)
      );
    case "Panic":
      return collectExprBindingSites(expr.message, bindings, path, moduleId);
    case "Block":
      return [
        ...expr.items.flatMap((item) =>
          isDecl(item)
            ? collectDeclBindingSite(item, bindings, path)
            : collectExprBindingSites(item, bindings, path, moduleId)
        ),
        ...collectExprBindingSites(expr.result, bindings, path, moduleId),
      ];
    case "Ascribed":
      return collectExprBindingSites(expr.value, bindings, path, moduleId);
    case "Binary":
    case "Pipe":
      return [expr.left, expr.right].flatMap((item) =>
        collectExprBindingSites(item, bindings, path, moduleId)
      );
    case "Unary":
      return collectExprBindingSites(expr.value, bindings, path, moduleId);
    default:
      return [];
  }
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}
