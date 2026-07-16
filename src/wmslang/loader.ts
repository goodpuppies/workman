import {
  GPU_ELABORATION_SCHEMA_VERSION,
  type GpuCompilationOutput,
  type GpuElaborationInput,
} from "./dto.ts";

const gpuTypeKinds = new Set([
  "unknown",
  "number",
  "bool",
  "void",
  "string",
  "vector",
  "tuple",
  "function",
  "named",
]);
const numericRepresentations = new Set(["", "abstract", "i32", "f32"]);
const gpuExpressionKinds = new Set([
  "number",
  "bool",
  "void",
  "string",
  "var",
  "tuple",
  "record",
  "jsonobject",
  "jsonarray",
  "ffiget",
  "fficall",
  "ffibindingcall",
  "lambda",
  "call",
  "if",
  "match",
  "panic",
  "block",
  "binary",
  "unary",
  "pipe",
  "let",
]);

export type WmslangCompiler = {
  compileGpu(input: GpuElaborationInput): GpuCompilationOutput;
};

export async function loadWmslangCompiler(moduleUrl: URL | string): Promise<WmslangCompiler> {
  const specifier = moduleUrl instanceof URL ? moduleUrl.href : moduleUrl;
  const imported: Record<string, unknown> = await import(specifier);
  if (typeof imported.compileGpu !== "function") {
    throw new Error("wmslang module does not export compileGpu");
  }
  const compileGpu = imported.compileGpu as (input: GpuElaborationInput) => unknown;
  return {
    compileGpu(input: GpuElaborationInput): GpuCompilationOutput {
      validateGpuElaborationInput(input);
      return validateGpuCompilationOutput(compileGpu(input));
    },
  };
}

export function validateGpuElaborationInput(value: unknown): asserts value is GpuElaborationInput {
  const input = record(value, "GPU elaboration input");
  schemaVersion(input.schemaVersion, "GPU elaboration input");
  array(input.roots, "GPU roots").forEach(validateRoot);
  array(input.functions, "GPU functions").forEach(validateInputFunction);
  array(input.bindings, "GPU bindings").forEach(validateBinding);
  array(input.types, "GPU types").forEach(validateType);
  array(input.expressions, "GPU expressions").forEach(validateExpression);
  array(input.spans, "GPU spans").forEach(validateSpan);
}

export function validateGpuCompilationOutput(value: unknown): GpuCompilationOutput {
  const output = record(value, "GPU compilation output");
  schemaVersion(output.schemaVersion, "GPU compilation output");
  array(output.functions, "typed GPU functions").forEach(validateTypedFunction);
  array(output.captures, "GPU captures").forEach(validateCapture);
  array(output.specializations, "GPU specializations").forEach(validateSpecialization);
  array(output.rootSpecializations, "GPU root specializations").forEach(
    validateRootSpecialization,
  );
  array(output.calls, "GPU specialized calls").forEach(validateSpecializedCall);
  array(output.irFunctions, "GPU IR functions").forEach(validateIrFunction);
  array(output.irExpressions, "GPU IR expressions").forEach(validateIrExpression);
  array(output.types, "typed GPU types").forEach(validateType);
  array(output.expressions, "typed GPU expressions").forEach(validateExpression);
  array(output.diagnostics, "GPU diagnostics").forEach(validateDiagnostic);
  validateOutputReferences(output);
  return output as GpuCompilationOutput;
}

function validateOutputReferences(output: Record<string, unknown>): void {
  const functions = array(output.functions, "typed GPU functions").map((item) =>
    record(item, "typed GPU function")
  );
  const types = array(output.types, "typed GPU types").map((item) =>
    record(item, "typed GPU type")
  );
  const specializations = array(output.specializations, "GPU specializations").map((item) =>
    record(item, "GPU specialization")
  );
  const irFunctions = array(output.irFunctions, "GPU IR functions").map((item) =>
    record(item, "GPU IR function")
  );
  const irExpressions = array(output.irExpressions, "GPU IR expressions").map((item) =>
    record(item, "GPU IR expression")
  );
  const functionIds = idSet(functions, "id");
  const typeIds = uniqueIdSet(types, "id", "GPU type");
  const specializationIds = uniqueIdSet(specializations, "id", "GPU specialization");
  const irExpressionIds = uniqueIdSet(irExpressions, "id", "GPU IR expression");
  const sourceExpressionIds = idSet(
    array(output.expressions, "typed GPU expressions").map((item) =>
      record(item, "typed GPU expression")
    ),
    "id",
  );
  const irExpressionsById = new Map(
    irExpressions.map((expression) => [expression.id as number, expression]),
  );

  for (const specialization of specializations) {
    requireReference(functionIds, specialization.functionId, "GPU specialization functionId");
    requireReference(typeIds, specialization.resultTypeId, "GPU specialization resultTypeId");
    numberArray(specialization.paramTypeIds, "GPU specialization parameter types");
    for (const typeId of specialization.paramTypeIds as number[]) {
      requireReference(typeIds, typeId, "GPU specialization parameter type");
    }
    for (const fact of array(specialization.typeFacts, "GPU specialization type facts")) {
      requireReference(
        typeIds,
        record(fact, "GPU representation fact").typeId,
        "GPU representation fact typeId",
      );
    }
  }
  for (const root of array(output.rootSpecializations, "GPU root specializations")) {
    requireReference(
      specializationIds,
      record(root, "GPU root specialization").specializationId,
      "GPU root specialization specializationId",
    );
  }
  for (const callValue of array(output.calls, "GPU specialized calls")) {
    const call = record(callValue, "GPU specialized call");
    requireReference(
      specializationIds,
      call.callerSpecializationId,
      "GPU specialized call callerSpecializationId",
    );
    requireReference(
      specializationIds,
      call.targetSpecializationId,
      "GPU specialized call targetSpecializationId",
    );
  }
  const irFunctionSpecializations = new Set<number>();
  for (const fn of irFunctions) {
    requireReference(
      specializationIds,
      fn.specializationId,
      "GPU IR function specializationId",
    );
    if (irFunctionSpecializations.has(fn.specializationId as number)) {
      throw new Error(`duplicate GPU IR function specialization ${String(fn.specializationId)}`);
    }
    irFunctionSpecializations.add(fn.specializationId as number);
    requireReference(irExpressionIds, fn.bodyExprId, "GPU IR function bodyExprId");
    if (
      irExpressionsById.get(fn.bodyExprId as number)?.specializationId !== fn.specializationId
    ) {
      throw new Error("GPU IR function body must belong to its specialization");
    }
  }
  if (irFunctionSpecializations.size !== specializationIds.size) {
    throw new Error("every GPU specialization must have exactly one IR function");
  }
  for (const expression of irExpressions) {
    requireReference(
      specializationIds,
      expression.specializationId,
      "GPU IR expression specializationId",
    );
    requireReference(typeIds, expression.typeId, "GPU IR expression typeId");
    requireReference(
      sourceExpressionIds,
      expression.sourceExprId,
      "GPU IR expression sourceExprId",
    );
    for (const childId of expression.children as number[]) {
      requireReference(irExpressionIds, childId, "GPU IR expression child");
      if (
        irExpressionsById.get(childId)?.specializationId !== expression.specializationId
      ) {
        throw new Error("GPU IR expression child must belong to the same specialization");
      }
    }
    if ((expression.callTargetSpecializationId as number) >= 0) {
      requireReference(
        specializationIds,
        expression.callTargetSpecializationId,
        "GPU IR expression call target",
      );
      if (expression.kind !== "call") {
        throw new Error("only GPU IR call expressions may have a call target");
      }
    }
  }
  const specializedCallKeys = new Set(
    array(output.calls, "GPU specialized calls").map((callValue) => {
      const call = record(callValue, "GPU specialized call");
      return `${call.callerSpecializationId}:${call.expressionId}:${call.targetSpecializationId}`;
    }),
  );
  const irCallKeys = new Set<string>();
  for (const expression of irExpressions) {
    if ((expression.callTargetSpecializationId as number) < 0) continue;
    const key =
      `${expression.specializationId}:${expression.sourceExprId}:${expression.callTargetSpecializationId}`;
    irCallKeys.add(key);
    if (!specializedCallKeys.has(key)) {
      throw new Error("GPU IR call target is missing its specialized call edge");
    }
  }
  for (const key of specializedCallKeys) {
    if (!irCallKeys.has(key)) throw new Error("GPU specialized call edge is missing its IR call");
  }
}

function uniqueIdSet(
  records: Record<string, unknown>[],
  field: string,
  label: string,
): Set<number> {
  const ids = new Set<number>();
  for (const item of records) {
    const id = item[field] as number;
    if (ids.has(id)) throw new Error(`duplicate ${label} id ${id}`);
    ids.add(id);
  }
  return ids;
}

function idSet(records: Record<string, unknown>[], field: string): Set<number> {
  return new Set(records.map((item) => item[field] as number));
}

function requireReference(ids: Set<number>, value: unknown, label: string): void {
  if (!ids.has(value as number)) throw new Error(`${label} references missing id ${String(value)}`);
}

function validateRoot(value: unknown): void {
  const item = record(value, "GPU root");
  numbers(item, ["regionId", "functionId", "bindingId"], "GPU root");
}

function validateFunctionShape(value: unknown): Record<string, unknown> {
  const item = record(value, "GPU function");
  numbers(
    item,
    ["id", "regionId", "bindingId", "resultTypeId", "bodyExprId", "spanId"],
    "GPU function",
  );
  string(item.name, "GPU function name");
  array(item.params, "GPU parameters").forEach(validateParam);
  return item;
}

function validateInputFunction(value: unknown): void {
  const item = validateFunctionShape(value);
  if (item.capability !== "gpu-only" && item.capability !== "candidate") {
    throw new Error("GPU input function has an invalid capability");
  }
}

function validateTypedFunction(value: unknown): void {
  const item = validateFunctionShape(value);
  if (
    item.capability !== "gpu-only" && item.capability !== "gpu-eligible" &&
    item.capability !== "cpu-only"
  ) {
    throw new Error("typed GPU function has an invalid capability");
  }
}

function validateParam(value: unknown): void {
  const item = record(value, "GPU parameter");
  numbers(item, ["bindingId", "typeId"], "GPU parameter");
  string(item.name, "GPU parameter name");
}

function validateBinding(value: unknown): void {
  const item = record(value, "GPU binding");
  numbers(item, ["id", "typeId", "definitionExprId", "spanId"], "GPU binding");
  string(item.name, "GPU binding name");
  if (!new Set(["parameter", "local", "module", "imported"]).has(String(item.scope))) {
    throw new Error("GPU binding has an invalid scope");
  }
}

function validateCapture(value: unknown): void {
  const item = record(value, "GPU capture");
  numbers(item, ["regionId", "bindingId", "typeId", "spanId"], "GPU capture");
  if (
    !new Set(["constant", "uniform", "resource", "function", "illegal"]).has(
      String(item.category),
    )
  ) {
    throw new Error("GPU capture has an invalid category");
  }
}

function validateSpecialization(value: unknown): void {
  const item = record(value, "GPU specialization");
  numbers(item, ["id", "functionId", "bindingId", "resultTypeId"], "GPU specialization");
  string(item.name, "GPU specialization name");
  numberArray(item.paramTypeIds, "GPU specialization parameter types");
  representationArray(
    item.paramRepresentations,
    "GPU specialization parameter representations",
  );
  representation(item.resultRepresentation, "GPU specialization result representation", true);
  array(item.typeFacts, "GPU specialization type facts").forEach(validateRepresentationFact);
}

function validateRepresentationFact(value: unknown): void {
  const item = record(value, "GPU representation fact");
  number(item.typeId, "GPU representation fact typeId");
  representation(item.representation, "GPU representation fact representation", false);
}

function validateRootSpecialization(value: unknown): void {
  const item = record(value, "GPU root specialization");
  numbers(item, ["regionId", "specializationId"], "GPU root specialization");
}

function validateSpecializedCall(value: unknown): void {
  const item = record(value, "GPU specialized call");
  numbers(
    item,
    ["callerSpecializationId", "expressionId", "targetSpecializationId"],
    "GPU specialized call",
  );
}

function validateIrFunction(value: unknown): void {
  const item = record(value, "GPU IR function");
  numbers(
    item,
    [
      "specializationId",
      "functionId",
      "bindingId",
      "resultTypeId",
      "bodyExprId",
      "spanId",
    ],
    "GPU IR function",
  );
  string(item.name, "GPU IR function name");
  array(item.params, "GPU IR function parameters").forEach(validateIrParam);
  representation(item.resultRepresentation, "GPU IR function result representation", true);
}

function validateIrParam(value: unknown): void {
  const item = record(value, "GPU IR parameter");
  numbers(item, ["bindingId", "typeId"], "GPU IR parameter");
  string(item.name, "GPU IR parameter name");
  representation(item.representation, "GPU IR parameter representation", true);
}

function validateIrExpression(value: unknown): void {
  const item = record(value, "GPU IR expression");
  numbers(
    item,
    [
      "id",
      "specializationId",
      "sourceExprId",
      "typeId",
      "spanId",
      "bindingId",
      "numberValue",
      "callTargetSpecializationId",
    ],
    "GPU IR expression",
  );
  string(item.kind, "GPU IR expression kind");
  if (!gpuExpressionKinds.has(String(item.kind))) {
    throw new Error("GPU IR expression has an invalid kind");
  }
  representation(item.representation, "GPU IR expression representation", true);
  string(item.name, "GPU IR expression name");
  string(item.operator, "GPU IR expression operator");
  boolean(item.boolValue, "GPU IR expression boolean value");
  numberArray(item.children, "GPU IR expression children");
  if (
    item.capability !== "gpu" && item.capability !== "host-ffi" &&
    item.capability !== "unsupported"
  ) {
    throw new Error("GPU IR expression has an invalid capability");
  }
  if (
    !new Set(["none", "literal", "local", "capture", "function", "unresolved"]).has(
      String(item.valueKind),
    )
  ) {
    throw new Error("GPU IR expression has an invalid value kind");
  }
}

function validateType(value: unknown): void {
  const item = record(value, "GPU type");
  numbers(item, ["id", "width", "result"], "GPU type");
  string(item.kind, "GPU type kind");
  if (!gpuTypeKinds.has(String(item.kind))) throw new Error("GPU type has an invalid kind");
  string(item.name, "GPU type name");
  string(item.representation, "GPU numeric representation");
  if (!numericRepresentations.has(String(item.representation))) {
    throw new Error("GPU type has an invalid numeric representation");
  }
  numberArray(item.items, "GPU type items");
  numberArray(item.params, "GPU type parameters");
}

function validateExpression(value: unknown): void {
  const item = record(value, "GPU expression");
  numbers(
    item,
    ["id", "typeId", "spanId", "bindingId", "numberValue"],
    "GPU expression",
  );
  string(item.kind, "GPU expression kind");
  if (!gpuExpressionKinds.has(String(item.kind))) {
    throw new Error("GPU expression has an invalid kind");
  }
  string(item.name, "GPU expression name");
  string(item.operator, "GPU expression operator");
  boolean(item.boolValue, "GPU expression boolean value");
  numberArray(item.children, "GPU expression children");
  if (
    item.capability !== "gpu" && item.capability !== "host-ffi" && item.capability !== "unsupported"
  ) {
    throw new Error("GPU expression has an invalid capability");
  }
}

function validateSpan(value: unknown): void {
  const item = record(value, "GPU span");
  numbers(item, ["id", "line", "col", "start", "end"], "GPU span");
  string(item.path, "GPU span path");
}

function validateDiagnostic(value: unknown): void {
  const item = record(value, "GPU diagnostic");
  string(item.code, "GPU diagnostic code");
  string(item.message, "GPU diagnostic message");
  number(item.spanId, "GPU diagnostic span");
}

function schemaVersion(value: unknown, label: string): void {
  if (value !== GPU_ELABORATION_SCHEMA_VERSION) {
    throw new Error(`unsupported ${label} schema version ${String(value)}`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function numbers(value: Record<string, unknown>, fields: string[], label: string): void {
  for (const field of fields) number(value[field], `${label} ${field}`);
}

function numberArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || !value.every(isNumber)) throw new Error(`${label} must be numeric`);
}

function representationArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  value.forEach((item) => representation(item, label, true));
}

function representation(value: unknown, label: string, allowEmpty: boolean): void {
  if (value !== "i32" && value !== "f32" && !(allowEmpty && value === "")) {
    throw new Error(`${label} has an invalid representation`);
  }
}

function number(value: unknown, label: string): void {
  if (!isNumber(value)) throw new Error(`${label} must be a finite number`);
}

function string(value: unknown, label: string): void {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
}

function boolean(value: unknown, label: string): void {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
