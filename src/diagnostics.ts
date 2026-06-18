import {
  type AuditableDiagnostic,
  type Claim,
  createDiagnosticWriter,
  type Failure,
  premiseContext,
  type SourceAnchor,
  sourceAnchor,
  type SupportEntry,
} from "./diagnostic_writer.ts";
import type { AstNode, SourceSpan } from "./source.ts";
import { lineStarts } from "./source.ts";
import { formatPathSegment, TypeMismatchError } from "./type_diff.ts";

export type FrontendDiagnostic = AuditableDiagnostic;

export class FrontendDiagnosticError extends Error {
  diagnostic: FrontendDiagnostic;

  constructor(diagnostic: FrontendDiagnostic) {
    super(renderDiagnosticSummary(diagnostic));
    this.name = "FrontendDiagnosticError";
    this.diagnostic = diagnostic;
  }
}

export class FrontendDiagnosticBundleError extends Error {
  primary: unknown;
  diagnostics: FrontendDiagnostic[];

  constructor(primary: unknown, diagnostics: FrontendDiagnostic[]) {
    super(errorMessage(primary));
    this.name = "FrontendDiagnosticBundleError";
    this.primary = primary;
    this.diagnostics = diagnostics;
  }
}

export function diagnosticError(
  error: unknown,
  node: AstNode | undefined,
  code = classifyDiagnostic(errorMessage(error)),
): FrontendDiagnosticError {
  if (error instanceof FrontendDiagnosticError) return error;
  if (error instanceof TypeMismatchError) {
    return new FrontendDiagnosticError(
      typeMismatchDiagnostic(error.left, error.right, error.path, node, code),
    );
  }
  return new FrontendDiagnosticError(
    genericDiagnostic("error", code, errorMessage(error), node),
  );
}

export function warningDiagnostic(
  message: string,
  node: AstNode | undefined,
  code: string,
): FrontendDiagnostic {
  return genericDiagnostic("warning", code, message, node);
}

export function genericDiagnostic(
  severity: "error" | "warning",
  code: string,
  message: string,
  node?: AstNode,
): FrontendDiagnostic {
  const writer = createDiagnosticWriter();
  const context = premiseContext(code, "diagnostic", message, node, {
    frame: writer.nextId("f"),
    premise: writer.nextId("p"),
  });
  const claimId = writer.nextId("cl");
  writer.add({
    kind: "claim",
    id: claimId,
    claim: { kind: "fact", subject: code, text: message },
    origin: context.origin,
  });
  const failure: Failure = {
    frame: context.frame,
    premise: context.premise,
    violation: {
      kind: "unsatisfied",
      message,
    },
  };
  return {
    id: writer.nextId("d"),
    code,
    severity,
    primary: context.origin,
    failure,
    support: writer.buildSupport([claimId]),
    repairs: [],
    dependsOn: [],
  };
}

export function typeMismatchDiagnostic(
  left: import("./types.ts").Ty,
  right: import("./types.ts").Ty,
  path: import("./type_diff.ts").DiffPath,
  node: AstNode | undefined,
  code = "type.mismatch",
): FrontendDiagnostic {
  const writer = createDiagnosticWriter();
  const leftSnapshot = writer.snapshotType(left);
  const rightSnapshot = writer.snapshotType(right);
  const context = premiseContext(code, "types are equal", "type constraint", node, {
    frame: writer.nextId("f"),
    premise: writer.nextId("p"),
  }, [
    { term: "left", role: "expected", snapshot: leftSnapshot },
    { term: "right", role: "actual", snapshot: rightSnapshot },
  ]);
  const constraintId = writer.nextId("c");
  writer.add({
    kind: "constraint",
    id: constraintId,
    frame: context.frame.id,
    premise: context.premise.id,
    left: leftSnapshot,
    right: rightSnapshot,
    roles: context.roles,
    origin: context.origin,
  });
  const collisionId = writer.nextId("x");
  writer.add({
    kind: "collision",
    id: collisionId,
    constraint: constraintId,
    left: leftSnapshot,
    right: rightSnapshot,
    path,
  });
  writer.addEdge({ from: constraintId, to: collisionId, role: "failed" });
  return {
    id: writer.nextId("d"),
    code,
    severity: "error",
    primary: context.origin,
    failure: {
      frame: context.frame,
      premise: {
        ...context.premise,
        predicate: { kind: "equal", left: leftSnapshot, right: rightSnapshot, domain: "type" },
      },
      violation: {
        kind: "contradicted",
        observed: { left: leftSnapshot, right: rightSnapshot },
        conflictPath: path,
      },
    },
    support: writer.buildSupport([collisionId]),
    repairs: [],
    dependsOn: [],
  };
}

export function formatDiagnosticError(
  error: FrontendDiagnosticError,
  filePath: string | undefined,
  source: string | undefined,
): string {
  return formatDiagnostic(error.diagnostic, filePath, source);
}

export function formatDiagnostic(
  diagnostic: FrontendDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string {
  const anchor = diagnostic.primary;
  const location = anchor.kind === "source" && source
    ? `${filePath || "<input>"}:${anchor.span.line}:${anchor.span.col}`
    : filePath || "<input>";
  const lines = [
    `${diagnostic.severity}[${diagnostic.code} ${location}]: ${
      renderDiagnosticSummary(diagnostic)
    }`,
    `rule: ${diagnostic.failure.frame.rule}`,
    `premise: ${renderPremise(diagnostic)}`,
    `violation: ${renderViolation(diagnostic)}`,
  ];
  const support = renderSupport(diagnostic);
  if (support.length > 0) {
    lines.push("support:");
    lines.push(...support.map((line) => `  ${line}`));
  }
  const excerpt = anchor.kind === "source" && source
    ? formatExcerpt(source, anchor.span)
    : undefined;
  if (excerpt) lines.push(excerpt);
  lines.push("raw diagnostic:");
  lines.push(...formatRawDiagnostic(diagnostic).map((line) => `  ${line}`));
  return `${lines.join("\n")}\n`;
}

export function formatError(
  message: string,
  filePath: string | undefined,
  source: string | undefined,
  span: SourceSpan | undefined,
): string {
  return formatDiagnostic(
    genericDiagnostic(
      "error",
      classifyDiagnostic(message),
      message,
      span ? { id: -1, span } : undefined,
    ),
    filePath,
    source,
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyDiagnostic(message: string): string {
  if (message.includes("type mismatch")) return "type.mismatch";
  if (message.includes("unknown import")) return "module.unknown-import";
  if (message.includes("duplicate value import") || message.includes("duplicate type import")) {
    return "module.duplicate-import";
  }
  if (message.includes("cannot resolve import")) return "module.resolve-import";
  if (message.includes("import cycle")) return "module.import-cycle";
  if (message.includes("Expected") || message.includes("expected")) return "parse.syntax-error";
  return "error";
}

export function renderDiagnosticSummary(diagnostic: FrontendDiagnostic): string {
  const violation = diagnostic.failure.violation;
  if (violation.kind === "unsatisfied") return violation.message;
  if (violation.kind === "contradicted") {
    const left = typeSnapshotRendered(diagnostic, violation.observed.left);
    const right = typeSnapshotRendered(diagnostic, violation.observed.right);
    const path = violation.conflictPath.length
      ? violation.conflictPath.map(formatPathSegment).join(" -> ")
      : "type";
    const slot = slotName(violation.conflictPath);
    const expected = slot ? `${slot}: ${left}` : left;
    const got = slot ? `${slot}: ${right}` : right;
    return [
      `type mismatch: ${diagnostic.failure.frame.rule}: ${diagnostic.failure.premise.role}`,
      violation.context ? `  context: ${violation.context}` : undefined,
      `  conflict: ${path}`,
      `  expected: ${expected}`,
      violation.origins?.expected ? `    source: ${violation.origins.expected}` : undefined,
      `  actual:   ${got}`,
      violation.origins?.got ? `    source: ${violation.origins.got}` : undefined,
    ].filter((line): line is string => !!line).join("\n");
  }
  return diagnostic.code;
}

export function renderDiagnosticSummaryWithRaw(diagnostic: FrontendDiagnostic): string {
  return [
    renderDiagnosticSummary(diagnostic),
    "",
    "raw diagnostic:",
    ...formatRawDiagnostic(diagnostic).map((line) => `  ${line}`),
  ].join("\n");
}

export function diagnosticNotes(diagnostic: FrontendDiagnostic): {
  message: string;
  anchor: SourceAnchor;
}[] {
  return diagnostic.support.entries
    .filter((entry) => entry.kind === "claim")
    .map((entry) => ({ message: renderClaim(entry.claim, diagnostic), anchor: entry.origin }));
}

function renderPremise(diagnostic: FrontendDiagnostic): string {
  const predicate = diagnostic.failure.premise.predicate;
  if (predicate.kind === "equal") {
    return `${predicate.left} == ${predicate.right} (${predicate.domain})`;
  }
  return diagnostic.failure.premise.role;
}

function renderViolation(diagnostic: FrontendDiagnostic): string {
  const violation = diagnostic.failure.violation;
  if (violation.kind === "unsatisfied") return violation.message;
  return `${typeSnapshotRendered(diagnostic, violation.observed.left)} != ${
    typeSnapshotRendered(diagnostic, violation.observed.right)
  }`;
}

function renderClaim(claim: Claim, diagnostic: FrontendDiagnostic): string {
  switch (claim.kind) {
    case "has-type":
      return `${claim.subject}: ${typeSnapshotRendered(diagnostic, claim.type)}`;
    case "fact":
      return claim.text;
  }
}

function renderSupport(diagnostic: FrontendDiagnostic): string[] {
  return diagnostic.support.entries.flatMap((entry) => renderSupportEntry(entry, diagnostic));
}

function renderSupportEntry(entry: SupportEntry, diagnostic: FrontendDiagnostic): string[] {
  switch (entry.kind) {
    case "claim":
      return [`${entry.id} claim: ${renderClaim(entry.claim, diagnostic)}`];
    case "constraint": {
      const roles = entry.roles.map((role) =>
        role.claim
          ? `${role.role}=${typeSnapshotRendered(diagnostic, role.snapshot)} via ${role.claim}`
          : `${role.role}=${typeSnapshotRendered(diagnostic, role.snapshot)}`
      ).join(", ");
      return [
        `${entry.id} constraint: ${typeSnapshotRendered(diagnostic, entry.left)} == ${
          typeSnapshotRendered(diagnostic, entry.right)
        }${roles ? ` (${roles})` : ""}`,
      ];
    }
    case "substitution":
      return [
        `${entry.id} substitution: ${typeSnapshotRendered(diagnostic, entry.variable)} := ${
          typeSnapshotRendered(diagnostic, entry.target)
        }`,
      ];
    case "collision":
      return [
        `${entry.id} collision: ${typeSnapshotRendered(diagnostic, entry.left)} != ${
          typeSnapshotRendered(diagnostic, entry.right)
        }`,
      ];
    case "note":
      return [`${entry.id} note: ${entry.message}`];
  }
}

function formatRawDiagnostic(diagnostic: FrontendDiagnostic): string[] {
  return JSON.stringify(diagnostic, null, 2).split("\n");
}

function typeSnapshotRendered(diagnostic: FrontendDiagnostic, id: string): string {
  return diagnostic.support.types.find((snapshot) => snapshot.id === id)?.rendered ?? id;
}

function slotName(path: import("./type_diff.ts").DiffPath): string | undefined {
  const named = [...path].reverse().find((segment) => segment.kind === "named-arg");
  if (!named || named.kind !== "named-arg") return undefined;
  return named.label
    ? `${named.typeName} ${named.label}`
    : `${named.typeName} argument ${named.index + 1}`;
}

function formatExcerpt(source: string, span: SourceSpan): string {
  const starts = lineStarts(source);
  const lineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  const line = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
  const spaces = " ".repeat(span.col);
  const carets = "^".repeat(Math.max(1, span.end - span.start));
  return `  ${line}\n  ${spaces}${carets}`;
}
