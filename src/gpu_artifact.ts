import type { Expr } from "./ast.ts";

/** The only runtime-visible data in a completed visual-v1 fragment. */
export type VisualShaderDescriptorV1 = {
  wgsl: string;
  vertexEntry: "wm_vertex";
  fragmentEntry: "wm_fragment";
};

/** Compiler-owned identity plus the minimal runtime descriptor. */
export type VisualShaderArtifactV1 = VisualShaderDescriptorV1 & {
  id: `wms-v1-${string}`;
};

export type GpuFragmentCall = Extract<Expr, { kind: "Call" }>;

/**
 * Explicit handoff from the completed shader pipeline to host Core lowering.
 * Keys are the resolved compiler-owned Gpu.fragment call identities.
 */
export type MaterializedGpuArtifacts = ReadonlyMap<GpuFragmentCall, VisualShaderArtifactV1>;
