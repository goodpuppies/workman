import type { Expr } from "../ast.ts";
import { isDecl } from "./ast_utils.ts";

export function findAccidentalMatchFnInFunction(
  expr: Expr,
): Extract<Expr, { kind: "Lambda" }> | undefined {
  if (expr.kind === "Block") {
    for (const item of expr.items) {
      if (isDecl(item)) continue;
      if (item.kind === "Lambda" && isMatchFnLambda(item)) return item;
      const nested = findAccidentalMatchFnInFunction(item);
      if (nested) return nested;
    }
    return findAccidentalMatchFnInFunction(expr.result);
  }
  switch (expr.kind) {
    case "Tuple":
      return expr.items.map(findAccidentalMatchFnInFunction).find((hit) => hit !== undefined);
    case "Record":
      return expr.fields.map((field) => findAccidentalMatchFnInFunction(field.value)).find((hit) =>
        hit !== undefined
      );
    case "JsonObject":
      return expr.fields.map((field) => findAccidentalMatchFnInFunction(field.value)).find((hit) =>
        hit !== undefined
      );
    case "JsonArray":
      return expr.items.map(findAccidentalMatchFnInFunction).find((hit) => hit !== undefined);
    case "Lambda":
      if (isMatchFnLambda(expr)) return expr;
      return findAccidentalMatchFnInFunction(expr.body);
    case "Call": {
      const callee = findAccidentalMatchFnInFunction(expr.callee);
      if (callee) return callee;
      return expr.args.map(findAccidentalMatchFnInFunction).find((hit) => hit !== undefined);
    }
    case "If":
      return findAccidentalMatchFnInFunction(expr.cond) ??
        findAccidentalMatchFnInFunction(expr.thenExpr) ??
        findAccidentalMatchFnInFunction(expr.elseExpr);
    case "Match": {
      const valueHit = findAccidentalMatchFnInFunction(expr.value);
      if (valueHit) return valueHit;
      return expr.arms.map((arm) => findAccidentalMatchFnInFunction(arm.body)).find((hit) =>
        hit !== undefined
      );
    }
    case "Panic":
      return findAccidentalMatchFnInFunction(expr.message);
    case "Binary":
      return findAccidentalMatchFnInFunction(expr.left) ??
        findAccidentalMatchFnInFunction(expr.right);
    case "Unary":
      return findAccidentalMatchFnInFunction(expr.value);
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
      return undefined;
  }
}

export function hasTrailingStatementLikeResult(expr: Expr): boolean {
  if (expr.kind !== "Block") return false;
  if (expr.items.length === 0) return false;
  if (expr.result.kind !== "Void") return false;
  const last = expr.items[expr.items.length - 1];
  return !isDecl(last);
}

function isMatchFnLambda(expr: Extract<Expr, { kind: "Lambda" }>): boolean {
  if (expr.body.kind !== "Match") return false;
  const names = expr.params.map((param) =>
    param.pattern.kind === "PVar" ? param.pattern.name : undefined
  );
  if (names.some((name) => name === undefined)) return false;
  const paramNames = names as string[];
  if (paramNames.length === 1) {
    return expr.body.value.kind === "Var" && expr.body.value.name === paramNames[0];
  }
  if (expr.body.value.kind !== "Tuple" || expr.body.value.items.length !== paramNames.length) {
    return false;
  }
  return expr.body.value.items.every((item, index) =>
    item.kind === "Var" && item.name === paramNames[index]
  );
}
