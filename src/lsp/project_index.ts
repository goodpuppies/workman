import { normalize, resolve } from "node:path";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { runtime } from "../io.ts";
import { resolveModuleImportPath } from "../module_graph.ts";
import { ReverseImportDiscoveryIndex } from "../project_context.ts";
import { directWorkmanImportSpecifiers, hasTopLevelMainBinding } from "./import_scan.ts";
import { fileUriToPath, pathToFileUri } from "./uri.ts";

export type InitializeParams = {
  rootUri?: string | null;
  rootPath?: string | null;
  workspaceFolders?: { uri: string; name?: string }[] | null;
};

export class ProjectIndex {
  readonly discovery = new ReverseImportDiscoveryIndex();
  #roots = new Set<string>();
  #dependencies = new Map<string, Set<string>>();
  #dependents = new Map<string, Set<string>>();
  #heads = new Set<string>();
  #contexts = new Map<string, Set<string>>();
  #documentContexts = new Map<string, string>();

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
    const previous = cloneContexts(this.#contexts);
    await this.refreshFile(path, sourceOverrides, options);
    this.#ensureDocumentContext(path);
    this.#recomputeContexts();
    return affectedContextUris([path], previous, this.#contexts);
  }

  async affectedUrisForWatchedFiles(
    uris: string[],
    sourceOverrides: Map<string, string>,
    options: CompilerFrontendOptions = {},
  ): Promise<string[]> {
    const changed = uris.map(uriPath);
    const previous = cloneContexts(this.#contexts);
    for (const path of changed) await this.refreshFile(path, sourceOverrides, options);
    this.#recomputeContexts();
    return affectedContextUris(changed, previous, this.#contexts);
  }

  fallbackUri(uri: string): string {
    const path = uriPath(uri);
    return pathToFileUri(this.#documentContexts.get(path) ?? path);
  }

  forgetOpenFile(uri: string): void {
    const path = uriPath(uri);
    const context = this.#documentContexts.get(path);
    this.#documentContexts.delete(path);
    if (context && ![...this.#documentContexts.values()].includes(context)) {
      this.#contexts.delete(context);
    }
  }

  async refreshFile(
    path: string,
    sourceOverrides: Map<string, string>,
    options: CompilerFrontendOptions = {},
  ) {
    const normalized = normalize(resolve(path));
    const previousDeps = this.#dependencies.get(normalized) ?? new Set<string>();
    for (const dep of previousDeps) this.#dependents.get(dep)?.delete(normalized);

    const discovery = await directDiscovery(normalized, sourceOverrides, options);
    if (discovery.source === undefined) {
      this.discovery.remove(normalized);
    } else {
      await this.discovery.update(
        normalized,
        discovery.source,
        async (referrer, specifier) => {
          try {
            return await resolveModuleImportPath(referrer, specifier, {
              ...options,
              sourceOverrides,
            });
          } catch {
            return undefined;
          }
        },
      );
    }
    const deps = discovery.dependencies;
    this.#dependencies.set(normalized, deps);
    if (discovery.main) this.#heads.add(normalized);
    else this.#heads.delete(normalized);
    for (const dep of deps) {
      const parents = this.#dependents.get(dep) ?? new Set<string>();
      parents.add(normalized);
      this.#dependents.set(dep, parents);
    }
  }

  #ensureDocumentContext(path: string): void {
    const file = normalize(resolve(path));
    const existing = this.#documentContexts.get(file);
    if (existing && this.#contexts.get(existing)?.has(file)) return;
    const covering = [...this.#contexts].find(([, paths]) => paths.has(file));
    if (covering) {
      this.#documentContexts.set(file, covering[0]);
      return;
    }
    const root = this.#closestHead(file) ?? file;
    this.#contexts.set(root, this.#forwardClosure(root));
    this.#documentContexts.set(file, root);
  }

  #closestHead(path: string): string | undefined {
    const visited = new Set([path]);
    let frontier = [path];
    while (frontier.length > 0) {
      const heads = frontier.filter((candidate) => this.#heads.has(candidate)).sort();
      if (heads.length > 0) return heads[0];
      const next = new Set<string>();
      for (const current of frontier) {
        for (const dependent of this.#dependents.get(current) ?? []) {
          if (visited.has(dependent)) continue;
          visited.add(dependent);
          next.add(dependent);
        }
      }
      frontier = [...next];
    }
    return undefined;
  }

  #forwardClosure(root: string): Set<string> {
    const reachable = new Set([root]);
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const dependency of this.#dependencies.get(current) ?? []) {
        if (reachable.has(dependency)) continue;
        reachable.add(dependency);
        pending.push(dependency);
      }
    }
    return reachable;
  }

  #recomputeContexts(): void {
    for (const root of this.#contexts.keys()) {
      this.#contexts.set(root, this.#forwardClosure(root));
    }
  }
}

async function directDiscovery(
  path: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<{ source?: string; dependencies: Set<string>; main: boolean }> {
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
    return { source, dependencies, main: hasTopLevelMainBinding(source) };
  } catch {
    return { source: undefined, dependencies: new Set(), main: false };
  }
}

function cloneContexts(
  contexts: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  return new Map([...contexts].map(([root, paths]) => [root, new Set(paths)]));
}

function affectedContextUris(
  changed: readonly string[],
  previous: ReadonlyMap<string, ReadonlySet<string>>,
  current: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const roots = new Set([...previous.keys(), ...current.keys()]);
  return [...roots]
    .filter((root) =>
      changed.some((path) => previous.get(root)?.has(path) || current.get(root)?.has(path))
    )
    .sort()
    .map(pathToFileUri);
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
