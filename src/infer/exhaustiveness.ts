import type { Pattern } from "../ast.ts";
import {
  instantiateRecordFields,
  prune,
  substituteTypeVars,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeFromAst,
} from "../types.ts";

export function checkExhaustive(
  patterns: Pattern[],
  valueType: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
): string | undefined {
  if (isVectorExhaustive(patterns.map((pattern) => [pattern]), [valueType], typeEnv, adts)) {
    return undefined;
  }
  const scrutinee = prune(valueType);
  if (scrutinee.tag === "named") {
    const info = adts.get(scrutinee.id);
    if (!info) return "non-exhaustive match";
    const covered = new Set(
      patterns
        .filter((p): p is Extract<Pattern, { kind: "PCtor" }> => p.kind === "PCtor")
        .map((p) => baseName(p.name)),
    );
    const missing = info.ctors.map((c) => c.name).filter((name) => !covered.has(name));
    if (missing.length) return `non-exhaustive match: missing ${missing.join(", ")}`;
  }
  return "non-exhaustive match";
}

export function isVectorExhaustive(
  rows: Pattern[][],
  types: Ty[],
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
): boolean {
  if (types.length === 0) return rows.length > 0;
  const [headType, ...tailTypes] = types;
  const head = prune(headType);
  if (rows.some((row) => isIrrefutable(row[0]))) {
    const tails = rows.filter((row) => isIrrefutable(row[0])).map((row) => row.slice(1));
    return isVectorExhaustive(tails, tailTypes, typeEnv, adts);
  }

  if (head.tag === "prim" && head.name === "Bool") {
    const trueRows = rows.filter((row) => row[0].kind === "PBool" && row[0].value).map((row) =>
      row.slice(1)
    );
    const falseRows = rows.filter((row) => row[0].kind === "PBool" && !row[0].value).map((row) =>
      row.slice(1)
    );
    return isVectorExhaustive(trueRows, tailTypes, typeEnv, adts) &&
      isVectorExhaustive(falseRows, tailTypes, typeEnv, adts);
  }

  if (head.tag === "prim" && head.name === "Void") {
    const voidRows = rows.filter((row) => row[0].kind === "PVoid").map((row) => row.slice(1));
    return isVectorExhaustive(voidRows, tailTypes, typeEnv, adts);
  }

  if (head.tag === "tuple") {
    const tupleRows = rows
      .filter((row): row is [Extract<Pattern, { kind: "PTuple" }>, ...Pattern[]] =>
        row[0].kind === "PTuple"
      )
      .filter((row) => row[0].items.length === head.items.length)
      .map((row) => [...row[0].items, ...row.slice(1)]);
    if (tupleRows.length === 0) return false;
    return isVectorExhaustive(tupleRows, [...head.items, ...tailTypes], typeEnv, adts);
  }

  if (head.tag === "named") {
    const record = [...typeEnv.values()].find((info) => info.id === head.id && info.recordFields);
    if (record?.recordFields) {
      const fields = instantiateRecordFields(record, head.args);
      const recordRows = rows
        .filter((row): row is [Extract<Pattern, { kind: "PRecord" }>, ...Pattern[]] =>
          row[0].kind === "PRecord"
        )
        .map((row) => [
          ...fields.map((field) =>
            row[0].fields.find((item) => item.name === field.name)?.pattern ??
              { kind: "PWildcard" as const }
          ),
          ...row.slice(1),
        ]);
      if (recordRows.length === 0) return false;
      return isVectorExhaustive(
        recordRows,
        [...fields.map((field) => field.type), ...tailTypes],
        typeEnv,
        adts,
      );
    }
    const info = adts.get(head.id);
    if (!info) return false;
    for (const ctor of info.ctors) {
      const ctorRows = rows
        .filter((row): row is [Extract<Pattern, { kind: "PCtor" }>, ...Pattern[]] =>
          row[0].kind === "PCtor"
        )
        .filter((row) => baseName(row[0].name) === ctor.name)
        .map((row) => [...row[0].args, ...row.slice(1)]);
      if (ctorRows.length === 0) return false;
      const ctorTypes = constructorArgTypes(info, ctor, head, typeEnv);
      if (!isVectorExhaustive(ctorRows, [...ctorTypes, ...tailTypes], typeEnv, adts)) return false;
    }
    return true;
  }

  return false;
}

export function mentionsLocalType(t: Ty, allowed: Set<number>): boolean {
  t = prune(t);
  if (t.tag === "fn") {
    return t.params.some((p) => mentionsLocalType(p, allowed)) ||
      mentionsLocalType(t.result, allowed);
  }
  if (t.tag === "tuple") return t.items.some((x) => mentionsLocalType(x, allowed));
  if (t.tag === "named") {
    return !allowed.has(t.id) || t.args.some((x) => mentionsLocalType(x, allowed));
  }
  return false;
}

function baseName(name: string): string {
  return name.split(".").at(-1)!;
}

function isIrrefutable(pattern: Pattern): boolean {
  if (pattern.kind === "PWildcard" || pattern.kind === "PVar") return true;
  if (pattern.kind === "PTuple") return pattern.items.every(isIrrefutable);
  if (pattern.kind === "PRecord") {
    return pattern.fields.every((field) => isIrrefutable(field.pattern));
  }
  return false;
}

function constructorArgTypes(
  info: TypeDeclInfo,
  ctor: TypeDeclInfo["ctors"][number],
  target: Extract<Ty, { tag: "named" }>,
  typeEnv: TypeEnv,
): Ty[] {
  const index = info.ctors.indexOf(ctor);
  const elaborated = info.ctorTypes?.[index];
  if (!elaborated) {
    const vars = new Map(info.params.map((name, i) => [name, target.args[i]] as const));
    return ctor.args.map((arg) => typeFromAst(arg, typeEnv, vars));
  }
  const subst = new Map<number, Ty>();
  for (const [i, arg] of target.args.entries()) {
    const param = info.paramTypeIds?.[i];
    if (param !== undefined) subst.set(param, arg);
  }
  return elaborated.map((arg) => substituteTypeVars(arg, subst));
}
