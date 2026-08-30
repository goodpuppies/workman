import type { BasisStructureId, BasisValueId, TypeNameId } from "./ids.ts";
import { BASIS_TYPES, GPU_INTRINSIC_ENTRIES } from "./basis_manifest.ts";

export const BASIS_TYPE_NAME_IDS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(BASIS_TYPES.map((descriptor) => [
    descriptor.name,
    descriptor.typeNameId,
  ])),
);

export function basisTypeNameId(name: string): TypeNameId | undefined {
  const id = (BASIS_TYPE_NAME_IDS as Record<string, number>)[name];
  return id === undefined ? undefined : id as TypeNameId;
}

export function basisValueId(name: string): BasisValueId {
  return `basis-value:${name}` as BasisValueId;
}

export function standardValueId(modulePath: string, name: string): BasisValueId {
  return `standard-value:${modulePath}:${name}` as BasisValueId;
}

export function basisStructureId(name: string): BasisStructureId {
  return `basis-structure:${name}` as BasisStructureId;
}

export const GPU_SEMANTIC_IDS = Object.freeze(Object.fromEntries(
  GPU_INTRINSIC_ENTRIES.map(([name, semanticId]) => [name, semanticId]),
)) as Readonly<
  Record<
    (typeof GPU_INTRINSIC_ENTRIES)[number][0],
    (typeof GPU_INTRINSIC_ENTRIES)[number][1]
  >
>;

export type CompilerSemanticId = (typeof GPU_SEMANTIC_IDS)[keyof typeof GPU_SEMANTIC_IDS];
