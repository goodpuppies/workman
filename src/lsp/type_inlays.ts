import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
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
    category: "binding" | "parameter";
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

export type WorkmanSemanticInlayHint = InferredTypeInlayHint | ParameterNameInlayHint;
export type SemanticInlayOptions = Readonly<{
  typeHints?: boolean;
  parameterHints?: boolean;
}>;

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
      .map((hint) => {
        const position = offsetToLineColFromStarts(hint.span.end, starts);
        const full = renderSemanticType(context.moduleInterface, hint.type.id);
        const compact = renderSemanticTypeCompact(context.moduleInterface, hint.type.id);
        return {
          position: { line: position.line - 1, character: position.col },
          label: `: ${compact}`,
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
        };
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
  return [...inferred, ...parameters].sort((left, right) =>
    left.position.line - right.position.line ||
    left.position.character - right.position.character ||
    left.kind - right.kind
  );
}

function positionOffset(position: LspPosition, starts: number[], sourceLength: number): number {
  return Math.min(
    sourceLength,
    lineColToOffset(position.line + 1, position.character, starts),
  );
}
