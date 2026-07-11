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
import { formatEnhancedDiagnostic } from "./enhanced_diagnostic_renderer.ts";
import { displayTypeVariables } from "./diagnostic_type_display.ts";
import { formatPathSegment, TypeMismatchError } from "./type_diff.ts";
import {
  renderPredicate as renderDiagnosticPredicate,
  renderRecoveryEntry,
  renderRepair,
  renderViolation,
} from "./diagnostic_syntax_renderer.ts";

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

export function missingEntrypointDiagnostic(): FrontendDiagnostic {
  const writer = createDiagnosticWriter();
  const origin: SourceAnchor = { kind: "generated", label: "entry module" };
  const frame = {
    id: writer.nextId("f"),
    rule: "Run.EntryPoint",
    subject: "entry module",
    anchor: origin,
    path: ["Run", "EntryPoint"],
  };
  const premise = {
    id: writer.nextId("p"),
    role: "a main function is declared",
    predicate: { kind: "present" as const, subject: "main", syntaxCategory: "function" },
    origin,
  };
  const claimId = writer.nextId("cl");
  writer.add({
    kind: "claim",
    id: claimId,
    claim: { kind: "fact", subject: "entry module", text: "no top-level binding named `main`" },
    origin,
  });
  return {
    id: writer.nextId("d"),
    code: "run.missing-entrypoint",
    severity: "error",
    primary: origin,
    failure: {
      frame,
      premise,
      violation: { kind: "missing", observedBoundary: "end of entry module" },
    },
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
  const enhanced = formatEnhancedDiagnostic(diagnostic, filePath, source);
  if (enhanced) return enhanced;

  return formatDiagnosticEvidence(diagnostic, filePath, source);
}

export function formatDiagnosticEvidence(
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
      renderDiagnosticHeadline(diagnostic)
    }`,
    ...renderCollision(diagnostic, filePath, source),
    ...renderTypeTrace(diagnostic, filePath, source),
    `rule: ${diagnostic.failure.frame.rule}`,
    `premise: ${renderPremise(diagnostic)}`,
  ];
  const support = renderSupport(diagnostic, filePath, source);
  if (support.length > 0) {
    lines.push("support:");
    lines.push(...support.map((line) => `  ${line}`));
  }
  if (diagnostic.repairs.length > 0) {
    lines.push("repairs:", ...diagnostic.repairs.map((repair) => `  ${renderRepair(repair)}`));
  }
  const excerpt = anchor.kind === "source" && source
    ? formatExcerpt(source, anchor.span)
    : undefined;
  if (excerpt) lines.push(excerpt);
  return `${lines.join("\n")}\n`;
}

export function formatDiagnosticInspection(
  diagnostic: FrontendDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string {
  const explain = formatEnhancedDiagnostic(diagnostic, filePath, source, { mode: "explain" });
  const trace = formatEnhancedDiagnostic(diagnostic, filePath, source, { mode: "trace" });
  return [
    "* authored diagnostic:",
    formatDiagnostic(diagnostic, filePath, source).trimEnd(),
    "* low-level diagnostic:",
    formatDiagnosticEvidence(diagnostic, filePath, source).trimEnd(),
    ...(explain ? ["* failed-premise view:", withoutRendererHeader(explain)] : []),
    ...(trace ? ["* compiler trace:", withoutRendererHeader(trace)] : []),
  ].join("\n\n");
}

function withoutRendererHeader(rendered: string): string {
  return rendered.replace(/^-- [^\n]+\n\n/, "").trimEnd();
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
  if (violation.kind !== "contradicted") return renderViolation(violation);
  const left = typeSnapshotRendered(diagnostic, violation.observed.left);
  const right = typeSnapshotRendered(diagnostic, violation.observed.right);
  const path = violation.conflictPath.length
    ? violation.conflictPath.map(formatPathSegment).join(" -> ")
    : "type";
  return [
    `type mismatch: ${diagnostic.failure.frame.rule}: ${diagnostic.failure.premise.role}`,
    violation.context ? `  context: ${violation.context}` : undefined,
    `  conflict: ${path}`,
    `  expected: ${left}`,
    violation.origins?.expected ? `    source: ${violation.origins.expected}` : undefined,
    `  actual:   ${right}`,
    violation.origins?.got ? `    source: ${violation.origins.got}` : undefined,
  ].filter((line): line is string => !!line).join("\n");
}

function renderDiagnosticHeadline(diagnostic: FrontendDiagnostic): string {
  return renderViolation(diagnostic.failure.violation);
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
  return renderDiagnosticPredicate(diagnostic.failure.premise.predicate);
}

function renderCollision(
  diagnostic: FrontendDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  const violation = diagnostic.failure.violation;
  if (violation.kind !== "contradicted") return [`violation: ${renderViolation(violation)}`];

  const left = typeSnapshotRendered(diagnostic, violation.observed.left);
  const right = typeSnapshotRendered(diagnostic, violation.observed.right);
  const slot = collisionSlot(violation.conflictPath);
  const parameter = collisionParameter(violation.conflictPath);

  return [
    "collision:",
    violation.context ? `  context: ${violation.context}` : undefined,
    slot ? `  slot: ${slot}` : undefined,
    parameter ? `  ${parameter} is:` : undefined,
    `    expected: ${left}`,
    ...renderNamedSourceReference(
      diagnostic,
      violation.origins?.expected,
      filePath,
      source,
      "      ",
    ),
    `    actual:   ${right}`,
    ...renderNamedSourceReference(diagnostic, violation.origins?.got, filePath, source, "      "),
  ].filter((line): line is string => !!line);
}

function renderTypeTrace(
  diagnostic: FrontendDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  const violation = diagnostic.failure.violation;
  if (violation.kind !== "contradicted") return [];
  const slot = collisionSlot(violation.conflictPath);
  const steps = [
    ...traceStep(diagnostic, violation.origins?.expected, filePath, source),
    ...traceStep(diagnostic, violation.origins?.got, filePath, source),
    ...(slot ? [`  ${slot}`] : []),
  ];
  return steps.length ? ["typetrace:", ...steps] : [];
}

function traceStep(
  diagnostic: FrontendDiagnostic,
  label: string | undefined,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  if (!label) return [];
  const entry = diagnostic.support.entries.find((item) =>
    item.kind === "claim" && item.claim.subject === label
  );
  if (!entry || entry.kind !== "claim") return [`  ${label}`];
  return [
    `  ${label}`,
    ...renderSupportOrigin(entry.origin, filePath, source).map((line) => `    ${line.trim()}`),
  ];
}

function renderClaim(claim: Claim, diagnostic: FrontendDiagnostic): string {
  switch (claim.kind) {
    case "has-type":
      return `${claim.subject}: ${typeSnapshotRendered(diagnostic, claim.type)}`;
    case "fact":
      return displayTypeVariables(claim.text);
  }
}

function renderSupport(
  diagnostic: FrontendDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  return supportEntriesInRenderOrder(diagnostic).flatMap((entry) =>
    renderSupportEntry(entry, diagnostic, filePath, source)
  );
}

function supportEntriesInRenderOrder(diagnostic: FrontendDiagnostic): SupportEntry[] {
  const roots = new Set(diagnostic.support.roots);
  return [
    ...diagnostic.support.entries.filter((entry) => roots.has(entry.id)),
    ...diagnostic.support.entries.filter((entry) => !roots.has(entry.id)),
  ];
}

function renderSupportEntry(
  entry: SupportEntry,
  diagnostic: FrontendDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  switch (entry.kind) {
    case "claim":
      return [
        `${entry.id} claim: ${renderClaim(entry.claim, diagnostic)}`,
        ...renderSupportOrigin(entry.origin, filePath, source),
      ];
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
        ...renderSupportOrigin(entry.origin, filePath, source),
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
      return [
        `${entry.id} note: ${entry.message}`,
        ...renderSupportOrigin(entry.origin, filePath, source),
      ];
    case "recovery":
      return [
        renderRecoveryEntry(entry),
        ...renderSupportOrigin(entry.anchor, filePath, source),
      ];
  }
}

function typeSnapshotRendered(diagnostic: FrontendDiagnostic, id: string): string {
  return displayTypeVariables(
    diagnostic.support.types.find((snapshot) => snapshot.id === id)?.rendered ?? id,
  );
}

function collisionSlot(path: import("./type_diff.ts").DiffPath): string | undefined {
  const named = [...path].reverse().find((segment) => segment.kind === "named-arg");
  if (named?.kind === "named-arg") {
    return `${named.typeName}<${typeArgumentSlots(named.index, named.label).join(", ")}>`;
  }
  return path.length ? path.map(formatPathSegment).join(" -> ") : undefined;
}

function collisionParameter(path: import("./type_diff.ts").DiffPath): string | undefined {
  const named = [...path].reverse().find((segment) => segment.kind === "named-arg");
  if (named?.kind !== "named-arg") return undefined;
  return named.label ?? `argument ${named.index + 1}`;
}

function typeArgumentSlots(index: number, label: string | undefined): string[] {
  const slots = Array.from({ length: index + 1 }, () => "_");
  slots[index] = label ?? `arg${index + 1}`;
  return slots;
}

function renderSupportOrigin(
  anchor: SourceAnchor,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  if (anchor.kind === "generated") return [`  from generated: ${anchor.label}`];
  if (anchor.kind === "recovery") return [`  from recovery ${anchor.step}: ${anchor.label}`];
  const location = `${filePath || "<input>"}:${anchor.span.line}:${anchor.span.col}`;
  const excerpt = source ? formatSourceLine(source, anchor.span) : undefined;
  return excerpt ? [`  from ${location}`, `  ${excerpt}`] : [`  from ${location}`];
}

function renderNamedSourceReference(
  diagnostic: FrontendDiagnostic,
  label: string | undefined,
  filePath: string | undefined,
  source: string | undefined,
  indent: string,
): string[] {
  if (!label) return [];
  const entry = diagnostic.support.entries.find((item) =>
    item.kind === "claim" && item.claim.subject === label
  );
  if (!entry || entry.kind !== "claim") return [`${indent}source: ${label}`];
  return [
    `${indent}source: ${label}`,
    ...renderSupportOrigin(entry.origin, filePath, source).map((line) => `${indent}${line.trim()}`),
  ];
}

function formatSourceLine(source: string, span: SourceSpan): string {
  const starts = lineStarts(source);
  const lineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  const line = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
  return line.trim();
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
