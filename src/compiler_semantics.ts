import type { TypeNameId } from "./ids.ts";

export const BASIS_TYPE_NAME_IDS = {
  Number: -1,
  Bool: -2,
  String: -3,
  Void: -4,
  "Js.Value": -5,
  "Js.Object": -6,
  "Js.Array": -7,
  "Js.ArrayLike": -8,
  "Js.Dict": -9,
  Option: -10,
  Result: -11,
  List: -12,
  "Js.Error": -13,
  Task: -14,
  "Gpu.Color": -15,
  "Gpu.Fragment": -16,
  "Gpu.Uniform": -17,
  "Gpu.Texture2D": -18,
  "Gpu.SampledTexture2D": -19,
  "Gpu.RenderTarget2D": -20,
  "Gpu.Sampler": -21,
} as const satisfies Record<string, number>;

export function basisTypeNameId(name: string): TypeNameId | undefined {
  const id = (BASIS_TYPE_NAME_IDS as Record<string, number>)[name];
  return id === undefined ? undefined : id as TypeNameId;
}

export const GPU_SEMANTIC_IDS = {
  color: "gpu.color",
  fragment: "gpu.fragment",
  i32: "gpu.i32",
  f32: "gpu.f32",
  uniform: "gpu.uniform",
  read: "gpu.read",
  withValue: "gpu.with-value",
  wgsl: "gpu.wgsl",
  vertexEntryPoint: "gpu.vertex-entry-point",
  fragmentEntryPoint: "gpu.fragment-entry-point",
  artifactIdentity: "gpu.artifact-identity",
  uniformBinding: "gpu.uniform-binding",
  uniformByteLength: "gpu.uniform-byte-length",
  uniformBytes: "gpu.uniform-bytes",
  texture2D: "gpu.texture-2d",
  sampledTexture2D: "gpu.sampled-texture-2d",
  renderTarget2D: "gpu.render-target-2d",
  nearestSampler: "gpu.nearest-sampler",
  linearSampler: "gpu.linear-sampler",
  destroyTexture2D: "gpu.destroy-texture-2d",
  bindGroupEntries: "gpu.bind-group-entries",
  bindingCount: "gpu.binding-count",
  renderTargetView: "gpu.render-target-view",
  validateRenderTarget: "gpu.validate-render-target",
} as const;

export type CompilerSemanticId = (typeof GPU_SEMANTIC_IDS)[keyof typeof GPU_SEMANTIC_IDS];
