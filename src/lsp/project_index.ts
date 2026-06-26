import { dirname, normalize, resolve } from "node:path";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { loadModuleGraph } from "../module_graph.ts";
import { fileUriToPath, pathToFileUri } from "./uri.ts";

export type InitializeParams = {
  rootUri?: string | null;
  rootPath?: string | null;
  workspaceFolders?: { uri: string; name?: string }[] | null;
};

export class ProjectIndex {
  #roots = new Set<string>();
  #dependencies = new Map<string, Set<string>>();
  #dependents = new Map<string, Set<string>>();

  rememberWorkspaceRoots(params: InitializeParams | undefined) {
    if (!params) return;
    for (const folder of params.workspaceFolders ?? []) this.#rememberWorkspaceRoot(folder.uri);
    if (params.rootUri) this.#rememberWorkspaceRoot(params.rootUri);
    else if (params.rootPath) this.#roots.add(normalize(resolve(params.rootPath)));
  }

  #rememberWorkspaceRoot(uri: string) {
    if (!uri.startsWith("file://")) return;
    this.#roots.add(normalize(resolve(fileUriToPath(uri))));
  }

  async initialize(
    sourceOverrides: Map<string, string>,
    options: CompilerFrontendOptions = {},
  ) {
    for (const root of this.#roots) {
      for await (const path of walkWmFiles(root)) {
        await this.refreshFile(path, sourceOverrides, options);
      }
    }
  }

  async affectedUrisForChange(
    uri: string,
    sourceOverrides: Map<string, string>,
    options: CompilerFrontendOptions = {},
  ): Promise<string[]> {
    const path = uriPath(uri);
    await this.refreshFile(path, sourceOverrides, options);
    return this.#affectedUris(path);
  }

  async affectedUrisForWatchedFiles(
    uris: string[],
    sourceOverrides: Map<string, string>,
    options: CompilerFrontendOptions = {},
  ): Promise<string[]> {
    const changed = uris.map(uriPath);
    for (const path of changed) await this.refreshFile(path, sourceOverrides, options);
    const affected = new Set<string>();
    for (const path of changed) {
      for (const uri of this.#affectedUris(path)) affected.add(uri);
    }
    return [...affected].sort();
  }

  fallbackUri(uri: string): string {
    return pathToFileUri(uriPath(uri));
  }

  async refreshFile(
    path: string,
    sourceOverrides: Map<string, string>,
    options: CompilerFrontendOptions = {},
  ) {
    const normalized = normalize(resolve(path));
    const previousDeps = this.#dependencies.get(normalized) ?? new Set<string>();
    for (const dep of previousDeps) this.#dependents.get(dep)?.delete(normalized);

    const deps = await directDependencies(normalized, sourceOverrides, options);
    this.#dependencies.set(normalized, deps);
    for (const dep of deps) {
      const parents = this.#dependents.get(dep) ?? new Set<string>();
      parents.add(normalized);
      this.#dependents.set(dep, parents);
    }
  }

  #affectedUris(path: string): string[] {
    const start = normalize(resolve(path));
    const affected = new Set<string>([start]);
    const work = [start];
    while (work.length > 0) {
      const current = work.pop()!;
      for (const parent of this.#dependents.get(current) ?? []) {
        if (affected.has(parent)) continue;
        affected.add(parent);
        work.push(parent);
      }
    }
    return [...affected].sort().map(pathToFileUri);
  }
}

async function directDependencies(
  path: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<Set<string>> {
  try {
    const graph = await loadModuleGraph(path, { ...options, sourceOverrides });
    const node = graph.nodes.get(graph.entry);
    return new Set(node?.imports.map((edge) => edge.path) ?? []);
  } catch {
    return new Set();
  }
}

function uriPath(uri: string): string {
  return normalize(resolve(fileUriToPath(uri)));
}

async function* walkWmFiles(root: string): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(root)) entries.push(entry);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.name.startsWith(".") && entry.isDirectory) continue;
    const path = normalize(resolve(root, entry.name));
    if (entry.isDirectory) {
      yield* walkWmFiles(path);
    } else if (entry.isFile && path.endsWith(".wm")) {
      yield path;
    }
  }
}
