import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadModuleGraph } from "../module_graph.ts";

/** Private adapter-to-mapper channel. Each TS session owns a different file. */
export const snapshotEnvironment = "WM_CONTENT_MAPPER_SNAPSHOT";

export async function readOverlays(): Promise<Map<string, string>> {
  const path = Deno.env.get(snapshotEnvironment);
  if (!path) return new Map();
  const entries: unknown = JSON.parse(await Deno.readTextFile(path));
  if (!Array.isArray(entries)) throw new Error("Invalid Workman buffer snapshot");
  const result = new Map<string, string>();
  for (const entry of entries) {
    if (
      !Array.isArray(entry) || entry.length !== 2 ||
      typeof entry[0] !== "string" || !isAbsolute(entry[0]) ||
      typeof entry[1] !== "string"
    ) throw new Error("Invalid Workman buffer snapshot entry");
    result.set(entry[0], entry[1]);
  }
  return result;
}

/** Watch complete WM graphs, including dependencies outside the TS project directory. */
export async function projectConfiguration(configFileName: string, entryPoints: string[]) {
  const overlays = await readOverlays();
  const sources = new Map<string, string>();
  const watched = new Set<string>();
  const snapshot = Deno.env.get(snapshotEnvironment);
  if (snapshot) watched.add(snapshot);
  for (const entry of entryPoints) {
    const path = resolve(configFileName ? dirname(configFileName) : Deno.cwd(), entry);
    watched.add(path);
    // An entry may be temporarily removed while other modules remain usable.
    let graph;
    try {
      graph = await loadModuleGraph(path, { virtualFs: overlays, syntaxRecovery: true });
    } catch (error) {
      if (
        !(error instanceof Deno.errors.NotFound) &&
        (error as NodeJS.ErrnoException)?.code !== "ENOENT"
      ) throw error;
      sources.set(path, "<missing>");
      continue;
    }
    for (const node of graph.nodes.values()) {
      watched.add(node.path);
      sources.set(node.path, node.source);
      for (const edge of node.imports) {
        if (isAbsolute(edge.path)) watched.add(edge.path);
      }
    }
  }
  const fingerprint = JSON.stringify([
    [...overlays].sort(([a], [b]) => a.localeCompare(b)),
    [...sources].sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return {
    configIdentity: createHash("sha256").update(fingerprint).digest("hex"),
    watchedFiles: [...watched].sort(),
  };
}
