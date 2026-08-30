import type {
  AuditableDiagnostic,
  SourceAnchor,
  SupportEntry,
  TypeSnapshotId,
} from "../diagnostic_writer.ts";
import { displayTypeVariables } from "../diagnostic_type_display.ts";
import { lineStarts, sliceSource, type SourceSpan } from "../source.ts";
import { formatPathSegment } from "../type_diff.ts";
import { renderViolation } from "../diagnostic_syntax_renderer.ts";
import { type Line, line as documentLine, span } from "../../tooling/tuiman/document.ts";

export type EnhancedDiagnosticRenderMode = "authored" | "detailed" | "explain" | "trace";

export type EnhancedDiagnosticRenderOptions = {
  mode?: EnhancedDiagnosticRenderMode;
};

export function renderExplainDiagnostic(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string {
  const violation = diagnostic.failure.violation;
  const lines = [
    renderHeader(diagnostic, filePath),
    "",
    "rule failed:",
    `  ${diagnostic.failure.frame.rule}`,
    "",
    "failed premise:",
    `  ${diagnostic.failure.premise.role}`,
    `  ${renderPredicate(diagnostic)}`,
  ];
  if (violation.kind === "contradicted") {
    lines.push(
      "",
      "observed:",
      `  ${typeSnapshotRendered(diagnostic, violation.observed.left)}`,
      `  ${typeSnapshotRendered(diagnostic, violation.observed.right)}`,
      "",
      `collision: ${renderConflictPath(violation.conflictPath)}`,
    );
  } else {
    lines.push("", "violation:", `  ${renderViolation(violation)}`);
  }
  const excerpt = source && diagnostic.primary.kind === "source"
    ? renderContextExcerpt(source, diagnostic.primary.span)
    : undefined;
  if (excerpt) lines.push("", excerpt);
  return `${lines.join("\n")}\n`;
}

export function renderTraceDiagnostic(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string {
  const lines = [
    renderHeader(diagnostic, filePath),
    "",
    "compiler path:",
    ...diagnostic.failure.frame.path.map((part) => `  ${part}`),
    "",
    "failure:",
    `  rule: ${diagnostic.failure.frame.rule}`,
    `  subject: ${diagnostic.failure.frame.subject}`,
    `  premise: ${diagnostic.failure.premise.role}`,
    `  predicate: ${renderPredicate(diagnostic)}`,
    "",
    "support:",
    ...supportEntriesInRenderOrder(diagnostic).flatMap((entry) =>
      renderSupportEntry(entry, diagnostic, filePath, source).map((line) => `  ${line}`)
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function renderHeader(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
): string {
  return diagnosticHeader(diagnostic, filePath).text;
}

export function renderHeaderLine(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
): Line {
  const header = diagnosticHeader(diagnostic, filePath);
  return documentLine(
    span(`${header.severity}:`, header.severity === "Warning" ? "warning" : "error"),
    span(header.text.slice(header.severity.length + 1), "header"),
  );
}

function diagnosticHeader(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
): { severity: "Error" | "Warning"; text: string } {
  const severity = diagnostic.severity === "error" ? "Error" : "Warning";
  const module = diagnosticModule(diagnostic.code);
  const file = filePath ? basename(filePath) : "<input>";
  const prefix = `${severity}: ${module}[${diagnostic.code}] `;
  const suffix = ` ${file}`;
  const width = Math.max(64, prefix.length + suffix.length);
  return {
    severity,
    text: `${prefix}${"-".repeat(Math.max(1, width - prefix.length - suffix.length))}${suffix}`,
  };
}

function diagnosticModule(code: string): string {
  if (code.startsWith("run.")) return "RUNNER";
  if (code.startsWith("syntax.") || code.startsWith("parse.")) return "PARSER";
  if (code.startsWith("module.") || code.startsWith("import.")) return "MODULE LOADER";
  return "TYPE CHECKER";
}

export function renderTypeBlock(type: string): string {
  return type;
}

function renderPredicate(diagnostic: AuditableDiagnostic): string {
  const predicate = diagnostic.failure.premise.predicate;
  if (predicate.kind === "equal") {
    return `${renderPredicateTerm(diagnostic, predicate.left)} == ${
      renderPredicateTerm(diagnostic, predicate.right)
    } (${predicate.domain})`;
  }
  return diagnostic.failure.premise.role;
}

function renderPredicateTerm(diagnostic: AuditableDiagnostic, term: string): string {
  return diagnostic.support.types.some((snapshot) => snapshot.id === term)
    ? typeSnapshotRendered(diagnostic, term)
    : term;
}

export function isDirectPipeInputConflict(path: import("../type_diff.ts").DiffPath): boolean {
  if (path.length === 1) return path[0].kind === "fn-param" && path[0].index === 0;
  if (path.length === 2) {
    return path[0].kind === "fn-param" && path[0].index === 0 &&
      path[1].kind === "tuple-item" && path[1].index === 0;
  }
  return false;
}

export function firstParameterType(
  diagnostic: AuditableDiagnostic,
  claim: Extract<SupportEntry, { kind: "claim" }> | undefined,
): string | undefined {
  if (!claim || claim.claim.kind !== "has-type") return undefined;
  const hasType = claim.claim;
  const snapshot = diagnostic.support.types.find((item) => item.id === hasType.type);
  if (!snapshot || snapshot.shape.kind !== "function") return undefined;
  const first = snapshot.shape.params[0];
  return first ? typeSnapshotRendered(diagnostic, first) : undefined;
}

export function findConstraintForFrame(
  diagnostic: AuditableDiagnostic,
): Extract<SupportEntry, { kind: "constraint" }> | undefined {
  return diagnostic.support.entries.find((entry): entry is Extract<SupportEntry, {
    kind: "constraint";
  }> =>
    entry.kind === "constraint" &&
    entry.frame === diagnostic.failure.frame.id &&
    entry.premise === diagnostic.failure.premise.id
  ) ??
    diagnostic.support.entries.find((entry): entry is Extract<SupportEntry, {
      kind: "constraint";
    }> => entry.kind === "constraint");
}

export function renderConflictPath(path: import("../type_diff.ts").DiffPath): string {
  return path.length ? path.map(formatPathSegment).join(" -> ") : "type";
}

export function renderTypeSlot(path: import("../type_diff.ts").DiffPath): string {
  const named = [...path].reverse().find((segment) => segment.kind === "named-arg");
  if (named?.kind === "named-arg") {
    return `${named.typeName}<${typeArgumentSlots(named.index, named.label).join(", ")}>`;
  }
  return renderConflictPath(path);
}

function typeArgumentSlots(index: number, label: string | undefined): string[] {
  const slots = Array.from({ length: index + 1 }, () => "_");
  slots[index] = label ?? `arg${index + 1}`;
  return slots;
}

export function renderContextExcerpt(source: string, span: SourceSpan): string {
  const starts = lineStarts(source);
  const targetLineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
  const firstLineIndex = Math.max(0, targetLineIndex - 2);
  const lastLineIndex = targetLineIndex;
  const numberWidth = String(lastLineIndex + 1).length;
  const lines: string[] = [];
  for (let index = firstLineIndex; index <= lastLineIndex; index++) {
    const lineStart = starts[index];
    const lineEnd = source.indexOf("\n", lineStart);
    const line = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
    const number = `${String(index + 1).padStart(numberWidth)}| `;
    lines.push(`${number}${line}`);
    if (index === targetLineIndex) {
      lines.push(renderCaretLine(source, span, lineStart, number.length));
    }
  }
  return lines.join("\n");
}

function renderCaretLine(
  source: string,
  span: SourceSpan,
  lineStart: number,
  prefixLength: number,
): string {
  const text = sliceSource(source, span);
  const lineEnd = source.indexOf("\n", lineStart);
  const lineLimit = lineEnd === -1 ? source.length : lineEnd;
  const underlineOffset = Math.max(0, Math.min(span.start, lineLimit) - lineStart);
  const underlineEnd = Math.max(span.end, span.start + 1);
  const underlineWidth = Math.max(
    1,
    Math.min(underlineEnd, lineLimit) - Math.min(span.start, lineLimit),
    text.length && !text.includes("\n") ? text.length : 0,
  );
  return `${" ".repeat(prefixLength + underlineOffset)}${"^".repeat(underlineWidth)}`;
}

function renderNumberedExcerpt(source: string, span: SourceSpan): string {
  const text = sliceSource(source, span);
  const starts = lineStarts(source);
  const lineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  const line = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
  const number = `${span.line}| `;
  const underlineOffset = Math.max(0, span.start - lineStart);
  const underlineWidth = Math.max(1, (text || line.slice(underlineOffset)).length);
  return [
    `${number}${line}`,
    `${" ".repeat(number.length + underlineOffset)}${"^".repeat(underlineWidth)}`,
  ].join("\n");
}

export function findClaim(diagnostic: AuditableDiagnostic, subject: string):
  | Extract<SupportEntry, {
    kind: "claim";
  }>
  | undefined {
  return diagnostic.support.entries.find((
    entry,
  ): entry is Extract<SupportEntry, { kind: "claim" }> =>
    entry.kind === "claim" && entry.claim.subject === subject
  );
}

export function findFactClaim(
  diagnostic: AuditableDiagnostic,
  matches: (text: string) => boolean,
): Extract<SupportEntry, { kind: "claim" }> | undefined {
  return diagnostic.support.entries.find((
    entry,
  ): entry is Extract<SupportEntry, { kind: "claim" }> =>
    entry.kind === "claim" && entry.claim.kind === "fact" && matches(entry.claim.text)
  );
}

export function findClaimWithType(
  diagnostic: AuditableDiagnostic,
  subjects: (string | undefined)[],
  renderedType: string,
): Extract<SupportEntry, { kind: "claim" }> | undefined {
  for (const subject of subjects) {
    if (!subject) continue;
    const claim = findClaim(diagnostic, subject);
    if (
      claim?.claim.kind === "has-type" &&
      typeSnapshotRendered(diagnostic, claim.claim.type) === renderedType
    ) {
      return claim;
    }
  }
  return diagnostic.support.entries.find((
    entry,
  ): entry is Extract<SupportEntry, { kind: "claim" }> =>
    entry.kind === "claim" &&
    entry.claim.kind === "has-type" &&
    typeSnapshotRendered(diagnostic, entry.claim.type) === renderedType
  );
}

export function findNoteAt(
  diagnostic: AuditableDiagnostic,
  anchor: SourceAnchor,
): Extract<SupportEntry, { kind: "note" }> | undefined {
  if (anchor.kind !== "source") return undefined;
  return diagnostic.support.entries.find((
    entry,
  ): entry is Extract<SupportEntry, { kind: "note" }> =>
    entry.kind === "note" &&
    entry.origin.kind === "source" &&
    entry.origin.span.start === anchor.span.start &&
    entry.origin.span.end === anchor.span.end
  );
}

function supportEntriesInRenderOrder(diagnostic: AuditableDiagnostic): SupportEntry[] {
  const roots = new Set(diagnostic.support.roots);
  return [
    ...diagnostic.support.entries.filter((entry) => roots.has(entry.id)),
    ...diagnostic.support.entries.filter((entry) => !roots.has(entry.id)),
  ];
}

function renderSupportEntry(
  entry: SupportEntry,
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  switch (entry.kind) {
    case "claim":
      return [
        `${entry.id} claim: ${renderClaim(entry, diagnostic)}`,
        ...renderOrigin(diagnostic, entry.origin, filePath, source),
      ];
    case "constraint":
      return [
        `${entry.id} constraint: ${typeSnapshotRendered(diagnostic, entry.left)} == ${
          typeSnapshotRendered(diagnostic, entry.right)
        }`,
        ...renderOrigin(diagnostic, entry.origin, filePath, source),
      ];
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
        ...renderOrigin(diagnostic, entry.origin, filePath, source),
      ];
    case "recovery":
      return [];
  }
}

function renderClaim(
  entry: Extract<SupportEntry, { kind: "claim" }>,
  diagnostic: AuditableDiagnostic,
): string {
  if (entry.claim.kind === "fact") return displayTypeVariables(entry.claim.text);
  return `${entry.claim.subject}: ${typeSnapshotRendered(diagnostic, entry.claim.type)}`;
}

function renderOrigin(
  diagnostic: AuditableDiagnostic,
  anchor: SourceAnchor,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  if (anchor.kind !== "source") return [`from ${anchor.kind}: ${anchor.label}`];
  const originFile = anchor.filePath ?? filePath;
  const originSource = anchor.filePath && anchor.filePath !== filePath
    ? diagnostic.support.sources?.find((item) => item.filePath === anchor.filePath)?.source
    : source;
  const location = `${originFile || "<input>"}:${anchor.span.line}:${anchor.span.col}`;
  const excerpt = originSource ? sourceLine(originSource, anchor.span) : undefined;
  return excerpt ? [`from ${location}`, excerpt] : [`from ${location}`];
}

export function sourceLine(source: string, span: SourceSpan): string {
  const starts = lineStarts(source);
  const lineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  return (lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd)).trim();
}

export function typeSnapshotRendered(diagnostic: AuditableDiagnostic, id: TypeSnapshotId): string {
  return displayTypeVariables(
    diagnostic.support.types.find((snapshot) => snapshot.id === id)?.rendered ?? id,
  );
}

export function typeAtPath(
  diagnostic: AuditableDiagnostic,
  id: TypeSnapshotId,
  path: import("../type_diff.ts").DiffPath,
): string | undefined {
  let current = diagnostic.support.types.find((snapshot) => snapshot.id === id);
  for (const segment of path) {
    if (!current) return undefined;
    let nextId: TypeSnapshotId | undefined;
    switch (segment.kind) {
      case "fn-param":
        nextId = current.shape.kind === "function"
          ? current.shape.params[segment.index]
          : undefined;
        break;
      case "fn-result":
        nextId = current.shape.kind === "function" ? current.shape.result : undefined;
        break;
      case "tuple-item":
        nextId = current.shape.kind === "tuple" ? current.shape.items[segment.index] : undefined;
        break;
      case "record-field":
        nextId = current.shape.kind === "struct"
          ? current.shape.fields.find((field) => field.name === segment.name)?.type
          : undefined;
        break;
      case "named-arg":
        nextId = current.shape.kind === "named" ? current.shape.args[segment.index] : undefined;
        break;
    }
    current = nextId
      ? diagnostic.support.types.find((snapshot) => snapshot.id === nextId)
      : undefined;
  }
  return current ? typeSnapshotRendered(diagnostic, current.id) : undefined;
}

export function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
