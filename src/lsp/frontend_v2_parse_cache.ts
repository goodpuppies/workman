import type { FrontendV2Surface, FrontendV2SurfaceProgram } from "../frontend_v2_surface_loader.ts";

type CacheEntry = {
  source: string;
  version?: number;
  surface?: FrontendV2SurfaceProgram;
  surfaceParsed: boolean;
};

export class FrontendV2ParseCache {
  #entries = new Map<string, CacheEntry>();

  surface(
    uri: string,
    source: string,
    version: number | undefined,
    frontend: Pick<FrontendV2Surface, "parseSurfaceProgram">,
  ): FrontendV2SurfaceProgram | undefined {
    const current = this.#entries.get(uri);
    if (
      current &&
      current.source === source &&
      versionsMatch(current.version, version) &&
      current.surfaceParsed
    ) {
      return current.surface;
    }
    const surface = frontend.parseSurfaceProgram(source);
    this.#entries.set(uri, {
      source,
      version,
      surface,
      surfaceParsed: true,
    });
    return surface;
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
