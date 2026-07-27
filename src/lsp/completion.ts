import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { discoverSemanticCompletionsAt } from "../completion_discovery.ts";
import { type SemanticCompletionCandidate, semanticCompletionsAt } from "../module_interface.ts";
import { lineColToOffset, lineStarts } from "../source.ts";
import { renderSemanticType } from "./hover_type_display.ts";
import { semanticDocumentContext } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";

export type CompletionPosition = { line: number; character: number };

export type CompletionItem = {
  label: string;
  kind: number;
  detail: string;
  filterText: string;
  insertText: string;
  sortText: string;
};

/** Convert compiler-owned ordinary/GPU completion candidates into protocol completion items. */
export async function completionAt(
  uri: string,
  position: CompletionPosition,
  sourceOverrides: Map<string, string> = new Map(),
  frontendOptions: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<CompletionItem[]> {
  const context = await semanticDocumentContext(
    uri,
    sourceOverrides,
    frontendOptions,
    service,
  );
  if (!context) return [];
  const offset = Math.min(
    context.source.length,
    lineColToOffset(position.line + 1, position.character, lineStarts(context.source)),
  );
  const discovered = await discoverSemanticCompletionsAt(
    context.moduleInterface.path,
    context.source,
    offset,
    { ...frontendOptions, sourceOverrides },
  );
  const candidates = discovered.applicable ? discovered.candidates : semanticCompletionsAt(
    context.project,
    context.moduleInterface.moduleId,
    context.source,
    offset,
  ).candidates;
  const interfaces = new Map([
    ...context.project.interfaces,
    ...discovered.interfaces,
  ]);
  return candidates.map(
    (candidate) => ({
      label: candidate.name,
      kind: completionItemKind(candidate.kind),
      detail: completionDetail(interfaces, candidate) ?? "",
      filterText: candidate.name,
      insertText: candidate.name,
      sortText: completionSortText(candidate),
    }),
  );
}

function completionSortText(candidate: SemanticCompletionCandidate): string {
  const compatibility = candidate.expectedCompatibility === "compatible"
    ? 0
    : candidate.expectedCompatibility === "incompatible"
    ? 2
    : 1;
  const proximity = Math.min(candidate.proximity ?? 999_999_999, 999_999_999);
  return `${String(candidate.rank).padStart(3, "0")}-${compatibility}-${
    String(proximity).padStart(9, "0")
  }-${candidate.name}`;
}

function completionDetail(
  interfaces: import("../module_id.ts").ReadonlyModuleMap<
    import("../module_interface.ts").ModuleInterface
  >,
  candidate: SemanticCompletionCandidate,
): string | undefined {
  if (candidate.overloads) {
    return candidate.overloads
      .map(({ params, result }) => `(${params.join(", ")}) => ${result}`)
      .join(" | ");
  }
  if (!candidate.type) return;
  const owner = interfaces.get(candidate.type.moduleId);
  return owner ? renderSemanticType(owner, candidate.type.occurrence.id) : undefined;
}

function completionItemKind(kind: SemanticCompletionCandidate["kind"]): number {
  switch (kind) {
    case "value":
      return 6; // Variable
    case "constructor":
      return 4; // Constructor
    case "type":
      return 7; // Class
    case "structure":
      return 9; // Module
    case "field":
      return 10; // Property
    case "keyword":
      return 14; // Keyword
    case "gpu-builtin":
      return 3; // Function
    case "file":
      return 17; // File
    case "folder":
      return 19; // Folder
  }
}
