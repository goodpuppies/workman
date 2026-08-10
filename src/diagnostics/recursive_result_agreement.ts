import {
  findFactClaim,
  indent,
  renderContextExcerpt,
  renderExplainDiagnostic,
  renderHeader,
  renderTraceDiagnostic,
  renderTypeBlock,
  typeSnapshotRendered,
} from "./rendering.ts";
import type { AuthoredDiagnosticProfile } from "./profile.ts";

export const recursiveResultAgreementProfile: AuthoredDiagnosticProfile = {
  id: "recursive-result-agreement",
  codes: ["type.recursive-result-mismatch"],
  render(diagnostic, filePath, source, options) {
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
      renderHeader(diagnostic, filePath),
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
  },
};
