import type { AuditableDiagnostic, SupportEntry } from "../diagnostic_writer.ts";
import { lineStarts, sliceSource, type SourceSpan } from "../source.ts";
import {
  findConstraintForFrame,
  indent,
  isDirectPipeInputConflict,
  renderContextExcerpt,
  renderExplainDiagnostic,
  renderHeader,
  renderHeaderLine,
  renderTraceDiagnostic,
  sourceLine,
  typeAtPath,
  typeSnapshotRendered,
} from "./rendering.ts";
import type { AuthoredDiagnosticProfile } from "./profile.ts";
import {
  type Document,
  type Line,
  line as documentLine,
  plainDocument,
  plainText,
  type SemanticRole,
  span,
  type Span,
  terminalWidth,
} from "../../tooling/tuiman/document.ts";

type ClaimEntry = Extract<SupportEntry, { kind: "claim" }>;
const TINY_TERMINAL_WIDTH = 80;

type CollisionAdapter = {
  code: string;
  equation: "leaf" | "constraint";
  subject: (diagnostic: AuditableDiagnostic, source: string | undefined) => string;
};

const collisionAdapters: CollisionAdapter[] = [
  {
    code: "type.mismatch",
    equation: "leaf",
    subject: annotationMismatchSubject,
  },
  {
    code: "type.call-argument-mismatch",
    equation: "leaf",
    subject: collisionSubject,
  },
  {
    code: "type.match-arm-results-disagree",
    equation: "constraint",
    subject: () => "match arms",
  },
  {
    code: "type.pipe-input-mismatch",
    equation: "leaf",
    subject: () => "pipe sides",
  },
  {
    code: "type.if-branch-results-disagree",
    equation: "constraint",
    subject: () => "if branches",
  },
];

export const neutralTypeCollisionProfile: AuthoredDiagnosticProfile = {
  id: "neutral-type-collision",
  codes: collisionAdapters.map((adapter) => adapter.code),
  render(diagnostic, filePath, source, options) {
    if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
    if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);
    return renderNeutralTypeCollision(diagnostic, filePath, source, options.mode === "detailed")
      .text;
  },
  terminalDocument(diagnostic, filePath, source) {
    return renderNeutralTypeCollision(diagnostic, filePath, source, false).document;
  },
};

type CollisionRendering = { text: string; document: Document };
type CollisionParticipant = { claim: ClaimEntry; type: string };
type CollisionParticipants = { left: CollisionParticipant; right: CollisionParticipant };
type CallArityMismatch = { expected: number; actual: number };

function renderNeutralTypeCollision(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
  detailed: boolean,
): CollisionRendering {
  const violation = diagnostic.failure.violation;
  const adapter = collisionAdapters.find((candidate) => candidate.code === diagnostic.code);
  if (violation.kind !== "contradicted" || !adapter) {
    const text = renderExplainDiagnostic(diagnostic, filePath, source);
    return { text, document: plainDocument(text) };
  }
  const collision = diagnostic.support.entries.find((entry): entry is Extract<SupportEntry, {
    kind: "collision";
  }> => entry.kind === "collision");
  const observed = collision
    ? diagnostic.support.edges
      .filter((edge) => edge.to === collision.id && edge.role === "observed")
      .map((edge) => claimById(diagnostic, edge.from))
      .filter((claim): claim is ClaimEntry => !!claim)
    : [];
  const constraint = findConstraintForFrame(diagnostic);
  const wholeEquation = adapter.equation === "constraint" && constraint;
  const leftType = wholeEquation
    ? typeSnapshotRendered(diagnostic, constraint.left)
    : typeSnapshotRendered(diagnostic, violation.observed.left);
  const rightType = wholeEquation
    ? typeSnapshotRendered(diagnostic, constraint.right)
    : typeSnapshotRendered(diagnostic, violation.observed.right);
  const leftLeaf = wholeEquation
    ? typeAtPath(diagnostic, constraint.left, violation.conflictPath)
    : leftType;
  const rightLeaf = wholeEquation
    ? typeAtPath(diagnostic, constraint.right, violation.conflictPath)
    : rightType;
  const leftOriginType = leftLeaf ?? leftType;
  const rightOriginType = rightLeaf ?? rightType;
  const arityMismatch = adapter.code === "type.call-argument-mismatch"
    ? callArityMismatch(diagnostic)
    : undefined;
  const leftObserved = observed.find((claim) =>
    claim.claim.kind === "has-type" &&
    typeSnapshotRendered(diagnostic, claim.claim.type) === leftLeaf
  );
  const rightObserved = observed.find((claim) =>
    claim !== leftObserved && claim.claim.kind === "has-type" &&
    typeSnapshotRendered(diagnostic, claim.claim.type) === rightLeaf
  );
  const participants = adapter.code === "type.match-arm-results-disagree"
    ? matchParticipants(diagnostic, leftType, rightType)
    : adapter.code === "type.pipe-input-mismatch"
    ? pipeParticipants(diagnostic, leftType, rightType)
    : adapter.code === "type.if-branch-results-disagree"
    ? ifParticipants(diagnostic, leftType, rightType)
    : undefined;
  const leftPath = leftObserved ? longestDerivationPath(diagnostic, leftObserved) : [];
  const rightPath = rightObserved ? longestDerivationPath(diagnostic, rightObserved) : [];
  const leftOrigin = leftPath[0] ?? leftObserved;
  const rightOrigin = rightPath[0] ?? rightObserved;
  const annotationSlot = adapter.code === "type.mismatch"
    ? annotationMismatchSlot(diagnostic)
    : undefined;
  // Usually the two provenance paths already explain the equation cleanly. When one side comes
  // from another unit, expose the structural callback slot that names the colliding parameter
  // and would otherwise be hidden inside the raw unification path.
  const callSlot = adapter.code === "type.call-argument-mismatch" &&
      (
        !leftOrigin || !rightOrigin ||
        (leftOrigin.origin.kind === "source" && leftOrigin.origin.filePath !== undefined &&
          leftOrigin.origin.filePath !== filePath)
      )
    ? callCollisionSlot(diagnostic, source)
    : undefined;
  // Shape collisions (tuple arity, say) fail before either side is pinned to an observed claim.
  // The participants already name both sides of the equation, so origin cells reuse them rather
  // than degrading to a bare type.
  const leftParticipant = participantClaimFor(participants, leftType);
  const rightParticipant = participantClaimFor(participants, rightType, leftParticipant);
  const leftDisplayOrigin = annotationSlot?.annotation ?? leftOrigin ?? leftParticipant ??
    callSlot?.calleeClaim;
  const leftOriginLabel = annotationSlot
    ? "annotation requires"
    : !leftOrigin && !leftParticipant
    ? callSlot?.calleeLabel
    : undefined;
  const rightDisplayOrigin = annotationSlot?.parameter ?? rightOrigin ?? rightParticipant ??
    callSlot?.argumentClaim;
  const rightOriginLabel = annotationSlot
    ? `${annotationSlot.parameterName} inferred as`
    : rightOrigin
    ? callSlot && rightPath.length > 1 ? parameterUseLabel(rightPath.at(-1)) : undefined
    : rightParticipant
    ? undefined
    : callSlot?.argumentLabel;
  const collisionSpan = diagnostic.primary.kind === "source" ? diagnostic.primary.span : undefined;
  const primaryDocument = diagnostic.primary.kind === "source"
    ? sourceDocument(diagnostic, diagnostic.primary, filePath, source)
    : undefined;
  const collisionSource = primaryDocument?.source;
  const collisionFilePath = primaryDocument?.filePath;
  const availableWidth = terminalWidth();
  // The primary span belongs to whichever unit recorded it; skip the excerpt when it is not ours.
  const excerptSpan = collisionSource !== undefined && collisionSpan !== undefined &&
      spanWithinSource(collisionSource, collisionSpan)
    ? collisionSpan
    : undefined;
  const compactCollisionExcerpt = collisionSource && excerptSpan && !detailed
    ? renderCompactExcerpt(collisionSource, excerptSpan, collisionFilePath, availableWidth - 2)
    : undefined;
  const collisionExcerpt = collisionSource && excerptSpan
    ? detailed
      ? renderContextExcerpt(collisionSource, excerptSpan).split("\n")
      : compactCollisionExcerpt?.lines
    : undefined;
  const originColumns = collisionOriginColumns(
    diagnostic,
    leftOriginType,
    leftDisplayOrigin,
    rightOriginType,
    rightDisplayOrigin,
    source,
    filePath,
    detailed,
    leftOriginLabel,
    rightOriginLabel,
  );
  const provenanceColumns = detailed
    ? provenancePathColumns(
      leftOriginType,
      leftPath.length > 0 ? leftPath : leftDisplayOrigin ? [leftDisplayOrigin] : [],
      rightOriginType,
      rightPath.length > 0 ? rightPath : rightDisplayOrigin ? [rightDisplayOrigin] : [],
      diagnostic,
      filePath,
      source,
    )
    : undefined;
  const columnWidth = largestColumnWidth(
    originColumns,
    ...(provenanceColumns ? [provenanceColumns] : []),
  );
  const subject = callSlot?.subject ?? adapter.subject(diagnostic, source);
  if (detailed) {
    const collisionLines = arityMismatch
      ? [
        `  type error: ${subject} expects ${arityMismatch.expected} arguments but got ${arityMismatch.actual}`,
        "",
        `  expected: ${leftType}`,
        `  received: ${rightType}`,
        "",
        ...(collisionExcerpt ? collisionExcerpt.map((line) => `  ${line}`) : []),
      ]
      : participants && source
      ? [
        `  type error: ${subject} can't be both:`,
        ...participantEquationLines(diagnostic, participants, source, availableWidth).map((line) =>
          line.spans.map((item) => item.text).join("")
        ),
      ]
      : [
        `  type error: ${subject}`,
        "",
        "  can't be both:",
        indent(renderTypeBullet(leftType), 2),
        indent(renderTypeBullet(rightType), 2),
        "",
        ...(collisionExcerpt ? collisionExcerpt.map((line) => `  ${line}`) : []),
      ];
    const lines = [
      renderHeader(diagnostic, filePath),
      "",
      ...collisionLines,
      "",
      sectionHeader("Origins", columnWidth, availableWidth),
      "",
      ...renderAdaptiveColumns(originColumns, columnWidth, availableWidth),
      "",
      sectionHeader("Provenance", columnWidth, availableWidth),
      "",
      ...renderAdaptiveColumns(provenanceColumns!, columnWidth, availableWidth),
    ];
    const text = `${lines.join("\n")}\n`;
    return { text, document: plainDocument(text) };
  }

  const document = compactCollisionDocument(
    diagnostic,
    renderHeaderLine(diagnostic, filePath),
    compactCollisionExcerpt,
    subject,
    leftType,
    rightType,
    leftOriginType,
    rightOriginType,
    originColumns,
    leftDisplayOrigin,
    rightDisplayOrigin,
    source,
    filePath,
    participants,
    leftOriginLabel,
    rightOriginLabel,
    availableWidth,
    arityMismatch,
  );
  return { text: `${plainText(document)}\n`, document };
}

function compactCollisionDocument(
  diagnostic: AuditableDiagnostic,
  header: Line,
  collisionExcerpt: CompactExcerpt | undefined,
  subject: string,
  leftType: string,
  rightType: string,
  leftOriginType: string,
  rightOriginType: string,
  originColumns: ColumnPair,
  leftOrigin: ClaimEntry | undefined,
  rightOrigin: ClaimEntry | undefined,
  source: string | undefined,
  filePath: string | undefined,
  participants: CollisionParticipants | undefined,
  leftOriginLabel?: string,
  rightOriginLabel?: string,
  availableWidth = 120,
  arityMismatch?: CallArityMismatch,
): Document {
  const lines: Line[] = [header];
  const tiny = availableWidth <= TINY_TERMINAL_WIDTH;
  if (arityMismatch) {
    if (collisionExcerpt) {
      if (collisionExcerpt.location) lines.push(collisionExcerpt.location);
      lines.push(collisionExcerpt.source);
      lines.push(...underlineAnnotationLines(
        collisionExcerpt,
        [span(
          `type error: ${subject} expects ${arityMismatch.expected} arguments but got ${arityMismatch.actual}`,
          "error",
        )],
        availableWidth,
        { underlineRole: "error" },
      ));
    } else {
      lines.push(documentLine(
        span(
          `  type error: ${subject} expects ${arityMismatch.expected} arguments but got ${arityMismatch.actual}`,
          "error",
        ),
      ));
    }
    lines.push(
      documentLine(span("  expected: ", "secondary"), span(leftType, "type")),
      documentLine(span("  received: ", "secondary"), span(rightType, "type")),
    );
  } else if (participants && source) {
    lines.push(
      documentLine(span(`${tiny ? "" : "  "}type error: ${subject} can't be both:`, "error")),
    );
    lines.push(...participantEquationLines(diagnostic, participants, source, availableWidth));
  } else if (collisionExcerpt) {
    if (collisionExcerpt.location) {
      lines.push(documentLine(span("  "), ...collisionExcerpt.location.spans));
    }
    lines.push(documentLine(span("  "), ...collisionExcerpt.source.spans));
    lines.push(...underlineAnnotationLines(
      collisionExcerpt,
      [span(`type error: ${subject} can't be both:`, "error")],
      availableWidth,
      { indent: "  ", underlineRole: "error" },
    ));
  } else {
    lines.push(documentLine(span(`  type error: ${subject} can't be both:`, "error")));
  }
  if (!arityMismatch && (!participants || !source)) {
    lines.push(typeBulletLine(leftType), typeBulletLine(rightType));
  }
  let leftCell = compactOriginCell(
    diagnostic,
    leftOriginType,
    leftOrigin,
    source,
    filePath,
    leftOriginLabel,
    availableWidth,
  );
  let rightCell = compactOriginCell(
    diagnostic,
    rightOriginType,
    rightOrigin,
    source,
    filePath,
    rightOriginLabel,
    availableWidth,
  );
  if (leftCell.length > 2 || rightCell.length > 2) {
    leftCell = compactOriginCell(
      diagnostic,
      leftOriginType,
      leftOrigin,
      source,
      filePath,
      leftOriginLabel,
      availableWidth,
      true,
    );
    rightCell = compactOriginCell(
      diagnostic,
      rightOriginType,
      rightOrigin,
      source,
      filePath,
      rightOriginLabel,
      availableWidth,
      true,
    );
  }
  const sideBySide = renderCompactDocumentColumns(leftCell, rightCell);
  const fitsSideBySide = !tiny && Math.max(...sideBySide.map(lineWidth), 1) <= availableWidth;
  lines.push(documentLine(
    span(compactSectionHeader("Origins", originColumns, availableWidth), "header"),
  ));
  lines.push(
    ...(
      fitsSideBySide ? sideBySide : renderStackedDocumentCells(leftCell, rightCell, !tiny)
    ),
  );
  lines.push(documentLine(
    span(`- use wm err ${relativeFile(filePath)} to see a more detailed error`, "hint"),
  ));
  return { lines };
}

/** Participants are ordered per adapter, so pick the side by its rendered type, not by position. */
function participantClaimFor(
  participants: CollisionParticipants | undefined,
  type: string,
  exclude?: ClaimEntry,
): ClaimEntry | undefined {
  if (!participants) return undefined;
  return [participants.left, participants.right]
    .find((participant) => participant.type === type && participant.claim !== exclude)?.claim;
}

function matchParticipants(
  diagnostic: AuditableDiagnostic,
  leftType: string,
  rightType: string,
): CollisionParticipants | undefined {
  const typedClaims = diagnostic.support.entries.filter((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.claim.kind === "has-type" && entry.origin.kind === "source"
  );
  const earlier = typedClaims
    .filter((claim) =>
      claim.claim.kind === "has-type" && claim.claim.subject === "earlier match arm" &&
      typeSnapshotRendered(diagnostic, claim.claim.type) === leftType
    )
    .sort((a, b) =>
      a.origin.kind === "source" && b.origin.kind === "source"
        ? b.origin.span.start - a.origin.span.start
        : 0
    )[0];
  const current = typedClaims.find((claim) =>
    claim.claim.kind === "has-type" && claim.claim.subject === "match arm result" &&
    typeSnapshotRendered(diagnostic, claim.claim.type) === rightType
  );
  return earlier && current
    ? { left: { claim: earlier, type: leftType }, right: { claim: current, type: rightType } }
    : undefined;
}

function pipeParticipants(
  diagnostic: AuditableDiagnostic,
  neededType: string,
  producedType: string,
): CollisionParticipants | undefined {
  const typedClaims = diagnostic.support.entries.filter((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.claim.kind === "has-type" && entry.origin.kind === "source"
  );
  const claimForSubject = (subject: string | undefined, type: string) =>
    subject
      ? typedClaims.find((claim) =>
        claim.claim.kind === "has-type" && claim.claim.subject === subject &&
        claimContainsType(diagnostic, claim.claim.type, type)
      )
      : undefined;
  const pipedValue = claimForSubject("piped value", producedType);
  const produced = claimForSubject(
    diagnostic.failure.violation.kind === "contradicted"
      ? diagnostic.failure.violation.origins?.right
      : undefined,
    producedType,
  ) ?? pipedValue;
  const direct = diagnostic.failure.violation.kind === "contradicted" &&
    isDirectPipeInputConflict(diagnostic.failure.violation.conflictPath);
  const callee = claimForSubject(diagnostic.failure.frame.subject, neededType);
  const result = typedClaims.find((claim) =>
    claim.claim.kind === "has-type" &&
    /(?:call|block|match|callback) result$/.test(claim.claim.subject) &&
    claimContainsType(diagnostic, claim.claim.type, neededType)
  );
  const needed = direct ? callee : result ?? claimForSubject(
    diagnostic.failure.violation.kind === "contradicted"
      ? diagnostic.failure.violation.origins?.left
      : undefined,
    neededType,
  ) ?? callee;
  return produced && needed
    ? {
      left: { claim: produced, type: producedType },
      right: { claim: needed, type: neededType },
    }
    : undefined;
}

function ifParticipants(
  diagnostic: AuditableDiagnostic,
  thenType: string,
  elseType: string,
): CollisionParticipants | undefined {
  const typedClaims = diagnostic.support.entries.filter((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.claim.kind === "has-type" && entry.origin.kind === "source"
  );
  const thenBranch = typedClaims.find((claim) =>
    claim.claim.kind === "has-type" && claim.claim.subject === "then branch result"
  );
  const elseBranch = typedClaims.find((claim) =>
    claim.claim.kind === "has-type" && claim.claim.subject === "else branch result"
  );
  return thenBranch && elseBranch
    ? {
      left: { claim: thenBranch, type: thenType },
      right: { claim: elseBranch, type: elseType },
    }
    : undefined;
}

function claimContainsType(
  diagnostic: AuditableDiagnostic,
  typeId: string,
  renderedType: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(typeId)) return false;
  seen.add(typeId);
  const snapshot = diagnostic.support.types.find((candidate) => candidate.id === typeId);
  if (!snapshot) return false;
  if (typeSnapshotRendered(diagnostic, snapshot.id) === renderedType) return true;
  const children = snapshot.shape.kind === "function"
    ? [...snapshot.shape.params, snapshot.shape.result]
    : snapshot.shape.kind === "tuple"
    ? snapshot.shape.items
    : snapshot.shape.kind === "struct"
    ? snapshot.shape.fields.map((field) => field.type)
    : snapshot.shape.kind === "named"
    ? snapshot.shape.args
    : [];
  return children.some((child) => claimContainsType(diagnostic, child, renderedType, seen));
}

function participantEquationLines(
  diagnostic: AuditableDiagnostic,
  participants: CollisionParticipants,
  source: string,
  availableWidth: number,
): Line[] {
  const tiny = availableWidth <= TINY_TERMINAL_WIDTH;
  const normalizeParticipant = (view: ParticipantSource): ParticipantSource => {
    const gutter = tiny ? view.gutter.trimEnd() : view.gutter;
    const code = tiny ? view.code.trimStart() : view.code;
    return { gutter, code };
  };
  const rawLeft = normalizeParticipant(participantSource(participants.left.claim, source));
  const rawRight = normalizeParticipant(participantSource(participants.right.claim, source));
  const typeWidth = Math.max(participants.left.type.length, participants.right.type.length);
  const gutterWidth = Math.max(rawLeft.gutter.length, rawRight.gutter.length);
  const separatorWidth = tiny ? 1 : 2;
  const sourceBudget = Math.max(
    4,
    availableWidth - (tiny ? 0 : 2) - gutterWidth - separatorWidth - typeWidth,
  );
  const left = { ...rawLeft, code: clipStart(rawLeft.code, sourceBudget) };
  const right = { ...rawRight, code: clipStart(rawRight.code, sourceBudget) };
  const width = Math.max(
    left.gutter.length + left.code.length,
    right.gutter.length + right.code.length,
  );
  const row = (participant: CollisionParticipant, view: ParticipantSource): Line => {
    const padding = " ".repeat(width - view.gutter.length - view.code.length);
    return documentLine(
      span(tiny ? "" : "  "),
      span(view.gutter, "secondary"),
      span(view.code),
      span(padding),
      span(tiny ? ":" : ": ", "secondary"),
      span(participant.type, "type"),
    );
  };
  const lines: Line[] = [];
  for (
    const [participant, view] of [
      [participants.left, left],
      [participants.right, right],
    ] as const
  ) {
    lines.push(row(participant, view));
    const participantOrigin = participant.claim.origin;
    const note = participantOrigin.kind === "source"
      ? diagnostic.support.entries.find((entry): entry is Extract<SupportEntry, { kind: "note" }> =>
        entry.kind === "note" && entry.origin.kind === "source" &&
        entry.origin.span.start === participantOrigin.span.start &&
        entry.origin.span.end === participantOrigin.span.end
      )
      : undefined;
    if (note) lines.push(documentLine(span(`    ${note.message}`, "hint")));
  }
  return lines;
}

type ParticipantSource = { gutter: string; code: string };

function participantSource(claim: ClaimEntry, source: string): ParticipantSource {
  if (claim.origin.kind !== "source") return { gutter: "", code: "{..}" };
  const starts = lineStarts(source);
  const span = claim.origin.span;
  const lineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  const sourceLine = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
  const bodyStart = Math.max(0, span.start - lineStart);
  return {
    gutter: `${span.line}| `,
    code: `${sourceLine.slice(0, bodyStart)}{..}`,
  };
}

function typeBulletLine(type: string): Line {
  return documentLine(span("  - "), span(type, "type"));
}

/**
 * A caret line and whatever it points at. When the two cannot share the width, the caret grows a
 * ┌── connector and the annotation drops to its own line rather than wrapping mid-word.
 */
function underlineAnnotationLines(
  excerpt: CompactExcerpt,
  annotation: Span[],
  width: number | undefined,
  options: { indent?: string; underlineRole?: SemanticRole; forceMultiline?: boolean } = {},
): Line[] {
  const indent = options.indent ?? "";
  const inline = documentLine(
    span(`${indent}${excerpt.underlinePrefix}`),
    span(`${excerpt.underline} `, options.underlineRole),
    ...annotation,
  );
  if (!options.forceMultiline && (width === undefined || lineWidth(inline) <= width)) {
    return [inline];
  }
  const connector = `┌${"─".repeat(Math.max(0, excerpt.underlinePrefix.length - 1))}`;
  return [
    documentLine(span(`${indent}${connector}${excerpt.underline}`, options.underlineRole)),
    documentLine(span(indent), ...annotation),
  ];
}

function compactOriginCell(
  diagnostic: AuditableDiagnostic,
  type: string,
  claim: ClaimEntry | undefined,
  source: string | undefined,
  filePath: string | undefined,
  labelOverride?: string,
  availableWidth?: number,
  forceMultiline = false,
): Line[] {
  const document = claim?.origin.kind === "source"
    ? sourceDocument(diagnostic, claim.origin, filePath, source)
    : undefined;
  const claimSource = document?.source;
  const contentWidth = availableWidth === undefined
    ? undefined
    : availableWidth - (availableWidth <= TINY_TERMINAL_WIDTH ? 0 : 2);
  const label = labelOverride ?? (claim ? claimSubject(claim, claimSource) : undefined);
  if (
    !claimSource || claim?.origin.kind !== "source" ||
    !spanWithinSource(claimSource, claim.origin.span)
  ) {
    return [documentLine(span(label ? `${label}: ` : "", "secondary"), span(type, "type"))];
  }
  const excerpt = renderCompactExcerpt(
    claimSource,
    claim.origin.span,
    document?.filePath,
    contentWidth,
  );
  return [
    ...(excerpt.location ? [excerpt.location] : []),
    excerpt.source,
    ...underlineAnnotationLines(
      excerpt,
      [span(label ? `${label}: ` : "", "secondary"), span(type, "type")],
      contentWidth,
      { underlineRole: "secondary", forceMultiline },
    ),
  ];
}

function renderCompactDocumentColumns(left: Line[], right: Line[]): Line[] {
  const leftWidth = Math.max(...left.map(lineWidth), 1);
  const height = Math.max(left.length, right.length);
  return Array.from({ length: height }, (_, index) => {
    const leftLine = left[index] ?? documentLine(span(""));
    const rightLine = right[index] ?? documentLine(span(""));
    return documentLine(
      span("  "),
      ...leftLine.spans,
      span(" ".repeat(leftWidth - lineWidth(leftLine) + 3)),
      span("│", "secondary"),
      span(" "),
      ...rightLine.spans,
    );
  });
}

function renderStackedDocumentCells(left: Line[], right: Line[], indent = true): Line[] {
  return [...left, ...right].map((item) => documentLine(span(indent ? "  " : ""), ...item.spans));
}

function lineWidth(line: Line): number {
  return line.spans.reduce((width, item) => width + item.text.length, 0);
}

function collisionSubject(
  diagnostic: AuditableDiagnostic,
  source: string | undefined,
): string {
  const argumentIndex = diagnostic.failure.violation.kind === "contradicted" &&
      diagnostic.failure.violation.conflictPath[0]?.kind === "tuple-item"
    ? diagnostic.failure.violation.conflictPath[0].index
    : undefined;
  if (source && argumentIndex !== undefined) {
    const primaryFilePath = diagnostic.primary.kind === "source"
      ? diagnostic.primary.filePath
      : undefined;
    const argument = diagnostic.support.entries.find((entry): entry is ClaimEntry =>
      entry.kind === "claim" && entry.claim.kind === "has-type" &&
      entry.claim.subject === `argument ${argumentIndex + 1}` && entry.origin.kind === "source" &&
      (entry.origin.filePath === undefined || entry.origin.filePath === primaryFilePath)
    );
    if (argument?.origin.kind === "source") {
      const selected = sliceSource(source, argument.origin.span).replace(/\s+/g, " ").trim();
      if (selected) return clip(selected, 40);
    }
  }
  if (source && diagnostic.primary.kind === "source") {
    const selected = sliceSource(source, diagnostic.primary.span).replace(/\s+/g, " ").trim();
    if (selected) return clip(selected, 40);
  }
  const fact = diagnostic.support.entries.find((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.claim.kind === "fact" &&
    entry.claim.text.startsWith("callee ")
  );
  if (fact?.claim.kind === "fact") {
    const match = /^callee ([^:]+):/.exec(fact.claim.text);
    if (match) return match[1];
  }
  return diagnostic.failure.frame.subject || "call";
}

function annotationMismatchSubject(
  diagnostic: AuditableDiagnostic,
  source: string | undefined,
): string {
  const slot = annotationMismatchSlot(diagnostic);
  if (slot) return slot.parameterName;
  return collisionSubject(diagnostic, source);
}

type AnnotationMismatchSlot = {
  annotation: ClaimEntry;
  parameter: ClaimEntry;
  parameterName: string;
};

function annotationMismatchSlot(
  diagnostic: AuditableDiagnostic,
): AnnotationMismatchSlot | undefined {
  if (diagnostic.failure.frame.rule !== "InferAnnotation.ParameterMatchesAnnotation") {
    return undefined;
  }
  const annotation = diagnostic.support.entries.find((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.claim.kind === "fact" &&
    entry.claim.text === "parameter annotation" && entry.origin.kind === "source"
  );
  const primaryStart = diagnostic.primary.kind === "source"
    ? diagnostic.primary.span.start
    : Number.POSITIVE_INFINITY;
  const parameter = diagnostic.support.entries
    .filter((entry): entry is ClaimEntry =>
      entry.kind === "claim" && entry.claim.kind === "has-type" &&
      entry.claim.subject.startsWith("parameter ") && entry.origin.kind === "source" &&
      entry.origin.span.start <= primaryStart
    )
    .sort((left, right) =>
      left.origin.kind === "source" && right.origin.kind === "source"
        ? right.origin.span.start - left.origin.span.start
        : 0
    )[0];
  if (!annotation || !parameter || parameter.claim.kind !== "has-type") return undefined;
  return {
    annotation,
    parameter,
    parameterName: parameter.claim.subject,
  };
}

type CallCollisionSlot = {
  subject: string;
  calleeClaim?: ClaimEntry;
  calleeLabel?: string;
  argumentClaim?: ClaimEntry;
  argumentLabel?: string;
};

function callCollisionSlot(
  diagnostic: AuditableDiagnostic,
  source: string | undefined,
): CallCollisionSlot | undefined {
  const path = diagnostic.failure.violation.kind === "contradicted"
    ? diagnostic.failure.violation.conflictPath
    : [];
  const baseSubject = collisionSubject(diagnostic, source);
  const calleeClaim = diagnostic.support.entries.find((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.claim.kind === "fact" &&
    entry.claim.text.startsWith("callee ")
  );
  const argumentClaim = diagnostic.support.entries.find((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.claim.kind === "fact" &&
    entry.claim.text === "call argument"
  );
  const calleeName = calleeClaim?.claim.kind === "fact"
    ? /^callee ([^:]+):/.exec(calleeClaim.claim.text)?.[1]
    : undefined;
  const arityMismatch = callArityMismatch(diagnostic);
  const parameterGroup = arityMismatch
    ? groupedCallClaims(
      diagnostic,
      "parameter",
      diagnostic.failure.violation.kind === "contradicted"
        ? diagnostic.failure.violation.observed.left
        : undefined,
    )
    : undefined;
  const argumentGroup = arityMismatch
    ? groupedCallClaims(
      diagnostic,
      "argument",
      diagnostic.failure.violation.kind === "contradicted"
        ? diagnostic.failure.violation.observed.right
        : undefined,
    )
    : undefined;
  const outerArgument = path[0]?.kind === "tuple-item" ? path[0].index : undefined;
  const fnParameterAt = path.findIndex((segment) => segment.kind === "fn-param");
  if (outerArgument === undefined || fnParameterAt < 0) {
    if (!calleeClaim && !argumentClaim) return undefined;
    return {
      subject: calleeName ?? baseSubject,
      calleeClaim: parameterGroup ?? calleeClaim,
      calleeLabel: parameterGroup
        ? `${arityMismatch?.expected} parameters declared here`
        : calleeName
        ? `${calleeName} signature`
        : "callee signature",
      argumentClaim: argumentGroup ?? argumentClaim,
      argumentLabel: arityMismatch
        ? `${arityMismatch.actual} arguments supplied here`
        : "arguments supplied here",
    };
  }

  // Workman represents a multi-parameter callback as one packed tuple parameter.
  // The tuple item following fn-param therefore names the source-level parameter.
  const packedParameter = path[fnParameterAt + 1];
  const parameterIndex = packedParameter?.kind === "tuple-item"
    ? packedParameter.index
    : path[fnParameterAt].kind === "fn-param"
    ? path[fnParameterAt].index
    : 0;
  return {
    subject: `${baseSubject} parameter ${parameterIndex + 1}`,
    calleeClaim,
    calleeLabel: calleeName
      ? `${calleeName} callback parameter ${parameterIndex + 1}`
      : `argument ${outerArgument + 1} callback parameter ${parameterIndex + 1}`,
    argumentClaim,
    argumentLabel: "arguments supplied here",
  };
}

function callArityMismatch(diagnostic: AuditableDiagnostic): CallArityMismatch | undefined {
  if (diagnostic.failure.violation.kind !== "contradicted") return undefined;
  const snapshot = (id: string) =>
    diagnostic.support.types.find((candidate) => candidate.id === id)?.shape;
  const left = snapshot(diagnostic.failure.violation.observed.left);
  const right = snapshot(diagnostic.failure.violation.observed.right);
  if (left?.kind !== "tuple" || right?.kind !== "tuple") return undefined;
  if (left.items.length === right.items.length) return undefined;
  return { expected: left.items.length, actual: right.items.length };
}

function groupedCallClaims(
  diagnostic: AuditableDiagnostic,
  kind: "parameter" | "argument",
  type: string | undefined,
): ClaimEntry | undefined {
  if (!type) return undefined;
  const claims = diagnostic.support.entries
    .filter((entry): entry is ClaimEntry =>
      entry.kind === "claim" && entry.claim.kind === "has-type" &&
      entry.claim.subject.startsWith(`${kind} `) && entry.origin.kind === "source"
    )
    .sort((left, right) =>
      left.origin.kind === "source" && right.origin.kind === "source"
        ? left.origin.span.start - right.origin.span.start
        : 0
    );
  const first = claims[0];
  const last = claims.at(-1);
  if (!first || !last || first.origin.kind !== "source" || last.origin.kind !== "source") {
    return undefined;
  }
  if (first.origin.filePath !== last.origin.filePath) return undefined;
  return {
    kind: "claim",
    id: `grouped-${kind}s`,
    claim: { kind: "has-type", subject: `${kind}s`, type },
    origin: {
      kind: "source",
      filePath: first.origin.filePath,
      span: { ...first.origin.span, end: last.origin.span.end },
    },
  };
}

function parameterUseLabel(claim: ClaimEntry | undefined): string | undefined {
  if (claim?.claim.kind !== "has-type") return undefined;
  const match = /^parameter (.+)$/.exec(claim.claim.subject);
  return match ? `${match[1]} used as` : undefined;
}

function claimById(diagnostic: AuditableDiagnostic, id: string): ClaimEntry | undefined {
  return diagnostic.support.entries.find((entry): entry is ClaimEntry =>
    entry.kind === "claim" && entry.id === id
  );
}

function longestDerivationPath(
  diagnostic: AuditableDiagnostic,
  claim: ClaimEntry,
  seen = new Set<string>(),
): ClaimEntry[] {
  if (seen.has(claim.id)) return [claim];
  const nextSeen = new Set(seen).add(claim.id);
  const parents = diagnostic.support.edges
    .filter((edge) => edge.to === claim.id && edge.role === "derived")
    .map((edge) => claimById(diagnostic, edge.from))
    .filter((entry): entry is ClaimEntry => !!entry);
  if (parents.length === 0) return [claim];
  const prefix = parents
    .map((parent) => longestDerivationPath(diagnostic, parent, nextSeen))
    .sort((a, b) => b.length - a.length)[0];
  return [...prefix, claim];
}

function collisionOriginColumns(
  diagnostic: AuditableDiagnostic,
  leftType: string,
  left: ClaimEntry | undefined,
  rightType: string,
  right: ClaimEntry | undefined,
  source: string | undefined,
  filePath: string | undefined,
  detailed: boolean,
  leftLabel?: string,
  rightLabel?: string,
): ColumnPair {
  const column = (type: string, claim: ClaimEntry | undefined, label?: string): string[] => {
    const document = claim?.origin.kind === "source"
      ? sourceDocument(diagnostic, claim.origin, filePath, source)
      : undefined;
    const claimSource = document?.source;
    const subject = label ?? (claim ? claimSubject(claim, claimSource) : undefined);
    const heading = subject ? `${type} — ${subject}` : type;
    const excerpt = claimSource && claim?.origin.kind === "source"
      ? detailed
        ? renderContextExcerpt(claimSource, claim.origin.span).split("\n")
        : renderCompactExcerpt(claimSource, claim.origin.span, document?.filePath).lines
      : undefined;
    if (detailed) return [heading, ...(excerpt ? ["", ...excerpt] : [])];
    if (!excerpt) return [subject ? `${subject}: ${type}` : type];
    return [
      ...excerpt.slice(0, -2),
      excerpt.at(-2) ?? "",
      `${excerpt.at(-1) ?? ""}${subject ? ` ${subject}: ${type}` : ` ${type}`}`,
    ];
  };
  return [column(leftType, left, leftLabel), column(rightType, right, rightLabel)];
}

function provenancePathColumns(
  leftType: string,
  leftPath: ClaimEntry[],
  rightType: string,
  rightPath: ClaimEntry[],
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): ColumnPair {
  return [
    [leftType, ...renderCompactPath(leftPath, diagnostic, filePath, source)],
    [rightType, ...renderCompactPath(rightPath, diagnostic, filePath, source)],
  ];
}

function renderCompactPath(
  path: ClaimEntry[],
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): string[] {
  if (path.length === 0) return ["no source path was retained"];
  const retained: (ClaimEntry | undefined)[] = path.length <= 4
    ? path
    : [path[0], path[1], undefined, path[path.length - 2], path[path.length - 1]];
  let step = 0;
  return retained.map((claim) => {
    if (!claim) return "...";
    const prefix = step++ === 0 ? "" : "-> ";
    if (claim.origin.kind !== "source") return `${prefix}${claim.origin.label}`;
    const document = sourceDocument(diagnostic, claim.origin, filePath, source);
    const location = `${relativeFile(document.filePath)}:${claim.origin.span.line}:${
      claim.origin.span.col + 1
    }`;
    const snippet = document.source ? sourceLine(document.source, claim.origin.span) : "";
    return clip(`${prefix}${location}${snippet ? ` : ${snippet}` : ""}`, 62);
  });
}

function sourceDocument(
  diagnostic: AuditableDiagnostic,
  anchor: Extract<import("../diagnostic_writer.ts").SourceAnchor, { kind: "source" }>,
  currentFilePath: string | undefined,
  currentSource: string | undefined,
): { filePath: string | undefined; source: string | undefined } {
  if (!anchor.filePath || anchor.filePath === currentFilePath) {
    return { filePath: anchor.filePath ?? currentFilePath, source: currentSource };
  }
  return {
    filePath: anchor.filePath,
    source: diagnostic.support.sources?.find((item) => item.filePath === anchor.filePath)?.source,
  };
}

type ColumnPair = [left: string[], right: string[]];

function largestColumnWidth(...pairs: ColumnPair[]): number {
  return Math.max(
    ...pairs.flatMap(([left, right]) => [...left, ...right]).map((line) => clip(line, 62).length),
    1,
  );
}

function renderColumns([left, right]: ColumnPair, columnWidth: number): string[] {
  const clippedLeft = left.map((line) => clip(line, 62));
  const clippedRight = right.map((line) => clip(line, 62));
  const height = Math.max(clippedLeft.length, clippedRight.length);
  return Array.from(
    { length: height },
    (_, index) =>
      `  ${(clippedLeft[index] ?? "").padEnd(columnWidth)}    │    ${clippedRight[index] ?? ""}`,
  );
}

function renderAdaptiveColumns(
  columns: ColumnPair,
  columnWidth: number,
  availableWidth: number,
): string[] {
  if (columnWidth * 2 + 11 <= availableWidth) return renderColumns(columns, columnWidth);
  const [left, right] = columns;
  return [...left, ...right]
    .filter((line) => line.length > 0)
    .map((line) => `  ${clip(line, Math.max(1, availableWidth - 2))}`);
}

function renderCompactColumns([left, right]: ColumnPair): string[] {
  const leftWidth = Math.max(...left.map((line) => line.length), 1);
  const height = Math.max(left.length, right.length);
  return Array.from(
    { length: height },
    (_, index) => `  ${(left[index] ?? "").padEnd(leftWidth)}   │ ${right[index] ?? ""}`,
  );
}

function sectionHeader(label: string, columnWidth: number, availableWidth: number): string {
  const totalWidth = Math.min(columnWidth * 2 + 11, availableWidth);
  const prefix = `-- ${label} `;
  return `${prefix}${"-".repeat(Math.max(1, totalWidth - prefix.length))}`;
}

function compactSectionHeader(label: string, columns: ColumnPair, availableWidth: number): string {
  const width = Math.min(
    Math.max(...renderCompactColumns(columns).map((line) => line.length), 1),
    availableWidth,
  );
  const prefix = `-- ${label} `;
  return `${prefix}${"-".repeat(Math.max(1, width - prefix.length))}`;
}

function relativeFile(filePath: string | undefined): string {
  if (!filePath) return "<input>";
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

type CompactExcerpt = {
  lines: string[];
  /** Present when the file location did not fit beside the code and moved to its own line. */
  location: Line | undefined;
  source: Line;
  underlinePrefix: string;
  underline: string;
};

/**
 * Spans only render against the unit they were recorded in. A span that lands outside this source
 * belongs to another file, and excerpting it here would emit an empty line under a huge indent.
 */
function spanWithinSource(source: string, sourceSpan: SourceSpan): boolean {
  if (sourceSpan.start < 0 || sourceSpan.start > source.length) return false;
  const starts = lineStarts(source);
  const lineIndex = sourceSpan.line - 1;
  if (lineIndex < 0 || lineIndex >= starts.length) return false;
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  return sourceSpan.start >= lineStart &&
    sourceSpan.start <= (lineEnd === -1 ? source.length : lineEnd);
}

function renderCompactExcerpt(
  source: string,
  sourceSpan: SourceSpan,
  filePath: string | undefined,
  availableWidth?: number,
): CompactExcerpt {
  const starts = lineStarts(source);
  const lineIndex = Math.max(0, Math.min(sourceSpan.line - 1, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = source.indexOf("\n", lineStart);
  const originalLine = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
  const tiny = availableWidth !== undefined && availableWidth <= TINY_TERMINAL_WIDTH;
  const gutter = `${sourceSpan.line}|${tiny ? "" : " "}`;
  const location = `${relativeFile(filePath)}:${sourceSpan.line}:${sourceSpan.col + 1}`;
  const leading = tiny ? /^[ \t]*/.exec(originalLine)?.[0].length ?? 0 : 0;
  const compacted = tiny
    ? {
      line: originalLine.slice(leading),
      offset: Math.max(0, sourceSpan.start - lineStart - leading),
    }
    : compactLeadingIndent(originalLine, sourceSpan.start - lineStart);
  let line = compacted.line;
  let underlineOffset = compacted.offset;
  let underlineWidth = Math.max(
    1,
    Math.min(
      Math.max(sourceSpan.end, sourceSpan.start + 1),
      lineEnd === -1 ? source.length : lineEnd,
    ) - sourceSpan.start,
  );
  // A location wedged onto the code line is what wraps first on a narrow terminal, and a wrapped
  // "draw.wm:264\n:3" reads as garbage. Once the pair no longer leaves room for a useful excerpt,
  // the location takes its own line above the code instead.
  const minimumCode = tiny ? 8 : 12;
  const hoistLocation = availableWidth !== undefined &&
    gutter.length + minimumCode + 2 + location.length > availableWidth;
  const codeBudget = availableWidth === undefined
    ? undefined
    : Math.max(
      minimumCode,
      availableWidth - gutter.length - (hoistLocation ? 0 : location.length + 2),
    );
  if (codeBudget !== undefined && line.length > codeBudget) {
    const context = tiny ? 0 : 3;
    const marker = "..";
    const start = Math.max(0, Math.min(underlineOffset - context, line.length - codeBudget));
    const leadingMarker = start > 0 ? marker : "";
    const roomAfterLeading = Math.max(1, codeBudget - leadingMarker.length);
    const needsTrailingMarker = start + roomAfterLeading < line.length;
    const sourceWidth = Math.max(1, roomAfterLeading - (needsTrailingMarker ? marker.length : 0));
    const end = Math.min(line.length, start + sourceWidth);
    const trailingMarker = end < line.length ? marker : "";
    line = `${leadingMarker}${line.slice(start, end)}${trailingMarker}`;
    underlineOffset = Math.max(
      leadingMarker.length,
      underlineOffset - start + leadingMarker.length,
    );
    underlineWidth = Math.min(underlineWidth, Math.max(1, line.length - underlineOffset));
  }
  const underlinePrefix = " ".repeat(gutter.length + underlineOffset);
  const underline = "^".repeat(underlineWidth);
  return {
    lines: [
      ...(hoistLocation ? [location] : []),
      hoistLocation ? `${gutter}${line}` : `${gutter}${line}  ${location}`,
      `${underlinePrefix}${underline}`,
    ],
    location: hoistLocation ? documentLine(span(location, "secondary")) : undefined,
    source: hoistLocation
      ? documentLine(span(gutter, "secondary"), span(line))
      : documentLine(span(gutter, "secondary"), span(`${line}  ${location}`)),
    underlinePrefix,
    underline,
  };
}

function compactLeadingIndent(line: string, offset: number): { line: string; offset: number } {
  const leading = /^[ \t]*/.exec(line)?.[0].length ?? 0;
  if (leading <= 8) return { line, offset: Math.max(0, offset) };
  const compactIndent = "  ";
  const removed = leading - compactIndent.length;
  return {
    line: compactIndent + line.slice(leading),
    offset: Math.max(compactIndent.length, offset - removed),
  };
}

function clip(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function clipStart(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 2) return text.slice(-width);
  return `..${text.slice(-(width - 2))}`;
}

function renderTypeBullet(type: string): string {
  const [first = "", ...rest] = type.split("\n");
  return [`- ${first}`, ...rest.map((line) => `  ${line}`)].join("\n");
}

function claimSubject(claim: ClaimEntry, source: string | undefined): string {
  if (
    source && claim.claim.kind === "has-type" && claim.claim.subject === "block result" &&
    claim.origin.kind === "source" && sliceSource(source, claim.origin.span).trim() === ";"
  ) {
    return "ending semicolon";
  }
  return claim.claim.kind === "has-type" ? claim.claim.subject : claim.claim.text;
}
