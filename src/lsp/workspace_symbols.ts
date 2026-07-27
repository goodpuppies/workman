import { basename } from "node:path";
import { type SemanticWorkspaceSymbolFact, semanticWorkspaceSymbols } from "../module_interface.ts";
import { type LspRange, spanRange } from "./range.ts";
import { semanticSourceForPath } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";
import { pathToFileUri } from "./uri.ts";

export type LspWorkspaceSymbol = Readonly<{
  name: string;
  kind: number;
  location: Readonly<{ uri: string; range: LspRange }>;
  containerName?: string;
}>;

/**
 * Search active semantic contexts only. Recursive discovery never becomes workspace membership.
 */
export async function workspaceSymbols(
  query: string,
  service: SemanticService,
  sourceOverrides: Map<string, string>,
): Promise<LspWorkspaceSymbol[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const facts = semanticWorkspaceSymbols(service.openSnapshots())
    .filter((fact) =>
      normalizedQuery.length === 0 ||
      workspaceSymbolName(fact).toLowerCase().includes(normalizedQuery)
    )
    .sort((left, right) =>
      workspaceSymbolMatchRank(left, normalizedQuery) -
        workspaceSymbolMatchRank(right, normalizedQuery) ||
      workspaceSymbolName(left).localeCompare(workspaceSymbolName(right)) ||
      left.path.localeCompare(right.path) ||
      left.selectionSpan.start - right.selectionSpan.start
    );
  const seen = new Set<string>();
  const symbols: LspWorkspaceSymbol[] = [];
  for (const fact of facts) {
    const name = workspaceSymbolName(fact);
    const key =
      `${fact.path}\0${fact.selectionSpan.start}\0${fact.selectionSpan.end}\0${fact.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = await semanticSourceForPath(fact.path, sourceOverrides);
    if (source === undefined) continue;
    symbols.push(Object.freeze({
      name,
      kind: workspaceSymbolKind(fact.kind),
      location: Object.freeze({
        uri: pathToFileUri(fact.path),
        range: spanRange(source, fact.selectionSpan),
      }),
      containerName: fact.containerName ??
        (fact.kind === "module" ? undefined : basename(fact.path)),
    }));
  }
  return symbols;
}

function workspaceSymbolName(fact: SemanticWorkspaceSymbolFact): string {
  return fact.kind === "module" ? basename(fact.path, ".wm") : fact.name;
}

function workspaceSymbolMatchRank(
  fact: SemanticWorkspaceSymbolFact,
  query: string,
): number {
  if (query.length === 0) return 0;
  const name = workspaceSymbolName(fact).toLowerCase();
  return name === query ? 0 : name.startsWith(query) ? 1 : 2;
}

function workspaceSymbolKind(kind: SemanticWorkspaceSymbolFact["kind"]): number {
  return kind === "module"
    ? 2
    : kind === "function"
    ? 12
    : kind === "value"
    ? 13
    : kind === "datatype"
    ? 10
    : kind === "record"
    ? 23
    : kind === "constructor"
    ? 22
    : 5;
}
