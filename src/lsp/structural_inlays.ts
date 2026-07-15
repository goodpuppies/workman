import type {
  StructuralArtifact,
  StructuralParseResult,
  StructuralRecoveryMark,
} from "../frontend_v2_loader.ts";
import { lineColToOffset, lineStarts, offsetToLineColFromStarts } from "../source.ts";
import type { LspPosition, LspRange } from "./range.ts";

export type StructuralInlayHint = {
  position: LspPosition;
  label: string;
  tooltip: string;
  data: StructuralInlayData;
};

export type StructuralInlayData = {
  kind: "workman.structural";
  recoveryId: number;
  repairClass: StructuralArtifact["repairClass"];
  pairId: number;
  order: number;
  code?: string;
};

export function structuralInlayHints(
  source: string,
  result: StructuralParseResult,
  range: LspRange,
): StructuralInlayHint[] {
  const starts = lineStarts(source);
  const start = positionOffset(range.start, starts, source.length);
  const end = positionOffset(range.end, starts, source.length);
  const marks = new Map(result.marks.map((mark) => [mark.id, mark]));

  return result.artifacts
    .filter((artifact) => artifact.text.trim().length > 0)
    .filter((artifact) => artifact.anchor >= start && artifact.anchor <= end)
    .map((artifact) => inlayForArtifact(artifact, marks.get(artifact.recoveryId), starts));
}

function inlayForArtifact(
  artifact: StructuralArtifact,
  mark: StructuralRecoveryMark | undefined,
  starts: number[],
): StructuralInlayHint {
  const location = offsetToLineColFromStarts(artifact.anchor, starts);
  return {
    position: { line: location.line - 1, character: location.col },
    label: artifact.text,
    tooltip: structuralTooltip(artifact, mark),
    data: {
      kind: "workman.structural",
      recoveryId: artifact.recoveryId,
      repairClass: artifact.repairClass,
      pairId: artifact.pairId,
      order: artifact.order,
      ...(mark ? { code: mark.code } : {}),
    },
  };
}

function structuralTooltip(
  artifact: StructuralArtifact,
  mark: StructuralRecoveryMark | undefined,
): string {
  const explanation = mark?.expectation || artifact.reason;
  return explanation ? `Virtual Workman syntax: ${explanation}` : "Virtual Workman syntax";
}

function positionOffset(position: LspPosition, starts: number[], sourceLength: number): number {
  return Math.min(
    sourceLength,
    lineColToOffset(position.line + 1, position.character, starts),
  );
}
