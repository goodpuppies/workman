import type { AuditableDiagnostic } from "../diagnostic_writer.ts";
import type { EnhancedDiagnosticRenderOptions } from "./rendering.ts";
import type { Document } from "../../tooling/tuiman/document.ts";

export type AuthoredDiagnosticProfile = {
  id: string;
  codes: string[];
  rules?: string[];
  render: (
    diagnostic: AuditableDiagnostic,
    filePath: string | undefined,
    source: string | undefined,
    options: Required<EnhancedDiagnosticRenderOptions>,
  ) => string;
  terminalDocument?: (
    diagnostic: AuditableDiagnostic,
    filePath: string | undefined,
    source: string | undefined,
  ) => Document;
};

export function profileMatches(
  profile: AuthoredDiagnosticProfile,
  diagnostic: AuditableDiagnostic,
): boolean {
  if (!profile.codes.includes(diagnostic.code)) return false;
  return !profile.rules || profile.rules.includes(diagnostic.failure.frame.rule);
}
