import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import {
  type JsDefinitionLocation,
  jsGlobalMemberDefinition,
  jsModuleMemberDefinition,
} from "../ffi/reflect/host.ts";
import { join } from "node:path";
import { workmanCache } from "../user_paths.ts";
import {
  type ModuleInterface,
  type ModuleSemanticOccurrence,
  semanticDefinitionsAt,
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
  if (!occurrence) {
    const definition = semanticDefinitionsAt(project, moduleInterface.moduleId, offset)[0];
    return definition ? await location(definition.path, definition.span, sourceOverrides) : null;
  }
  const jsDefinition = await jsDefinitionLocation(
    moduleInterface,
    occurrence,
    sourceOverrides,
  );
  if (jsDefinition) return jsDefinition;
  const definition = semanticDefinitionsForTarget(project, occurrence.target)[0];
  return definition ? await location(definition.path, definition.span, sourceOverrides) : null;
}

async function jsDefinitionLocation(
  moduleInterface: ModuleInterface,
  occurrence: ModuleSemanticOccurrence,
  sourceOverrides: Map<string, string>,
): Promise<LspLocation | null> {
  if (occurrence.target.kind !== "value") return null;
  for (const imported of moduleInterface.ffiFacts.imports) {
    const binding = imported.bindings.find(({ id }) => id === occurrence.target.id);
    if (!binding) continue;
    try {
      const target = imported.target;
      const definition = target.kind === "module"
        ? jsModuleMemberDefinition(target.specifier, binding.sourceName, moduleInterface.path)
        : target.kind === "global" || target.kind === "global-root"
        ? jsGlobalMemberDefinition(
          target.kind === "global" ? target.path : "globalThis",
          binding.sourceName,
          moduleInterface.path,
        )
        : undefined;
      return definition ? await jsLocation(definition, sourceOverrides) : null;
    } catch {
      // A missing external declaration or unwritable cache must not hide the local import site.
      return null;
    }
  }
  return null;
}

async function jsLocation(
  definition: JsDefinitionLocation,
  sourceOverrides: Map<string, string>,
): Promise<LspLocation | null> {
  let path = definition.path;
  if (definition.source !== undefined) {
    // Use the exact text the checker saw so offsets remain correct across Deno versions.
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(definition.source));
    const key = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
    const directory = join(workmanCache(), "typescript");
    path = join(directory, `deno-${key}.d.ts`);
    let existing: string | undefined;
    try {
      existing = await Deno.readTextFile(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (existing !== definition.source) {
      await Deno.mkdir(directory, { recursive: true });
      await Deno.writeTextFile(path, definition.source);
    }
  }
  return await location(
    path,
    { line: 1, col: 0, start: definition.start, end: definition.end },
    sourceOverrides,
  );
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
