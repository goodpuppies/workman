import {
  instantiateRecordFields,
  prune,
  quoteType,
  substituteTypeVars,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
} from "../types.ts";

export function assertEqualityType(
  type: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
) {
  if (!admitsEquality(type, typeEnv, adts)) {
    throw new Error(`type ${quoteType(type)} does not admit equality`);
  }
}

function admitsEquality(
  type: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  seen = new Set<string>(),
): boolean {
  const resolved = prune(type);
  if (resolved.tag === "ffi") return true;
  if (resolved.tag === "prim") return ["Number", "Bool", "String", "Void"].includes(resolved.name);
  if (resolved.tag === "tuple") {
    return resolved.items.every((item) => admitsEquality(item, typeEnv, adts, seen));
  }
  if (resolved.tag === "named") {
    const key = `${resolved.id}<${resolved.args.map((arg) => quoteType(arg)).join(",")}>`;
    if (seen.has(key)) return true;
    seen.add(key);

    const record = [...typeEnv.values()].find((info) => info.id === resolved.id);
    if (record?.recordFields) {
      return instantiateRecordFields(record, resolved.args)
        .every((field) => admitsEquality(field.type, typeEnv, adts, seen));
    }

    const adt = adts.get(resolved.id);
    if (!adt) return false;
    const subst = new Map<number, Ty>();
    (adt.paramTypeIds ?? []).forEach((id, index) => subst.set(id, resolved.args[index]));
    return (adt.ctorTypes ?? []).flat()
      .every((arg) => admitsEquality(substituteTypeVars(arg, subst), typeEnv, adts, seen));
  }
  return false;
}
