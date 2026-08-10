import type { AuditableDiagnostic } from "../diagnostic_writer.ts";
import { type EnhancedDiagnosticRenderOptions, renderHeaderLine } from "./rendering.ts";
import { neutralTypeCollisionProfile } from "./neutral_type_collision.ts";
import { missingEntrypointProfile } from "./missing_entrypoint.ts";
import { type AuthoredDiagnosticProfile, profileMatches } from "./profile.ts";
import { recursiveResultAgreementProfile } from "./recursive_result_agreement.ts";
import { type Document, line, span } from "../../tooling/tuiman/document.ts";

const authoredDiagnosticProfiles: AuthoredDiagnosticProfile[] = [
  missingEntrypointProfile,
  neutralTypeCollisionProfile,
  recursiveResultAgreementProfile,
];

export function formatAuthoredDiagnostic(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
  options: EnhancedDiagnosticRenderOptions = {},
): string | undefined {
  const profile = authoredDiagnosticProfiles.find((item) => profileMatches(item, diagnostic));
  if (!profile) return undefined;
  return profile.render(diagnostic, filePath, source, { mode: options.mode ?? "authored" });
}

export function authoredDiagnosticDocument(
  diagnostic: AuditableDiagnostic,
  filePath: string | undefined,
  source: string | undefined,
): Document | undefined {
  const profile = authoredDiagnosticProfiles.find((item) => profileMatches(item, diagnostic));
  if (!profile) return undefined;
  if (profile.terminalDocument) return profile.terminalDocument(diagnostic, filePath, source);
  const rendered = profile.render(diagnostic, filePath, source, { mode: "authored" }).trimEnd();
  const lines = rendered.split("\n");
  return {
    lines: [
      renderHeaderLine(diagnostic, filePath),
      ...lines.slice(1).map((text) => line(span(text))),
    ],
  };
}
