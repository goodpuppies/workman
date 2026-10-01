import {
  type BasisIntrinsicDescriptor,
  type BasisTypeDescriptor,
  ctor,
  profiles,
} from "../basis_descriptor.ts";

// The wmslang target layer: the `Gpu.*` types and the compiler-lowered GPU intrinsics. Lowering
// refers to the intrinsics by semantic id (BD7), so they stay compiler-known, described here
// instead of in the layer-0 manifest.

export const GPU_TARGET_TYPES = Object.freeze(
  [
    { name: "Gpu.Color", typeNameId: -15, arity: 0, profiles, equality: "never" },
    { name: "Gpu.Fragment", typeNameId: -16, arity: 0, profiles, equality: "never" },
    {
      name: "Gpu.Uniform",
      typeNameId: -17,
      arity: 1,
      profiles,
      equality: "never",
      argLabels: ["value"],
    },
    { name: "Gpu.Texture2D", typeNameId: -18, arity: 0, profiles, equality: "never" },
    {
      name: "Gpu.SampledTexture2D",
      typeNameId: -19,
      arity: 0,
      profiles,
      equality: "never",
    },
    {
      name: "Gpu.RenderTarget2D",
      typeNameId: -20,
      arity: 0,
      profiles,
      equality: "never",
    },
    { name: "Gpu.Sampler", typeNameId: -21, arity: 0, profiles, equality: "never" },
    {
      name: "Gpu.ShaderTarget",
      typeNameId: -23,
      arity: 0,
      profiles,
      equality: "structural",
      constructors: [
        ctor("Gpu.ShaderTarget.WGSL", -9, []),
        ctor("Gpu.ShaderTarget.GLSL", -10, []),
        ctor("Gpu.ShaderTarget.HLSL", -11, []),
        ctor("Gpu.ShaderTarget.METAL", -12, []),
      ],
    },
  ] satisfies readonly BasisTypeDescriptor[],
);

export const GPU_INTRINSIC_ENTRIES = [
  ["color", "gpu.color", undefined],
  ["fragment", "gpu.fragment", undefined],
  ["i32", "gpu.i32", undefined],
  ["f32", "gpu.f32", undefined],
  ["uniform", "gpu.uniform", undefined],
  ["read", "gpu.read", undefined],
  ["withValue", "gpu.with-value", undefined],
  ["slang", "gpu.slang", "__wm_gpu_slang"],
  ["glsl", "gpu.glsl", "__wm_gpu_glsl"],
  ["callableName", "gpu.callable-name", "__wm_gpu_callable_name"],
  ["wgsl", "gpu.wgsl", "__wm_gpu_wgsl"],
  ["shaderSource", "gpu.shader-source", "__wm_gpu_shader_source"],
  ["vertexEntryPoint", "gpu.vertex-entry-point", "__wm_gpu_vertex_entry_point"],
  ["fragmentEntryPoint", "gpu.fragment-entry-point", "__wm_gpu_fragment_entry_point"],
  ["artifactIdentity", "gpu.artifact-identity", "__wm_gpu_artifact_identity"],
  ["uniformBinding", "gpu.uniform-binding", "__wm_gpu_uniform_binding"],
  ["uniformByteLength", "gpu.uniform-byte-length", "__wm_gpu_uniform_byte_length"],
  ["uniformBytes", "gpu.uniform-bytes", "__wm_gpu_uniform_bytes"],
  ["texture2D", "gpu.texture-2d", "__wm_gpu_texture_2d"],
  ["sampledTexture2D", "gpu.sampled-texture-2d", "__wm_gpu_sampled_texture_2d"],
  ["renderTarget2D", "gpu.render-target-2d", "__wm_gpu_render_target_2d"],
  ["nearestSampler", "gpu.nearest-sampler", "__wm_gpu_nearest_sampler"],
  ["linearSampler", "gpu.linear-sampler", "__wm_gpu_linear_sampler"],
  ["destroyTexture2D", "gpu.destroy-texture-2d", "__wm_gpu_destroy_texture_2d"],
  ["bindGroupEntries", "gpu.bind-group-entries", "__wm_gpu_bind_group_entries"],
  ["bindingCount", "gpu.binding-count", "__wm_gpu_binding_count"],
  ["renderTargetView", "gpu.render-target-view", "__wm_gpu_render_target_view"],
  ["validateRenderTarget", "gpu.validate-render-target", "__wm_gpu_validate_render_target"],
] as const;

export const BASIS_INTRINSICS: readonly BasisIntrinsicDescriptor[] = Object.freeze(
  GPU_INTRINSIC_ENTRIES.map(([name, semanticId, runtimeName]) =>
    Object.freeze({ exportName: `Gpu.${name}`, semanticId, runtimeName })
  ),
);
