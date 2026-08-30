import type { Expr, LongId, RecordExprSpread, TypeExpr } from "../ast.ts";
import { isQualified, longIdSpelling, pathOf } from "../ast.ts";
import { type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import {
  type Env,
  fresh,
  instantiate,
  instantiateRecordFields,
  knownTypeInfos,
  named,
  prune,
  show,
  structural,
  type Ty,
  type TypeEnv,
  type TypeInfo,
  typeInfoById,
} from "../types.ts";
import { constrainAt } from "./provenance.ts";
import { resolveLongType, resolveLongValue, type StrEnv } from "./environment.ts";
import {
  recordRecordFieldFact,
  recordRecordProjectionFact,
  recordTypeExpressionFact,
  recordTypeReferenceFact,
  type TypeFacts,
} from "./type_facts.ts";

type InferValue = (expr: Expr, expected?: Ty) => Ty;
type NamedTy = Extract<Ty, { tag: "named" }>;

/**
 * Resolve a dotted expression that is not (or not entirely) an SML long
 * identifier.
 *
 * Workman overloads `.` for both structure qualification and nominal record
 * projection, so a spelling such as `Lib.value.field` may resolve partly through
 * `StrEnv` and partly by projecting fields out of the reached value. Structure
 * qualification is tried first via `resolveLongValue`; every qualifier it does
 * not consume is a record projection. Record projection is a Workman extension,
 * not a Definition long identifier, so it peels segments off the path directly.
 */
export function inferDottedVar(
  path: LongId,
  env: Env,
  typeEnv: TypeEnv,
  strEnv?: StrEnv,
  occurrence?: {
    expression: Extract<Expr, { kind: "Var" }>;
    facts: TypeFacts;
    warnings: string[];
    diagnostics: FrontendDiagnostic[];
  },
): Ty {
  const name = longIdSpelling(path);
  const scheme = env.get(name);
  if (scheme) return instantiate(scheme);
  const structured = strEnv && resolveLongValue(strEnv, path);
  if (structured) {
    const segments = path.qualifiers.length + 1;
    const firstFieldIndex = segments - structured.remaining.length;
    return structured.remaining.reduce((type, field, index) => {
      const resolved = inferRecordField(type, field, typeEnv, occurrence);
      if (resolved.record && occurrence) {
        recordRecordProjectionFact(occurrence.facts, occurrence.expression, {
          name: field,
          partIndex: firstFieldIndex + index,
          record: resolved.record,
          type: resolved.type,
        });
      }
      return resolved.type;
    }, instantiate(structured.scheme));
  }
  // No structure prefix resolved: the final segment is a record field of the
  // value denoted by the remaining prefix.
  if (path.qualifiers.length === 0) throw new Error(`unknown name ${name}`);
  const receiver: LongId = {
    qualifiers: path.qualifiers.slice(0, -1),
    id: path.qualifiers.at(-1)!,
  };
  const field = path.id;
  try {
    const resolved = inferRecordField(
      inferDottedVar(receiver, env, typeEnv, strEnv, occurrence),
      field,
      typeEnv,
      occurrence,
    );
    if (resolved.record && occurrence) {
      recordRecordProjectionFact(occurrence.facts, occurrence.expression, {
        name: field,
        partIndex: path.qualifiers.length,
        record: resolved.record,
        type: resolved.type,
      });
    }
    return resolved.type;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("unknown name ")) {
      throw new Error(`unknown name ${name}`);
    }
    throw error;
  }
}

export function inferRecordExpr(
  expr: Extract<Expr, { kind: "Record" }>,
  typeEnv: TypeEnv,
  inferValue: InferValue,
  expected?: Ty,
  warnings?: string[],
  diagnostics?: FrontendDiagnostic[],
  facts?: TypeFacts,
  strEnv?: StrEnv,
): Ty {
  const fields = expr.fields.filter((field) => field.kind === "Field");
  const spreads = expr.fields.filter((field) => field.kind === "Spread");
  rejectDuplicateFields(fields.map((field) => field.name));
  const explicitResult = expr.target
    ? explicitRecord(expr.target, typeEnv, strEnv, facts)
    : undefined;
  const expectedResult = expectedRecord(expected, typeEnv);
  if (explicitResult && expectedResult) {
    constrainRecord(
      explicitResult,
      expectedResult,
      expr,
      "InferRecord.ExplicitTarget",
      "explicit record name matches contextual record type",
      explicitResult.name,
      "explicit record",
      "contextual record",
    );
  }
  const inferredSpreads = spreads.map((spread) => ({
    spread,
    type: inferValue(spread.value, expectedResult),
  }));
  const spreadResult = firstSpreadRecord(inferredSpreads, typeEnv);
  const result = explicitResult ?? expectedResult ?? spreadResult ?? freshRecord(
    recordCandidate(
      typeEnv,
      fields.map((field) => field.name),
      expr,
      warnings,
      diagnostics,
      spreads.length === 0 ? "exact" : "contains",
      spreads.length === 0 ? "ambiguous record type" : "ambiguous record update type",
    ),
  );
  const fieldTypes = instantiateRecordFields(recordInfo(result, typeEnv), result.args);
  const expectedNames = new Set(fieldTypes.map((field) => field.name));
  for (const { spread, type } of inferredSpreads) {
    constrainRecord(
      type,
      result,
      spread.value,
      "InferRecord.SpreadValue",
      "record spread matches literal record type",
      result.name,
      "spread value",
      "record literal",
    );
  }
  for (const field of fields) {
    if (!expectedNames.has(field.name)) {
      throw new Error(`${result.name} has no field ${field.name}`);
    }
    const expectedField = fieldTypes.find((item) => item.name === field.name)!;
    if (facts) {
      recordRecordFieldFact(
        facts,
        field,
        recordInfo(result, typeEnv),
        expectedField.type,
      );
    }
    constrainRecord(
      inferValue(field.value),
      expectedField.type,
      field.value,
      "InferRecord.FieldValue",
      "record field matches declared field type",
      `${result.name}.${field.name}`,
      "field value",
      "declared field",
    );
  }
  if (spreads.length === 0 && fieldTypes.length !== fields.length) {
    throw new Error(`missing record field for ${result.name}`);
  }
  return result;
}

function explicitRecord(
  target: Extract<TypeExpr, { kind: "TName" }>,
  typeEnv: TypeEnv,
  strEnv?: StrEnv,
  facts?: TypeFacts,
): NamedTy {
  const path = pathOf(target);
  const qualified = isQualified(path) && strEnv ? resolveLongType(strEnv, path) : undefined;
  const info = qualified?.info ?? typeEnv.get(target.name);
  if (!info) throw new Error(`unknown record type ${target.name}`);
  if (!info.recordFields) throw new Error(`${target.name} is not a record type`);
  if (facts) {
    recordTypeReferenceFact(
      facts,
      target,
      info,
      qualified
        ? Object.freeze({
          name: path.qualifiers[0],
          environment: qualified.root,
        })
        : undefined,
    );
  }
  const result = freshRecord(info);
  if (facts) recordTypeExpressionFact(facts, target, result);
  return result;
}

function firstSpreadRecord(
  spreads: { spread: RecordExprSpread; type: Ty }[],
  typeEnv: TypeEnv,
): NamedTy | undefined {
  if (spreads.length === 0) return undefined;
  const target = prune(spreads[0].type);
  if (target.tag === "var" || target.tag === "struct") return undefined;
  if (target.tag !== "named") throw new Error("record spread requires a record type");
  recordInfo(target, typeEnv);
  return target;
}

function inferRecordField(
  base: Ty,
  field: string,
  typeEnv: TypeEnv,
  occurrence?: {
    expression: Extract<Expr, { kind: "Var" }>;
    facts: TypeFacts;
    warnings: string[];
    diagnostics: FrontendDiagnostic[];
  },
): { type: Ty; record?: TypeInfo } {
  const target = prune(base);
  if (target.tag === "named") {
    const info = recordInfo(target, typeEnv);
    const fields = instantiateRecordFields(info, target.args);
    const found = fields.find((item) => item.name === field);
    if (!found) throw new Error(`${target.name} has no field ${field}`);
    return { type: found.type, record: info };
  }
  if (target.tag === "var") {
    const nominal = selectedFieldRecord(typeEnv, field, occurrence);
    if (nominal) {
      if (nominal.nominalReceiver) {
        constrainRecord(
          target,
          nominal.record,
          undefined,
          "InferRecord.ProjectNominal",
          "receiver matches record containing projected field",
          field,
          "receiver",
          "record",
        );
      } else {
        constrainRecord(
          target,
          structural([{ name: field, type: nominal.type }]),
          undefined,
          "InferRecord.ProjectAmbiguous",
          "receiver retains a structural field requirement until an annotation selects a record",
          field,
          "receiver",
          "structural field",
        );
      }
      return {
        type: nominal.type,
        record: nominal.info,
      };
    }
    const result = fresh();
    constrainRecord(
      target,
      structural([{ name: field, type: result }]),
      undefined,
      "InferRecord.ProjectStructural",
      "receiver has projected structural field",
      field,
      "receiver",
      "structural field",
    );
    return { type: result };
  }
  if (target.tag === "struct") {
    const found = target.fields.find((item) => item.name === field);
    if (found) return { type: found.type };
    const result = fresh();
    target.fields.push({ name: field, type: result });
    return { type: result };
  }
  throw new Error(`type ${show(base)} has no field ${field}`);
}

function constrainRecord(
  left: Ty,
  right: Ty,
  expr: Expr | undefined,
  rule: string,
  role: string,
  subject: string,
  leftRole: string,
  rightRole: string,
) {
  constrainAt(left, right, expr, undefined, [], undefined, {
    message: subject,
    node: expr?.node,
    span: expr?.node?.span,
  }, {
    premise: {
      rule,
      role,
      subject,
      leftRole,
      rightRole,
    },
  });
}

function selectedFieldRecord(
  typeEnv: TypeEnv,
  field: string,
  occurrence?: {
    expression: Extract<Expr, { kind: "Var" }>;
    facts: TypeFacts;
    warnings: string[];
    diagnostics: FrontendDiagnostic[];
  },
): { record: NamedTy; type: Ty; info: TypeInfo; nominalReceiver: boolean } | undefined {
  const candidates = findRecordTypes(typeEnv, [field], "contains");
  if (candidates.length === 0) return undefined;
  const info = candidates[0];
  const record = freshRecord(info);
  const declaredType =
    instantiateRecordFields(info, record.args).find((item) => item.name === field)!.type;
  if (candidates.length === 1 && prune(declaredType).tag !== "fn") {
    return { record, type: declaredType, info, nominalReceiver: true };
  }
  if (candidates.length > 1 && occurrence) {
    const candidateNames = candidates.map((candidate) => candidate.name).join(", ");
    const message = `ambiguous record projection ${field}; using first record type ${info.name}. ` +
      `Candidates: ${candidateNames}. ` +
      `Hint: annotate the receiver, binding, or parameter with the intended record type.`;
    occurrence.warnings.push(message);
    occurrence.diagnostics.push(
      warningDiagnostic(
        message,
        occurrence.expression.node,
        "record.ambiguous-projection",
      ),
    );
  }
  // Selecting an identity for tooling does not nominally constrain the receiver. It remains a
  // structural requirement and can still be accepted by any compatible record value.
  const type = sharedNonFunctionFieldType(typeEnv, field) ?? fresh();
  return { record, type, info, nominalReceiver: false };
}

function sharedNonFunctionFieldType(typeEnv: TypeEnv, field: string): Ty | undefined {
  const candidates = findRecordTypes(typeEnv, [field], "contains");
  if (candidates.length < 2) return undefined;
  const types = candidates.map((info) => {
    const record = freshRecord(info);
    return instantiateRecordFields(info, record.args).find((item) => item.name === field)!.type;
  });
  if (types.some((type) => prune(type).tag === "fn")) return undefined;
  const shape = show(types[0]);
  return types.every((type) => show(type) === shape) ? types[0] : undefined;
}

function expectedRecord(expected: Ty | undefined, typeEnv: TypeEnv): NamedTy | undefined {
  if (!expected) return undefined;
  const target = prune(expected);
  if (target.tag !== "named") throw new Error("record literal requires a record type");
  recordInfo(target, typeEnv);
  return target;
}

function freshRecord(info: TypeInfo): NamedTy {
  return named(info, Array.from({ length: info.arity }, () => fresh())) as NamedTy;
}

function recordInfo(type: NamedTy, typeEnv: TypeEnv): TypeInfo {
  const info = typeInfoById(typeEnv, type.id);
  if (!info?.recordFields) throw new Error(`${type.name} is not a record type`);
  return info;
}

function recordCandidate(
  typeEnv: TypeEnv,
  names: string[],
  expr: Extract<Expr, { kind: "Record" }>,
  warnings?: string[],
  diagnostics?: FrontendDiagnostic[],
  mode: "exact" | "contains" = "exact",
  ambiguous = "ambiguous record type",
): TypeInfo {
  const candidates = findRecordTypes(typeEnv, names, mode);
  if (candidates.length === 0) throw new Error("no matching record type");
  if (candidates.length > 1) {
    if (!warnings || !diagnostics) throw new Error(ambiguous);
    const selected = candidates[0];
    const candidateNames = candidates.map((candidate) => candidate.name).join(", ");
    const message = `${ambiguous}; using first matching record type called ${selected.name}. ` +
      `Candidates: ${candidateNames}. ` +
      `Hint: use an annotation like \`x: ${selected.name} = .{ ... }\` or its ordered ` +
      `constructor like \`x = ${selected.name}(...)\`.`;
    warnings.push(message);
    diagnostics.push(warningDiagnostic(message, expr.node, "record.ambiguous-literal"));
  }
  return candidates[0];
}

function findRecordTypes(
  typeEnv: TypeEnv,
  names: string[],
  mode: "exact" | "contains",
): TypeInfo[] {
  const wanted = [...names].sort();
  return knownTypeInfos(typeEnv).filter((info) => {
    if (!info.recordFields) return false;
    const fields = info.recordFields.map((field) => field.name);
    if (mode === "contains") return wanted.every((name) => fields.includes(name));
    return fields.length === wanted.length &&
      [...fields].sort().every((name, i) => name === wanted[i]);
  });
}

function rejectDuplicateFields(names: string[]) {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate record field ${name}`);
    seen.add(name);
  }
}
