import type { Decl, Expr } from "../ast.ts";

export function recordFieldNamesInDecls(
  decls: Decl[],
  importedFields: Iterable<string> = [],
): Set<string> {
  const fields = new Set(importedFields);

  const visitDecl = (decl: Decl): void => {
    switch (decl.kind) {
      case "RecordDecl":
        for (const field of decl.fields) fields.add(field.name);
        return;
      case "LetDecl":
        for (const binding of decl.bindings) visitExpr(binding.value);
        return;
      case "ImportDecl":
      case "JsImportDecl":
      case "ForeignTypeDecl":
      case "TypeDecl":
        return;
    }
  };

  const visitExpr = (expr: Expr): void => {
    switch (expr.kind) {
      case "FfiGet":
        visitExpr(expr.receiver);
        return;
      case "FfiCall":
        visitExpr(expr.receiver);
        expr.args.forEach(visitExpr);
        return;
      case "FfiBindingCall":
        expr.args.forEach(visitExpr);
        return;
      case "Call":
        visitExpr(expr.callee);
        expr.args.forEach(visitExpr);
        return;
      case "Tuple":
      case "JsonArray":
        expr.items.forEach(visitExpr);
        return;
      case "Record":
        expr.fields.forEach((field) => visitExpr(field.value));
        return;
      case "JsonObject":
        expr.fields.forEach((field) => visitExpr(field.value));
        return;
      case "Lambda":
        visitExpr(expr.body);
        return;
      case "If":
        visitExpr(expr.cond);
        visitExpr(expr.thenExpr);
        visitExpr(expr.elseExpr);
        return;
      case "Match":
        visitExpr(expr.value);
        expr.arms.forEach((arm) => visitExpr(arm.body));
        return;
      case "Panic":
        visitExpr(expr.message);
        return;
      case "Block":
        for (const item of expr.items) {
          if (isDecl(item)) visitDecl(item);
          else visitExpr(item);
        }
        visitExpr(expr.result);
        return;
      case "Binary":
        visitExpr(expr.left);
        visitExpr(expr.right);
        return;
      case "Unary":
        visitExpr(expr.value);
        return;
      case "Pipe":
        visitExpr(expr.left);
        visitExpr(expr.right);
        return;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        return;
    }
  };

  decls.forEach(visitDecl);
  return fields;
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind === "ImportDecl" ||
    value.kind === "JsImportDecl" ||
    value.kind === "ForeignTypeDecl" ||
    value.kind === "RecordDecl" ||
    value.kind === "TypeDecl" ||
    value.kind === "LetDecl";
}
