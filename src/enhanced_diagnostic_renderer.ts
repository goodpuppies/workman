import type {
  AuditableDiagnostic,
  SourceAnchor,
  SupportEntry,
  TypeSnapshotId,
} from "./diagnostic_writer.ts";
import { displayTypeVariables } from "./diagnostic_type_display.ts";
import { lineStarts, sliceSource, type SourceSpan } from "./source.ts";
import { formatPathSegment } from "./type_diff.ts";
import { renderViolation } from "./diagnostic_syntax_renderer.ts";

export type EnhancedDiagnosticRenderMode = "authored" | "explain" | "trace";

export type EnhancedDiagnosticRenderOptions = {
  mode?: EnhancedDiagnosticRenderMode;
};

type EnhancedDiagnosticProfile = {
  id: string;
  codes: string[];
  rules?: string[];
  render: (
    diagnostic: AuditableDiagnostic,
    filePath: string | undefined,
    source: string | undefined,
    options: Required<EnhancedDiagnosticRenderOptions>,
  ) => string;
};

const enhancedDiagnosticProfiles: EnhancedDiagnosticProfile[] = [
  {
    id: "missing-entrypoint",
    codes: ["run.missing-entrypoint"],
    rules: ["Run.EntryPoint"],
    render: renderMissingEntrypoint,
  },
  {
    id: "pipe-step-input",
    codes: ["type.mismatch"],
    rules: ["InferPipe.StepInput"],
    render: renderPipeStepInput,
  },
  {
    id: "recursive-result-agreement",
    codes: ["type.mismatch"],
    rules: ["InferRecursive.ResultAgreement"],
    render: renderRecursiveResultAgreement,
  },
  {
    id: "match-arm-result-agreement",
    codes: ["type.mismatch"],
    rules: ["InferMatch.ArmsSameType"],
    render: renderMatchArmResultAgreement,
  },
];

function renderMissingEntrypoint(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
  options: Required<EnhancedDiagnosticRenderOptions>,
): string {
  if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
  if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);

  return `${
    [
      renderHeader(diagnostic, filePath),
      "",
      "This file cannot be run because it has no `main` function.",
      "",
      "`wm run` starts by calling `main`. Add a top-level entrypoint, for example:",
      "",
      "    let main = () => {};",
    ].join("\n")
  }\n`;
}

export function formatEnhancedDiagnostic(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
  options: EnhancedDiagnosticRenderOptions = {},
): string | undefined {
  const profile = enhancedDiagnosticProfiles.find((item) => profileMatches(item, diagnostic));
  if (!profile) return undefined;
  return profile.render(diagnostic, filePath, source, { mode: options.mode ?? "authored" });
}

function profileMatches(profile: EnhancedDiagnosticProfile, diagnostic: AuditableDiagnostic) {
  if (!profile.codes.includes(diagnostic.code)) return false;
  return !profile.rules || profile.rules.includes(diagnostic.failure.frame.rule);
}

function renderPipeStepInput(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
  options: Required<EnhancedDiagnosticRenderOptions>,
): string {
  if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
  if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);

  const violation = diagnostic.failure.violation;
  if (violation.kind !== "contradicted") {
    return renderExplainDiagnostic(diagnostic, filePath, source);
  }

  const valueClaim = findClaim(diagnostic, "piped value");
  const calleeClaim = findClaim(diagnostic, diagnostic.failure.frame.subject) ??
    diagnostic.support.entries.find((entry): entry is Extract<SupportEntry, { kind: "claim" }> =>
      entry.kind === "claim" && entry.claim.kind === "has-type"
    );
  const directPipeInput = isDirectPipeInputConflict(violation.conflictPath);
  const produced = directPipeInput && valueClaim?.claim.kind === "has-type"
    ? typeSnapshotRendered(diagnostic, valueClaim.claim.type)
    : typeSnapshotRendered(diagnostic, violation.observed.right);
  const needed = directPipeInput
    ? firstParameterType(diagnostic, calleeClaim) ??
      typeSnapshotRendered(diagnostic, violation.observed.left)
    : typeSnapshotRendered(diagnostic, violation.observed.left);
  const producedClaim = directPipeInput ? valueClaim : findClaimWithType(
    diagnostic,
    [violation.origins?.got, violation.origins?.expected],
    produced,
  ) ?? valueClaim;
  const producedNote = producedClaim ? findNoteAt(diagnostic, producedClaim.origin) : undefined;

  const valueSnippet = source && producedClaim?.origin.kind === "source"
    ? renderContextExcerpt(source, producedClaim.origin.span)
    : source && diagnostic.primary.kind === "source"
    ? renderContextExcerpt(source, diagnostic.primary.span)
    : undefined;
  const calleeSnippet = source && calleeClaim?.origin.kind === "source"
    ? renderContextExcerpt(source, calleeClaim.origin.span)
    : undefined;

  const header = renderHeader(diagnostic, filePath);
  const calleeName = diagnostic.failure.frame.subject || "the next function";
  const lines = [
    header,
    "",
    "This expression produces:",
    "",
    indent(renderTypeBlock(produced), 4),
    "",
    ...(valueSnippet ? [valueSnippet, ""] : []),
    ...(producedNote ? [producedNote.message, ""] : []),
    "But this pipeline step needs:",
    "",
    indent(renderTypeBlock(needed), 4),
    "",
    ...(calleeSnippet ? [calleeSnippet, ""] : []),
    `\`${calleeName}\` takes a \`${needed}\` as its first argument.`,
    `The piped value has type \`${produced}\`, so it cannot be passed to that step directly.`,
  ];
  return `${lines.join("\n")}\n`;
}

function renderRecursiveResultAgreement(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
  options: Required<EnhancedDiagnosticRenderOptions>,
): string {
  if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
  if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);

  const violation = diagnostic.failure.violation;
  if (violation.kind !== "contradicted") {
    return renderExplainDiagnostic(diagnostic, filePath, source);
  }

  const expected = typeSnapshotRendered(diagnostic, violation.observed.left);
  const actual = typeSnapshotRendered(diagnostic, violation.observed.right);
  const bodyClaim = findFactClaim(diagnostic, (text) => text.startsWith("body:"));
  const recClaim = findFactClaim(
    diagnostic,
    (text) => text === "rec: occurrences share one monomorphic type",
  );
  const occurrenceClaim = findFactClaim(diagnostic, (text) => text.startsWith("occurrence:"));
  const matchHint = findFactClaim(diagnostic, (text) => text.includes("match(...) => { ... }"));

  const header = renderHeader(diagnostic, filePath);
  const bindingName = diagnostic.failure.frame.subject || "this recursive binding";
  const bodyOrigin = (matchHint ?? bodyClaim)?.origin;
  const bodySnippet = source && bodyOrigin?.kind === "source"
    ? renderContextExcerpt(source, bodyOrigin.span)
    : undefined;
  const occurrenceSnippet = source && occurrenceClaim?.origin.kind === "source"
    ? renderContextExcerpt(source, occurrenceClaim.origin.span)
    : source && diagnostic.primary.kind === "source"
    ? renderContextExcerpt(source, diagnostic.primary.span)
    : undefined;
  const recSnippet = source && recClaim?.origin.kind === "source"
    ? renderContextExcerpt(source, recClaim.origin.span)
    : undefined;

  const lines = [
    header,
    "",
    `\`${bindingName}\` is recursive, so its body must return the same result type as its recursive calls.`,
    "",
    "Recursive calls produce:",
    "",
    indent(renderTypeBlock(expected), 4),
    "",
    ...(occurrenceSnippet ? [occurrenceSnippet, ""] : []),
    "But the body produces:",
    "",
    indent(renderTypeBlock(actual), 4),
    "",
    ...(bodySnippet ? [bodySnippet, ""] : []),
    ...(matchHint
      ? [
        "This looks like an accidental match-function expression.",
        "Use `match(list) { ... }` when you want the block to return the match result.",
        "",
      ]
      : []),
    ...(recSnippet ? ["Recursive binding:", "", recSnippet, ""] : []),
    `The recursive result is \`${expected}\`, but the inferred body result is \`${actual}\`.`,
  ];
  return `${lines.join("\n")}\n`;
}

function renderMatchArmResultAgreement(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
  options: Required<EnhancedDiagnosticRenderOptions>,
): string {
  if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
  if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);

  const violation = diagnostic.failure.violation;
  const constraint = findConstraintForFrame(diagnostic);
  if (violation.kind !== "contradicted" || !constraint) {
    return renderExplainDiagnostic(diagnostic, filePath, source);
  }

  const previousArmType = typeSnapshotRendered(diagnostic, constraint.left);
  const currentArmType = typeSnapshotRendered(diagnostic, constraint.right);
  const previousArmConflict = typeAtPath(diagnostic, constraint.left, violation.conflictPath) ??
    typeSnapshotRendered(diagnostic, violation.observed.right);
  const currentArmConflict = typeAtPath(diagnostic, constraint.right, violation.conflictPath) ??
    typeSnapshotRendered(diagnostic, violation.observed.left);
  const currentArmClaim = findFactClaim(diagnostic, (text) => text === "match arm result");
  const previousArmClaim = findClaim(
    diagnostic,
    violation.origins?.got ?? violation.origins?.expected ?? "",
  );
  const currentOrigin = currentArmClaim?.origin ?? constraint.origin ?? diagnostic.primary;
  const previousSnippet = source && previousArmClaim?.origin.kind === "source"
    ? renderContextExcerpt(source, previousArmClaim.origin.span)
    : undefined;
  const currentSnippet = source && currentOrigin.kind === "source"
    ? renderContextExcerpt(source, currentOrigin.span)
    : undefined;
  const slot = renderTypeSlot(violation.conflictPath);

  const lines = [
    renderHeader(diagnostic, filePath),
    "",
    "These match arms return different types.",
    "Match arms are checked left-to-right: this arm is being compared with the result type established by earlier arms.",
    "",
    "Earlier arm result:",
    "",
    indent(renderTypeBlock(previousArmType), 4),
    "",
    ...(previousSnippet
      ? ["Source of the mismatching part from an earlier arm:", "", previousSnippet, ""]
      : []),
    "This arm result:",
    "",
    indent(renderTypeBlock(currentArmType), 4),
    "",
    ...(currentSnippet ? [currentSnippet, ""] : []),
    "Different part:",
    "",
    indent(
      `${slot}\nprevious arm(s): ${previousArmConflict}\nthis arm:       ${currentArmConflict}`,
      4,
    ),
    "",
    `The current arm returns \`${currentArmType}\`; the earlier arm result is \`${previousArmType}\`.`,
    "Make both arms return the same type, or convert one arm before returning it.",
  ];
  return `${lines.join("\n")}\n`;
}

function renderExplainDiagnostic(
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

function renderTraceDiagnostic(
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

function renderHeader(diagnostic: AuditableDiagnostic, filePath: string | undefined): string {
  const label = diagnostic.code.startsWith("run.")
    ? "RUNNER"
    : diagnostic.severity === "error"
    ? "TYPE CHECKER"
    : "WARNING";
  const file = filePath ? basename(filePath) : "<input>";
  const prefix = `-- ${label} `;
  const suffix = ` ${file}`;
  const width = Math.max(64, prefix.length + suffix.length);
  return `${prefix}${"-".repeat(Math.max(1, width - prefix.length - suffix.length))}${suffix}`;
}

function renderTypeBlock(type: string): string {
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

function isDirectPipeInputConflict(path: import("./type_diff.ts").DiffPath): boolean {
  if (path.length === 1) return path[0].kind === "fn-param" && path[0].index === 0;
  if (path.length === 2) {
    return path[0].kind === "fn-param" && path[0].index === 0 &&
      path[1].kind === "tuple-item" && path[1].index === 0;
  }
  return false;
}

function firstParameterType(
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

function findConstraintForFrame(
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

function renderConflictPath(path: import("./type_diff.ts").DiffPath): string {
  return path.length ? path.map(formatPathSegment).join(" -> ") : "type";
}

function renderTypeSlot(path: import("./type_diff.ts").DiffPath): string {
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

function renderContextExcerpt(source: string, span: SourceSpan): string {
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

function findClaim(diagnostic: AuditableDiagnostic, subject: string):
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

function findFactClaim(
  diagnostic: AuditableDiagnostic,
  matches: (text: string) => boolean,
): Extract<SupportEntry, { kind: "claim" }> | undefined {
  return diagnostic.support.entries.find((
    entry,
  ): entry is Extract<SupportEntry, { kind: "claim" }> =>
    entry.kind === "claim" && entry.claim.kind === "fact" && matches(entry.claim.text)
  );
}

function findClaimWithType(
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

function findNoteAt(
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
        ...renderOrigin(entry.origin, filePath, source),
      ];
    case "constraint":
      return [
        `${entry.id} constraint: ${typeSnapshotRendered(diagnostic, entry.left)} == ${
          typeSnapshotRendered(diagnostic, entry.right)
        }`,
        ...renderOrigin(entry.origin, filePath, source),
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
        ...renderOrigin(entry.origin, filePath, source),
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
  anchor: SourceAnchor,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  if (anchor.kind !== "source") return [`from ${anchor.kind}: ${anchor.label}`];
  const location = `${filePath || "<input>"}:${anchor.span.line}:${anchor.span.col}`;
  const excerpt = source ? sourceLine(source, anchor.span) : undefined;
  return excerpt ? [`from ${location}`, excerpt] : [`from ${location}`];
}

function sourceLine(source: string, span: SourceSpan): string {
  const starts = lineStarts(source);
  const lineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  return (lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd)).trim();
}

function typeSnapshotRendered(diagnostic: AuditableDiagnostic, id: TypeSnapshotId): string {
  return displayTypeVariables(
    diagnostic.support.types.find((snapshot) => snapshot.id === id)?.rendered ?? id,
  );
}

function typeAtPath(
  diagnostic: AuditableDiagnostic,
  id: TypeSnapshotId,
  path: import("./type_diff.ts").DiffPath,
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

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
