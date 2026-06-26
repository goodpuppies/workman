export type FrontendMode = "v1" | "v2" | "compare";

export function assertCompilerFrontendMode(mode: FrontendMode | undefined): void {
  if (mode === undefined || mode === "v1" || mode === "v2" || mode === "compare") return;
  throw new Error(`unknown frontend mode ${String(mode)}`);
}
