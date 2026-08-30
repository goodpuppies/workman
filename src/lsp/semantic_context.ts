import { normalize, resolve } from "node:path";
import { analyzeFile, analyzeRecoveredFile } from "../compiler.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { runtime } from "../io.ts";
import type { ModuleInterface, ProjectSnapshot } from "../module_interface.ts";
import type { SemanticService } from "./semantic_service.ts";
import { fileUriToPath } from "./uri.ts";

export type SemanticDocumentContext = Readonly<{
  project: ProjectSnapshot;
  moduleInterface: ModuleInterface;
  source: string;
  recovered: boolean;
  recoveryHoles: readonly Readonly<{ id: number; anchor: number; diagnosticCode: string }>[];
}>;

/** Resolve one document to the compiler-owned current project/interface artifact. */
export async function semanticDocumentContext(
  uri: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<SemanticDocumentContext | null> {
  if (service) return await service.documentContext(uri);
  const entryPath = normalize(resolve(fileUriToPath(uri)));
  let project: ProjectSnapshot;
  let recovered = false;
  try {
    project = (await analyzeFile(entryPath, { ...options, sourceOverrides })).projectSnapshot;
  } catch {
    try {
      project = await analyzeRecoveredFile(entryPath, { ...options, sourceOverrides });
      recovered = true;
    } catch {
      return null;
    }
  }
  const moduleInterface = [...project.interfaces.values()].find((item) =>
    normalize(resolve(item.path)) === entryPath
  );
  if (!moduleInterface) return null;
  const source = await semanticSourceForPath(moduleInterface.path, sourceOverrides);
  return source === undefined
    ? null
    : Object.freeze({ project, moduleInterface, source, recovered, recoveryHoles: [] });
}

export async function semanticSourceForPath(
  path: string,
  sourceOverrides: Map<string, string>,
): Promise<string | undefined> {
  const direct = sourceOverrides.get(path);
  if (direct !== undefined) return direct;
  const canonical = normalize(resolve(path));
  for (const [candidate, source] of sourceOverrides) {
    if (normalize(resolve(candidate)) === canonical) return source;
  }
  try {
    return await runtime.readTextFile(path);
  } catch {
    return undefined;
  }
}
