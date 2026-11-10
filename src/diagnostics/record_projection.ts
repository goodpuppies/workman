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
  renderCompactExcerpt,
  renderExplainDiagnostic,
  renderHeaderLine,
  renderTraceDiagnostic,
  typeSnapshotRendered,
} from "./rendering.ts";

export const recordProjectionProfile: AuthoredDiagnosticProfile = {
  id: "record-projection",
  codes: ["record.invalid-projection"],
  render(diagnostic, filePath, source, options) {
    if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
    if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);
    return `${plainText(recordProjectionDocument(diagnostic, filePath, source))}\n`;
  },
  terminalDocument: recordProjectionDocument,
};

function recordProjectionDocument(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): Document {
  const width = terminalWidth();
  const lines = [renderHeaderLine(diagnostic, filePath)];
  const violation = diagnostic.failure.violation;
  if (violation.kind === "unsatisfied") {
    lines.push(
      ...wrapDocument({ lines: [line(span(`  ${violation.message}`, "error"))] }, width).lines,
    );
  }
  const excerpt = (anchor: SourceAnchor, role: "error" | "secondary") => {
    if (anchor.kind !== "source") return;
    const path = anchor.filePath ?? filePath;
    const text = anchor.filePath && anchor.filePath !== filePath
      ? diagnostic.support.sources?.find((item) => item.filePath === anchor.filePath)?.source
      : source;
    if (!text) {
      lines.push(line(span(
        `  ${relativeDiagnosticPath(path)}:${anchor.span.line}:${anchor.span.col + 1}`,
        "secondary",
      )));
      return;
    }
    // Use the same cropping and location placement as authored type collisions.
    const view = renderCompactExcerpt(text, anchor.span, path, width - 2);
    if (view.location) lines.push(line(span("  "), ...view.location.spans));
    lines.push(line(span("  "), ...view.source.spans));
    lines.push(line(span(`  ${view.underlinePrefix}`), span(view.underline, role)));
  };
  excerpt(diagnostic.primary, "error");
  const origins = diagnostic.support.entries.filter((entry) =>
    entry.kind === "claim" && entry.claim.kind === "has-type"
  );
  if (origins.length) {
    lines.push(line(span(`-- Origins ${"-".repeat(Math.max(1, width - 11))}`, "header")));
  }
  for (const entry of origins) {
    if (entry.kind !== "claim" || entry.claim.kind !== "has-type") continue;
    lines.push(
      ...wrapDocument({
        lines: [line(
          span(`  ${entry.claim.subject}: `, "secondary"),
          span(typeSnapshotRendered(diagnostic, entry.claim.type), "type"),
        )],
      }, width).lines,
    );
    excerpt(entry.origin, "secondary");
  }
  if (filePath) {
    lines.push(line(span(
      `- use wm err ${relativeDiagnosticPath(filePath)} to see a more detailed error`,
      "hint",
    )));
  }
  return { lines };
}
