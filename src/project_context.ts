import { normalize, resolve } from "node:path";
import type { ProjectSnapshot } from "./module_interface.ts";
import { directWorkmanImportSpecifiers, hasTopLevelMainBinding } from "./lsp/import_scan.ts";

export type DiscoveryResolver = (
  referrer: string,
  specifier: string,
) => string | undefined | Promise<string | undefined>;

/**
 * Syntax-only workspace index. Its nodes are discovery data, never project members or diagnostic
 * participants merely because they were indexed.
 */
export class ReverseImportDiscoveryIndex {
  #dependencies = new Map<string, Set<string>>();
  #dependents = new Map<string, Set<string>>();
  #heads = new Set<string>();
  #closestHeadQueries = 0;

  get closestHeadQueries(): number {
    return this.#closestHeadQueries;
  }

  async update(path: string, source: string, resolver: DiscoveryResolver): Promise<void> {
    const file = canonicalPath(path);
    for (const dependency of this.#dependencies.get(file) ?? []) {
      this.#dependents.get(dependency)?.delete(file);
    }
    const dependencies = new Set<string>();
    for (const specifier of directWorkmanImportSpecifiers(source)) {
      const resolved = await resolver(file, specifier);
      if (resolved !== undefined) dependencies.add(canonicalPath(resolved));
    }
    this.#dependencies.set(file, dependencies);
    for (const dependency of dependencies) {
      const dependents = this.#dependents.get(dependency) ?? new Set<string>();
      dependents.add(file);
      this.#dependents.set(dependency, dependents);
    }
    if (hasTopLevelMainBinding(source)) this.#heads.add(file);
    else this.#heads.delete(file);
  }

  remove(path: string): void {
    const file = canonicalPath(path);
    for (const dependency of this.#dependencies.get(file) ?? []) {
      this.#dependents.get(dependency)?.delete(file);
    }
    this.#dependencies.delete(file);
    this.#heads.delete(file);
  }

  /**
   * Reverse breadth-first search returns the nearest main-bearing importer. Equal-distance ties
   * use canonical path order so one open file selects exactly one project deterministically.
   */
  closestHead(path: string): string | undefined {
    this.#closestHeadQueries += 1;
    const start = canonicalPath(path);
    const visited = new Set([start]);
    let frontier = [start];
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

  dependenciesOf(path: string): ReadonlySet<string> {
    return this.#dependencies.get(canonicalPath(path)) ?? new Set();
  }
}

export type ProjectContextSelection = Readonly<{
  snapshot: ProjectSnapshot;
  reason: "active-reachable" | "closest-head" | "detached";
}>;

export type AnalyzeProjectHead = (
  headPath: string,
  configurationKey: string,
) => Promise<ProjectSnapshot>;

export type AnalyzeDetachedDocument = (
  path: string,
  configurationKey: string,
) => Promise<ProjectSnapshot>;

type ActiveContext = {
  key: string;
  configurationKey: string;
  snapshot: ProjectSnapshot;
  paths: ReadonlySet<string>;
  lastUsed: number;
};

/**
 * Selects semantic contexts for opened documents. Forward graph expansion is supplied as an opaque
 * callback and is never followed by another reverse lookup.
 */
export class ProjectContextRegistry {
  #active = new Map<string, ActiveContext>();
  #detached = new Map<string, ActiveContext>();
  #documents = new Map<string, string>();
  #clock = 0;

  constructor(readonly discovery: ReverseImportDiscoveryIndex) {}

  async openDocument(
    path: string,
    configurationKey: string,
    analyzeHead: AnalyzeProjectHead,
    analyzeDetached: AnalyzeDetachedDocument,
  ): Promise<ProjectContextSelection> {
    const file = canonicalPath(path);
    const documentKey = `${configurationKey}\0${file}`;
    const selectedKey = this.#documents.get(documentKey);
    const selected = selectedKey
      ? this.#active.get(selectedKey) ?? this.#detached.get(selectedKey)
      : undefined;
    if (selected?.paths.has(file)) {
      selected.lastUsed = ++this.#clock;
      return Object.freeze({
        snapshot: selected.snapshot,
        reason: selected.snapshot.kind === "headed" ? "active-reachable" : "detached",
      });
    }
    const covering = [...this.#active.values()]
      .filter((context) =>
        context.configurationKey === configurationKey && context.paths.has(file)
      )
      .sort((left, right) => right.lastUsed - left.lastUsed)[0];
    if (covering) {
      covering.lastUsed = ++this.#clock;
      this.#documents.set(documentKey, covering.key);
      return Object.freeze({ snapshot: covering.snapshot, reason: "active-reachable" });
    }

    const head = this.discovery.closestHead(file);
    if (head !== undefined) {
      const key = contextKey("headed", head, configurationKey);
      const existing = this.#active.get(key);
      if (existing) {
        existing.lastUsed = ++this.#clock;
        this.#documents.set(documentKey, existing.key);
        return Object.freeze({ snapshot: existing.snapshot, reason: "closest-head" });
      }
      const snapshot = await analyzeHead(head, configurationKey);
      const context = activeContext(key, configurationKey, snapshot, ++this.#clock);
      this.#active.set(key, context);
      this.#documents.set(documentKey, key);
      return Object.freeze({ snapshot, reason: "closest-head" });
    }

    const key = contextKey("detached", file, configurationKey);
    const existing = this.#detached.get(key);
    if (existing) {
      existing.lastUsed = ++this.#clock;
      this.#documents.set(documentKey, existing.key);
      return Object.freeze({ snapshot: existing.snapshot, reason: "detached" });
    }
    const snapshot = await analyzeDetached(file, configurationKey);
    const context = activeContext(key, configurationKey, snapshot, ++this.#clock);
    this.#detached.set(key, context);
    this.#documents.set(documentKey, key);
    return Object.freeze({ snapshot, reason: "detached" });
  }

  forgetDocument(path: string, configurationKey: string): void {
    this.#documents.delete(`${configurationKey}\0${canonicalPath(path)}`);
  }

  activeSnapshots(): readonly ProjectSnapshot[] {
    return [...this.#active.values()].map((context) => context.snapshot);
  }

  contextsForPath(path: string): readonly ProjectSnapshot[] {
    const file = canonicalPath(path);
    return [...this.#active.values()]
      .filter((context) => context.paths.has(file))
      .map((context) => context.snapshot);
  }
}

function activeContext(
  key: string,
  configurationKey: string,
  snapshot: ProjectSnapshot,
  lastUsed: number,
): ActiveContext {
  return {
    key,
    configurationKey,
    snapshot,
    paths: new Set([...snapshot.interfaces.values()].map((module) => canonicalPath(module.path))),
    lastUsed,
  };
}

function contextKey(
  kind: "headed" | "detached",
  path: string,
  configurationKey: string,
): string {
  return `${kind}\0${configurationKey}\0${canonicalPath(path)}`;
}

function canonicalPath(path: string): string {
  return normalize(resolve(path));
}
