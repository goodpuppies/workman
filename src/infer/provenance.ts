import type { Expr, Param } from "../ast.ts";
import { diagnosticError, type FrontendRelatedDiagnostic } from "../diagnostics.ts";
import type { AstNode, SourceSpan } from "../source.ts";
import { type DiffPath, type DiffPathSegment, TypeMismatchError } from "../type_diff.ts";
import { JsBoundaryError, prune, show, type Ty, type UnifyBind } from "../types.ts";
import { isDecl, resultExpr } from "./ast_utils.ts";
import { constrain } from "./shared.ts";

export type TypeProvenance = Map<number, TypeProvenanceEntry>;

export type TypeProvenanceEntry = {
  related: FrontendRelatedDiagnostic[];
  commitment?: TypeCommitment;
};

export type TypeCommitment = {
  type: Ty;
  origin?: ConstraintOrigin;
};

export type ConstraintOrigin = {
  message: string;
  node?: AstNode;
  span?: SourceSpan;
};

export type TypeSource = {
  origin?: ConstraintOrigin;
  type?: Ty;
  provenance?: TypeProvenance;
  fnParams?: TypeSource[];
  fnResult?: TypeSource;
  tupleItems?: TypeSource[];
  namedArgs?: TypeSource[];
};

export type ConstrainAtOptions = {
  sources?: { left?: TypeSource; right?: TypeSource };
  context?: (path: DiffPath) => string | undefined;
};

export function constrainAt(
  left: Ty,
  right: Ty,
  expr: Expr | Param | undefined,
  message?: () => string,
  related: FrontendRelatedDiagnostic[] = [],
  provenance?: TypeProvenance,
  reason?: FrontendRelatedDiagnostic,
  options: ConstrainAtOptions = {},
) {
  try {
    constrain(
      left,
      right,
      provenance && reason ? rememberProvenance(provenance, reason, options.sources) : undefined,
    );
  } catch (error) {
    const primary = selectPrimaryCallsite(related, reason);
    const enhanced = provenance && error instanceof TypeMismatchError
      ? typeCommitmentMismatchMessage(error, provenance, reason, options)
      : undefined;
    throw diagnosticError(
      enhanced
        ? new Error(enhanced)
        : message && !(error instanceof JsBoundaryError)
        ? new Error(message())
        : error,
      primary?.node ?? expr?.node,
      undefined,
      primary
        ? dedupeRelated([...related, ...(reason && reason !== primary ? [reason] : [])])
        : related,
    );
  }
}

function selectPrimaryCallsite(
  related: FrontendRelatedDiagnostic[],
  reason?: FrontendRelatedDiagnostic,
): FrontendRelatedDiagnostic | undefined {
  const all = dedupeRelated([...related, ...(reason ? [reason] : [])]);
  const calls = all.filter((item) =>
    item.expectedCallTupleShape !== undefined && item.actualCallTupleShape !== undefined
  );
  if (calls.length > 0) {
    const byDepth = [...calls].sort((a, b) => (a.callDepth ?? 0) - (b.callDepth ?? 0));
    const mismatch = byDepth.find((item) =>
      item.expectedCallTupleShape !== item.actualCallTupleShape
    );
    if (mismatch) return mismatch;
    const targetShape = byDepth[0].actualCallTupleShape!;
    const boundary = byDepth.find((item) => item.actualCallTupleShape !== targetShape);
    if (boundary) return boundary;
  }
  const inheritedPrimary = related.find((item) => item.primary);
  return inheritedPrimary ?? (reason?.primary ? reason : undefined);
}

export function rememberProvenance(
  provenance: TypeProvenance,
  reason: FrontendRelatedDiagnostic,
  sources?: { left?: TypeSource; right?: TypeSource },
): UnifyBind {
  return (variable, target, path, targetSide) => {
    const current = provenance.get(variable.id) ?? { related: [] };
    const origin = sourceAt(sources?.[targetSide], path) ?? relatedAsOrigin(reason);
    provenance.set(variable.id, {
      related: dedupeRelated([...current.related, reason]),
      commitment: { type: target, origin },
    });
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
    const local = provenance.get(type.id)?.related ?? [];
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

export function sourceForExpr(expr: Expr, message = "expression"): TypeSource {
  const origin = {
    message,
    node: expr.node,
    span: expr.node?.span,
  };
  if (expr.kind !== "Lambda") return { origin };
  const body = resultExpr(expr.body);
  return {
    origin,
    fnParams: expr.params.map((param) => ({
      origin: {
        message: "lambda parameter",
        node: param.node,
        span: param.node?.span,
      },
    })),
    fnResult: sourceForExpr(body, "callback result"),
  };
}

export function sourceForTypedExpr(
  expr: Expr,
  type: Ty,
  provenance: TypeProvenance,
  message = "expression",
): TypeSource {
  return {
    ...sourceForExpr(expr, message),
    type,
    provenance,
  };
}

export function fnSource(params: TypeSource[], result?: TypeSource): TypeSource {
  return { fnParams: params, fnResult: result };
}

export function tupleSource(items: TypeSource[]): TypeSource {
  return { tupleItems: items };
}

function typeCommitmentMismatchMessage(
  error: TypeMismatchError,
  provenance: TypeProvenance,
  reason: FrontendRelatedDiagnostic | undefined,
  options: ConstrainAtOptions,
): string | undefined {
  if (error.boundVariableId === undefined || !error.attemptedSide) return undefined;
  const commitment = provenance.get(error.boundVariableId)?.commitment;
  if (!commitment) return undefined;
  const attempted = error.attemptedSide === "left" ? error.left : error.right;
  const attemptedOrigin = sourceAt(options.sources?.[error.attemptedSide], error.path) ??
    (reason ? relatedAsOrigin(reason) : undefined);
  const existingOrigin = commitment.origin;
  const slot = slotName(error.path);
  const context = options.context?.(error.path);
  const expectedLabel = slot ? `${slot}: ${show(attempted)}` : show(attempted);
  const gotLabel = slot ? `${slot}: ${show(commitment.type)}` : show(commitment.type);
  return [
    context ? `type mismatch in ${context}` : "type mismatch",
    "",
    `expected ${expectedLabel}`,
    formatOrigin(attemptedOrigin),
    "",
    `got      ${gotLabel}`,
    formatOrigin(existingOrigin),
  ].filter((line): line is string => line !== undefined).join("\n");
}

function sourceAt(source: TypeSource | undefined, path: DiffPath): ConstraintOrigin | undefined {
  let current = source;
  let last = current?.origin;
  for (const segment of path) {
    if (!current) break;
    last = current.origin ?? last;
    current = childSource(current, segment);
  }
  return current?.origin ?? last;
}

function childSource(source: TypeSource, segment: DiffPathSegment): TypeSource | undefined {
  switch (segment.kind) {
    case "fn-param":
      return source.fnParams?.[segment.index] ?? childTypeSource(source, segment);
    case "fn-result":
      return source.fnResult ?? childTypeSource(source, segment);
    case "tuple-item":
      return source.tupleItems?.[segment.index] ?? childTypeSource(source, segment);
    case "named-arg":
      return source.namedArgs?.[segment.index] ?? childTypeSource(source, segment);
  }
}

function childTypeSource(source: TypeSource, segment: DiffPathSegment): TypeSource | undefined {
  if (!source.type || !source.provenance) return undefined;
  const type = childType(source.type, segment);
  if (!type) return undefined;
  return {
    type,
    provenance: source.provenance,
    origin: commitmentOriginForType(type, source.provenance),
  };
}

function childType(type: Ty, segment: DiffPathSegment): Ty | undefined {
  const resolved = prune(type);
  switch (segment.kind) {
    case "fn-param":
      return resolved.tag === "fn" ? resolved.params[segment.index] : undefined;
    case "fn-result":
      return resolved.tag === "fn" ? resolved.result : undefined;
    case "tuple-item":
      return resolved.tag === "tuple" ? resolved.items[segment.index] : undefined;
    case "named-arg":
      return resolved.tag === "named" ? resolved.args[segment.index] : undefined;
  }
}

function commitmentOriginForType(
  type: Ty,
  provenance: TypeProvenance,
  seen = new Set<number>(),
): ConstraintOrigin | undefined {
  if (type.tag === "var") {
    if (seen.has(type.id)) return undefined;
    seen.add(type.id);
    return provenance.get(type.id)?.commitment?.origin ??
      (type.instance ? commitmentOriginForType(type.instance, provenance, seen) : undefined);
  }
  if (type.tag === "ffi") {
    return type.instance ? commitmentOriginForType(type.instance, provenance, seen) : undefined;
  }
  return undefined;
}

function slotName(path: DiffPath): string | undefined {
  const named = [...path].reverse().find((segment) => segment.kind === "named-arg");
  if (!named || named.kind !== "named-arg") return undefined;
  return named.label
    ? `${named.typeName} ${named.label}`
    : `${named.typeName} argument ${named.index + 1}`;
}

function formatOrigin(origin: ConstraintOrigin | undefined): string | undefined {
  if (!origin) return undefined;
  const span = origin.span;
  const location = span ? ` at line ${span.line}:${span.col}` : "";
  return `  from ${origin.message}${location}`;
}

function relatedAsOrigin(related: FrontendRelatedDiagnostic): ConstraintOrigin {
  return {
    message: related.message,
    node: related.node,
    span: related.span,
  };
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
    case "FfiGet":
      visit(node.receiver);
      break;
    case "FfiCall":
      visit(node.receiver);
      node.args.forEach(visit);
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
    case "Panic":
      visit(node.message);
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
