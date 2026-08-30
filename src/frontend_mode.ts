export type FrontendMode = "v2";

export const DEFAULT_WORKMAN_FRONTEND: FrontendMode = "v2";

export function resolveCompilerFrontend(
  mode: FrontendMode | undefined,
  _surface: "workman" | "wmsml" | undefined,
): FrontendMode {
  return mode ?? DEFAULT_WORKMAN_FRONTEND;
}

export function assertCompilerFrontendMode(mode: FrontendMode | undefined): void {
  if (mode === undefined || mode === "v2") return;
  throw new Error(`unknown frontend mode ${String(mode)}`);
}
