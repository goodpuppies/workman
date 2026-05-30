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

const param = (name: string): TypeExpr => ({ kind: "TName", name, args: [] });

export const basisTypes: BasisTypeDecl[] = [
  {
    name: "Option",
    params: ["T"],
    ctors: [
      { name: "None", id: -1, args: [] },
      { name: "Some", id: -2, args: [param("T")] },
    ],
  },
  {
    name: "Result",
    params: ["T", "E"],
    ctors: [
      { name: "Ok", id: -3, args: [param("T")] },
      { name: "Err", id: -4, args: [param("E")] },
    ],
  },
  //export type List<T> = Nil | Cons<T, List<T>>;
  {
    name: "List",
    params: ["T"],
    ctors: [
      { name: "Nil", id: -5, args: [] },
      { name: "Cons", id: -6, args: [param("T"), { kind: "TName", name: "List", args: [param("T")] }] },
    ],
  },
];

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
    if (ctor) return `__wm_basis_${ctor.name}`;
  }
  return undefined;
}

export function basisCtorNamesForType(name: string): string[] {
  return basisTypes.find((type) => type.name === name)?.ctors.map((ctor) => ctor.name) ?? [];
}
