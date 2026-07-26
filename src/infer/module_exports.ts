import {
  knownTypeInfos,
  prune,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  type TypeInfo,
} from "../types.ts";

export function addExportableTypes(ids: Set<number>, typeEnv: TypeEnv) {
  for (const info of knownTypeInfos(typeEnv)) ids.add(info.id);
}

export function assertExportableType(t: Ty, exportableTypeIds: Set<number>, label: string) {
  if (mentionsPrivateType(t, exportableTypeIds)) {
    throw new Error(`${label} mentions non-exported type`);
  }
}

export function assertExportableRecord(info: TypeInfo, exportableTypeIds: Set<number>) {
  for (const field of info.recordFields ?? []) {
    assertExportableType(field.type, exportableTypeIds, `exported record ${info.name}`);
  }
}

export function exportedAdts(
  adts: Map<number, TypeDeclInfo>,
  typeExports: TypeEnv,
): Map<number, TypeDeclInfo> {
  const exportedTypeIds = new Set([...typeExports.values()].map((info) => info.id));
  return new Map([...adts].filter(([id]) => exportedTypeIds.has(id)));
}

function mentionsPrivateType(t: Ty, exportableTypeIds: Set<number>): boolean {
  t = prune(t);
  if (t.tag === "fn") {
    return t.params.some((p) => mentionsPrivateType(p, exportableTypeIds)) ||
      mentionsPrivateType(t.result, exportableTypeIds);
  }
  if (t.tag === "tuple") {
    return t.items.some((item) => mentionsPrivateType(item, exportableTypeIds));
  }
  if (t.tag === "named") {
    return !exportableTypeIds.has(t.id) ||
      t.args.some((arg) => mentionsPrivateType(arg, exportableTypeIds));
  }
  return false;
}
