import type { TypeExpr } from "../../ast.ts";

export function tsTypeFromTypeExpr(type: TypeExpr): string {
  switch (type.kind) {
    case "TName":
      return tsNamedType(type);
    case "TVar":
      return "any";
    case "TTuple":
      return `[${type.items.map(tsTypeFromTypeExpr).join(", ")}]`;
    case "TFn":
      return `(${
        type.params.map((param, index) => `arg${index}: ${tsTypeFromTypeExpr(param)}`).join(", ")
      }) => ${tsTypeFromTypeExpr(type.result)}`;
  }
}

export function typeExprKey(type: TypeExpr): string {
  switch (type.kind) {
    case "TName":
      return type.args.length ? `${type.name}<${type.args.map(typeExprKey).join(",")}>` : type.name;
    case "TVar":
      return `'${type.name}`;
    case "TTuple":
      return `(${type.items.map(typeExprKey).join(",")})`;
    case "TFn":
      return `(${type.params.map(typeExprKey).join(",")})->${typeExprKey(type.result)}`;
  }
}

function tsNamedType(type: Extract<TypeExpr, { kind: "TName" }>): string {
  if (type.name === "String") return "string";
  if (type.name === "Number") return "number";
  if (type.name === "Bool") return "boolean";
  if (type.name === "Void") return "void";
  if (type.name === "Js.Value") return "any";
  if (type.name === "Js.Object") return "object";
  if (type.name === "Js.Array" && type.args.length === 1) {
    return `Array<${tsTypeFromTypeExpr(type.args[0])}>`;
  }
  if (type.name === "Task" && type.args.length === 2) {
    return `Promise<${tsTypeFromTypeExpr(type.args[0])}>`;
  }
  return type.args.length
    ? `${type.name}<${type.args.map(tsTypeFromTypeExpr).join(", ")}>`
    : type.name;
}
