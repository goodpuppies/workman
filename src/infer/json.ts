import type { Expr } from "../ast.ts";
import { diagnosticError } from "../diagnostics.ts";
import { named, prune, quoteType, type Ty, type TypeEnv } from "../types.ts";

export function jsonValueTy(typeEnv: TypeEnv): Ty {
  const info = typeEnv.get("Js.Value");
  if (!info) throw new Error("unknown type Js.Value");
  return named(info);
}

export function assertJsonCompatible(type: Ty, typeEnv: TypeEnv, expr: Expr) {
  const t = prune(type);
  if (t.tag === "prim" && ["Number", "String", "Bool", "Void"].includes(t.name)) return;
  if (isJsValueTy(t, typeEnv) || isJsObjectLikeTy(t, typeEnv)) return;
  if (t.tag === "var") return;
  throw diagnosticError(new Error(`type mismatch ${quoteType(t)} vs "Js.Value"`), expr.node);
}

function isJsValueTy(type: Ty, typeEnv: TypeEnv): boolean {
  const jsValue = typeEnv.get("Js.Value");
  return !!jsValue && type.tag === "named" && type.id === jsValue.id;
}

function isJsObjectLikeTy(type: Ty, typeEnv: TypeEnv): boolean {
  const jsObject = typeEnv.get("Js.Object");
  const jsDict = typeEnv.get("Js.Dict");
  return type.tag === "named" &&
    (type.id === jsObject?.id || type.id === jsDict?.id ||
      Boolean(type.foreign || typeEnv.get(type.name)?.foreign));
}
