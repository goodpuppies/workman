import {
  addEqualityConstraint,
  instantiateRecordFields,
  prune,
  quoteType,
  substituteTypeVars,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeInfoById,
} from "../types.ts";
import { basisPrimitiveAdmitsEquality } from "../basis_manifest.ts";

export function assertEqualityType(
  type: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
) {
  requireEquality(type, typeEnv, adts);
}

function rejectEquality(type: Ty): never {
  throw new Error(`type ${quoteType(type)} does not admit equality`);
}

function requireEquality(
  type: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  seen = new Set<string>(),
): void {
  const resolved = prune(type);
  if (resolved.tag === "var") {
    addEqualityConstraint(resolved, (bound) => {
      requireEquality(bound, typeEnv, adts);
    });
    return;
  }
  if (resolved.tag === "ffi") return;
  if (resolved.tag === "prim") {
    if (!basisPrimitiveAdmitsEquality(resolved.name)) {
      rejectEquality(resolved);
    }
    return;
  }
  if (resolved.tag === "tuple") {
    resolved.items.forEach((item) => requireEquality(item, typeEnv, adts, seen));
    return;
  }
  if (resolved.tag === "named") {
    const key = `${resolved.id}<${resolved.args.map((arg) => quoteType(arg)).join(",")}>`;
    if (seen.has(key)) return;
    seen.add(key);

    const record = typeInfoById(typeEnv, resolved.id);
    if (record?.recordFields) {
      instantiateRecordFields(record, resolved.args)
        .forEach((field) => requireEquality(field.type, typeEnv, adts, seen));
      return;
    }

    const adt = adts.get(resolved.id);
    if (!adt) rejectEquality(resolved);
    const subst = new Map<number, Ty>();
    (adt.paramTypeIds ?? []).forEach((id, index) => subst.set(id, resolved.args[index]));
    return (adt.ctorTypes ?? []).flat()
      .forEach((arg) => requireEquality(substituteTypeVars(arg, subst), typeEnv, adts, seen));
  }
  rejectEquality(resolved);
}
