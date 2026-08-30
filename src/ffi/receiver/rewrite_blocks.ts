import type { Decl, Expr, Pattern } from "../../ast.ts";
import type { JsTypeRef } from "../reflect/types.ts";
import { type ObjectAccess, rememberLetObjectAccess } from "./receiver.ts";
import { type FfiBinding, isDecl } from "../shared.ts";

type RewriteDecl = (
  decl: Decl,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
  rewriteExpr: RewriteExpr,
) => Decl;

type RewriteExpr = (
  expr: Expr,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
) => Expr;

export function rewriteBlock(
  expr: Extract<Expr, { kind: "Block" }>,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
  rewriteDecl: RewriteDecl,
  rewriteExpr: RewriteExpr,
): Expr {
  const localRefs = new Map(refs);
  const localObjectAccess = new Map(objectAccess);
  const items = expr.items.map((item) => {
    const rewritten = isDecl(item)
      ? rewriteDecl(
        item,
        bindings,
        selected,
        localRefs,
        localObjectAccess,
        importedTypeRefs,
        rewriteExpr,
      )
      : rewriteExpr(
        item,
        bindings,
        selected,
        localRefs,
        localObjectAccess,
        importedTypeRefs,
      );
    if (isDecl(rewritten)) {
      rememberLetObjectAccess(rewritten, bindings, localObjectAccess, importedTypeRefs);
    }
    return rewritten;
  });
  return {
    ...expr,
    items,
    result: rewriteExpr(
      expr.result,
      bindings,
      selected,
      localRefs,
      localObjectAccess,
      importedTypeRefs,
    ),
  };
}

export function rewriteMatchArms(
  expr: Extract<Expr, { kind: "Match" }>,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
  rewriteExpr: RewriteExpr,
): Extract<Expr, { kind: "Match" }>["arms"] {
  return expr.arms.map((arm) => {
    const localRefs = new Map(refs);
    const localObjectAccess = new Map(objectAccess);
    for (const binder of patternBinders(arm.pattern)) {
      localObjectAccess.set(binder, { kind: "unresolved" });
    }
    return {
      ...arm,
      body: rewriteExpr(
        arm.body,
        bindings,
        selected,
        localRefs,
        localObjectAccess,
        importedTypeRefs,
      ),
    };
  });
}

function patternBinders(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "PVar":
      return [pattern.name];
    case "PTuple":
      return pattern.items.flatMap(patternBinders);
    case "PRecord":
      return pattern.fields.flatMap((field) => patternBinders(field.pattern));
    case "PCtor":
      return pattern.args.flatMap(patternBinders);
    case "PAscribed":
      return patternBinders(pattern.pattern);
    case "PWildcard":
    case "PInt":
    case "PString":
    case "PBool":
    case "PVoid":
    case "PPinned":
      return [];
  }
}
