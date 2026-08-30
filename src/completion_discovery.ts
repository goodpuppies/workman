import { basename, dirname, normalize, relative, resolve } from "node:path";
import { analyzeDetachedFile } from "./compiler.ts";
import { runtime } from "./io.ts";
import type { ModuleInterface, SemanticCompletionCandidate } from "./module_interface.ts";
import type { ModuleGraphOptions } from "./module_graph.ts";
import { resolveModuleImportPath } from "./module_graph.ts";
import type { ModuleId } from "./module_id.ts";

export type SemanticDiscoveredCompletions = Readonly<{
  applicable: boolean;
  candidates: readonly SemanticCompletionCandidate[];
  interfaces: ReadonlyMap<ModuleId, ModuleInterface>;
}>;

/** Compiler-owned discovery completion for named import clauses and module path strings. */
export async function discoverSemanticCompletionsAt(
  fromPath: string,
  source: string,
  offset: number,
  options: ModuleGraphOptions = {},
): Promise<SemanticDiscoveredCompletions> {
  const before = source.slice(0, Math.max(0, Math.min(offset, source.length)));
  const path = importPathContext(before);
  if (path) {
    return Object.freeze({
      applicable: true,
      candidates: Object.freeze(await importPathCandidates(fromPath, path, options)),
      interfaces: new Map(),
    });
  }
  const named = namedImportContext(before);
  if (!named) return emptyDiscoveredCompletions;
  if (named.aliasPosition) {
    return Object.freeze({
      applicable: true,
      candidates: Object.freeze([]),
      interfaces: new Map(),
    });
  }
  try {
    const targetPath = await resolveModuleImportPath(fromPath, named.specifier, options);
    const project = await analyzeDetachedFile(targetPath, options);
    const target = project.interfaces.get(project.head);
    if (!target) return emptyApplicableCompletions;
    const candidates = target.occurrences.flatMap((occurrence) => {
      if (
        occurrence.role !== "declaration" ||
        occurrence.declaration?.visibility !== "public" ||
        named.usedNames.has(occurrence.name) ||
        !occurrence.name.startsWith(named.prefix) ||
        (occurrence.target.kind !== "value" &&
          occurrence.target.kind !== "constructor" &&
          occurrence.target.kind !== "type")
      ) return [];
      return [
        Object.freeze({
          name: occurrence.name,
          kind: occurrence.target.kind,
          origin: "import",
          rank: 10,
          type: occurrence.inferredType
            ? Object.freeze({
              moduleId: target.moduleId,
              occurrence: occurrence.inferredType,
            })
            : undefined,
        }) satisfies SemanticCompletionCandidate,
      ];
    });
    return Object.freeze({
      applicable: true,
      candidates: distinctCandidates(candidates),
      interfaces: project.interfaces,
    });
  } catch {
    return emptyApplicableCompletions;
  }
}

function namedImportContext(
  before: string,
):
  | Readonly<{
    specifier: string;
    prefix: string;
    usedNames: ReadonlySet<string>;
    aliasPosition: boolean;
  }>
  | undefined {
  const matches = [
    ...before.matchAll(/\bfrom\s+"([^"\r\n]+)"\s+import\s*\{([^}]*)$/g),
  ];
  const match = matches.at(-1);
  if (!match) return;
  const content = match[2];
  const segments = content.split(",");
  const current = segments.at(-1) ?? "";
  const aliasPosition = /\bas\s+[A-Za-z_][A-Za-z0-9_]*\s*$/.test(current) ||
    /\bas\s*$/.test(current);
  const prefix = aliasPosition ? "" : current.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  const usedNames = new Set(
    segments.slice(0, -1).flatMap((segment) =>
      segment.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? []
    ),
  );
  return Object.freeze({ specifier: match[1], prefix, usedNames, aliasPosition });
}

function importPathContext(before: string): string | undefined {
  const matches = [...before.matchAll(/\bfrom\s+"([^"\r\n]*)$/g)];
  return matches.at(-1)?.[1];
}

async function importPathCandidates(
  fromPath: string,
  specifierPrefix: string,
  options: ModuleGraphOptions,
): Promise<SemanticCompletionCandidate[]> {
  const directoryPart = specifierPrefix.endsWith("/") ? specifierPrefix : dirname(specifierPrefix);
  const leafPrefix = specifierPrefix.endsWith("/") ? "" : basename(specifierPrefix);
  const directory = resolve(dirname(fromPath), directoryPart === "." ? "" : directoryPart);
  const entries = new Map<string, "file" | "folder">();
  try {
    for (const entry of await runtime.readDirectory(directory)) {
      if (entry.isDirectory) entries.set(`${entry.name}/`, "folder");
      else if (entry.isFile && entry.name.endsWith(".wm")) entries.set(entry.name, "file");
    }
  } catch {
    // Unsaved/virtual candidates below remain useful when the directory is absent on disk.
  }
  for (const path of options.sourceOverrides?.keys() ?? []) {
    addVirtualPathEntry(entries, directory, path);
  }
  for (const path of options.virtualFs?.keys() ?? []) addVirtualPathEntry(entries, directory, path);
  return [...entries]
    .filter(([name]) => name.startsWith(leafPrefix))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, kind]) =>
      Object.freeze({
        name,
        kind,
        origin: "import",
        rank: kind === "folder" ? 5 : 10,
      })
    );
}

function addVirtualPathEntry(
  entries: Map<string, "file" | "folder">,
  directory: string,
  path: string,
): void {
  const normalized = normalize(resolve(path));
  const child = relative(normalize(directory), normalized);
  if (child.startsWith("..") || child === "" || child.startsWith("/")) return;
  const [first, ...rest] = child.split(/[\\/]/);
  if (rest.length > 0) entries.set(`${first}/`, "folder");
  else if (first.endsWith(".wm")) entries.set(first, "file");
}

function distinctCandidates(
  candidates: readonly SemanticCompletionCandidate[],
): readonly SemanticCompletionCandidate[] {
  const seen = new Set<string>();
  return Object.freeze(
    candidates
      .filter((candidate) => {
        const key = `${candidate.kind}:${candidate.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name) ||
        importNamespaceRank(left.kind) - importNamespaceRank(right.kind)
      ),
  );
}

function importNamespaceRank(kind: SemanticCompletionCandidate["kind"]): number {
  // A named import spelling may deliberately import several SML namespaces at once.
  // Keep those identities distinct while presenting them in a stable namespace order.
  if (kind === "type") return 0;
  if (kind === "constructor") return 1;
  if (kind === "value") return 2;
  return 3;
}

const emptyApplicableCompletions: SemanticDiscoveredCompletions = Object.freeze({
  applicable: true,
  candidates: Object.freeze([]),
  interfaces: new Map(),
});

const emptyDiscoveredCompletions: SemanticDiscoveredCompletions = Object.freeze({
  applicable: false,
  candidates: Object.freeze([]),
  interfaces: new Map(),
});
