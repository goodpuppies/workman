import type { Expr } from "./ast.ts";

/** The only runtime-visible data in a completed visual-v1 fragment. */
export type VisualShaderDescriptorV1 = {
  wgsl: string;
  vertexEntry: "wm_vertex";
  fragmentEntry: "wm_fragment";
};

export type VisualShaderUniformRepresentation =
  | "f32"
  | "f32x2"
  | "f32x3"
  | "f32x4"
  | "i32"
  | "i32x2"
  | "i32x3"
  | "i32x4";

export type VisualShaderUniformFieldV2 = {
  name: string;
  declaredIndex: number;
  representation: VisualShaderUniformRepresentation;
  offset: number;
  byteLength: number;
};

export type VisualShaderUniformLayoutV2 = {
  recordName: string;
  binding: 0;
  byteLength: number;
  fields: VisualShaderUniformFieldV2[];
};

export type VisualShaderResourceBindingV5 = {
  name: string;
  declaredIndex: number;
  binding: number;
  kind: "sampled-texture-2d" | "sampler";
};

export type VisualShaderResourceLayoutV5 = {
  recordName: string;
  group: 0;
  bindings: VisualShaderResourceBindingV5[];
};

/** Compiler-owned identity plus the minimal runtime descriptor. */
export type VisualShaderArtifactV1 = VisualShaderDescriptorV1 & {
  id: `wms-v1-${string}`;
  uniformLayout?: VisualShaderUniformLayoutV2;
  resourceLayout?: VisualShaderResourceLayoutV5;
};

export type GpuFragmentCall = Extract<Expr, { kind: "Call" }>;

/**
 * Explicit handoff from the completed shader pipeline to host Core lowering.
 * Keys are the resolved compiler-owned Gpu.fragment call identities.
 */
export type MaterializedGpuArtifacts = ReadonlyMap<GpuFragmentCall, VisualShaderArtifactV1>;
