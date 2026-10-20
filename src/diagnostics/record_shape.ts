import type { AuditableDiagnostic, SourceAnchor } from "../diagnostic_writer.ts";
import {
  type Document,
  line,
  plainText,
  span,
  terminalWidth,
  wrapDocument,
} from "../../tooling/tuiman/document.ts";
import type { AuthoredDiagnosticProfile } from "./profile.ts";
import {
  relativeDiagnosticPath,
  renderContextExcerpt,
  renderExplainDiagnostic,
  renderHeaderLine,
  renderTraceDiagnostic,
} from "./rendering.ts";

export const recordShapeProfile: AuthoredDiagnosticProfile = {
  id: "record-field-set",
  codes: [
    "record.missing-fields",
    "record.unknown-fields",
    "record.field-set-mismatch",
    "record.ambiguous-incomplete",
    "record.no-matching-type",
  ],
  render(diagnostic, filePath, source, options) {
    if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
    if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);
    return `${plainText(recordShapeDocument(diagnostic, filePath, source))}\n`;
  },
  terminalDocument: recordShapeDocument,
};

function recordShapeDocument(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): Document {
  const lines = [renderHeaderLine(diagnostic, filePath)];
  const violation = diagnostic.failure.violation;
  if (violation.kind === "unsatisfied") {
    lines.push(line(span(`  ${violation.message}`, "error")));
  }
  const excerpt = (anchor: SourceAnchor) => {
    if (anchor.kind !== "source") return;
    const path = anchor.filePath ?? filePath;
    const text = anchor.filePath && anchor.filePath !== filePath
      ? diagnostic.support.sources?.find((item) => item.filePath === anchor.filePath)?.source
      : source;
    lines.push(line(span(
      `  ${relativeDiagnosticPath(path)}:${anchor.span.line}:${anchor.span.col + 1}`,
      "secondary",
    )));
    if (text) {
      lines.push(
        ...renderContextExcerpt(text, anchor.span).split("\n").map((text) =>
          line(span(`  ${text}`, "plain"))
        ),
      );
    }
  };
  excerpt(diagnostic.primary);
  const details = diagnostic.support.entries.filter((entry) =>
    entry.kind === "claim" && entry.claim.kind === "fact" &&
    (entry.claim.subject === "required field" || entry.claim.subject === "unknown field")
  );
  if (details.length) lines.push(line(), line(span("-- Field details --", "header")));
  for (const entry of details) {
    if (entry.kind !== "claim" || entry.claim.kind !== "fact") continue;
    lines.push(line(span(`  ${entry.claim.text}`, "type")));
    excerpt(entry.origin);
  }
  if (filePath) {
    lines.push(line(span(
      `- use wm err ${relativeDiagnosticPath(filePath)} to see a more detailed error`,
      "hint",
    )));
  }
  return wrapDocument({ lines }, terminalWidth());
}
