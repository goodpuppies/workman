import type {
  FrontendV2SurfaceProgram,
  FrontendV2SurfaceRecoveryMark,
} from "../frontend_v2_surface_loader.ts";
import { offsetToLineCol } from "../source.ts";
import type { LspDiagnostic } from "./validation.ts";
import type { LspRange } from "./range.ts";

const committedTokens = new Set([";", "{", "}"]);

export function surfaceRecoveryDiagnostics(
  source: string,
  surface: FrontendV2SurfaceProgram | undefined,
): LspDiagnostic[] {
  if (!surface) return [];
  return surface.marks
    .filter(isCommittedMark)
    .map((mark) => ({
      range: insertionRange(source, displayAnchor(source, mark)),
      severity: 2,
      code: diagnosticCode(mark, source),
      source: "wm-mini",
      message: `Missing ${tokenName(mark.expectedText)}.`,
    }));
}

export function surfaceRecoveryInlayHints(
  source: string,
  surface: FrontendV2SurfaceProgram | undefined,
  range: LspRange,
): SurfaceRecoveryInlayHint[] {
  if (!surface) return [];
  return surface.marks
    .filter(isCommittedMark)
    .filter((mark) => positionInRange(source, displayAnchor(source, mark), range))
    .map((mark) => {
      const position = offsetToLineCol(source, displayAnchor(source, mark));
      return {
        position: { line: position.line - 1, character: position.col },
        label: mark.expectedText,
        tooltip: `Virtual Workman syntax: insert ${tokenName(mark.expectedText)}`,
        data: {
          kind: "workman.structural",
          recoveryId: mark.id,
          repairClass: mark.repairClass,
          pairId: 0,
          order: mark.id,
          code: diagnosticCode(mark, source),
        },
      };
    });
}

export function isCommittedRecoveryText(text: string): boolean {
  return committedTokens.has(text);
}

function isCommittedMark(mark: FrontendV2SurfaceRecoveryMark): boolean {
  return mark.repairClass === "autoFix" && committedTokens.has(mark.expectedText);
}

function diagnosticCode(mark: FrontendV2SurfaceRecoveryMark, source: string): string {
  if (mark.expectedText === ";") {
    if (mark.rule.startsWith("SemiToken")) return "parse.let.missing-semicolon";
    const phrase = source.slice(0, mark.anchor).trimEnd().split(/[;\n}]/).at(-1)?.trimStart() ?? "";
    if (phrase.startsWith("from ")) return "parse.import.missing-semicolon";
    if (phrase.startsWith("type ")) return "parse.type.missing-semicolon";
    if (phrase.startsWith("record ")) return "parse.record.missing-semicolon";
    return "parse.let.missing-semicolon";
  }
  if (mark.rule.includes("Lambda")) {
    return mark.expectedText === "{"
      ? "parse.lambda.missing-body-open-block"
      : "parse.expression.missing-close-brace";
  }
  if (mark.rule.includes("If")) {
    const branch = mark.rule.toLowerCase().includes("else") ? "else" : "then";
    return `parse.if.missing-${branch}-${mark.expectedText === "{" ? "open" : "close"}-block`;
  }
  return mark.expectedText === "}" ? "parse.expression.missing-close-brace" : "parse.syntax-error";
}

function tokenName(text: string): string {
  if (text === ";") return "semicolon";
  if (text === "{") return "opening brace";
  if (text === "}") return "closing brace";
  return JSON.stringify(text);
}

function displayAnchor(source: string, mark: FrontendV2SurfaceRecoveryMark): number {
  if (mark.expectedText !== ";") return mark.anchor;
  let anchor = mark.anchor;
  while (anchor > 0 && /\s/.test(source[anchor - 1] ?? "")) anchor--;
  return anchor;
}

function insertionRange(source: string, offset: number) {
  const position = offsetToLineCol(source, offset);
  const point = { line: position.line - 1, character: position.col };
  return { start: point, end: point };
}

function positionInRange(source: string, offset: number, range: LspRange): boolean {
  const position = offsetToLineCol(source, offset);
  const line = position.line - 1;
  const character = position.col;
  return compare(line, character, range.start.line, range.start.character) >= 0 &&
    compare(line, character, range.end.line, range.end.character) <= 0;
}

function compare(leftLine: number, leftCol: number, rightLine: number, rightCol: number): number {
  return leftLine - rightLine || leftCol - rightCol;
}
export type SurfaceRecoveryInlayHint = {
  position: { line: number; character: number };
  label: string;
  tooltip: string;
  data: {
    kind: "workman.structural";
    recoveryId: number;
    repairClass: "autoFix" | "recoveryOnly";
    pairId: number;
    order: number;
    code: string;
  };
};
