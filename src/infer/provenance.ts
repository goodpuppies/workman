import type { Expr, Param } from "../ast.ts";
import { diagnosticError, type FrontendRelatedDiagnostic } from "../diagnostics.ts";
import { show, type Ty, type UnifyBind } from "../types.ts";
import { isDecl } from "./ast_utils.ts";
import { constrain } from "./shared.ts";

export type TypeProvenance = Map<number, FrontendRelatedDiagnostic[]>;

export function constrainAt(
  left: Ty,
  right: Ty,
  expr: Expr | Param | undefined,
  message?: () => string,
  related: FrontendRelatedDiagnostic[] = [],
  provenance?: TypeProvenance,
  reason?: FrontendRelatedDiagnostic,
) {
  try {
    constrain(
      left,
      right,
      provenance && reason ? rememberProvenance(provenance, reason) : undefined,
    );
  } catch (error) {
    const primary = related.find((item) => item.primary);
    throw diagnosticError(
      message ? new Error(message()) : error,
      primary?.node ?? expr?.node,
      undefined,
      primary ? related.filter((item) => item !== primary) : related,
    );
  }
}

export function rememberProvenance(
  provenance: TypeProvenance,
  reason: FrontendRelatedDiagnostic,
): UnifyBind {
  return (variable) => {
    const current = provenance.get(variable.id) ?? [];
    provenance.set(variable.id, dedupeRelated([...current, reason]));
  };
}

export function provenanceFor(
  expr: Expr,
  types: Map<Expr, Ty>,
  provenance: TypeProvenance,
): FrontendRelatedDiagnostic[] {
  const type = types.get(expr);
  return type ? provenanceForType(type, provenance) : [];
}

export function provenanceForType(
  type: Ty,
  provenance: TypeProvenance,
): FrontendRelatedDiagnostic[] {
  return dedupeRelated(collectProvenance(type, provenance));
}

export function dedupeRelated(
  items: FrontendRelatedDiagnostic[],
): FrontendRelatedDiagnostic[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const span = item.span;
    const key = `${item.message}:${span?.start ?? -1}:${span?.end ?? -1}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function recursiveResultEvidence(
  name: string,
  expr: Expr,
  resultType: Ty,
  types: Map<Expr, Ty>,
): { expr: Expr; related: FrontendRelatedDiagnostic }[] {
  const target = show(resultType);
  const evidence: { expr: Expr; related: FrontendRelatedDiagnostic }[] = [];
  const visit = (node: Expr) => {
    if (
      node.kind === "Call" && node.callee.kind === "Var" && node.callee.name === name &&
      types.has(node) && show(types.get(node)!) === target
    ) {
      evidence.push({
        expr: node,
        related: {
          message: `occurrence: ${target}`,
          node: node.node,
          span: node.node?.span,
        },
      });
    }
    visitChildren(node, visit);
  };
  visit(expr);
  return evidence;
}

export function expressionTypeEvidence(
  expr: Expr,
  type: Ty,
  types: Map<Expr, Ty>,
): FrontendRelatedDiagnostic[] {
  const target = show(type);
  const evidence: FrontendRelatedDiagnostic[] = [];
  const visit = (node: Expr) => {
    if (node.kind === "Binary" && types.has(node) && show(types.get(node)!) === target) {
      evidence.push({
        message: `operator ${node.op}: ${target}`,
        node: node.node,
        span: node.node?.span,
      });
    }
    visitChildren(node, visit);
  };
  visit(expr);
  return dedupeRelated(evidence);
}

function collectProvenance(
  type: Ty,
  provenance: TypeProvenance,
  seen = new Set<number>(),
): FrontendRelatedDiagnostic[] {
  if (type.tag === "var") {
    if (seen.has(type.id)) return [];
    seen.add(type.id);
    const local = provenance.get(type.id) ?? [];
    return dedupeRelated([
      ...local,
      ...(type.instance ? collectProvenance(type.instance, provenance, seen) : []),
    ]);
  }
  if (type.tag === "fn") {
    return dedupeRelated([
      ...type.params.flatMap((param) => collectProvenance(param, provenance, seen)),
      ...collectProvenance(type.result, provenance, seen),
    ]);
  }
  if (type.tag === "tuple") {
    return dedupeRelated(type.items.flatMap((item) => collectProvenance(item, provenance, seen)));
  }
  if (type.tag === "named") {
    return dedupeRelated(type.args.flatMap((arg) => collectProvenance(arg, provenance, seen)));
  }
  return [];
}

function visitChildren(node: Expr, visit: (node: Expr) => void) {
  switch (node.kind) {
    case "Tuple":
      node.items.forEach(visit);
      break;
    case "Record":
      node.fields.forEach((field) => visit(field.value));
      break;
    case "JsonObject":
      node.fields.forEach((field) => visit(field.value));
      break;
    case "JsonArray":
      node.items.forEach(visit);
      break;
    case "Lambda":
      visit(node.body);
      break;
    case "Call":
      visit(node.callee);
      node.args.forEach(visit);
      break;
    case "If":
      visit(node.cond);
      visit(node.thenExpr);
      visit(node.elseExpr);
      break;
    case "Match":
      visit(node.value);
      node.arms.forEach((arm) => visit(arm.body));
      break;
    case "Block":
      node.items.forEach((item) => {
        if (!isDecl(item)) visit(item);
      });
      visit(node.result);
      break;
    case "Binary":
      visit(node.left);
      visit(node.right);
      break;
    case "Unary":
      visit(node.value);
      break;
  }
}
