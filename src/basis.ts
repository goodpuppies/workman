import { BASIS_TYPES } from "./basis_manifest.ts";
import type { TypeExpr } from "./ast.ts";

export type BasisCtorDecl = {
  name: string;
  id: number;
  args: TypeExpr[];
};

export type BasisTypeDecl = {
  name: string;
  params: string[];
  ctors: BasisCtorDecl[];
};

export const basisTypes: BasisTypeDecl[] = BASIS_TYPES.flatMap((type) =>
  type.constructors
    ? [{
      name: type.name,
      params: [...(type.argLabels ?? [])],
      ctors: type.constructors.map((ctor) => ({
        name: ctor.name,
        id: ctor.id,
        args: [...ctor.args],
      })),
    }]
    : []
);

export function basisCtorId(name: string): number | undefined {
  for (const type of basisTypes) {
    const ctor = type.ctors.find((item) => item.name === name);
    if (ctor) return ctor.id;
  }
  return undefined;
}

export function basisCtorJsName(id: number): string | undefined {
  for (const type of basisTypes) {
    const ctor = type.ctors.find((item) => item.id === id);
    if (ctor) return `__wm_basis_${ctor.name.replaceAll(".", "_")}`;
  }
  return undefined;
}

export function basisCtorNamesForType(name: string): string[] {
  return basisTypes.find((type) => type.name === name)?.ctors.map((ctor) => ctor.name) ?? [];
}
