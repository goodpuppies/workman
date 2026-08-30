import { dirname, normalize, posix, relative, resolve, sep } from "node:path";
import { runtime } from "./io.ts";
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
   * prefer the head whose directory is nearest to the opened file, then canonical path order.
   */
  closestHead(path: string): string | undefined {
    this.#closestHeadQueries += 1;
    return this.headsFor(path)[0];
  }

  /**
   * Return every main-bearing reverse importer, ordered by import distance. Directory proximity
   * and canonical path provide the same deterministic tie breaks as closestHead.
   */
  headsFor(path: string): readonly string[] {
    const start = canonicalPath(path);
    const visited = new Set([start]);
    let frontier = [start];
    const heads: string[] = [];
    while (frontier.length > 0) {
      heads.push(
        ...frontier.filter((candidate) => this.#heads.has(candidate)).sort(
          (left, right) =>
            headDirectoryDistance(start, left) - headDirectoryDistance(start, right) ||
            left.localeCompare(right),
        ),
      );
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
    return heads;
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
    return await this.#selectContext(
      path,
      configurationKey,
      analyzeHead,
      analyzeDetached,
      true,
    );
  }

  /** Select a snapshot for a non-document operation without extending its open lifetime. */
  async contextForPath(
    path: string,
    configurationKey: string,
    analyzeHead: AnalyzeProjectHead,
    analyzeDetached: AnalyzeDetachedDocument,
  ): Promise<ProjectContextSelection> {
    return await this.#selectContext(
      path,
      configurationKey,
      analyzeHead,
      analyzeDetached,
      false,
    );
  }

  async #selectContext(
    path: string,
    configurationKey: string,
    analyzeHead: AnalyzeProjectHead,
    analyzeDetached: AnalyzeDetachedDocument,
    rememberDocument: boolean,
  ): Promise<ProjectContextSelection> {
    const file = canonicalPath(path);
    const documentKey = `${configurationKey}\0${file}`;
    const selectedKey = this.#documents.get(documentKey);
    let selected = selectedKey
      ? this.#active.get(selectedKey) ?? this.#detached.get(selectedKey)
      : undefined;
    if (!selected && selectedKey) {
      const descriptor = parseContextKey(selectedKey);
      if (descriptor?.configurationKey === configurationKey) {
        const snapshot = descriptor.kind === "headed"
          ? await analyzeHead(descriptor.path, configurationKey)
          : await analyzeDetached(descriptor.path, configurationKey);
        const restored = activeContext(
          selectedKey,
          configurationKey,
          snapshot,
          ++this.#clock,
        );
        if (restored.paths.has(file)) {
          (descriptor.kind === "headed" ? this.#active : this.#detached).set(
            selectedKey,
            restored,
          );
          selected = restored;
        } else {
          this.#documents.delete(documentKey);
        }
      }
    }
    if (selected?.paths.has(file)) {
      selected.lastUsed = ++this.#clock;
      return Object.freeze({
        snapshot: selected.snapshot,
        reason: selected.snapshot.kind === "headed" ? "active-reachable" : "detached",
      });
    }
    const covering = [...this.#active.values()]
      .filter((context) => context.configurationKey === configurationKey && context.paths.has(file))
      .sort((left, right) => right.lastUsed - left.lastUsed)[0];
    if (covering) {
      covering.lastUsed = ++this.#clock;
      if (rememberDocument) this.#documents.set(documentKey, covering.key);
      return Object.freeze({ snapshot: covering.snapshot, reason: "active-reachable" });
    }

    const head = this.discovery.closestHead(file);
    if (head !== undefined) {
      const key = contextKey("headed", head, configurationKey);
      const existing = this.#active.get(key);
      if (existing) {
        if (existing.paths.has(file)) {
          existing.lastUsed = ++this.#clock;
          if (rememberDocument) this.#documents.set(documentKey, existing.key);
          return Object.freeze({ snapshot: existing.snapshot, reason: "closest-head" });
        }
      } else {
        const snapshot = await analyzeHead(head, configurationKey);
        const context = activeContext(key, configurationKey, snapshot, ++this.#clock);
        this.#active.set(key, context);
        if (context.paths.has(file)) {
          if (rememberDocument) this.#documents.set(documentKey, key);
          return Object.freeze({ snapshot, reason: "closest-head" });
        }
      }
      // Syntax discovery can still find a reverse importer after recovered semantic analysis has
      // rejected that import and removed its target from the certified project snapshot. The
      // document must then get its own recovered context instead of being assigned a project that
      // cannot answer semantic queries for it.
    }

    const key = contextKey("detached", file, configurationKey);
    const existing = this.#detached.get(key);
    if (existing) {
      existing.lastUsed = ++this.#clock;
      if (rememberDocument) this.#documents.set(documentKey, existing.key);
      return Object.freeze({ snapshot: existing.snapshot, reason: "detached" });
    }
    const snapshot = await analyzeDetached(file, configurationKey);
    const context = activeContext(key, configurationKey, snapshot, ++this.#clock);
    this.#detached.set(key, context);
    if (rememberDocument) this.#documents.set(documentKey, key);
    return Object.freeze({ snapshot, reason: "detached" });
  }

  forgetDocument(path: string, configurationKey: string): void {
    const documentKey = `${configurationKey}\0${canonicalPath(path)}`;
    const selectedContextKey = this.#documents.get(documentKey);
    this.#documents.delete(documentKey);
    if (!selectedContextKey) return;
    for (const [openDocumentKey, contextKey] of this.#documents) {
      if (contextKey === selectedContextKey) this.#documents.delete(openDocumentKey);
    }
    this.#active.delete(selectedContextKey);
    this.#detached.delete(selectedContextKey);
  }

  /** Drop every snapshot whose forward closure contains a changed source path. */
  invalidatePaths(paths: Iterable<string>): void {
    const changed = new Set([...paths].map(canonicalPath));
    const affectedHeads = new Set(
      [...changed].flatMap((path) => this.discovery.headsFor(path).map(canonicalPath)),
    );
    const invalidKeys = new Set<string>();
    for (const context of [...this.#active.values(), ...this.#detached.values()]) {
      if ([...changed].some((path) => context.paths.has(path))) {
        invalidKeys.add(context.key);
      }
    }
    for (const [key] of this.#active) {
      const descriptor = parseContextKey(key);
      if (descriptor?.kind === "headed" && affectedHeads.has(descriptor.path)) {
        invalidKeys.add(key);
      }
    }
    for (const [documentKey, contextKey] of this.#documents) {
      const separator = documentKey.indexOf("\0");
      if (changed.has(documentKey.slice(separator + 1))) invalidKeys.add(contextKey);
    }
    for (const key of invalidKeys) {
      this.#active.delete(key);
      this.#detached.delete(key);
    }
  }

  activeSnapshots(): readonly ProjectSnapshot[] {
    return [...this.#active.values()].map((context) => context.snapshot);
  }

  /** Every semantic context currently selected by an open document, including detached files. */
  openSnapshots(): readonly ProjectSnapshot[] {
    const selected = new Set(this.#documents.values());
    return [...this.#active.values(), ...this.#detached.values()]
      .filter((context) => selected.has(context.key))
      .map((context) => context.snapshot);
  }

  /** Release contexts created only for a transient non-document query. */
  releaseUnselectedContexts(): void {
    const selected = new Set(this.#documents.values());
    for (const key of this.#active.keys()) {
      if (!selected.has(key)) this.#active.delete(key);
    }
    for (const key of this.#detached.keys()) {
      if (!selected.has(key)) this.#detached.delete(key);
    }
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

function parseContextKey(
  key: string,
):
  | Readonly<{
    kind: "headed" | "detached";
    configurationKey: string;
    path: string;
  }>
  | undefined {
  const first = key.indexOf("\0");
  const second = first < 0 ? -1 : key.indexOf("\0", first + 1);
  if (first < 0 || second < 0) return;
  const kind = key.slice(0, first);
  if (kind !== "headed" && kind !== "detached") return;
  return Object.freeze({
    kind,
    configurationKey: key.slice(first + 1, second),
    path: key.slice(second + 1),
  });
}

function headDirectoryDistance(start: string, head: string): number {
  const path = relative(dirname(start), dirname(head));
  return path === "" ? 0 : path.split(sep).length;
}

function canonicalPath(path: string): string {
  if (runtime.platform === "win32" && path.startsWith("/") && !/^\/[A-Za-z]:\//.test(path)) {
    return posix.normalize(path);
  }
  return normalize(resolve(path));
}
