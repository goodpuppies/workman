import type { AuditableDiagnostic, SourceAnchor, SupportEntry } from "../diagnostic_writer.ts";
import { librarySources } from "../generated/assets.ts";

type ClaimEntry = Extract<SupportEntry, { kind: "claim" }>;

export function returnAnnotationAnchors(diagnostic: AuditableDiagnostic): SourceAnchor[] {
  if (diagnostic.failure.frame.rule !== "InferAnnotation.ReturnMatchesAnnotation") {
    return [diagnostic.primary];
  }
  const constraint = diagnostic.support.entries.find((entry) =>
    entry.kind === "constraint" && entry.frame === diagnostic.failure.frame.id
  );
  const annotationId = constraint?.kind === "constraint"
    ? constraint.roles.find((role) => role.term === "right")?.claim
    : undefined;
  const annotation = diagnostic.support.entries.find((entry) =>
    entry.kind === "claim" && entry.id === annotationId
  );
  return annotation?.kind === "claim"
    ? [diagnostic.primary, annotation.origin]
    : [diagnostic.primary];
}

/** The pipe boundary and both sides of its conflict remain equally actionable. */
export function pipeConflictAnchors(diagnostic: AuditableDiagnostic): SourceAnchor[] {
  const violation = diagnostic.failure.violation;
  if (diagnostic.code !== "type.pipe-input-mismatch" || violation.kind !== "contradicted") {
    return [diagnostic.primary];
  }
  const constraint = diagnostic.support.entries.find((entry) =>
    entry.kind === "constraint" && entry.frame === diagnostic.failure.frame.id
  );
  const claims = new Map(
    diagnostic.support.entries.filter((entry): entry is ClaimEntry => entry.kind === "claim")
      .map((entry) => [entry.id, entry]),
  );
  const callee = constraint?.kind === "constraint"
    ? claims.get(constraint.roles.find((role) => role.term === "left")?.claim ?? "")
    : undefined;
  // The compact pipe renderer heads direct input collisions at the consuming stage.
  // Explicit arguments already have a more specific primary anchor.
  const path = violation.conflictPath;
  const explicitArgument = path[0]?.kind === "fn-param" && path[1]?.kind === "tuple-item" &&
    path[1].index > 0;
  const payloadReturn = [...claims.values()].some((claim) =>
    claim.claim.kind === "has-type" && claim.claim.subject === "returned constructor payload"
  );
  const nonCallable = constraint?.kind === "constraint" && path.length === 0 &&
    diagnostic.support.types.find((type) => type.id === constraint.left)?.shape.kind !== "function";
  const head = !explicitArgument && !payloadReturn && (path[0]?.kind === "fn-param" || nonCallable)
    ? callee?.origin ?? diagnostic.primary
    : diagnostic.primary;
  if (nonCallable && constraint?.kind === "constraint") {
    const input = [...claims.values()].find((claim) =>
      claim.claim.kind === "has-type" && claim.claim.subject === "piped value"
    );
    return [
      head,
      ...[callee, input].flatMap((claim) => {
        const origin = authoredOrigin(diagnostic, claim);
        return origin ? [origin.origin] : [];
      }),
    ];
  }
  const collision = diagnostic.support.entries.find((entry) =>
    entry.kind === "collision" && entry.constraint === constraint?.id
  );
  const origins = diagnostic.support.edges.filter((edge) =>
    edge.to === collision?.id && edge.role === "observed"
  ).flatMap((edge) => {
    const origin = authoredOrigin(diagnostic, claims.get(edge.from));
    return origin ? [origin.origin] : [];
  });
  return [head, ...origins];
}

/** Library implementation nodes are transparent, not endpoints, in an authored explanation. */
export function authoredOrigin(
  diagnostic: AuditableDiagnostic,
  claim: ClaimEntry | undefined,
): ClaimEntry | undefined {
  if (!claim) return undefined;
  const claims = new Map(
    diagnostic.support.entries.filter((entry): entry is ClaimEntry => entry.kind === "claim")
      .map((entry) => [entry.id, entry]),
  );
  const parents = new Map<string, string[]>();
  for (const edge of diagnostic.support.edges) {
    if (edge.role !== "derived") continue;
    const entries = parents.get(edge.to) ?? [];
    entries.push(edge.from);
    parents.set(edge.to, entries);
  }
  type Candidate = { claim: ClaimEntry; distance: number };
  const visit = (current: ClaimEntry, seen: Set<string>): Candidate | undefined => {
    if (seen.has(current.id)) return undefined;
    const next = new Set(seen).add(current.id);
    // Search every branch: the longest raw path may contain only library internals,
    // while another branch leads through a library callback to a user's definition.
    const candidates = (parents.get(current.id) ?? []).flatMap((id) => {
      const parent = claims.get(id);
      const candidate = parent && visit(parent, next);
      return candidate ? [{ ...candidate, distance: candidate.distance + 1 }] : [];
    });
    if (candidates.length) return candidates.sort((a, b) => b.distance - a.distance)[0];
    if (current.origin.kind !== "source") return undefined;
    const path = current.origin.filePath;
    const librarySource = path === undefined ? undefined : librarySources[path];
    const recordedSource = diagnostic.support.sources?.find((source) => source.filePath === path);
    // Match bundled module identities, not arbitrary user directories named std or basis.
    if (
      librarySource !== undefined && (!recordedSource || recordedSource.source === librarySource)
    ) {
      return undefined;
    }
    return { claim: current, distance: 0 };
  };
  return visit(claim, new Set())?.claim;
}
