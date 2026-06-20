import type { Expr, Param, Pattern } from "../ast.ts";
import { diagnosticError, FrontendDiagnosticError } from "../diagnostics.ts";
import {
  type ClaimId,
  createDiagnosticWriter,
  type Failure,
  premiseContext,
  sourceAnchor,
  type TypeSnapshotId,
} from "../diagnostic_writer.ts";
import type { AstNode, SourceSpan } from "../source.ts";
import { type DiffPath, type DiffPathSegment, TypeMismatchError } from "../type_diff.ts";
import { JsBoundaryError, prune, show, type Ty, type UnifyBind } from "../types.ts";
import { isDecl, resultExpr } from "./ast_utils.ts";
import { constrain } from "./shared.ts";

export type TypeProvenance = Map<number, TypeProvenanceEntry>;

export type TypeProvenanceEntry = {
  origins: EvidenceOrigin[];
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
  note?: string;
};

export type EvidenceOrigin = ConstraintOrigin & {
  primary?: boolean;
  expectedCallTupleShape?: number;
  actualCallTupleShape?: number;
  callDepth?: number;
};

export type TypeSource = {
  origin?: ConstraintOrigin;
  notes?: ConstraintOrigin[];
  type?: Ty;
  provenance?: TypeProvenance;
  fnParams?: TypeSource[];
  fnResult?: TypeSource;
  tupleItems?: TypeSource[];
  namedArgs?: TypeSource[];
};

export type ConstrainAtOptions = {
  sources?: { left?: TypeSource; right?: TypeSource };
  primarySource?: "left" | "right";
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
  expr: Expr | Param | Pattern | undefined,
  message?: () => string,
  origins: EvidenceOrigin[] = [],
  provenance?: TypeProvenance,
  reason?: EvidenceOrigin,
  options: ConstrainAtOptions = {},
) {
  const writer = createDiagnosticWriter();
  const primary = selectPrimaryCallsite(origins, reason);
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
  for (const item of dedupeOrigins([...origins, ...(reason ? [reason] : [])])) {
    const claimId = writer.nextId("cl");
    writer.add({
      kind: "claim",
      id: claimId,
      claim: { kind: "fact", subject: ruleSubject, text: item.message },
      origin: anchorFromOrigin(item),
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
    if (error instanceof TypeMismatchError) {
      const collisionId = writer.nextId("x");
      const commitment = error.boundVariableId === undefined
        ? undefined
        : provenance?.get(error.boundVariableId)?.commitment;
      const attempted = error.attemptedSide === "left" ? error.left : error.right;
      const attemptedOrigin = error.attemptedSide
        ? sourceAt(options.sources?.[error.attemptedSide], error.path)
        : undefined;
      const primaryOrigin = options.primarySource && !isInheritedCallsitePrimary(primary, reason)
        ? sourceAt(options.sources?.[options.primarySource], error.path)
        : undefined;
      const observedLeft = writer.snapshotType(commitment ? attempted : error.left);
      const observedRight = writer.snapshotType(commitment?.type ?? error.right);
      const useSourcePathOrigins = options.primarySource !== undefined;
      const expectedOrigin = attemptedOrigin ??
        (useSourcePathOrigins ? sourceAt(options.sources?.left, error.path) : undefined);
      const actualOrigin = commitment?.origin ??
        (useSourcePathOrigins ? sourceAt(options.sources?.right, error.path) : undefined);
      const expectedClaim = addObservedOriginClaim(writer, expectedOrigin, observedLeft);
      const actualClaim = addObservedOriginClaim(writer, actualOrigin, observedRight);
      writer.add({
        kind: "collision",
        id: collisionId,
        constraint: constraintId,
        left: observedLeft,
        right: observedRight,
        path: error.path,
      });
      if (expectedClaim) writer.addEdge({ from: expectedClaim, to: collisionId, role: "observed" });
      if (actualClaim) writer.addEdge({ from: actualClaim, to: collisionId, role: "observed" });
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
            expected: expectedOrigin?.message,
            got: actualOrigin?.message,
          },
        },
      };
      throw new FrontendDiagnosticError({
        id: writer.nextId("d"),
        code: "type.mismatch",
        severity: "error",
        primary: primaryOrigin
          ? anchorFromOrigin(primaryOrigin)
          : anchorFromEvidence(primary, expr?.node),
        failure,
        support: writer.buildSupport([collisionId]),
        repairs: [],
        dependsOn: [],
      });
    }
    throw diagnosticError(
      message && !(error instanceof JsBoundaryError) ? new Error(message()) : error,
      primary?.node ?? expr?.node,
      undefined,
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
  for (const note of source.notes ?? []) {
    writer.add({
      kind: "note",
      id: writer.nextId("n"),
      message: note.message,
      origin: anchorFromOrigin(note),
    });
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

function addObservedOriginClaim(
  writer: ReturnType<typeof createDiagnosticWriter>,
  origin: ConstraintOrigin | undefined,
  type: TypeSnapshotId,
): ClaimId | undefined {
  if (!origin) return undefined;
  const claimId = writer.nextId("cl");
  writer.add({
    kind: "claim",
    id: claimId,
    claim: { kind: "has-type", subject: origin.message, type },
    origin: anchorFromOrigin(origin),
  });
  if (origin.note) {
    writer.add({
      kind: "note",
      id: writer.nextId("n"),
      message: origin.note,
      origin: anchorFromOrigin(origin),
    });
  }
  return claimId;
}

function selectPrimaryCallsite(
  origins: EvidenceOrigin[],
  reason?: EvidenceOrigin,
): EvidenceOrigin | undefined {
  const all = dedupeOrigins([...origins, ...(reason ? [reason] : [])]);
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
  const inheritedPrimary = origins.find((item) => item.primary);
  return reason?.primary ? reason : inheritedPrimary;
}

function isInheritedCallsitePrimary(
  primary: EvidenceOrigin | undefined,
  reason: EvidenceOrigin | undefined,
): boolean {
  return primary !== undefined && primary !== reason &&
    primary.expectedCallTupleShape !== undefined &&
    primary.actualCallTupleShape !== undefined;
}

export function rememberProvenance(
  provenance: TypeProvenance,
  reason: EvidenceOrigin,
  sources?: { left?: TypeSource; right?: TypeSource },
): UnifyBind {
  return (variable, target, path, targetSide) => {
    const current = provenance.get(variable.id) ?? { origins: [] };
    const origin = sourceAt(sources?.[targetSide], path) ?? originAsConstraint(reason);
    provenance.set(variable.id, {
      origins: dedupeOrigins([...current.origins, reason]),
      commitment: { type: target, origin },
    });
  };
}

export function provenanceFor(
  expr: Expr,
  types: Map<Expr, Ty>,
  provenance: TypeProvenance,
): EvidenceOrigin[] {
  const type = types.get(expr);
  return type ? provenanceForType(type, provenance) : [];
}

export function provenanceForType(
  type: Ty,
  provenance: TypeProvenance,
): EvidenceOrigin[] {
  return dedupeOrigins(collectProvenance(type, provenance));
}

export function dedupeOrigins(
  items: EvidenceOrigin[],
): EvidenceOrigin[] {
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
): { expr: Expr; origin: EvidenceOrigin }[] {
  const target = show(resultType);
  const evidence: { expr: Expr; origin: EvidenceOrigin }[] = [];
  const visit = (node: Expr) => {
    if (
      node.kind === "Call" && node.callee.kind === "Var" && node.callee.name === name &&
      types.has(node) && show(types.get(node)!) === target
    ) {
      evidence.push({
        expr: node,
        origin: {
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
): EvidenceOrigin[] {
  const target = show(type);
  const evidence: EvidenceOrigin[] = [];
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
  return dedupeOrigins(evidence);
}

function collectProvenance(
  type: Ty,
  provenance: TypeProvenance,
  seen = new Set<number>(),
): EvidenceOrigin[] {
  if (type.tag === "var") {
    if (seen.has(type.id)) return [];
    seen.add(type.id);
    const local = provenance.get(type.id)?.origins ?? [];
    return dedupeOrigins([
      ...local,
      ...(type.instance ? collectProvenance(type.instance, provenance, seen) : []),
    ]);
  }
  if (type.tag === "fn") {
    return dedupeOrigins([
      ...type.params.flatMap((param) => collectProvenance(param, provenance, seen)),
      ...collectProvenance(type.result, provenance, seen),
    ]);
  }
  if (type.tag === "tuple") {
    return dedupeOrigins(type.items.flatMap((item) => collectProvenance(item, provenance, seen)));
  }
  if (type.tag === "struct") {
    return dedupeOrigins(
      type.fields.flatMap((field) => collectProvenance(field.type, provenance, seen)),
    );
  }
  if (type.tag === "named") {
    return dedupeOrigins(type.args.flatMap((arg) => collectProvenance(arg, provenance, seen)));
  }
  return [];
}

export function sourceForExpr(expr: Expr, message = "expression"): TypeSource {
  const implicitStatement = expr.kind === "Void" ? expr.implicitStatement : undefined;
  const implicitTerminatorSpan = expr.kind === "Void" ? expr.implicitTerminatorSpan : undefined;
  const origin = {
    message,
    node: implicitStatement?.node ?? expr.node,
    span: implicitTerminatorSpan ?? implicitStatement?.node?.span ?? expr.node?.span,
  };
  const notes = implicitStatement
    ? [{
      message: "this trailing `;` makes the block result Void",
      node: implicitStatement.node,
      span: implicitTerminatorSpan ?? implicitStatement.node?.span,
    }]
    : undefined;
  if (expr.kind === "Void") return { origin, notes };
  if (expr.kind !== "Lambda") return { origin };
  const body = resultExpr(expr.body);
  return {
    origin,
    notes,
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

function sourceAt(source: TypeSource | undefined, path: DiffPath): ConstraintOrigin | undefined {
  let current = source;
  let last = current?.origin;
  let lastNote = current?.notes?.[0]?.message;
  for (const segment of path) {
    if (!current) break;
    last = current.origin ?? last;
    lastNote = current.notes?.[0]?.message ?? lastNote;
    current = childSource(current, segment);
  }
  const origin = current?.origin ?? last;
  const note = current?.notes?.[0]?.message ?? lastNote;
  return origin && note ? { ...origin, note } : origin;
}

function childSource(source: TypeSource, segment: DiffPathSegment): TypeSource | undefined {
  switch (segment.kind) {
    case "fn-param":
      return source.fnParams?.[segment.index] ?? childTypeSource(source, segment);
    case "fn-result":
      return source.fnResult ?? childTypeSource(source, segment);
    case "tuple-item":
      return source.tupleItems?.[segment.index] ?? childTypeSource(source, segment);
    case "record-field":
      return childTypeSource(source, segment);
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
    case "record-field":
      return resolved.tag === "struct"
        ? resolved.fields.find((field) => field.name === segment.name)?.type
        : undefined;
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

function originAsConstraint(origin: EvidenceOrigin): ConstraintOrigin {
  return {
    message: origin.message,
    node: origin.node,
    span: origin.span,
  };
}

function anchorFromEvidence(evidence: EvidenceOrigin | undefined, fallback?: AstNode) {
  return evidence?.span
    ? { kind: "source" as const, span: evidence.span }
    : sourceAnchor(evidence?.node ?? fallback);
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
    case "FfiBindingCall":
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
