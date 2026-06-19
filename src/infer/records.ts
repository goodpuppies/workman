import type { Expr } from "../ast.ts";
import { type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import {
  type Env,
  fresh,
  instantiate,
  instantiateRecordFields,
  named,
  prune,
  show,
  structural,
  type Ty,
  type TypeEnv,
  type TypeInfo,
} from "../types.ts";
import { constrainAt } from "./provenance.ts";

type InferValue = (expr: Expr) => Ty;
type NamedTy = Extract<Ty, { tag: "named" }>;

export function inferDottedVar(name: string, env: Env, typeEnv: TypeEnv): Ty {
  const scheme = env.get(name);
  if (scheme) return instantiate(scheme);
  const dot = name.lastIndexOf(".");
  if (dot < 0) throw new Error(`unknown name ${name}`);
  const baseName = name.slice(0, dot);
  const field = name.slice(dot + 1);
  try {
    return inferRecordField(inferDottedVar(baseName, env, typeEnv), field, typeEnv);
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
): Ty {
  rejectDuplicateFields(expr.fields.map((field) => field.name));
  const result = expectedRecord(expected, typeEnv) ??
    freshRecord(recordCandidate(typeEnv, expr, warnings, diagnostics));
  const fieldTypes = instantiateRecordFields(recordInfo(result, typeEnv), result.args);
  const expectedNames = new Set(fieldTypes.map((field) => field.name));
  for (const field of expr.fields) {
    if (!expectedNames.has(field.name)) {
      throw new Error(`${result.name} has no field ${field.name}`);
    }
    const expectedField = fieldTypes.find((item) => item.name === field.name)!;
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
  if (fieldTypes.length !== expr.fields.length) {
    throw new Error(`missing record field for ${result.name}`);
  }
  return result;
}

function inferRecordField(base: Ty, field: string, typeEnv: TypeEnv): Ty {
  const target = prune(base);
  if (target.tag === "named") {
    const fields = instantiateRecordFields(recordInfo(target, typeEnv), target.args);
    const found = fields.find((item) => item.name === field);
    if (!found) throw new Error(`${target.name} has no field ${field}`);
    return found.type;
  }
  if (target.tag === "var") {
    const nominal = uniqueNonFunctionFieldRecord(typeEnv, field);
    if (nominal) {
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
      return nominal.type;
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
    return result;
  }
  if (target.tag === "struct") {
    const found = target.fields.find((item) => item.name === field);
    if (found) return found.type;
    const result = fresh();
    target.fields.push({ name: field, type: result });
    return result;
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

function uniqueNonFunctionFieldRecord(
  typeEnv: TypeEnv,
  field: string,
): { record: NamedTy; type: Ty } | undefined {
  const candidates = findRecordTypes(typeEnv, [field], "contains");
  if (candidates.length !== 1) return undefined;
  const info = candidates[0];
  const record = freshRecord(info);
  const type = instantiateRecordFields(info, record.args).find((item) => item.name === field)!.type;
  return prune(type).tag === "fn" ? undefined : { record, type };
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
  const info = [...typeEnv.values()].find((candidate) => candidate.id === type.id);
  if (!info?.recordFields) throw new Error(`${type.name} is not a record type`);
  return info;
}

function recordCandidate(
  typeEnv: TypeEnv,
  expr: Extract<Expr, { kind: "Record" }>,
  warnings?: string[],
  diagnostics?: FrontendDiagnostic[],
  ambiguous = "ambiguous record type",
): TypeInfo {
  const names = expr.fields.map((field) => field.name);
  const candidates = findRecordTypes(typeEnv, names, "exact");
  if (candidates.length === 0) throw new Error("no matching record type");
  if (candidates.length > 1) {
    if (!warnings || !diagnostics) throw new Error(ambiguous);
    const selected = candidates[0];
    const candidateNames = candidates.map((candidate) => candidate.name).join(", ");
    const message = `${ambiguous}; using first matching record type called ${selected.name}. ` +
      `Candidates: ${candidateNames}. ` +
      `Hint: use an annotation like \`x: ${selected.name} = .{ ... }\` or explicit form ` +
      `\`x = ${selected.name}{ ... }\`.`;
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
  return [...typeEnv.values()].filter((info) => {
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
