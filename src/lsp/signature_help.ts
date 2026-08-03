import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { semanticSignatureHelpAt } from "../module_interface.ts";
import { lineColToOffset, lineStarts } from "../source.ts";
import { renderSemanticType, renderSemanticTypeCompact } from "./hover_type_display.ts";
import type { LspPosition } from "./range.ts";
import { semanticDocumentContext } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";

export type LspSignatureHelp = Readonly<{
  signatures: readonly Readonly<{
    label: string;
    parameters: readonly Readonly<{
      label: string;
      documentation?: Readonly<{ kind: "markdown"; value: string }>;
    }>[];
  }>[];
  activeSignature: 0;
  activeParameter: number;
}>;

/** Map one compiler-owned call-site signature to standard LSP presentation. */
export async function signatureHelpAt(
  uri: string,
  position: LspPosition,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<LspSignatureHelp | null> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return null;
  const offset = Math.min(
    context.source.length,
    lineColToOffset(
      position.line + 1,
      position.character,
      lineStarts(context.source),
    ),
  );
  const signature = semanticSignatureHelpAt(
    context.project,
    context.moduleInterface.moduleId,
    context.source,
    offset,
  );
  if (!signature) return null;
  const parameters = signature.parameters.map((parameter) => {
    const owner = context.project.interfaces.get(parameter.type.moduleId);
    if (!owner) return Object.freeze({ label: parameter.name ?? "?" });
    const compact = renderSemanticTypeCompact(owner, parameter.type.id);
    const full = renderSemanticType(owner, parameter.type.id);
    const label = parameter.name ? `${parameter.name}: ${compact}` : compact;
    return Object.freeze({
      label,
      documentation: compact === full ? undefined : Object.freeze({
        kind: "markdown" as const,
        value: `\`\`\`workman\n${full}\n\`\`\``,
      }),
    });
  });
  const resultOwner = context.project.interfaces.get(signature.result.moduleId);
  if (!resultOwner) return null;
  const result = renderSemanticTypeCompact(resultOwner, signature.result.id);
  return Object.freeze({
    signatures: Object.freeze([
      Object.freeze({
        label: `${signature.callee}(${
          parameters.map(({ label }) => label).join(", ")
        }) -> ${result}`,
        parameters: Object.freeze(parameters),
      }),
    ]),
    activeSignature: 0 as const,
    activeParameter: signature.activeParameter,
  });
}
