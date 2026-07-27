import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import {
  semanticRenameAt,
  semanticRenameNameIsValid,
  type SemanticRenamePlan,
} from "../module_interface.ts";
import { lineColToOffset, lineStarts } from "../source.ts";
import { type LspRange, spanRange } from "./range.ts";
import { semanticDocumentContext, semanticSourceForPath } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";
import { pathToFileUri } from "./uri.ts";

export type PrepareRenameResult = {
  range: LspRange;
  placeholder: string;
};

export type WorkspaceEdit = {
  changes: Record<string, { range: LspRange; newText: string }[]>;
};

export async function prepareRenameAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<PrepareRenameResult | null> {
  const selected = await renamePlanAt(uri, position, sourceOverrides, options, service);
  return selected
    ? {
      range: spanRange(selected.context.source, selected.plan.selection),
      placeholder: selected.plan.placeholder,
    }
    : null;
}

export async function renameAt(
  uri: string,
  position: { line: number; character: number },
  newName: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<WorkspaceEdit | null> {
  const selected = await renamePlanAt(uri, position, sourceOverrides, options, service);
  if (!selected || !semanticRenameNameIsValid(selected.plan, newName)) return null;
  const changes: WorkspaceEdit["changes"] = {};
  for (const { moduleId, occurrence } of selected.plan.occurrences) {
    const owner = selected.context.project.interfaces.get(moduleId);
    if (!owner) continue;
    const source = await semanticSourceForPath(owner.path, sourceOverrides);
    if (source === undefined) return null;
    const edit = { range: spanRange(source, occurrence.span), newText: newName };
    (changes[pathToFileUri(owner.path)] ??= []).push(edit);
  }
  return Object.keys(changes).length === 0 ? null : { changes };
}

async function renamePlanAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions,
  service?: SemanticService,
) {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return null;
  const offset = lineColToOffset(
    position.line + 1,
    position.character,
    lineStarts(context.source),
  );
  const plan = semanticRenameAt(context.project, context.moduleInterface.moduleId, offset);
  return plan ? { context, plan } : null;
}
