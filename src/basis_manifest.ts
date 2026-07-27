import type { TypeExpr } from "./ast.ts";

export type BasisProfileName = "kernel" | "default";
export type BasisEquality = "always" | "structural" | "never";

export type BasisConstructorDescriptor = Readonly<{
  name: string;
  id: number;
  args: readonly TypeExpr[];
  runtimeName: string;
}>;

export type BasisTypeDescriptor = Readonly<{
  name: string;
  typeNameId: number;
  arity: number;
  profiles: readonly BasisProfileName[];
  equality: BasisEquality;
  argLabels?: readonly string[];
  constructors?: readonly BasisConstructorDescriptor[];
}>;

const param = (name: string): TypeExpr => ({ kind: "TName", name, args: [] });
const profiles = Object.freeze(["kernel", "default"] as const);
const defaultOnly = Object.freeze(["default"] as const);
const ctor = (
  name: string,
  id: number,
  args: TypeExpr[],
): BasisConstructorDescriptor =>
  Object.freeze({
    name,
    id,
    args: Object.freeze(args),
    runtimeName: `__wm_basis_${name.replaceAll(".", "_")}`,
  });

/**
 * Compiler-owned basis type inventory. Static identity, profile membership, equality,
 * constructor identity, and runtime constructor names all originate here.
 */
export const BASIS_TYPES = Object.freeze(
  [
    { name: "Number", typeNameId: -1, arity: 0, profiles, equality: "always" },
    { name: "Bool", typeNameId: -2, arity: 0, profiles, equality: "always" },
    { name: "String", typeNameId: -3, arity: 0, profiles, equality: "always" },
    { name: "Void", typeNameId: -4, arity: 0, profiles, equality: "always" },
    { name: "Js.Value", typeNameId: -5, arity: 0, profiles, equality: "never" },
    { name: "Js.Object", typeNameId: -6, arity: 0, profiles, equality: "never" },
    {
      name: "Js.Array",
      typeNameId: -7,
      arity: 1,
      profiles,
      equality: "never",
      argLabels: ["element"],
    },
    { name: "Js.ArrayLike", typeNameId: -8, arity: 0, profiles, equality: "never" },
    {
      name: "Js.Dict",
      typeNameId: -9,
      arity: 1,
      profiles,
      equality: "never",
      argLabels: ["value"],
    },
    {
      name: "Option",
      typeNameId: -10,
      arity: 1,
      profiles: defaultOnly,
      equality: "structural",
      argLabels: ["T"],
      constructors: [
        ctor("None", -1, []),
        ctor("Some", -2, [param("T")]),
      ],
    },
    {
      name: "Result",
      typeNameId: -11,
      arity: 2,
      profiles: defaultOnly,
      equality: "structural",
      argLabels: ["T", "E"],
      constructors: [
        ctor("Ok", -3, [param("T")]),
        ctor("Err", -4, [param("E")]),
      ],
    },
    {
      name: "List",
      typeNameId: -12,
      arity: 1,
      profiles: defaultOnly,
      equality: "structural",
      argLabels: ["T"],
      constructors: [
        ctor("Nil", -5, []),
        ctor("Cons", -6, [
          param("T"),
          { kind: "TName", name: "List", args: [param("T")] },
        ]),
      ],
    },
    {
      name: "Js.Error",
      typeNameId: -13,
      arity: 0,
      profiles: defaultOnly,
      equality: "structural",
      constructors: [
        ctor("Js.Error", -7, [{ kind: "TName", name: "String", args: [] }]),
        ctor("Js.Unknown", -8, []),
      ],
    },
    {
      name: "Task",
      typeNameId: -14,
      arity: 2,
      profiles: defaultOnly,
      equality: "never",
      argLabels: ["value", "error"],
    },
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
  ] satisfies readonly BasisTypeDescriptor[],
);

export type BasisOperatorKind =
  | "number"
  | "string"
  | "number-order"
  | "equality"
  | "boolean";

export type BasisOperatorDescriptor = Readonly<{
  spelling: string;
  kind: BasisOperatorKind;
  runtimeName: string;
}>;

export const BASIS_OPERATORS: readonly BasisOperatorDescriptor[] = Object.freeze([
  ["+", "number", "__wm_op_add"],
  ["-", "number", "__wm_op_sub"],
  ["*", "number", "__wm_op_mul"],
  ["/", "number", "__wm_op_div"],
  ["%", "number", "__wm_op_mod"],
  ["++", "string", "__wm_op_concat"],
  ["<", "number-order", "__wm_op_lt"],
  ["<=", "number-order", "__wm_op_lte"],
  [">", "number-order", "__wm_op_gt"],
  [">=", "number-order", "__wm_op_gte"],
  ["==", "equality", "__wm_op_eq"],
  ["!=", "equality", "__wm_op_ne"],
  ["&&", "boolean", "__wm_op_and"],
  ["||", "boolean", "__wm_op_or"],
].map(([spelling, kind, runtimeName]) =>
  Object.freeze({
    spelling,
    kind,
    runtimeName,
  } as BasisOperatorDescriptor)
));

/**
 * Fixed unary operators.
 *
 * These are a separate catalog from `BASIS_OPERATORS` because the binary catalog defines
 * the operator *syntax* Workman parses into binary nodes, and several consumers enumerate
 * it as exactly that set. Unary minus is deliberately absent: it shares the binary `-`
 * descriptor, whose implementation distinguishes the tuple and scalar cases, so it already
 * resolves through the manifest.
 */
export const BASIS_UNARY_OPERATORS: readonly BasisOperatorDescriptor[] = Object.freeze([
  Object.freeze({ spelling: "!", kind: "boolean", runtimeName: "__wm_op_not" }),
] as BasisOperatorDescriptor[]);

export function basisUnaryOperatorDescriptor(
  spelling: string,
): BasisOperatorDescriptor | undefined {
  return BASIS_UNARY_OPERATORS.find((descriptor) => descriptor.spelling === spelling);
}

export type BasisIntrinsicDescriptor = Readonly<{
  exportName: string;
  semanticId: `gpu.${string}`;
  runtimeName?: string;
}>;

export type BasisValueDescriptor = Readonly<{
  exportName: string;
  profiles: readonly BasisProfileName[];
  runtimeName: string;
}>;

/** Host values which are neither datatype constructors nor compiler intrinsics. */
export const BASIS_VALUES: readonly BasisValueDescriptor[] = Object.freeze([
  { exportName: "print", profiles, runtimeName: "print" },
  { exportName: "Js.Array.toList", profiles: defaultOnly, runtimeName: "Js.Array.toList" },
  { exportName: "Js.Array.fromList", profiles: defaultOnly, runtimeName: "Js.Array.fromList" },
  {
    exportName: "Result.textOf",
    profiles: defaultOnly,
    runtimeName: "__wm_basis_Result.textOf",
  },
  { exportName: "Json.assert", profiles: defaultOnly, runtimeName: "Json.assert" },
  ...[
    "fromResult",
    "succeed",
    "fail",
    "map",
    "map2",
    "race",
    "andThen",
    "mapErr",
    "recover",
    "all",
  ].map((name) => ({
    exportName: `Task.${name}`,
    profiles: defaultOnly,
    runtimeName: `__wm_basis_Task.${name}`,
  })),
  ...["empty", "get", "set"].map((name) => ({
    exportName: `Dict.${name}`,
    profiles: defaultOnly,
    runtimeName: `Dict.${name}`,
  })),
]);

export const GPU_INTRINSIC_ENTRIES = [
  ["color", "gpu.color", undefined],
  ["fragment", "gpu.fragment", undefined],
  ["i32", "gpu.i32", undefined],
  ["f32", "gpu.f32", undefined],
  ["uniform", "gpu.uniform", undefined],
  ["read", "gpu.read", undefined],
  ["withValue", "gpu.with-value", undefined],
  ["wgsl", "gpu.wgsl", "__wm_gpu_wgsl"],
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

export function basisTypeDescriptor(name: string): BasisTypeDescriptor | undefined {
  return BASIS_TYPES.find((descriptor) => descriptor.name === name);
}

export function basisPrimitiveAdmitsEquality(name: string): boolean {
  return basisTypeDescriptor(name)?.equality === "always";
}

export function basisOperatorDescriptor(
  spelling: string,
): BasisOperatorDescriptor | undefined {
  return BASIS_OPERATORS.find((descriptor) => descriptor.spelling === spelling);
}

export function basisIntrinsicDescriptor(
  exportName: string,
): BasisIntrinsicDescriptor | undefined {
  return BASIS_INTRINSICS.find((descriptor) => descriptor.exportName === exportName);
}

export function basisIntrinsicDescriptorBySemanticId(
  semanticId: BasisIntrinsicDescriptor["semanticId"],
): BasisIntrinsicDescriptor | undefined {
  return BASIS_INTRINSICS.find((descriptor) => descriptor.semanticId === semanticId);
}
