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
import { JsBoundaryError, prune, type Scheme, show, type Ty, type UnifyBind } from "../types.ts";
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
  source?: TypeSource;
};

export type ConstraintOrigin = {
  message: string;
  node?: AstNode;
  span?: SourceSpan;
  note?: string;
  derivedFrom?: ConstraintOrigin[];
  filePath?: string;
  source?: string;
};

export type EvidenceOrigin = ConstraintOrigin & {
  primary?: boolean;
  expectedCallTupleShape?: number;
  actualCallTupleShape?: number;
  callDepth?: number;
};

export type TypeSource = {
  origin?: ConstraintOrigin;
  definition?: ConstraintOrigin;
  notes?: ConstraintOrigin[];
  type?: Ty;
  provenance?: TypeProvenance;
  fnParams?: TypeSource[];
  fnResult?: TypeSource;
  tupleItems?: TypeSource[];
  namedArgs?: TypeSource[];
  derivedFrom?: TypeSource[];
  related?: TypeSource[];
  document?: { filePath: string; source: string };
};

const expressionSources = new WeakMap<Expr, TypeSource>();
const schemeSources = new WeakMap<Scheme, TypeSource>();

export function rememberSchemeSourceDocument(
  scheme: Scheme,
  filePath: string,
  source: string,
): void {
  const existing = schemeSources.get(scheme);
  if (!existing) return;
  schemeSources.set(
    scheme,
    mapSourceOrigins(
      existing,
      (origin) => ({ ...origin, filePath, source }),
      new WeakMap(),
      { filePath, source },
    ),
  );
}

export function inheritSchemeSource(source: Scheme, target: Scheme): void {
  const existing = schemeSources.get(source);
  if (existing) schemeSources.set(target, existing);
}

function mapSourceOrigins(
  source: TypeSource,
  map: (origin: ConstraintOrigin) => ConstraintOrigin,
  seen = new WeakMap<TypeSource, TypeSource>(),
  document = source.document,
): TypeSource {
  const previous = seen.get(source);
  if (previous) return previous;
  const mapped: TypeSource = {};
  seen.set(source, mapped);
  Object.assign(mapped, source, {
    document,
    origin: source.origin ? map(source.origin) : undefined,
    definition: source.definition ? map(source.definition) : undefined,
    notes: source.notes?.map(map),
    fnParams: source.fnParams?.map((item) => mapSourceOrigins(item, map, seen, document)),
    fnResult: source.fnResult ? mapSourceOrigins(source.fnResult, map, seen, document) : undefined,
    tupleItems: source.tupleItems?.map((item) => mapSourceOrigins(item, map, seen, document)),
    namedArgs: source.namedArgs?.map((item) => mapSourceOrigins(item, map, seen, document)),
    derivedFrom: source.derivedFrom?.map((item) => mapSourceOrigins(item, map, seen, document)),
    related: source.related?.map((item) => mapSourceOrigins(item, map, seen, document)),
  });
  return mapped;
}

export type ConstrainAtOptions = {
  sources?: { left?: TypeSource; right?: TypeSource };
  primarySource?: "left" | "right";
  context?: (path: DiffPath) => string | undefined;
  premise?: {
    code?: string;
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
      const observedLeft = writer.snapshotType(commitment ? attempted : error.left);
      const observedRight = writer.snapshotType(commitment?.type ?? error.right);
      const useSourcePathOrigins = options.primarySource !== undefined;
      const leftOrigin = attemptedOrigin ??
        (useSourcePathOrigins ? sourceAt(options.sources?.left, error.path) : undefined);
      const rightOrigin = commitment?.origin ??
        (useSourcePathOrigins ? sourceAt(options.sources?.right, error.path) : undefined);
      const primaryOrigin = options.primarySource && !isInheritedCallsitePrimary(primary, reason)
        ? primaryOriginForSource(options.sources?.[options.primarySource], error.path)
        : undefined;
      const leftClaim = addObservedOriginClaim(writer, leftOrigin, observedLeft);
      const rightClaim = addObservedOriginClaim(writer, rightOrigin, observedRight);
      writer.add({
        kind: "collision",
        id: collisionId,
        constraint: constraintId,
        left: observedLeft,
        right: observedRight,
        path: error.path,
      });
      if (leftClaim) writer.addEdge({ from: leftClaim, to: collisionId, role: "observed" });
      if (rightClaim) writer.addEdge({ from: rightClaim, to: collisionId, role: "observed" });
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
            left: leftOrigin?.message,
            right: rightOrigin?.message,
          },
        },
      };
      throw new FrontendDiagnosticError({
        id: writer.nextId("d"),
        code: premise?.code ?? "type.mismatch",
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
    registerOriginSource(writer, origin);
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
    registerOriginSource(writer, note);
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
  for (const related of source.related ?? []) {
    claims.push(...claimsForSource(writer, related, fallbackSubject, fallbackType));
  }
  return claims;
}

function addObservedOriginClaim(
  writer: ReturnType<typeof createDiagnosticWriter>,
  origin: ConstraintOrigin | undefined,
  type: TypeSnapshotId,
): ClaimId | undefined {
  if (!origin) return undefined;
  registerOriginSource(writer, origin);
  const derivedClaims = (origin.derivedFrom ?? [])
    .map((derived) => addObservedOriginClaim(writer, derived, type))
    .filter((claim): claim is ClaimId => !!claim);
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
  for (const derived of derivedClaims) {
    writer.addEdge({ from: derived, to: claimId, role: "derived" });
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
    if (reason?.primary) return reason;
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
      commitment: { type: target, origin, source: sources?.[targetSide] },
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
    const key = `${item.filePath ?? ""}:${item.message}:${span?.start ?? -1}:${span?.end ?? -1}`;
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
  const params = expr.params.map((param) => patternSource(param.pattern));
  return {
    origin,
    notes,
    fnParams: params.length === 0 ? [] : [params.length === 1 ? params[0] : tupleSource(params)],
    fnResult: sourceForExpr(body, "callback result"),
  };
}

export function sourceForTypedExpr(
  expr: Expr,
  type: Ty,
  provenance: TypeProvenance,
  message = "expression",
): TypeSource {
  const inferred = expressionSources.get(expr);
  if (inferred) {
    return {
      ...inferred,
      origin: sourceForExpr(expr, message).origin,
      type,
      provenance,
      derivedFrom: [inferred, ...(inferred.derivedFrom ?? [])],
    };
  }
  return {
    ...sourceForExpr(expr, message),
    type,
    provenance,
  };
}

export function rememberVariableSource(
  expr: Extract<Expr, { kind: "Var" }>,
  type: Ty,
  scheme: Scheme,
  provenance: TypeProvenance,
): void {
  const definition = schemeSources.get(scheme);
  expressionSources.set(expr, {
    ...(definition ?? sourceForExpr(expr, expr.name)),
    origin: sourceForExpr(expr, expr.name).origin,
    type,
    provenance,
    derivedFrom: definition ? [definition] : undefined,
  });
}

export function rememberSchemeSource(
  scheme: Scheme,
  value: Expr,
  type: Ty,
  provenance: TypeProvenance,
): void {
  const inferred = expressionSources.get(value) ?? sourceForTypedExpr(
    value,
    type,
    provenance,
    "binding value",
  );
  schemeSources.set(scheme, {
    ...inferred,
    definition: scheme.node?.span
      ? { message: "function definition", node: scheme.node, span: scheme.node.span }
      : inferred.origin,
    type,
    provenance,
  });
}

export function rememberExpressionSource(
  expr: Expr,
  type: Ty,
  provenance: TypeProvenance,
): void {
  if (expressionSources.has(expr)) return;
  const base: TypeSource = {
    ...sourceForExpr(expr, expressionSourceMessage(expr)),
    type,
    provenance,
  };
  switch (expr.kind) {
    case "Block": {
      const result = expressionSources.get(expr.result);
      expressionSources.set(expr, {
        ...base,
        derivedFrom: result ? [result] : undefined,
      });
      return;
    }
    case "Call": {
      const callee = expressionSources.get(expr.callee);
      expressionSources.set(expr, {
        ...base,
        derivedFrom: callee?.fnResult ? [callee.fnResult] : undefined,
      });
      return;
    }
    case "Lambda": {
      const resolved = prune(type);
      const parameterType = resolved.tag === "fn" ? resolved.params[0] : undefined;
      const resolvedParameter = parameterType ? prune(parameterType) : undefined;
      const parameterItems = expr.params.length > 1 && resolvedParameter?.tag === "tuple"
        ? resolvedParameter.items
        : parameterType
        ? [parameterType]
        : [];
      const parameterSources = expr.params.map((param, index) =>
        patternSource(param.pattern, parameterItems[index], provenance)
      );
      const body = expressionSources.get(resultExpr(expr.body));
      expressionSources.set(expr, {
        ...base,
        fnParams: parameterSources.length === 0
          ? []
          : [parameterSources.length === 1 ? parameterSources[0] : tupleSource(parameterSources)],
        fnResult: body ?? sourceForExpr(resultExpr(expr.body), "callback result"),
      });
      return;
    }
    default:
      expressionSources.set(expr, base);
  }
}

function expressionSourceMessage(expr: Expr): string {
  switch (expr.kind) {
    case "Void":
      return expr.implicitStatement ? "block result" : "empty block result";
    case "Record":
      return "record literal";
    case "Block":
      return "block result";
    case "Call":
      return expr.callee.kind === "Var" ? `${expr.callee.name} call result` : "call result";
    case "Match":
      return "match result";
    case "Lambda":
      return "function";
    default:
      return "expression";
  }
}

export function fnSource(params: TypeSource[], result?: TypeSource): TypeSource {
  return { fnParams: params, fnResult: result };
}

export function tupleSource(items: TypeSource[]): TypeSource {
  return { tupleItems: items };
}

function typedSource(
  origin: ConstraintOrigin,
  type: Ty | undefined,
  provenance: TypeProvenance,
): TypeSource {
  if (!type) return { origin };
  const commitment = commitmentOriginForType(type, provenance) ??
    provenanceForType(type, provenance).at(-1);
  return {
    origin,
    type,
    provenance,
    derivedFrom: commitment ? [{ origin: commitment, type, provenance }] : undefined,
  };
}

function patternSource(
  pattern: Pattern,
  type?: Ty,
  provenance?: TypeProvenance,
): TypeSource {
  const origin: ConstraintOrigin = {
    message: pattern.kind === "PVar" ? `parameter ${pattern.name}` : "lambda parameter",
    node: pattern.node,
    span: pattern.node?.span,
  };
  const resolved = type ? prune(type) : undefined;
  if (pattern.kind === "PTuple") {
    const itemTypes = resolved?.tag === "tuple" ? resolved.items : [];
    return {
      origin,
      type,
      provenance,
      tupleItems: pattern.items.map((item, index) =>
        patternSource(item, itemTypes[index], provenance)
      ),
    };
  }
  if (pattern.kind === "PAscribed") {
    return {
      ...patternSource(pattern.pattern, type, provenance),
      origin,
    };
  }
  return provenance ? typedSource(origin, type, provenance) : { origin };
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
  const origin = originForSource(current) ?? last;
  const note = current?.notes?.[0]?.message ?? lastNote;
  return origin && note ? { ...origin, note } : origin;
}

function primaryOriginForSource(
  source: TypeSource | undefined,
  path: DiffPath,
): ConstraintOrigin | undefined {
  let current = source;
  let functionDefinition: ConstraintOrigin | undefined;
  // A unary call source is the argument expression itself. Keep the call expression as the
  // primary collision site; only descend when a packed multi-argument tuple identifies one slot.
  if (current?.origin) return undefined;
  for (const [index, segment] of path.entries()) {
    current = current ? childSource(current, segment) : undefined;
    if (current?.origin) {
      const resolved = current.type ? prune(current.type) : undefined;
      const entersFunction = resolved?.tag === "fn" &&
        path.slice(index + 1).some((part) => part.kind === "fn-param" || part.kind === "fn-result");
      if (entersFunction) {
        functionDefinition = current.definition ?? current.origin;
        continue;
      }
      return current.origin;
    }
  }
  return functionDefinition;
}

function originForSource(source: TypeSource | undefined): ConstraintOrigin | undefined {
  if (!source) return undefined;
  const origin = source.origin && source.document
    ? { ...source.origin, ...source.document }
    : source.origin;
  const derivedFrom = (source.derivedFrom ?? [])
    .map((derived) => originForSource(inheritSourceDocument(source, derived)))
    .filter((item): item is ConstraintOrigin => !!item);
  if (!origin) return derivedFrom[0];
  return derivedFrom.length > 0 ? { ...origin, derivedFrom } : origin;
}

function childSource(source: TypeSource, segment: DiffPathSegment): TypeSource | undefined {
  const committedSource = source.type?.tag === "var" && source.provenance
    ? source.provenance.get(source.type.id)?.commitment?.source
    : undefined;
  const committedChild = committedSource ? childSource(committedSource, segment) : undefined;
  if (committedChild) {
    return source.document && !committedChild.document
      ? { ...committedChild, document: source.document }
      : committedChild;
  }
  switch (segment.kind) {
    case "fn-param":
      return inheritSourceDocument(
        source,
        source.fnParams?.[segment.index] ?? childTypeSource(source, segment),
      );
    case "fn-result":
      return inheritSourceDocument(source, source.fnResult ?? childTypeSource(source, segment));
    case "tuple-item":
      return inheritSourceDocument(
        source,
        source.tupleItems?.[segment.index] ?? childTypeSource(source, segment),
      );
    case "record-field":
      return inheritSourceDocument(source, childTypeSource(source, segment));
    case "named-arg":
      return inheritSourceDocument(
        source,
        source.namedArgs?.[segment.index] ?? childTypeSource(source, segment),
      );
  }
}

function inheritSourceDocument(
  parent: TypeSource,
  child: TypeSource | undefined,
): TypeSource | undefined {
  return child && parent.document && !child.document
    ? { ...child, document: parent.document }
    : child;
}

function childTypeSource(source: TypeSource, segment: DiffPathSegment): TypeSource | undefined {
  if (!source.type || !source.provenance) return undefined;
  const type = childType(source.type, segment);
  if (!type) return undefined;
  return {
    type,
    provenance: source.provenance,
    // A structural child such as the first parameter of an inferred callback may not contain a
    // type variable of its own. In that case its shape still came from the parent variable's
    // commitment (for example `render(None, ...)` committing a callback parameter to Option).
    origin: commitmentOriginForType(type, source.provenance) ??
      source.derivedFrom?.map(originForSource).find((origin) => !!origin),
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
    const commitment = provenance.get(type.id)?.commitment;
    const downstream = commitment?.type
      ? commitmentOriginForType(commitment.type, provenance, seen)
      : type.instance
      ? commitmentOriginForType(type.instance, provenance, seen)
      : undefined;
    if (!commitment?.origin) return downstream;
    return downstream ? { ...commitment.origin, derivedFrom: [downstream] } : commitment.origin;
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
    filePath: origin.filePath,
    source: origin.source,
  };
}

function anchorFromEvidence(evidence: EvidenceOrigin | undefined, fallback?: AstNode) {
  return evidence?.span
    ? { kind: "source" as const, span: evidence.span }
    : sourceAnchor(evidence?.node ?? fallback);
}

function anchorFromOrigin(origin: ConstraintOrigin) {
  return origin.span
    ? { kind: "source" as const, span: origin.span, filePath: origin.filePath }
    : origin.node?.span
    ? { kind: "source" as const, span: origin.node.span, filePath: origin.filePath }
    : { kind: "generated" as const, label: origin.message };
}

function registerOriginSource(
  writer: ReturnType<typeof createDiagnosticWriter>,
  origin: ConstraintOrigin,
): void {
  if (origin.filePath && origin.source !== undefined) {
    writer.addSource(origin.filePath, origin.source);
  }
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
