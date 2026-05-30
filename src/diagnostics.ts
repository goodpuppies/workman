import type { AstNode, SourceSpan } from "./source.ts";
import { lineStarts, sliceSource } from "./source.ts";

export type FrontendDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  node?: AstNode;
  span?: SourceSpan;
  related?: FrontendRelatedDiagnostic[];
};

export type FrontendRelatedDiagnostic = {
  message: string;
  node?: AstNode;
  span?: SourceSpan;
  primary?: boolean;
  expectedCallTupleShape?: number;
  actualCallTupleShape?: number;
  callDepth?: number;
};

export class FrontendDiagnosticError extends Error {
  diagnostic: FrontendDiagnostic;

  constructor(diagnostic: FrontendDiagnostic) {
    super(diagnostic.message);
    this.name = "FrontendDiagnosticError";
    this.diagnostic = diagnostic;
  }
}

export function formatError(
  message: string,
  filePath: string | undefined,
  source: string | undefined,
  span: SourceSpan | undefined,
): string {
  const location = span && source
    ? `${filePath || "<input>"}:${span.line}:${span.col}`
    : filePath || "<input>";
  
  let output = `error[${location}]: ${message}\n`;
  
  if (source && span) {
    const starts = lineStarts(source);
    const lineIndex = Math.max(0, Math.min(span.line - 1, starts.length - 1));
    const lineStart = starts[lineIndex];
    const lineEnd = source.indexOf("\n", lineStart);
    const line = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
    
    output += `  ${line}\n`;
    
    const spaces = " ".repeat(span.col);
    const carets = "^".repeat(Math.max(1, span.end - span.start));
    output += `  ${spaces}${carets}\n`;
  }
  
  return output;
}

export function diagnosticError(
  error: unknown,
  node: AstNode | undefined,
  code = classifyDiagnostic(errorMessage(error)),
  related: FrontendRelatedDiagnostic[] = [],
): FrontendDiagnosticError {
  if (error instanceof FrontendDiagnosticError) return error;
  return new FrontendDiagnosticError({
    severity: "error",
    code,
    message: errorMessage(error),
    node,
    span: node?.span,
    related,
  });
}

export function warningDiagnostic(
  message: string,
  node: AstNode | undefined,
  code: string,
): FrontendDiagnostic {
  return {
    severity: "warning",
    code,
    message,
    node,
    span: node?.span,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyDiagnostic(message: string): string {
  if (message.includes("type mismatch")) return "type.mismatch";
  if (message.includes("unknown import")) return "module.unknown-import";
  if (message.includes("duplicate value import") || message.includes("duplicate type import")) {
    return "module.duplicate-import";
  }
  if (message.includes("cannot resolve import")) return "module.resolve-import";
  if (message.includes("import cycle")) return "module.import-cycle";
  if (message.includes("Expected") || message.includes("expected")) return "parse.syntax-error";
  return "error";
}
