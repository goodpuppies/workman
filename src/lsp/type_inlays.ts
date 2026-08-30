import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import type { ModuleInterface, SemanticInferredTypeHint } from "../module_interface.ts";
import { lineColToOffset, lineStarts, offsetToLineColFromStarts } from "../source.ts";
import { renderSemanticType, renderSemanticTypeCompact } from "./hover_type_display.ts";
import type { LspPosition, LspRange } from "./range.ts";
import { semanticDocumentContext } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";

export type InferredTypeInlayHint = {
  position: LspPosition;
  label: string;
  kind: 1;
  tooltip: Readonly<{ kind: "markdown"; value: string }>;
  paddingLeft: false;
  paddingRight: true;
  data: Readonly<{
    kind: "workman.inferred-type";
    category: "binding" | "parameter" | "result";
  }>;
};

export type ParameterNameInlayHint = {
  position: LspPosition;
  label: string;
  kind: 2;
  tooltip: string;
  paddingLeft: false;
  paddingRight: true;
  data: Readonly<{ kind: "workman.parameter-name" }>;
};

export type RecoveryHoleInlayHint = {
  position: LspPosition;
  label: "?";
  kind?: never;
  tooltip: string;
  data: Readonly<{
    kind: "workman.structural";
    recoveryId: number;
    repairClass: "recoveryOnly";
    pairId: 0;
    order: number;
    code: string;
  }>;
};

export type WorkmanSemanticInlayHint =
  | InferredTypeInlayHint
  | ParameterNameInlayHint
  | RecoveryHoleInlayHint;
export type SemanticInlayOptions = Readonly<{
  typeHints?: boolean;
  parameterHints?: boolean;
  recoveryHoles?: boolean;
}>;

const MAX_TYPE_INLAY_LABEL_LENGTH = 60;

/** Standard, editor-neutral inferred-type inlays from compiler-owned module-interface facts. */
export async function semanticInlayHints(
  uri: string,
  range: LspRange,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  inlayOptions: SemanticInlayOptions = {},
  service?: SemanticService,
): Promise<WorkmanSemanticInlayHint[]> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return [];
  const starts = lineStarts(context.source);
  const start = positionOffset(range.start, starts, context.source.length);
  const end = positionOffset(range.end, starts, context.source.length);
  const inferred: WorkmanSemanticInlayHint[] = inlayOptions.typeHints === false
    ? []
    : context.moduleInterface.inferredTypeHints
      .filter((hint) => hint.span.end >= start && hint.span.end <= end)
      .flatMap((hint) => {
        const typeId = inferredHintTypeId(context.moduleInterface, hint);
        if (typeId === undefined) return [];
        const position = offsetToLineColFromStarts(hint.span.end, starts);
        const full = renderSemanticType(context.moduleInterface, typeId);
        const compact = truncateTypeInlay(
          `: ${renderSemanticTypeCompact(context.moduleInterface, typeId)}`,
        );
        return [{
          position: { line: position.line - 1, character: position.col },
          label: compact,
          kind: 1 as const,
          tooltip: Object.freeze({
            kind: "markdown" as const,
            value: `\`\`\`workman\n${full}\n\`\`\``,
          }),
          paddingLeft: false as const,
          paddingRight: true as const,
          data: Object.freeze({
            kind: "workman.inferred-type" as const,
            category: hint.kind,
          }),
        }];
      });
  const parameters: WorkmanSemanticInlayHint[] = inlayOptions.parameterHints === false
    ? []
    : context.moduleInterface.parameterHints
      .filter((hint) => hint.span.start >= start && hint.span.start <= end)
      .map((hint) => {
        const position = offsetToLineColFromStarts(hint.span.start, starts);
        return {
          position: { line: position.line - 1, character: position.col },
          label: `${hint.name}:`,
          kind: 2 as const,
          tooltip: `Parameter \`${hint.name}\``,
          paddingLeft: false as const,
          paddingRight: true as const,
          data: Object.freeze({ kind: "workman.parameter-name" as const }),
        };
      });
  const recoveryHoles: RecoveryHoleInlayHint[] = inlayOptions.recoveryHoles === true
    ? [...context.moduleInterface.recoveryHoles, ...context.recoveryHoles]
      .filter((hole) => hole.anchor >= start && hole.anchor <= end)
      .map((hole) => {
        const position = offsetToLineColFromStarts(hole.anchor, starts);
        return {
          position: { line: position.line - 1, character: position.col },
          label: "?",
          tooltip: "Virtual Workman syntax: inferred hole for an unfinished expression",
          data: Object.freeze({
            kind: "workman.structural" as const,
            recoveryId: hole.id,
            repairClass: "recoveryOnly" as const,
            pairId: 0 as const,
            order: hole.anchor,
            code: hole.diagnosticCode,
          }),
        };
      })
    : [];
  return [...inferred, ...parameters, ...recoveryHoles].sort((left, right) =>
    left.position.line - right.position.line ||
    left.position.character - right.position.character ||
    (left.kind ?? 0) - (right.kind ?? 0)
  );
}

function inferredHintTypeId(
  moduleInterface: ModuleInterface,
  hint: SemanticInferredTypeHint,
) {
  if (hint.kind !== "result") return hint.type.id;
  const shape = moduleInterface.semanticTypes[hint.type.id]?.shape;
  return shape?.kind === "function" ? shape.result : undefined;
}

function truncateTypeInlay(label: string): string {
  if (label.length <= MAX_TYPE_INLAY_LABEL_LENGTH) return label;
  return `${label.slice(0, MAX_TYPE_INLAY_LABEL_LENGTH - 3).trimEnd()}...`;
}

function positionOffset(position: LspPosition, starts: number[], sourceLength: number): number {
  return Math.min(
    sourceLength,
    lineColToOffset(position.line + 1, position.character, starts),
  );
}
