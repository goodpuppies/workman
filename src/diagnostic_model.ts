// Diagnostic data and error construction: usable without terminal/editor renderers.
import {
  type AuditableDiagnostic,
  createDiagnosticWriter,
  type Failure,
  premiseContext,
} from "./diagnostic_writer.ts";
import type { AstNode } from "./source.ts";
import { displayTypeVariables } from "./diagnostic_type_display.ts";
import { formatPathSegment, TypeMismatchError } from "./type_diff.ts";
import { renderViolation } from "./diagnostic_syntax_renderer.ts";

export type FrontendDiagnostic = AuditableDiagnostic;

export class FrontendDiagnosticError extends Error {
  diagnostic: FrontendDiagnostic;

  constructor(diagnostic: FrontendDiagnostic) {
    super(renderDiagnosticSummary(diagnostic));
    this.name = "FrontendDiagnosticError";
    this.diagnostic = diagnostic;
  }
}

export class FrontendDiagnosticBundleError extends Error {
  primary: unknown;
  diagnostics: FrontendDiagnostic[];

  constructor(primary: unknown, diagnostics: FrontendDiagnostic[]) {
    super(errorMessage(primary));
    this.name = "FrontendDiagnosticBundleError";
    this.primary = primary;
    this.diagnostics = diagnostics;
  }
}

export function diagnosticError(
  error: unknown,
  node: AstNode | undefined,
  code = classifyDiagnostic(errorMessage(error)),
): FrontendDiagnosticError {
  if (error instanceof FrontendDiagnosticError) return error;
  if (error instanceof TypeMismatchError) {
    return new FrontendDiagnosticError(
      typeMismatchDiagnostic(error.left, error.right, error.path, node, code),
    );
  }
  return new FrontendDiagnosticError(
    genericDiagnostic("error", code, errorMessage(error), node),
  );
}

export function warningDiagnostic(
  message: string,
  node: AstNode | undefined,
  code: string,
): FrontendDiagnostic {
  return genericDiagnostic("warning", code, message, node);
}

export function genericDiagnostic(
  severity: "error" | "warning",
  code: string,
  message: string,
  node?: AstNode,
): FrontendDiagnostic {
  const writer = createDiagnosticWriter();
  const context = premiseContext(code, "diagnostic", message, node, {
    frame: writer.nextId("f"),
    premise: writer.nextId("p"),
  });
  const claimId = writer.nextId("cl");
  writer.add({
    kind: "claim",
    id: claimId,
    claim: { kind: "fact", subject: code, text: message },
    origin: context.origin,
  });
  const failure: Failure = {
    frame: context.frame,
    premise: context.premise,
    violation: {
      kind: "unsatisfied",
      message,
    },
  };
  return {
    id: writer.nextId("d"),
    code,
    severity,
    primary: context.origin,
    failure,
    support: writer.buildSupport([claimId]),
    repairs: [],
    dependsOn: [],
  };
}

export function typeMismatchDiagnostic(
  left: import("./types.ts").Ty,
  right: import("./types.ts").Ty,
  path: import("./type_diff.ts").DiffPath,
  node: AstNode | undefined,
  code = "type.mismatch",
): FrontendDiagnostic {
  const writer = createDiagnosticWriter();
  const leftSnapshot = writer.snapshotType(left);
  const rightSnapshot = writer.snapshotType(right);
  const context = premiseContext(code, "types are equal", "type constraint", node, {
    frame: writer.nextId("f"),
    premise: writer.nextId("p"),
  }, [
    { term: "left", role: "expected", snapshot: leftSnapshot },
    { term: "right", role: "actual", snapshot: rightSnapshot },
  ]);
  const constraintId = writer.nextId("c");
  writer.add({
    kind: "constraint",
    id: constraintId,
    frame: context.frame.id,
    premise: context.premise.id,
    left: leftSnapshot,
    right: rightSnapshot,
    roles: context.roles,
    origin: context.origin,
  });
  const collisionId = writer.nextId("x");
  writer.add({
    kind: "collision",
    id: collisionId,
    constraint: constraintId,
    left: leftSnapshot,
    right: rightSnapshot,
    path,
  });
  writer.addEdge({ from: constraintId, to: collisionId, role: "failed" });
  return {
    id: writer.nextId("d"),
    code,
    severity: "error",
    primary: context.origin,
    failure: {
      frame: context.frame,
      premise: {
        ...context.premise,
        predicate: { kind: "equal", left: leftSnapshot, right: rightSnapshot, domain: "type" },
      },
      violation: {
        kind: "contradicted",
        observed: { left: leftSnapshot, right: rightSnapshot },
        conflictPath: path,
      },
    },
    support: writer.buildSupport([collisionId]),
    repairs: [],
    dependsOn: [],
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyDiagnostic(message: string): string {
  if (message.includes("type mismatch")) return "type.mismatch";
  if (message.includes("cannot resolve npm package")) return "js.package-resolution";
  if (message.includes("unknown import")) return "module.unknown-import";
  if (message.includes("duplicate value import") || message.includes("duplicate type import")) {
    return "module.duplicate-import";
  }
  if (message.includes("cannot resolve import")) return "module.resolve-import";
  if (message.includes("import cycle")) return "module.import-cycle";
  if (message.includes("Expected") || message.includes("expected")) return "parse.syntax-error";
  return "error";
}

export function renderDiagnosticSummary(diagnostic: FrontendDiagnostic): string {
  const violation = diagnostic.failure.violation;
  if (violation.kind !== "contradicted") return renderViolation(violation);
  const left = typeSnapshotRendered(diagnostic, violation.observed.left);
  const right = typeSnapshotRendered(diagnostic, violation.observed.right);
  const path = violation.conflictPath.length
    ? violation.conflictPath.map(formatPathSegment).join(" -> ")
    : "type";
  const neutral = isNeutralHmCollision(diagnostic);
  return [
    `${
      neutral ? "type collision" : "type mismatch"
    }: ${diagnostic.failure.frame.rule}: ${diagnostic.failure.premise.role}`,
    violation.context ? `  context: ${violation.context}` : undefined,
    `  conflict: ${path}`,
    `  ${neutral ? "left" : "expected"}: ${left}`,
    violation.origins?.left ? `    source: ${violation.origins.left}` : undefined,
    neutral ? `  right: ${right}` : `  actual:   ${right}`,
    violation.origins?.right ? `    source: ${violation.origins.right}` : undefined,
  ].filter((line): line is string => !!line).join("\n");
}

export function isNeutralHmCollision(diagnostic: FrontendDiagnostic): boolean {
  return diagnostic.code === "type.call-argument-mismatch" ||
    diagnostic.code === "type.match-arm-results-disagree";
}

export function typeSnapshotRendered(diagnostic: FrontendDiagnostic, id: string): string {
  return displayTypeVariables(
    diagnostic.support.types.find((snapshot) => snapshot.id === id)?.rendered ?? id,
  );
}
