import type { FrontendV2, StructuralParseResult } from "../frontend_v2_loader.ts";

type CacheEntry = {
  source: string;
  version?: number;
  result: StructuralParseResult;
};

export class FrontendV2ParseCache {
  #entries = new Map<string, CacheEntry>();

  structural(
    uri: string,
    source: string,
    version: number | undefined,
    frontend: Pick<FrontendV2, "parseStructural">,
  ): StructuralParseResult {
    const current = this.#entries.get(uri);
    if (
      current &&
      current.source === source &&
      versionsMatch(current.version, version)
    ) {
      return current.result;
    }
    const result = frontend.parseStructural(source);
    this.#entries.set(uri, { source, version, result });
    return result;
  }

  delete(uri: string): void {
    this.#entries.delete(uri);
  }

  clear(): void {
    this.#entries.clear();
  }
}

function versionsMatch(left: number | undefined, right: number | undefined): boolean {
  return left === undefined || right === undefined || left === right;
}
