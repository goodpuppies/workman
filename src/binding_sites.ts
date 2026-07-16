import type { Binding, Decl, Expr, Module } from "./ast.ts";
import type { BindingFacts } from "./binding_facts.ts";

export type ResolvedBindingSiteInput = {
  module: Module;
  bindings: BindingFacts;
  path?: string;
};

export type ResolvedBindingSite = {
  binding: Binding;
  recursive: boolean;
  bindings: BindingFacts;
  path?: string;
};

export function collectResolvedBindingSites(
  inputs: ResolvedBindingSiteInput[],
): ResolvedBindingSite[] {
  return inputs.flatMap(({ module, bindings, path }) =>
    collectDeclBindingSites(module.decls, bindings, path)
  );
}

function collectDeclBindingSites(
  decls: Decl[],
  bindings: BindingFacts,
  path?: string,
): ResolvedBindingSite[] {
  return decls.flatMap((decl) => collectDeclBindingSite(decl, bindings, path));
}

function collectDeclBindingSite(
  decl: Decl,
  bindings: BindingFacts,
  path?: string,
): ResolvedBindingSite[] {
  if (decl.kind !== "LetDecl") return [];
  return decl.bindings.flatMap((binding) => [
    { binding, recursive: decl.recursive, bindings, path },
    ...collectExprBindingSites(binding.value, bindings, path),
  ]);
}

function collectExprBindingSites(
  expr: Expr,
  bindings: BindingFacts,
  path?: string,
): ResolvedBindingSite[] {
  switch (expr.kind) {
    case "Tuple":
    case "JsonArray":
      return expr.items.flatMap((item) => collectExprBindingSites(item, bindings, path));
    case "Record":
    case "JsonObject":
      return expr.fields.flatMap((field) => collectExprBindingSites(field.value, bindings, path));
    case "FfiGet":
      return collectExprBindingSites(expr.receiver, bindings, path);
    case "FfiCall":
      return [expr.receiver, ...expr.args].flatMap((item) =>
        collectExprBindingSites(item, bindings, path)
      );
    case "FfiBindingCall":
      return expr.args.flatMap((item) => collectExprBindingSites(item, bindings, path));
    case "Lambda":
      return collectExprBindingSites(expr.body, bindings, path);
    case "Call":
      return [expr.callee, ...expr.args].flatMap((item) =>
        collectExprBindingSites(item, bindings, path)
      );
    case "If":
      return [expr.cond, expr.thenExpr, expr.elseExpr].flatMap((item) =>
        collectExprBindingSites(item, bindings, path)
      );
    case "Match":
      return [expr.value, ...expr.arms.map((arm) => arm.body)].flatMap((item) =>
        collectExprBindingSites(item, bindings, path)
      );
    case "Panic":
      return collectExprBindingSites(expr.message, bindings, path);
    case "Block":
      return [
        ...expr.items.flatMap((item) =>
          isDecl(item)
            ? collectDeclBindingSite(item, bindings, path)
            : collectExprBindingSites(item, bindings, path)
        ),
        ...collectExprBindingSites(expr.result, bindings, path),
      ];
    case "Binary":
    case "Pipe":
      return [expr.left, expr.right].flatMap((item) =>
        collectExprBindingSites(item, bindings, path)
      );
    case "Unary":
      return collectExprBindingSites(expr.value, bindings, path);
    default:
      return [];
  }
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}
