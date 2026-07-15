import { normalize, resolve } from "node:path";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { runtime } from "../io.ts";
import { resolveModuleImportPath } from "../module_graph.ts";
import { directWorkmanImportSpecifiers } from "./import_scan.ts";
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
  ): Promise<number> {
    const paths = new Set((await Promise.all([...this.#roots].map(collectWmFiles))).flat());
    await Promise.all([...paths].map((path) => this.refreshFile(path, sourceOverrides, options)));
    return paths.size;
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
    const source = sourceOverrides.get(path) ?? await runtime.readTextFile(path);
    const dependencies = new Set<string>();
    for (const specifier of directWorkmanImportSpecifiers(source)) {
      try {
        dependencies.add(
          await resolveModuleImportPath(path, specifier, { ...options, sourceOverrides }),
        );
      } catch {
        // Missing imports are reported by validation; the index remains usable.
      }
    }
    return dependencies;
  } catch {
    return new Set();
  }
}

function uriPath(uri: string): string {
  return normalize(resolve(fileUriToPath(uri)));
}

async function collectWmFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await runtime.readDirectory(root);
  } catch {
    return [];
  }
  const files: string[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.name.startsWith(".") && entry.isDirectory) continue;
    const path = normalize(resolve(root, entry.name));
    if (entry.isDirectory) {
      directories.push(path);
    } else if (entry.isFile && path.endsWith(".wm")) {
      files.push(path);
    }
  }
  const descendants = await Promise.all(directories.map(collectWmFiles));
  return files.concat(...descendants);
}
