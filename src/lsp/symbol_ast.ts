import type { Decl, Expr, Pattern } from "../ast.ts";

export function binderPatterns(pattern: Pattern): Extract<Pattern, { kind: "PVar" }>[] {
  if (pattern.kind === "PVar") return [pattern];
  if (pattern.kind === "PTuple") return pattern.items.flatMap(binderPatterns);
  if (pattern.kind === "PRecord") {
    return pattern.fields.flatMap((field) => binderPatterns(field.pattern));
  }
  return [];
}

export function isDecl(item: Decl | Expr): item is Decl {
  return item.kind === "ImportDecl" || item.kind === "JsImportDecl" ||
    item.kind === "ForeignTypeDecl" || item.kind === "LetDecl" ||
    item.kind === "RecordDecl" || item.kind === "TypeDecl";
}

export function childExpressions(expr: Expr): Expr[] {
  switch (expr.kind) {
    case "Tuple":
      return expr.items;
    case "Record":
      return expr.fields.map((field) => field.value);
    case "JsonObject":
      return expr.fields.map((field) => field.value);
    case "JsonArray":
      return expr.items;
    case "FfiGet":
      return [expr.receiver];
    case "FfiCall":
      return [expr.receiver, ...expr.args];
    case "FfiBindingCall":
      return expr.args;
    case "Call":
      return [expr.callee, ...expr.args];
    case "If":
      return [expr.cond, expr.thenExpr, expr.elseExpr];
    case "Panic":
      return [expr.message];
    case "Binary":
      return [expr.left, expr.right];
    case "Unary":
      return [expr.value];
    case "Pipe":
      return [expr.left, expr.right];
    case "Lambda":
    case "Block":
    case "Match":
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
      return [];
  }
}
