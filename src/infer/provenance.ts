import type { Expr, Param } from "../ast.ts";
import {
  anchorFromRelated,
  diagnosticError,
  FrontendDiagnosticError,
  type FrontendRelatedDiagnostic,
} from "../diagnostics.ts";
import {
  type ClaimId,
  createDiagnosticWriter,
  type Failure,
  premiseContext,
  type TypeSnapshotId,
} from "../diagnostic_writer.ts";
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
  premise?: {
    rule: string;
    role: string;
    subject?: string;
    leftRole?: string;
    rightRole?: string;
  };
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
  const writer = createDiagnosticWriter();
  const primary = selectPrimaryCallsite(related, reason);
  const ruleSubject = primary?.message ?? reason?.message ?? "type constraint";
  const constraintId = writer.nextId("c");
  const leftAtIntroduction = writer.snapshotType(left);
  const rightAtIntroduction = writer.snapshotType(right);
  const premise = options.premise;
  const leftClaims = claimsForSource(
    writer,
    options.sources?.left,
    premise?.leftRole ?? "left",
    leftAtIntroduction,
  );
  const rightClaims = claimsForSource(
    writer,
    options.sources?.right,
    premise?.rightRole ?? "right",
    rightAtIntroduction,
  );
  const context = premiseContext(
    premise?.rule ?? "Infer.Constraint.Equal",
    premise?.role ?? ruleSubject,
    premise?.subject ?? ruleSubject,
    primary?.node ?? reason?.node ?? expr?.node,
    { frame: writer.nextId("f"), premise: writer.nextId("p") },
    [
      {
        term: "left",
        role: premise?.leftRole ?? "left",
        snapshot: leftAtIntroduction,
        claim: leftClaims[0],
      },
      {
        term: "right",
        role: premise?.rightRole ?? "right",
        snapshot: rightAtIntroduction,
        claim: rightClaims[0],
      },
    ],
  );
  writer.add({
    kind: "constraint",
    id: constraintId,
    frame: context.frame.id,
    premise: context.premise.id,
    left: leftAtIntroduction,
    right: rightAtIntroduction,
    roles: context.roles,
    origin: context.origin,
  });
  for (const claim of [...leftClaims, ...rightClaims]) {
    if (claim) writer.addEdge({ from: claim, to: constraintId, role: "operand" });
  }
  for (const item of dedupeRelated([...related, ...(reason ? [reason] : [])])) {
    const claimId = writer.nextId("cl");
    writer.add({
      kind: "claim",
      id: claimId,
      claim: { kind: "fact", subject: ruleSubject, text: item.message },
      origin: anchorFromRelated(item),
    });
    writer.addEdge({ from: claimId, to: constraintId, role: "supports" });
  }
  const provenanceBind = provenance && reason
    ? rememberProvenance(provenance, reason, options.sources)
    : undefined;
  try {
    constrain(
      left,
      right,
      (variable, target, path, targetSide) => {
        const substitutionId = writer.nextId("s");
        writer.add({
          kind: "substitution",
          id: substitutionId,
          variable: writer.snapshotType(variable),
          target: writer.snapshotType(target),
          constraint: constraintId,
          path,
        });
        writer.addEdge({ from: constraintId, to: substitutionId, role: "produced" });
        provenanceBind?.(variable, target, path, targetSide);
      },
    );
  } catch (error) {
    const enhanced = provenance && error instanceof TypeMismatchError
      ? typeCommitmentMismatchMessage(error, provenance, reason, options)
      : undefined;
    if (error instanceof TypeMismatchError) {
      const collisionId = writer.nextId("x");
      const commitment = error.boundVariableId === undefined
        ? undefined
        : provenance?.get(error.boundVariableId)?.commitment;
      const attempted = error.attemptedSide === "left" ? error.left : error.right;
      const attemptedOrigin = error.attemptedSide
        ? sourceAt(options.sources?.[error.attemptedSide], error.path)
        : undefined;
      const observedLeft = writer.snapshotType(commitment ? attempted : error.left);
      const observedRight = writer.snapshotType(commitment?.type ?? error.right);
      writer.add({
        kind: "collision",
        id: collisionId,
        constraint: constraintId,
        left: observedLeft,
        right: observedRight,
        path: error.path,
      });
      writer.addEdge({ from: constraintId, to: collisionId, role: "failed" });
      const failure: Failure = {
        frame: context.frame,
        premise: {
          ...context.premise,
          predicate: {
            kind: "equal",
            left: leftAtIntroduction,
            right: rightAtIntroduction,
            domain: "type",
          },
        },
        violation: {
          kind: "contradicted",
          observed: { left: observedLeft, right: observedRight },
          conflictPath: error.path,
          context: options.context?.(error.path),
          origins: {
            expected: attemptedOrigin?.message,
            got: commitment?.origin?.message,
          },
        },
      };
      throw new FrontendDiagnosticError({
        id: writer.nextId("d"),
        code: "type.mismatch",
        severity: "error",
        primary: anchorFromRelated(primary, expr?.node),
        failure,
        support: writer.buildSupport([collisionId]),
        repairs: [],
        dependsOn: [],
      });
    }
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

function claimsForSource(
  writer: ReturnType<typeof createDiagnosticWriter>,
  source: TypeSource | undefined,
  fallbackSubject: string,
  fallbackType: TypeSnapshotId,
): ClaimId[] {
  if (!source) return [];
  const claims: ClaimId[] = [];
  const origin = source?.origin;
  if (origin) {
    const claimId = writer.nextId("cl");
    writer.add({
      kind: "claim",
      id: claimId,
      claim: {
        kind: "has-type",
        subject: origin.message || fallbackSubject,
        type: source.type ? writer.snapshotType(source.type) : fallbackType,
      },
      origin: anchorFromOrigin(origin),
    });
    claims.push(claimId);
  }
  source.fnParams?.forEach((param, index) => {
    claims.push(
      ...claimsForSource(writer, param, `${fallbackSubject} parameter ${index + 1}`, fallbackType),
    );
  });
  if (source.fnResult) {
    claims.push(
      ...claimsForSource(writer, source.fnResult, `${fallbackSubject} result`, fallbackType),
    );
  }
  source.tupleItems?.forEach((item, index) => {
    claims.push(
      ...claimsForSource(writer, item, `${fallbackSubject} item ${index + 1}`, fallbackType),
    );
  });
  source.namedArgs?.forEach((arg, index) => {
    claims.push(
      ...claimsForSource(writer, arg, `${fallbackSubject} argument ${index + 1}`, fallbackType),
    );
  });
  return claims;
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

function anchorFromOrigin(origin: ConstraintOrigin) {
  return origin.span
    ? { kind: "source" as const, span: origin.span }
    : origin.node?.span
    ? { kind: "source" as const, span: origin.node.span }
    : { kind: "generated" as const, label: origin.message };
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
