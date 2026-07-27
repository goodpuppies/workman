import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import {
  type ModuleInterface,
  type ModuleSemanticOccurrence,
  semanticDefinitionsForTarget,
  semanticDocumentHighlightsAt,
  semanticOccurrenceAt,
  semanticOccurrencesForTarget,
  semanticTypeDefinitionsAt,
} from "../module_interface.ts";
import { lineColToOffset, lineStarts, type SourceSpan } from "../source.ts";
import { type LspRange, spanRange } from "./range.ts";
import { semanticDocumentContext, semanticSourceForPath } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";
import { pathToFileUri } from "./uri.ts";

export type LspLocation = { uri: string; range: LspRange };
export type LspDocumentHighlight = { range: LspRange; kind: 2 | 3 };

export async function definitionAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<LspLocation | null> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return null;
  const { project, moduleInterface, source } = context;
  const offset = lineColToOffset(position.line + 1, position.character, lineStarts(source));
  const occurrence = occurrenceAt(moduleInterface, offset);
  if (!occurrence) return null;
  const definition = semanticDefinitionsForTarget(project, occurrence.target)[0];
  return definition ? await location(definition.path, definition.span, sourceOverrides) : null;
}

export async function referencesAt(
  uri: string,
  position: { line: number; character: number },
  includeDeclaration: boolean,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<LspLocation[]> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return [];
  const { project, moduleInterface, source } = context;
  const offset = lineColToOffset(position.line + 1, position.character, lineStarts(source));
  const selected = occurrenceAt(moduleInterface, offset);
  if (!selected) return [];
  const occurrences = semanticOccurrencesForTarget(project, selected.target)
    .filter(({ occurrence }) => includeDeclaration || occurrence.declaration === undefined);
  const locations = await Promise.all(
    occurrences.map(async ({ moduleId, occurrence }) => {
      const owner = project.interfaces.get(moduleId);
      return owner ? await location(owner.path, occurrence.span, sourceOverrides) : null;
    }),
  );
  return locations.filter((item): item is LspLocation => item !== null);
}

export async function typeDefinitionAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<LspLocation[]> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return [];
  const offset = lineColToOffset(
    position.line + 1,
    position.character,
    lineStarts(context.source),
  );
  const definitions = semanticTypeDefinitionsAt(
    context.project,
    context.moduleInterface.moduleId,
    offset,
  );
  const locations = await Promise.all(
    definitions.map(({ path, span }) => location(path, span, sourceOverrides)),
  );
  return locations.filter((item): item is LspLocation => item !== null);
}

export async function documentHighlightsAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<LspDocumentHighlight[]> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return [];
  const offset = lineColToOffset(
    position.line + 1,
    position.character,
    lineStarts(context.source),
  );
  return semanticDocumentHighlightsAt(context.moduleInterface, offset).map(
    ({ occurrence, access }) => ({
      range: spanRange(context.source, occurrence.span),
      kind: access === "write" ? 3 as const : 2 as const,
    }),
  );
}

function occurrenceAt(
  moduleInterface: ModuleInterface,
  offset: number,
): ModuleSemanticOccurrence | undefined {
  return semanticOccurrenceAt(moduleInterface, offset) ??
    moduleInterface.occurrences
      .filter((occurrence) => occurrence.span.end === offset)
      .sort((left, right) => spanWidth(left.span) - spanWidth(right.span))[0];
}

async function location(
  path: string,
  span: SourceSpan,
  sourceOverrides: Map<string, string>,
): Promise<LspLocation | null> {
  const source = await semanticSourceForPath(path, sourceOverrides);
  return source === undefined ? null : { uri: pathToFileUri(path), range: spanRange(source, span) };
}

function spanWidth(span: SourceSpan): number {
  return span.end - span.start;
}
