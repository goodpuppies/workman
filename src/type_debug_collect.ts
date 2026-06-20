import type { Decl, Expr, Module, Pattern } from "./ast.ts";

export function collectExprs(module: Module): Expr[] {
  const out: Expr[] = [];
  const visitDecl = (decl: Decl) => {
    if (decl.kind !== "LetDecl") return;
    for (const binding of decl.bindings) visitExpr(binding.value);
  };
  const visitExpr = (expr: Expr) => {
    out.push(expr);
    switch (expr.kind) {
      case "Tuple":
      case "JsonArray":
        expr.items.forEach(visitExpr);
        break;
      case "Record":
      case "JsonObject":
        expr.fields.forEach((field) => visitExpr(field.value));
        break;
      case "FfiGet":
        visitExpr(expr.receiver);
        break;
      case "FfiCall":
        visitExpr(expr.receiver);
        expr.args.forEach(visitExpr);
        break;
      case "FfiBindingCall":
        expr.args.forEach(visitExpr);
        break;
      case "Lambda":
        visitExpr(expr.body);
        break;
      case "Call":
        visitExpr(expr.callee);
        expr.args.forEach(visitExpr);
        break;
      case "If":
        visitExpr(expr.cond);
        visitExpr(expr.thenExpr);
        visitExpr(expr.elseExpr);
        break;
      case "Match":
        visitExpr(expr.value);
        expr.arms.forEach((arm) => visitExpr(arm.body));
        break;
      case "Panic":
        visitExpr(expr.message);
        break;
      case "Block":
        for (const item of expr.items) {
          if (isDecl(item)) visitDecl(item);
          else visitExpr(item);
        }
        visitExpr(expr.result);
        break;
      case "Binary":
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case "Unary":
        visitExpr(expr.value);
        break;
      case "Pipe":
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        break;
    }
  };
  module.decls.forEach(visitDecl);
  return out;
}

export function collectPatterns(module: Module): Pattern[] {
  const out: Pattern[] = [];
  const visitDecl = (decl: Decl) => {
    if (decl.kind !== "LetDecl") return;
    for (const binding of decl.bindings) {
      visitPattern(binding.pattern);
      visitExpr(binding.value);
    }
  };
  const visitExpr = (expr: Expr) => {
    switch (expr.kind) {
      case "Lambda":
        expr.params.forEach((param) => visitPattern(param.pattern));
        visitExpr(expr.body);
        break;
      case "Match":
        visitExpr(expr.value);
        expr.arms.forEach((arm) => {
          visitPattern(arm.pattern);
          visitExpr(arm.body);
        });
        break;
      case "Tuple":
      case "JsonArray":
        expr.items.forEach(visitExpr);
        break;
      case "Record":
      case "JsonObject":
        expr.fields.forEach((field) => visitExpr(field.value));
        break;
      case "FfiGet":
        visitExpr(expr.receiver);
        break;
      case "FfiCall":
        visitExpr(expr.receiver);
        expr.args.forEach(visitExpr);
        break;
      case "FfiBindingCall":
        expr.args.forEach(visitExpr);
        break;
      case "Call":
        visitExpr(expr.callee);
        expr.args.forEach(visitExpr);
        break;
      case "If":
        visitExpr(expr.cond);
        visitExpr(expr.thenExpr);
        visitExpr(expr.elseExpr);
        break;
      case "Panic":
        visitExpr(expr.message);
        break;
      case "Block":
        for (const item of expr.items) {
          if (isDecl(item)) visitDecl(item);
          else visitExpr(item);
        }
        visitExpr(expr.result);
        break;
      case "Binary":
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case "Unary":
        visitExpr(expr.value);
        break;
      case "Pipe":
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        break;
    }
  };
  const visitPattern = (pattern: Pattern) => {
    out.push(pattern);
    switch (pattern.kind) {
      case "PTuple":
        pattern.items.forEach(visitPattern);
        break;
      case "PRecord":
        pattern.fields.forEach((field) => visitPattern(field.pattern));
        break;
      case "PCtor":
        pattern.args.forEach(visitPattern);
        break;
      case "PWildcard":
      case "PVar":
      case "PInt":
      case "PString":
      case "PBool":
      case "PVoid":
      case "PPinned":
        break;
    }
  };
  module.decls.forEach(visitDecl);
  return out;
}

function isDecl(item: Decl | Expr): item is Decl {
  return item.kind.endsWith("Decl");
}
