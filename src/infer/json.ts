import type { Expr } from "../ast.ts";
import { diagnosticError } from "../diagnostics.ts";
import {
  named,
  prune,
  quoteType,
  typeInfoByName,
  type Ty,
  type TypeEnv,
} from "../types.ts";

export function jsonValueTy(typeEnv: TypeEnv): Ty {
  const info = typeInfoByName(typeEnv, "Js.Value");
  if (!info) throw new Error("unknown type Js.Value");
  return named(info);
}

export function assertJsonCompatible(type: Ty, typeEnv: TypeEnv, expr: Expr) {
  const t = prune(type);
  if (t.tag === "prim" && ["Number", "String", "Bool", "Void"].includes(t.name)) return;
  if (isJsValueTy(t, typeEnv) || isJsObjectLikeTy(t, typeEnv)) return;
  if (t.tag === "var") return;
  const element = jsArrayElementTy(t, typeEnv);
  if (element) return assertJsonCompatible(element, typeEnv, expr);
  throw diagnosticError(new Error(`type mismatch ${quoteType(t)} vs "Js.Value"`), expr.node);
}

function isJsValueTy(type: Ty, typeEnv: TypeEnv): boolean {
  const jsValue = typeInfoByName(typeEnv, "Js.Value");
  return !!jsValue && type.tag === "named" && type.id === jsValue.id;
}

// A `Js.Array<T>` is a genuine JavaScript array, so it is JSON-compatible exactly when its
// elements are.
function jsArrayElementTy(type: Ty, typeEnv: TypeEnv): Ty | undefined {
  const jsArray = typeInfoByName(typeEnv, "Js.Array");
  return type.tag === "named" && type.id === jsArray?.id && type.args.length === 1
    ? type.args[0]
    : undefined;
}

function isJsObjectLikeTy(type: Ty, typeEnv: TypeEnv): boolean {
  const jsObject = typeInfoByName(typeEnv, "Js.Object");
  const jsDict = typeInfoByName(typeEnv, "Js.Dict");
  return type.tag === "named" &&
    (type.id === jsObject?.id || type.id === jsDict?.id ||
      Boolean(type.foreign || typeInfoByName(typeEnv, type.name)?.foreign));
}
