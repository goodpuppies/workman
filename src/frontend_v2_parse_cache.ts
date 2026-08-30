import { normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FrontendV2Surface,
  FrontendV2SurfaceParseFailure,
  FrontendV2SurfaceProgram,
} from "./frontend_v2_surface_loader.ts";

type CacheEntry = {
  source: string;
  version?: number;
  surface?: FrontendV2SurfaceProgram;
  surfaceParsed: boolean;
  failure?: FrontendV2SurfaceParseFailure;
  failureParsed: boolean;
};

/** Source-keyed parser results shared by compiler analysis and LSP presentation. */
export class FrontendV2ParseCache {
  #entries = new Map<string, CacheEntry>();

  surface(
    pathOrUri: string,
    source: string,
    version: number | undefined,
    frontend: Pick<FrontendV2Surface, "parseSurfaceProgram">,
  ): FrontendV2SurfaceProgram | undefined {
    const key = cacheKey(pathOrUri);
    const current = this.#matching(key, source, version);
    if (current?.surfaceParsed) return current.surface;
    const surface = frontend.parseSurfaceProgram(source);
    this.#entries.set(key, {
      source,
      version,
      surface,
      surfaceParsed: true,
      failure: current?.failure,
      failureParsed: current?.failureParsed ?? false,
    });
    return surface;
  }

  failure(
    pathOrUri: string,
    source: string,
    version: number | undefined,
    frontend: Pick<FrontendV2Surface, "parseSurfaceFailure">,
  ): FrontendV2SurfaceParseFailure | undefined {
    const key = cacheKey(pathOrUri);
    const current = this.#matching(key, source, version);
    if (current?.failureParsed) return current.failure;
    const failure = frontend.parseSurfaceFailure(source);
    this.#entries.set(key, {
      source,
      version,
      surface: current?.surface,
      surfaceParsed: current?.surfaceParsed ?? false,
      failure,
      failureParsed: true,
    });
    return failure;
  }

  delete(pathOrUri: string): void {
    this.#entries.delete(cacheKey(pathOrUri));
  }

  clear(): void {
    this.#entries.clear();
  }

  #matching(key: string, source: string, version: number | undefined): CacheEntry | undefined {
    const current = this.#entries.get(key);
    return current && current.source === source && versionsMatch(current.version, version)
      ? current
      : undefined;
  }
}

function cacheKey(pathOrUri: string): string {
  try {
    const path = pathOrUri.startsWith("file:") ? fileURLToPath(pathOrUri) : pathOrUri;
    return normalize(resolve(path));
  } catch {
    return pathOrUri;
  }
}

function versionsMatch(left: number | undefined, right: number | undefined): boolean {
  return left === undefined || right === undefined || left === right;
}
