import type { SupportEntry } from "../diagnostic_writer.ts";
import {
  findClaim,
  findClaimWithType,
  findNoteAt,
  firstParameterType,
  indent,
  isDirectPipeInputConflict,
  renderContextExcerpt,
  renderExplainDiagnostic,
  renderHeader,
  renderTraceDiagnostic,
  renderTypeBlock,
  typeSnapshotRendered,
} from "./rendering.ts";
import type { AuthoredDiagnosticProfile } from "./profile.ts";

export const pipeStepInputProfile: AuthoredDiagnosticProfile = {
  id: "pipe-step-input",
  codes: ["type.pipe-input-mismatch"],
  render(diagnostic, filePath, source, options) {
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
      [violation.origins?.right, violation.origins?.left],
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
    const calleeName = diagnostic.failure.frame.subject || "the next function";
    const lines = [
      renderHeader(diagnostic, filePath),
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
  },
};
