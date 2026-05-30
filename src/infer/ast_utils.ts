import type { Decl, Expr } from "../ast.ts";

export function isDecl(value: Decl | Expr): value is Decl {
  return value.kind === "ImportDecl" || value.kind === "LetDecl" ||
    value.kind === "JsImportDecl" || value.kind === "TypeDecl" || value.kind === "RecordDecl";
}

export function resultExpr(expr: Expr): Expr {
  if (expr.kind === "Block") return resultExpr(expr.result);
  return expr;
}
