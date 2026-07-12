import type { TypeExpr } from "../../ast.ts";

export type JsMemberType = {
  name: string;
  type: TypeExpr;
  overloads?: TypeExpr[];
  variants?: JsCallableVariant[];
};

export type JsCallableVariant = {
  type: TypeExpr;
  resultRef?: JsTypeRef;
  callbackParamRefs?: JsCallbackParamRefs[];
};

export type JsTypeRef = {
  key: string;
  source: string;
  expr: string;
  type?: TypeExpr;
  // Constructor values can carry the canonical nominal type of their instances.
  // This avoids deriving identity from a reflection query's transient return key.
  constructorTypeRef?: JsTypeRef;
};

export type JsCallbackParamRefs = {
  argIndex: number;
  params: JsTypeRef[];
};

export type JsCallArgHint =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "function"; arity: number; paramTypes?: TypeExpr[]; resultType?: TypeExpr }
  | { kind: "ref"; ref: JsTypeRef; type?: TypeExpr }
  | { kind: "unknown" };
