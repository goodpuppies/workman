import type { Pattern } from "../ast.ts";
import { parseLongId } from "../ast.ts";
import {
  instantiateRecordFields,
  prune,
  substituteTypeVars,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeFromAst,
  typeInfoById,
} from "../types.ts";

export interface MissingCase {
  path: string[];
  missing: string;
}

export function checkExhaustive(
  patterns: Pattern[],
  valueType: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
): string | undefined {
  const missing = findMissingCases(
    patterns.map((pattern) => [pattern]),
    [valueType],
    typeEnv,
    adts,
    [],
  );
  if (missing.length === 0) return undefined;

  const scrutinee = prune(valueType);
  if (scrutinee.tag === "named") {
    const info = adts.get(scrutinee.id);
    if (info) {
      const coveredPatterns = patterns
        .filter((p): p is Extract<Pattern, { kind: "PCtor" }> => p.kind === "PCtor");
      const missingCtors = info.ctors.map((c) => c.name).filter((name) =>
        !coveredPatterns.some((pattern) => constructorPatternMatches(pattern.name, name))
      );
      if (missingCtors.length) return `non-exhaustive match: missing ${missingCtors.join(", ")}`;
    }
  }

  // Report first missing case with path
  const first = missing[0];
  if (first.path.length > 0) {
    const context = first.path.join(" → ");
    if (first.missing === "_") {
      return `non-exhaustive match: ${context} is missing a wildcard pattern`;
    }
    // A concrete nested witness remains useful for closed payload domains.
    // For example, path=["Some"], missing="false" means Some(false) is uncovered.
    return `non-exhaustive match: in ${context}, missing: ${first.missing}`;
  }
  return `non-exhaustive match: missing ${first.missing}`;
}

export function isVectorExhaustive(
  rows: Pattern[][],
  types: Ty[],
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
): boolean {
  return findMissingCases(rows, types, typeEnv, adts, []).length === 0;
}

function findMissingCases(
  rows: Pattern[][],
  types: Ty[],
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  path: string[],
): MissingCase[] {
  rows = rows.map((row) => row.length === 0 ? row : [withoutConstraint(row[0]), ...row.slice(1)]);
  if (types.length === 0) return rows.length > 0 ? [] : [{ path: [...path], missing: "_" }];

  const [headType, ...tailTypes] = types;
  const head = prune(headType);

  if (rows.length > 0 && rows.every((row) => isIrrefutable(row[0]))) {
    return findMissingCases(rows.map((row) => row.slice(1)), tailTypes, typeEnv, adts, path);
  }

  if (head.tag === "prim" && head.name === "Bool") {
    const trueRows = rows.filter((row) =>
      isIrrefutable(row[0]) || row[0].kind === "PBool" && row[0].value
    ).map((row) => row.slice(1));
    const falseRows = rows.filter((row) =>
      isIrrefutable(row[0]) || row[0].kind === "PBool" && !row[0].value
    ).map((row) => row.slice(1));
    const missing: MissingCase[] = [];
    if (!isVectorExhaustive(trueRows, tailTypes, typeEnv, adts)) {
      // If no more types to check, the missing case is the literal itself
      if (tailTypes.length === 0) {
        missing.push({ path: [...path], missing: "true" });
      } else {
        missing.push(...findMissingCases(trueRows, tailTypes, typeEnv, adts, path));
      }
    }
    if (!isVectorExhaustive(falseRows, tailTypes, typeEnv, adts)) {
      if (tailTypes.length === 0) {
        missing.push({ path: [...path], missing: "false" });
      } else {
        missing.push(...findMissingCases(falseRows, tailTypes, typeEnv, adts, path));
      }
    }
    return missing;
  }

  if (head.tag === "prim" && head.name === "Void") {
    const voidRows = rows.filter((row) => isIrrefutable(row[0]) || row[0].kind === "PVoid").map((
      row,
    ) => row.slice(1));
    return findMissingCases(voidRows, tailTypes, typeEnv, adts, path);
  }

  if (head.tag === "tuple") {
    const tupleRows = rows.flatMap((row) => {
      if (isIrrefutable(row[0])) return [[...wildcards(head.items.length), ...row.slice(1)]];
      return row[0].kind === "PTuple" && row[0].items.length === head.items.length
        ? [[...row[0].items, ...row.slice(1)]]
        : [];
    });
    if (tupleRows.length === 0) {
      return [{ path: [...path], missing: `(${head.items.map(() => "_").join(", ")})` }];
    }
    return findMissingCases(tupleRows, [...head.items, ...tailTypes], typeEnv, adts, path);
  }

  if (head.tag === "named") {
    const candidate = typeInfoById(typeEnv, head.id);
    const record = candidate?.recordFields ? candidate : undefined;
    if (record?.recordFields) {
      const fields = instantiateRecordFields(record, head.args);
      const recordRows = rows.flatMap((row) => {
        const pattern = row[0];
        if (isIrrefutable(pattern)) return [[...wildcards(fields.length), ...row.slice(1)]];
        if (pattern.kind !== "PRecord") return [];
        return [[
          ...fields.map((field) =>
            pattern.fields.find((item) => item.name === field.name)?.pattern ??
              { kind: "PWildcard" as const }
          ),
          ...row.slice(1),
        ]];
      });
      if (recordRows.length === 0) {
        return [{
          path: [...path],
          missing: `.{ ${fields.map((f) => `${f.name} = _`).join(", ")} }`,
        }];
      }
      return findMissingCases(
        recordRows,
        [...fields.map((field) => field.type), ...tailTypes],
        typeEnv,
        adts,
        path,
      );
    }

    const info = adts.get(head.id);
    if (!info) return findMissingCases(defaultRows(rows), tailTypes, typeEnv, adts, path);

    const missing: MissingCase[] = [];
    for (const ctor of info.ctors) {
      // Wildcard rows apply to every constructor. Keep them alongside specific
      // rows, including their remaining tuple columns, during specialization.
      const ctorRows = rows.flatMap((row) => {
        if (isIrrefutable(row[0])) return [[...wildcards(ctor.args.length), ...row.slice(1)]];
        return row[0].kind === "PCtor" && constructorPatternMatches(row[0].name, ctor.name)
          ? [[...row[0].args, ...row.slice(1)]]
          : [];
      });

      if (ctorRows.length === 0) {
        // Entire constructor is missing
        const ctorPattern = ctor.args.length > 0
          ? `${ctor.name}(${ctor.args.map(() => "_").join(", ")})`
          : ctor.name;
        missing.push({ path: [...path], missing: ctorPattern });
      } else {
        const ctorTypes = constructorArgTypes(info, ctor, head, typeEnv);
        const ctorMissing = findMissingCases(
          ctorRows,
          [...ctorTypes, ...tailTypes],
          typeEnv,
          adts,
          [
            ...path,
            ctor.name,
          ],
        );
        missing.push(...ctorMissing);
      }
    }
    return missing;
  }

  return findMissingCases(defaultRows(rows), tailTypes, typeEnv, adts, path);
}

function wildcards(count: number): Pattern[] {
  return Array.from({ length: count }, () => ({ kind: "PWildcard" }));
}

function defaultRows(rows: Pattern[][]): Pattern[][] {
  return rows.filter((row) => isIrrefutable(row[0])).map((row) => row.slice(1));
}

export function mentionsLocalType(t: Ty, allowed: Set<number>, seen = new Set<Ty>()): boolean {
  t = prune(t);
  if (seen.has(t)) return false;
  seen.add(t);
  if (t.tag === "var") {
    return (t.projectionFields ?? []).some((field) => mentionsLocalType(field.type, allowed, seen));
  }
  if (t.tag === "fn") {
    return t.params.some((p) => mentionsLocalType(p, allowed, seen)) ||
      mentionsLocalType(t.result, allowed, seen);
  }
  if (t.tag === "tuple") return t.items.some((x) => mentionsLocalType(x, allowed, seen));
  if (t.tag === "named") {
    return !allowed.has(t.id) || t.args.some((x) => mentionsLocalType(x, allowed, seen));
  }
  return false;
}

/**
 * A constructor pattern may be written qualified (`Lib.Some`) or unqualified
 * (`Some`) for the same constructor. Both denote the same value identifier, so
 * exhaustiveness compares the Definition's base identifier of the long
 * identifier against the constructor's own name.
 */
function constructorPatternMatches(patternName: string, ctorName: string): boolean {
  return patternName === ctorName || parseLongId(patternName).id === ctorName;
}

function isIrrefutable(pattern: Pattern): boolean {
  pattern = withoutConstraint(pattern);
  if (pattern.kind === "PWildcard" || pattern.kind === "PVar") return true;
  if (pattern.kind === "PTuple") return pattern.items.every(isIrrefutable);
  if (pattern.kind === "PRecord") {
    return pattern.fields.every((field) => isIrrefutable(field.pattern));
  }
  return false;
}

function withoutConstraint(pattern: Pattern): Pattern {
  return pattern.kind === "PAscribed" ? withoutConstraint(pattern.pattern) : pattern;
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
