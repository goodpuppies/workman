// Descriptor types and helpers shared by the layer-0 manifest (`basis_manifest.ts`), the JS host
// manifest (`host/js_manifest.ts`) and the wmslang target manifest (`wmslang/target_manifest.ts`).
import type { TypeExpr } from "./ast.ts";

export type BasisProfileName = "kernel" | "default";
/**
 * `structural` types are datatypes whose constructors decide equality. `arguments` types are
 * host-owned containers that admit equality exactly when their type arguments do.
 */
export type BasisEquality = "always" | "structural" | "arguments" | "never";

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
  /**
   * A layer-1 type whose values are host values that the library's JavaScript primitives create
   * and consume. Such values may cross a JS FFI boundary as they are (`basis/js/*.js`).
   */
  hostOwned?: true;
  argLabels?: readonly string[];
  constructors?: readonly BasisConstructorDescriptor[];
}>;

export const param = (name: string): TypeExpr => ({ kind: "TName", name, args: [] });
export const profiles = Object.freeze(["kernel", "default"] as const);
export const defaultOnly = Object.freeze(["default"] as const);
export const ctor = (
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
