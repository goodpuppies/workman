import type {
  StructuralArtifact,
  StructuralParseResult,
  StructuralRecoveryMark,
} from "./frontend_v2_loader.ts";
import type {
  AuditableDiagnostic,
  Repair,
  SourceAnchor,
  SupportEntry,
  Violation,
} from "./diagnostic_writer.ts";
import { offsetToLineCol, type SourceSpan } from "./source.ts";

export type StructuralDiagnosticsOptions = {
  includeOptionalCanonical?: boolean;
};

export function structuralDiagnostics(
  result: StructuralParseResult,
  source: string,
  options: StructuralDiagnosticsOptions = {},
): AuditableDiagnostic[] {
  if (result.sourceLength !== source.length) {
    throw new Error("frontend-v2 structural result does not match source length");
  }
  const seen = new Set<number>();
  const diagnostics: AuditableDiagnostic[] = [];
  for (const mark of result.marks) {
    if (seen.has(mark.id)) continue;
    seen.add(mark.id);
    if (mark.repairClass === "optionalCanonical" && !options.includeOptionalCanonical) {
      continue;
    }
    diagnostics.push(structuralDiagnostic(mark, result.artifacts, source));
  }
  return diagnostics;
}

function structuralDiagnostic(
  mark: StructuralRecoveryMark,
  artifacts: StructuralArtifact[],
  source: string,
): AuditableDiagnostic {
  const diagnosticId = diagnosticIdFor(mark.id);
  const frameId = `syntax-frame-${mark.id}`;
  const premiseId = `syntax-premise-${mark.id}`;
  const recoveryId = `syntax-recovery-${mark.id}`;
  const fallbackId = `syntax-fallback-${mark.id}`;
  const sourceAnchor = anchorAt(source, mark.anchor);
  const recoveryAnchor: SourceAnchor = {
    kind: "recovery",
    step: recoveryId,
    label: `${mark.recovery} -> ${mark.fallbackCategory}#${mark.fallbackNode}`,
  };
  const artifact = artifacts.find((item) => item.recoveryId === mark.id);
  const recoveryEntry: Extract<SupportEntry, { kind: "recovery" }> = {
    kind: "recovery",
    id: recoveryId,
    action: mark.recovery,
    anchor: sourceAnchor,
    insertedText: artifact?.text ?? "",
    fallbackNode: String(mark.fallbackNode),
    fallbackCategory: mark.fallbackCategory,
    repairClass: mark.repairClass,
  };
  const fallbackEntry: Extract<SupportEntry, { kind: "note" }> = {
    kind: "note",
    id: fallbackId,
    message: `parser continued with ${mark.fallbackCategory}#${mark.fallbackNode}`,
    origin: recoveryAnchor,
  };
  const repairs = repairFor(mark, premiseId, recoveryId, source);
  return {
    id: diagnosticId,
    code: mark.code,
    severity: mark.severity,
    primary: sourceAnchor,
    failure: {
      frame: {
        id: frameId,
        rule: mark.rule,
        subject: `node#${mark.subject}`,
        anchor: sourceAnchor,
        path: mark.rulePath.split(" -> "),
      },
      premise: {
        id: premiseId,
        role: mark.expectation,
        predicate: {
          kind: "present",
          subject: `node#${mark.subject}`,
          syntaxCategory: mark.fallbackCategory,
        },
        origin: sourceAnchor,
      },
      violation: violationFor(mark),
    },
    support: {
      entries: [recoveryEntry, fallbackEntry],
      edges: [{ from: recoveryId, to: fallbackId, role: "produced-fallback" }],
      roots: [recoveryId],
      types: [],
    },
    repairs,
    dependsOn: mark.dependsOn.map(diagnosticIdFor),
  };
}

function violationFor(mark: StructuralRecoveryMark): Violation {
  if (mark.code.includes("opaque") || mark.code.includes("unexpected")) {
    return {
      kind: "unexpected",
      observedToken: mark.observation,
      expected: [mark.expectation],
    };
  }
  return { kind: "missing", observedBoundary: mark.observation };
}

function repairFor(
  mark: StructuralRecoveryMark,
  premiseId: string,
  recoveryId: string,
  source: string,
): Repair[] {
  if (!mark.hasRepair || !mark.repairText) return [];
  return [{
    id: `syntax-repair-${mark.id}`,
    description: `Insert ${JSON.stringify(mark.repairText)}`,
    edits: [{ span: spanAt(source, mark.anchor), text: mark.repairText }],
    makesTrue: premiseId,
    requires: [recoveryId],
    applicability: mark.repairClass === "autoFix" ? "safe" : "suggested",
  }];
}

function anchorAt(source: string, offset: number): SourceAnchor {
  return { kind: "source", span: spanAt(source, offset) };
}

function spanAt(source: string, offset: number): SourceSpan {
  const bounded = Math.max(0, Math.min(offset, source.length));
  const position = offsetToLineCol(source, bounded);
  return { line: position.line, col: position.col, start: bounded, end: bounded };
}

function diagnosticIdFor(recoveryId: number): string {
  return `syntax-diagnostic-${recoveryId}`;
}
