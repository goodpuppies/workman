import {
  type BasisIntrinsicDescriptor,
  type BasisTypeDescriptor,
  type BasisValueDescriptor,
  ctor,
  defaultOnly,
  param,
  profiles,
} from "./basis_descriptor.ts";
import { JS_HOST_TYPES, JS_HOST_VALUES } from "./host/js_manifest.ts";
import {
  BASIS_INTRINSICS,
  GPU_INTRINSIC_ENTRIES,
  GPU_TARGET_TYPES,
} from "./wmslang/target_manifest.ts";

export * from "./basis_descriptor.ts";
export { BASIS_INTRINSICS, GPU_INTRINSIC_ENTRIES };

/**
 * Layer-0 types: the Definition's initial basis plus Workman's compiler-owned additions (`Result`,
 * `Task`, and the host-owned layer-1 types whose equality and printing the compiler implements).
 */
const LAYER0_TYPES = Object.freeze(
  [
    { name: "Number", typeNameId: -1, arity: 0, profiles, equality: "always" },
    { name: "Bool", typeNameId: -2, arity: 0, profiles, equality: "always" },
    { name: "String", typeNameId: -3, arity: 0, profiles, equality: "always" },
    { name: "Void", typeNameId: -4, arity: 0, profiles, equality: "always" },
    { name: "Char", typeNameId: -34, arity: 0, profiles, equality: "always" },
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
      name: "Task",
      typeNameId: -14,
      arity: 2,
      profiles: defaultOnly,
      equality: "never",
      argLabels: ["value", "error"],
    },
    {
      name: "Word8.Word",
      typeNameId: -24,
      arity: 0,
      profiles,
      equality: "always",
      hostOwned: true,
    },
    {
      name: "Word16.Word",
      typeNameId: -25,
      arity: 0,
      profiles,
      equality: "always",
      hostOwned: true,
    },
    {
      name: "Word32.Word",
      typeNameId: -26,
      arity: 0,
      profiles,
      equality: "always",
      hostOwned: true,
    },
    {
      name: "Word64.Word",
      typeNameId: -27,
      arity: 0,
      profiles,
      equality: "always",
      hostOwned: true,
    },
    {
      name: "Word8Vector.Vector",
      typeNameId: -28,
      arity: 0,
      profiles,
      equality: "always",
      hostOwned: true,
    },
    {
      name: "Word8VectorSlice.Slice",
      typeNameId: -29,
      arity: 0,
      profiles,
      equality: "never",
      hostOwned: true,
    },
    {
      name: "Float32.Real",
      typeNameId: -30,
      arity: 0,
      profiles,
      equality: "never",
      hostOwned: true,
    },
    {
      name: "Float64.Real",
      typeNameId: -31,
      arity: 0,
      profiles,
      equality: "never",
      hostOwned: true,
    },
    {
      name: "Vector.Vector",
      typeNameId: -32,
      arity: 1,
      profiles,
      equality: "arguments",
      hostOwned: true,
      argLabels: ["T"],
    },
    {
      name: "VectorSlice.Slice",
      typeNameId: -33,
      arity: 1,
      profiles,
      equality: "never",
      hostOwned: true,
      argLabels: ["T"],
    },
  ] satisfies readonly BasisTypeDescriptor[],
);

/**
 * Compiler-owned basis type inventory: layer 0, the JS host layer and the wmslang target layer.
 * Static identity, profile membership, equality, constructor identity, and runtime constructor
 * names all originate in these descriptors.
 */
export const BASIS_TYPES: readonly BasisTypeDescriptor[] = Object.freeze([
  ...LAYER0_TYPES,
  ...JS_HOST_TYPES,
  ...GPU_TARGET_TYPES,
]);

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
  directRuntimeName?: string;
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
  ["&&", "boolean", "__wm_op_and", "__wm_op_and_d2"],
  ["||", "boolean", "__wm_op_or", "__wm_op_or_d2"],
].map(([spelling, kind, runtimeName, directRuntimeName]) =>
  Object.freeze({
    spelling,
    kind,
    runtimeName,
    ...(directRuntimeName ? { directRuntimeName } : {}),
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

/** Host values which are neither datatype constructors nor compiler intrinsics. */
/** Layer-0 values implemented by the compiler, followed by the JS host's. */
export const BASIS_VALUES: readonly BasisValueDescriptor[] = Object.freeze([
  { exportName: "print", profiles, runtimeName: "print" },
  { exportName: "Text.of", profiles, runtimeName: "Text.of" },
  ...JS_HOST_VALUES,
]);

export function basisTypeDescriptor(name: string): BasisTypeDescriptor | undefined {
  return BASIS_TYPES.find((descriptor) => descriptor.name === name);
}

export function basisTypeIsHostOwned(name: string): boolean {
  return basisTypeDescriptor(name)?.hostOwned === true;
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
