import { GPU_SEMANTIC_IDS } from "../compiler_semantics.ts";
import { GPU_OPERATOR_IDS } from "../gpu_operators.ts";
import {
  GPU_SLICE_SCHEMA_VERSION,
  type GpuSliceCompilationOutput,
  type GpuSliceElaborationInput,
} from "./v2_dto.ts";

const typeKinds = new Set(["f32", "bool", "void", "tuple", "function", "adt", "color"]);
const patternKinds = new Set(["wildcard", "binding", "tuple", "constructor"]);
const patternContexts = new Set(["parameter", "let", "match"]);
const expressionKinds = new Set([
  "number",
  "bool",
  "void",
  "var",
  "tuple",
  "call",
  "constructor",
  "color",
  "if",
  "match",
  "block",
  "binary",
  "unary",
]);
const irExpressionKinds = new Set([
  "number",
  "bool",
  "void",
  "local",
  "tuple",
  "call",
  "constructor",
  "color",
  "if",
  "match",
  "let",
  "sequence",
  "binary",
  "unary",
  "tail-call",
]);
const operatorIds = new Set(Object.values(GPU_OPERATOR_IDS));
const loweredLocalKinds = new Set([
  "parameter",
  "loop-parameter",
  "binding",
  "temporary",
  "join",
  "tail-next",
]);
const loweredAtomKinds = new Set(["local", "number", "bool", "void"]);
const loweredOperationKinds = new Set([
  "copy",
  "tuple",
  "project",
  "call",
  "construct",
  "color",
  "binary",
  "unary",
  "payload",
]);
const loweredStatementKinds = new Set([
  "let",
  "assign",
  "if",
  "switch",
  "loop",
  "continue",
  "return",
]);
const loweredStatementReasons = new Set([
  "",
  "binding",
  "temporary",
  "join",
  "loop-initial",
  "tail-next",
]);

export type WmslangSliceCompiler = {
  compileGpuSlice(input: GpuSliceElaborationInput): GpuSliceCompilationOutput;
};

export async function loadWmslangSliceCompiler(
  moduleUrl: URL | string,
): Promise<WmslangSliceCompiler> {
  const specifier = moduleUrl instanceof URL ? moduleUrl.href : moduleUrl;
  const imported: Record<string, unknown> = await import(specifier);
  if (typeof imported.compileGpuSlice !== "function") {
    throw new Error("wmslang module does not export compileGpuSlice");
  }
  const compileGpuSlice = imported.compileGpuSlice as (input: GpuSliceElaborationInput) => unknown;
  return {
    compileGpuSlice(input) {
      validateGpuSliceElaborationInput(input);
      return validateGpuSliceCompilationOutput(compileGpuSlice(input));
    },
  };
}

export function validateGpuSliceCompilationOutput(value: unknown): GpuSliceCompilationOutput {
  const output = record(value, "GPU slice output");
  if (output.schemaVersion !== GPU_SLICE_SCHEMA_VERSION) {
    throw new Error(`unsupported GPU slice output schema version ${String(output.schemaVersion)}`);
  }
  validateGpuSliceElaborationInput(output.program);
  const program = output.program as GpuSliceElaborationInput;
  validateGpuSliceLayouts(output, program);
  validateGpuSliceIr(output, program);
  validateGpuSliceLowering(output, program);
  string(output.slangSource, "GPU slice generated Slang source");
  const diagnostics = records(output.diagnostics, "GPU slice diagnostics");
  const spanIds = new Set(program.spans.map((span) => span.id));
  for (const diagnostic of diagnostics) {
    string(diagnostic.code, "GPU slice diagnostic code");
    string(diagnostic.message, "GPU slice diagnostic message");
    spanReference(spanIds, diagnostic.spanId, "GPU slice diagnostic spanId");
  }
  if (diagnostics.length === 0 && (output.slangSource as string).length === 0) {
    throw new Error("successful GPU slice output has no generated Slang source");
  }
  if (diagnostics.length !== 0 && output.slangSource !== "") {
    throw new Error("failed GPU slice output must not contain generated Slang source");
  }
  return output as GpuSliceCompilationOutput;
}

function validateGpuSliceLayouts(
  output: Record<string, unknown>,
  program: GpuSliceElaborationInput,
): void {
  const layouts = records(output.adtLayouts, "GPU slice ADT layouts");
  const fields = records(output.adtFields, "GPU slice ADT fields");
  const layoutIds = ids(layouts, "id", "GPU slice ADT layout");
  const fieldIds = ids(fields, "id", "GPU slice ADT field");
  const typeIds = new Set(program.types.map((type) => type.id));
  const constructorIds = new Set(program.constructors.map((constructor) => constructor.id));
  const spanIds = new Set(program.spans.map((span) => span.id));
  const fieldsById = new Map(fields.map((field) => [field.id as number, field]));

  if (layouts.length !== program.adts.length) {
    throw new Error("GPU slice must have one private layout for every selected ADT");
  }
  for (const layout of layouts) {
    integers(layout, ["id", "typeId", "typeNameId", "spanId"], "GPU slice ADT layout");
    reference(typeIds, layout.typeId, "GPU slice ADT layout typeId");
    spanReference(spanIds, layout.spanId, "GPU slice ADT layout spanId");
    integerArray(layout.fieldIds, "GPU slice ADT layout fieldIds");
    const sourceAdt = program.adts.find((adt) => adt.typeNameId === layout.typeNameId);
    const sourceType = program.types.find((type) => type.id === layout.typeId);
    if (
      !sourceAdt || !sourceType || sourceType.kind !== "adt" ||
      sourceType.typeNameId !== sourceAdt.typeNameId || sourceAdt.spanId !== layout.spanId
    ) throw new Error("GPU slice ADT layout disagrees with its source ADT");
    const expectedConstructors = sourceAdt.constructorIds.filter((constructorId) =>
      program.constructors.find((constructor) => constructor.id === constructorId)!.payloadTypeId >=
        0
    );
    const actualConstructors = (layout.fieldIds as number[]).map((fieldId) => {
      reference(fieldIds, fieldId, "GPU slice ADT layout fieldId");
      return fieldsById.get(fieldId)!.constructorId as number;
    });
    if (JSON.stringify(actualConstructors) !== JSON.stringify(expectedConstructors)) {
      throw new Error("GPU slice ADT fields do not follow constructor declaration order");
    }
  }
  for (const field of fields) {
    integers(
      field,
      ["id", "layoutId", "constructorId", "tag", "typeId", "spanId"],
      "GPU slice ADT field",
    );
    reference(layoutIds, field.layoutId, "GPU slice ADT field layoutId");
    reference(constructorIds, field.constructorId, "GPU slice ADT field constructorId");
    reference(typeIds, field.typeId, "GPU slice ADT field typeId");
    spanReference(spanIds, field.spanId, "GPU slice ADT field spanId");
    const source = program.constructors.find((constructor) =>
      constructor.id === field.constructorId
    );
    if (
      !source || source.payloadTypeId < 0 || source.payloadTypeId !== field.typeId ||
      source.tag !== field.tag || source.spanId !== field.spanId
    ) throw new Error("GPU slice ADT field disagrees with its source constructor");
    const layout = layouts.find((candidate) => candidate.id === field.layoutId);
    if (!layout || !(layout.fieldIds as number[]).includes(field.id as number)) {
      throw new Error("GPU slice ADT field is not owned by its declared layout");
    }
  }
}

function validateGpuSliceIr(
  output: Record<string, unknown>,
  program: GpuSliceElaborationInput,
): void {
  const functions = records(output.irFunctions, "GPU slice IR functions");
  const expressions = records(output.irExpressions, "GPU slice IR expressions");
  const arms = records(output.irMatchArms, "GPU slice IR match arms");
  const functionIds = new Set(program.functions.map((fn) => fn.id));
  const sourceExpressionIds = new Set(program.expressions.map((expression) => expression.id));
  const sourceArmIds = new Set(program.matchArms.map((arm) => arm.id));
  const patternIds = new Set(program.patterns.map((pattern) => pattern.id));
  const paramIds = new Set(program.params.map((param) => param.id));
  const typeIds = new Set(program.types.map((type) => type.id));
  const constructorIds = new Set(program.constructors.map((constructor) => constructor.id));
  const localBindingIds = new Set(
    program.patterns.filter((pattern) => pattern.kind === "binding").map((pattern) =>
      pattern.bindingId
    ),
  );
  const spanIds = new Set(program.spans.map((span) => span.id));
  const expressionIds = ids(expressions, "id", "GPU slice IR expression");
  const armIds = ids(arms, "id", "GPU slice IR match arm");
  const seenFunctions = new Set<number>();

  for (const fn of functions) {
    integers(
      fn,
      [
        "functionId",
        "bindingId",
        "resultTypeId",
        "bodyExprId",
        "recursionGroupId",
        "spanId",
      ],
      "GPU slice IR function",
    );
    reference(functionIds, fn.functionId, "GPU slice IR functionId");
    if (seenFunctions.has(fn.functionId as number)) {
      throw new Error(`duplicate GPU slice IR function ${String(fn.functionId)}`);
    }
    seenFunctions.add(fn.functionId as number);
    string(fn.name, "GPU slice IR function name");
    integerArray(fn.paramIds, "GPU slice IR function paramIds");
    for (const paramId of fn.paramIds as number[]) {
      reference(paramIds, paramId, "GPU slice IR function paramId");
    }
    reference(typeIds, fn.resultTypeId, "GPU slice IR function resultTypeId");
    reference(expressionIds, fn.bodyExprId, "GPU slice IR function bodyExprId");
    spanReference(spanIds, fn.spanId, "GPU slice IR function spanId");
    const source = program.functions.find((sourceFn) => sourceFn.id === fn.functionId);
    if (
      !source || source.bindingId !== fn.bindingId || source.name !== fn.name ||
      source.resultTypeId !== fn.resultTypeId || source.recursionGroupId !== fn.recursionGroupId ||
      source.spanId !== fn.spanId ||
      JSON.stringify(source.paramIds) !== JSON.stringify(fn.paramIds)
    ) throw new Error("GPU slice IR function disagrees with its selected source function");
  }
  if (seenFunctions.size !== functionIds.size) {
    throw new Error("GPU slice IR does not contain every selected function");
  }

  for (const arm of arms) {
    integers(
      arm,
      ["id", "sourceArmId", "patternId", "bodyExprId", "spanId"],
      "GPU slice IR match arm",
    );
    reference(sourceArmIds, arm.sourceArmId, "GPU slice IR match arm sourceArmId");
    reference(patternIds, arm.patternId, "GPU slice IR match arm patternId");
    reference(expressionIds, arm.bodyExprId, "GPU slice IR match arm bodyExprId");
    spanReference(spanIds, arm.spanId, "GPU slice IR match arm spanId");
    const source = program.matchArms.find((sourceArm) => sourceArm.id === arm.sourceArmId);
    if (!source || source.patternId !== arm.patternId || source.spanId !== arm.spanId) {
      throw new Error("GPU slice IR match arm disagrees with its source arm");
    }
  }

  for (const expression of expressions) {
    integers(
      expression,
      [
        "id",
        "functionId",
        "sourceExprId",
        "typeId",
        "spanId",
        "bindingId",
        "patternId",
        "targetFunctionId",
        "constructorId",
      ],
      "GPU slice IR expression",
    );
    enumValue(expression.kind, irExpressionKinds, "GPU slice IR expression kind");
    reference(functionIds, expression.functionId, "GPU slice IR expression functionId");
    reference(
      sourceExpressionIds,
      expression.sourceExprId,
      "GPU slice IR expression sourceExprId",
    );
    reference(typeIds, expression.typeId, "GPU slice IR expression typeId");
    spanReference(spanIds, expression.spanId, "GPU slice IR expression spanId");
    string(expression.semanticId, "GPU slice IR expression semanticId");
    string(expression.operatorId, "GPU slice IR expression operatorId");
    finiteNumber(expression.numberValue, "GPU slice IR expression numberValue");
    boolean(expression.boolValue, "GPU slice IR expression boolValue");
    integerArray(expression.children, "GPU slice IR expression children");
    for (const child of expression.children as number[]) {
      reference(expressionIds, child, "GPU slice IR expression child");
    }
    integerArray(expression.armIds, "GPU slice IR expression armIds");
    for (const armId of expression.armIds as number[]) {
      reference(armIds, armId, "GPU slice IR expression armId");
    }
    if (expression.kind === "local") {
      if ((expression.bindingId as number) < 0) {
        throw new Error("GPU slice IR local has no binding");
      }
      reference(localBindingIds, expression.bindingId, "GPU slice IR local bindingId");
    } else if (expression.bindingId !== -1) {
      throw new Error("GPU slice IR non-local expression has a bindingId");
    }
    if (expression.kind === "let") {
      reference(patternIds, expression.patternId, "GPU slice IR let patternId");
    } else if (expression.patternId !== -1) {
      throw new Error("GPU slice IR non-let expression has a patternId");
    }
    if (expression.kind === "call" || expression.kind === "tail-call") {
      reference(
        functionIds,
        expression.targetFunctionId,
        "GPU slice IR call targetFunctionId",
      );
      if (
        expression.kind === "tail-call" && expression.targetFunctionId !== expression.functionId
      ) throw new Error("GPU slice IR tail-call does not target its owning function");
    } else if (expression.targetFunctionId !== -1) {
      throw new Error("GPU slice IR non-call expression has a targetFunctionId");
    }
    if (expression.kind === "constructor") {
      reference(
        constructorIds,
        expression.constructorId,
        "GPU slice IR constructorId",
      );
    } else if (expression.constructorId !== -1) {
      throw new Error("GPU slice IR non-constructor expression has a constructorId");
    }
    if (expression.kind === "match") {
      if ((expression.armIds as number[]).length === 0) {
        throw new Error("GPU slice IR match has no arms");
      }
    } else if ((expression.armIds as number[]).length !== 0) {
      throw new Error("GPU slice IR non-match expression has armIds");
    }
    if (expression.kind === "if" && (expression.children as number[]).length !== 3) {
      throw new Error("GPU slice IR if must have three children");
    }
    if (
      (expression.kind === "let" || expression.kind === "sequence") &&
      (expression.children as number[]).length !== 2
    ) throw new Error(`GPU slice IR ${String(expression.kind)} must have two children`);
    if (expression.kind === "match" && (expression.children as number[]).length !== 1) {
      throw new Error("GPU slice IR match must have one scrutinee child");
    }
    if (expression.kind === "void" && (expression.children as number[]).length !== 0) {
      throw new Error("GPU slice IR void must not execute implicit-statement provenance");
    }
    if (expression.kind === "color") {
      if (expression.semanticId !== GPU_SEMANTIC_IDS.color) {
        throw new Error("GPU slice IR color has the wrong semanticId");
      }
    } else if (expression.semanticId !== "") {
      throw new Error("GPU slice IR non-color expression has a semanticId");
    }
    if (expression.kind === "binary" || expression.kind === "unary") {
      enumValue(expression.operatorId, operatorIds, "GPU slice IR expression operatorId");
    } else if (expression.operatorId !== "") {
      throw new Error("GPU slice IR non-operator expression has an operatorId");
    }
  }
}

function validateGpuSliceLowering(
  output: Record<string, unknown>,
  program: GpuSliceElaborationInput,
): void {
  const functions = records(output.loweredFunctions, "GPU slice lowered functions");
  const locals = records(output.loweredLocals, "GPU slice lowered locals");
  const atoms = records(output.loweredAtoms, "GPU slice lowered atoms");
  const operations = records(output.loweredOperations, "GPU slice lowered operations");
  const statements = records(output.loweredStatements, "GPU slice lowered statements");
  const blocks = records(output.loweredBlocks, "GPU slice lowered blocks");
  const cases = records(output.loweredCases, "GPU slice lowered cases");
  const layouts = records(output.adtLayouts, "GPU slice ADT layouts");
  const fields = records(output.adtFields, "GPU slice ADT fields");

  const sourceFunctions = byId(
    program.functions as unknown as Record<string, unknown>[],
    "id",
  );
  const sourceTypes = byId(program.types as unknown as Record<string, unknown>[], "id");
  const sourceExpressions = byId(
    program.expressions as unknown as Record<string, unknown>[],
    "id",
  );
  const sourceConstructors = byId(
    program.constructors as unknown as Record<string, unknown>[],
    "id",
  );
  const sourceParams = byId(program.params as unknown as Record<string, unknown>[], "id");
  const sourcePatterns = byId(
    program.patterns as unknown as Record<string, unknown>[],
    "id",
  );
  const sourceFunctionIds = new Set(sourceFunctions.keys());
  const sourceTypeIds = new Set(sourceTypes.keys());
  const sourceExpressionIds = new Set(sourceExpressions.keys());
  const sourceConstructorIds = new Set(sourceConstructors.keys());
  const spanIds = new Set(program.spans.map((span) => span.id));
  const bindingIds = new Set(
    program.patterns.filter((pattern) => pattern.kind === "binding").map((pattern) =>
      pattern.bindingId
    ),
  );

  const localIds = ids(locals, "id", "GPU slice lowered local");
  const atomIds = ids(atoms, "id", "GPU slice lowered atom");
  const operationIds = ids(operations, "id", "GPU slice lowered operation");
  const statementIds = ids(statements, "id", "GPU slice lowered statement");
  const blockIds = ids(blocks, "id", "GPU slice lowered block");
  const caseIds = ids(cases, "id", "GPU slice lowered case");
  const layoutIds = ids(layouts, "id", "GPU slice ADT layout");
  const fieldIds = ids(fields, "id", "GPU slice ADT field");
  const localsById = byId(locals, "id");
  const atomsById = byId(atoms, "id");
  const operationsById = byId(operations, "id");
  const blocksById = byId(blocks, "id");
  const casesById = byId(cases, "id");
  const layoutsById = byId(layouts, "id");
  const fieldsById = byId(fields, "id");
  const loweredFunctionsById = byId(functions, "functionId");

  const sameFunction = (
    ownerFunctionId: unknown,
    referenced: Record<string, unknown> | undefined,
    label: string,
  ) => {
    if (!referenced || referenced.functionId !== ownerFunctionId) {
      throw new Error(`${label} crosses a lowered function boundary`);
    }
  };
  const sourceExprReference = (value: unknown, label: string) => {
    integer(value, label);
    if (value !== -1) reference(sourceExpressionIds, value, label);
  };
  const typeKind = (typeId: unknown) => sourceTypes.get(typeId as number)?.kind;

  const seenFunctions = new Set<number>();
  for (const fn of functions) {
    integers(fn, ["functionId", "bodyBlockId", "spanId"], "GPU slice lowered function");
    reference(sourceFunctionIds, fn.functionId, "GPU slice lowered functionId");
    if (seenFunctions.has(fn.functionId as number)) {
      throw new Error(`duplicate GPU slice lowered function ${String(fn.functionId)}`);
    }
    seenFunctions.add(fn.functionId as number);
    boolean(fn.recursive, "GPU slice lowered function recursive");
    spanReference(spanIds, fn.spanId, "GPU slice lowered function spanId");
    integerArray(fn.physicalParamLocalIds, "GPU slice lowered physical parameters");
    integerArray(fn.loopParamLocalIds, "GPU slice lowered loop parameters");
    reference(blockIds, fn.bodyBlockId, "GPU slice lowered function bodyBlockId");
    sameFunction(fn.functionId, blocksById.get(fn.bodyBlockId as number), "lowered function body");
    const source = sourceFunctions.get(fn.functionId as number)!;
    const expectedRecursive = source.recursionGroupId !== -1;
    if (fn.recursive !== expectedRecursive || fn.spanId !== source.spanId) {
      throw new Error("GPU slice lowered function disagrees with its source function");
    }
    const sourceParamIds = source.paramIds as number[];
    if ((fn.physicalParamLocalIds as number[]).length !== sourceParamIds.length) {
      throw new Error("GPU slice lowered function has the wrong physical parameter count");
    }
    for (let index = 0; index < sourceParamIds.length; index++) {
      const localId = (fn.physicalParamLocalIds as number[])[index];
      reference(localIds, localId, "GPU slice lowered physical parameter");
      const local = localsById.get(localId)!;
      const param = sourceParams.get(sourceParamIds[index])!;
      sameFunction(fn.functionId, local, "lowered physical parameter");
      if (local.kind !== "parameter" || local.typeId !== param.typeId || local.mutable !== false) {
        throw new Error("GPU slice lowered physical parameter disagrees with its source parameter");
      }
    }
    const loopParamIds = fn.loopParamLocalIds as number[];
    if (expectedRecursive && loopParamIds.length !== sourceParamIds.length) {
      throw new Error("GPU slice recursive function has the wrong loop parameter count");
    }
    if (!expectedRecursive && loopParamIds.length !== 0) {
      throw new Error("GPU slice non-recursive function has loop parameters");
    }
    for (let index = 0; index < loopParamIds.length; index++) {
      reference(localIds, loopParamIds[index], "GPU slice lowered loop parameter");
      const local = localsById.get(loopParamIds[index])!;
      const param = sourceParams.get(sourceParamIds[index])!;
      sameFunction(fn.functionId, local, "lowered loop parameter");
      if (
        local.kind !== "loop-parameter" || local.typeId !== param.typeId || local.mutable !== true
      ) {
        throw new Error("GPU slice lowered loop parameter disagrees with its source parameter");
      }
    }
  }
  if (seenFunctions.size !== sourceFunctionIds.size) {
    throw new Error("GPU slice lowering does not contain every selected function");
  }

  for (const local of locals) {
    integers(
      local,
      ["id", "functionId", "typeId", "bindingId", "spanId"],
      "GPU slice lowered local",
    );
    enumValue(local.kind, loweredLocalKinds, "GPU slice lowered local kind");
    reference(sourceFunctionIds, local.functionId, "GPU slice lowered local functionId");
    reference(sourceTypeIds, local.typeId, "GPU slice lowered local typeId");
    spanReference(spanIds, local.spanId, "GPU slice lowered local spanId");
    boolean(local.mutable, "GPU slice lowered local mutable");
    const mutable = local.kind === "loop-parameter" || local.kind === "join";
    if (local.mutable !== mutable) {
      throw new Error("only GPU slice loop parameters and joins may be mutable");
    }
    const mayHaveBinding = local.kind === "parameter" || local.kind === "loop-parameter" ||
      local.kind === "binding";
    if (local.bindingId !== -1) {
      if (!mayHaveBinding) throw new Error("GPU slice synthetic local has a bindingId");
      reference(bindingIds, local.bindingId, "GPU slice lowered local bindingId");
    } else if (local.kind === "binding" || local.kind === "loop-parameter") {
      throw new Error("GPU slice lowered binding local has no bindingId");
    }
  }

  for (const atom of atoms) {
    integers(
      atom,
      ["id", "functionId", "typeId", "sourceExprId", "spanId", "localId"],
      "GPU slice lowered atom",
    );
    enumValue(atom.kind, loweredAtomKinds, "GPU slice lowered atom kind");
    reference(sourceFunctionIds, atom.functionId, "GPU slice lowered atom functionId");
    reference(sourceTypeIds, atom.typeId, "GPU slice lowered atom typeId");
    sourceExprReference(atom.sourceExprId, "GPU slice lowered atom sourceExprId");
    spanReference(spanIds, atom.spanId, "GPU slice lowered atom spanId");
    finiteNumber(atom.numberValue, "GPU slice lowered atom numberValue");
    boolean(atom.boolValue, "GPU slice lowered atom boolValue");
    if (atom.kind === "local") {
      reference(localIds, atom.localId, "GPU slice lowered atom localId");
      const local = localsById.get(atom.localId as number)!;
      sameFunction(atom.functionId, local, "lowered local atom");
      if (local.typeId !== atom.typeId) throw new Error("GPU slice local atom has the wrong type");
      if (atom.sourceExprId === -1 && local.kind !== "parameter") {
        throw new Error("only GPU slice parameter atoms may omit source expression provenance");
      }
    } else if (atom.localId !== -1) {
      throw new Error("GPU slice literal atom has a localId");
    }
    const expectedKind = atom.kind === "number"
      ? "f32"
      : atom.kind === "bool"
      ? "bool"
      : atom.kind === "void"
      ? "void"
      : undefined;
    if (expectedKind && typeKind(atom.typeId) !== expectedKind) {
      throw new Error(`GPU slice ${String(atom.kind)} atom has the wrong type`);
    }
  }

  for (const operation of operations) {
    integers(
      operation,
      [
        "id",
        "functionId",
        "typeId",
        "sourceExprId",
        "spanId",
        "targetFunctionId",
        "constructorId",
        "layoutId",
        "fieldId",
        "index",
      ],
      "GPU slice lowered operation",
    );
    enumValue(operation.kind, loweredOperationKinds, "GPU slice lowered operation kind");
    reference(sourceFunctionIds, operation.functionId, "GPU slice lowered operation functionId");
    reference(sourceTypeIds, operation.typeId, "GPU slice lowered operation typeId");
    sourceExprReference(operation.sourceExprId, "GPU slice lowered operation sourceExprId");
    if (operation.sourceExprId === -1) throw new Error("GPU slice lowered operation has no source");
    spanReference(spanIds, operation.spanId, "GPU slice lowered operation spanId");
    string(operation.operatorId, "GPU slice lowered operation operatorId");
    string(operation.semanticId, "GPU slice lowered operation semanticId");
    integerArray(operation.args, "GPU slice lowered operation args");
    for (const atomId of operation.args as number[]) {
      reference(atomIds, atomId, "GPU slice lowered operation arg");
      sameFunction(operation.functionId, atomsById.get(atomId), "lowered operation argument");
    }
    if (operation.kind === "call") {
      reference(sourceFunctionIds, operation.targetFunctionId, "GPU slice lowered call target");
    } else if (operation.targetFunctionId !== -1) {
      throw new Error("GPU slice lowered non-call operation has a targetFunctionId");
    }
    if (operation.kind === "construct" || operation.kind === "payload") {
      reference(sourceConstructorIds, operation.constructorId, "GPU slice lowered constructor");
      reference(layoutIds, operation.layoutId, "GPU slice lowered constructor layout");
      const ctor = sourceConstructors.get(operation.constructorId as number)!;
      const layout = layoutsById.get(operation.layoutId as number)!;
      if (layout.typeNameId !== ctor.typeNameId) {
        throw new Error("GPU slice lowered constructor uses the wrong ADT layout");
      }
      if (operation.kind === "payload") {
        reference(fieldIds, operation.fieldId, "GPU slice lowered payload field");
        const field = fieldsById.get(operation.fieldId as number)!;
        if (
          field.layoutId !== operation.layoutId ||
          field.constructorId !== operation.constructorId ||
          field.typeId !== operation.typeId
        ) throw new Error("GPU slice lowered payload uses the wrong ADT field");
      } else if (operation.fieldId !== -1) {
        throw new Error("GPU slice lowered construct operation has a fieldId");
      }
    } else if (
      operation.constructorId !== -1 || operation.layoutId !== -1 || operation.fieldId !== -1
    ) throw new Error("GPU slice lowered non-ADT operation carries ADT identity");
    if (operation.kind === "binary" || operation.kind === "unary") {
      enumValue(operation.operatorId, operatorIds, "GPU slice lowered operatorId");
      const arity = operation.kind === "binary" ? 2 : 1;
      if ((operation.args as number[]).length !== arity) {
        throw new Error(`GPU slice lowered ${String(operation.kind)} has the wrong arity`);
      }
    } else if (operation.operatorId !== "") {
      throw new Error("GPU slice lowered non-operator operation has an operatorId");
    }
    if (operation.kind === "color") {
      if (operation.semanticId !== GPU_SEMANTIC_IDS.color) {
        throw new Error("GPU slice lowered color has the wrong semanticId");
      }
    } else if (operation.semanticId !== "") {
      throw new Error("GPU slice lowered non-color operation has a semanticId");
    }
    if (operation.kind === "project") {
      if ((operation.index as number) < 0 || (operation.args as number[]).length !== 1) {
        throw new Error("GPU slice lowered projection has an invalid index or arity");
      }
    } else if (operation.index !== -1) {
      throw new Error("GPU slice lowered non-projection operation has an index");
    }
    if (
      (operation.kind === "copy" || operation.kind === "payload" || operation.kind === "color") &&
      (operation.args as number[]).length !== 1
    ) throw new Error(`GPU slice lowered ${String(operation.kind)} has the wrong arity`);
  }

  for (const block of blocks) {
    integers(block, ["id", "functionId"], "GPU slice lowered block");
    reference(sourceFunctionIds, block.functionId, "GPU slice lowered block functionId");
    integerArray(block.statementIds, "GPU slice lowered block statements");
    for (const statementId of block.statementIds as number[]) {
      reference(statementIds, statementId, "GPU slice lowered block statement");
      sameFunction(
        block.functionId,
        statements.find((statement) => statement.id === statementId),
        "lowered block statement",
      );
    }
  }

  for (const gpuCase of cases) {
    integers(
      gpuCase,
      ["id", "functionId", "constructorId", "tag", "blockId", "spanId"],
      "GPU slice lowered case",
    );
    reference(sourceFunctionIds, gpuCase.functionId, "GPU slice lowered case functionId");
    reference(sourceConstructorIds, gpuCase.constructorId, "GPU slice lowered case constructorId");
    reference(blockIds, gpuCase.blockId, "GPU slice lowered case blockId");
    spanReference(spanIds, gpuCase.spanId, "GPU slice lowered case spanId");
    sameFunction(
      gpuCase.functionId,
      blocksById.get(gpuCase.blockId as number),
      "lowered case block",
    );
    const ctor = sourceConstructors.get(gpuCase.constructorId as number)!;
    if (gpuCase.tag !== ctor.tag) throw new Error("GPU slice lowered case has the wrong tag");
  }

  for (const statement of statements) {
    integers(
      statement,
      [
        "id",
        "functionId",
        "sourceExprId",
        "spanId",
        "localId",
        "operationId",
        "atomId",
        "conditionAtomId",
        "thenBlockId",
        "elseBlockId",
        "scrutineeAtomId",
        "layoutId",
        "bodyBlockId",
      ],
      "GPU slice lowered statement",
    );
    enumValue(statement.kind, loweredStatementKinds, "GPU slice lowered statement kind");
    enumValue(statement.reason, loweredStatementReasons, "GPU slice lowered statement reason");
    reference(sourceFunctionIds, statement.functionId, "GPU slice lowered statement functionId");
    sourceExprReference(statement.sourceExprId, "GPU slice lowered statement sourceExprId");
    if (statement.sourceExprId === -1) throw new Error("GPU slice lowered statement has no source");
    spanReference(spanIds, statement.spanId, "GPU slice lowered statement spanId");
    integerArray(statement.caseIds, "GPU slice lowered statement caseIds");
    integerArray(statement.targetLocalIds, "GPU slice lowered statement targetLocalIds");
    integerArray(statement.valueAtomIds, "GPU slice lowered statement valueAtomIds");

    if (statement.kind === "let") {
      reference(localIds, statement.localId, "GPU slice lowered let localId");
      reference(operationIds, statement.operationId, "GPU slice lowered let operationId");
      const local = localsById.get(statement.localId as number)!;
      const operation = operationsById.get(statement.operationId as number)!;
      sameFunction(statement.functionId, local, "lowered let local");
      sameFunction(statement.functionId, operation, "lowered let operation");
      const initializesLoop = statement.reason === "loop-initial" &&
        local.kind === "loop-parameter" && local.mutable === true;
      if (local.typeId !== operation.typeId || (local.mutable === true && !initializesLoop)) {
        throw new Error("GPU slice lowered let has incompatible storage");
      }
      if (
        !new Set(["binding", "temporary", "loop-initial", "tail-next"]).has(
          String(statement.reason),
        )
      ) {
        throw new Error("GPU slice lowered let has an invalid reason");
      }
    } else if (
      statement.localId !== -1 && statement.kind !== "assign" &&
      statement.kind !== "if" && statement.kind !== "switch"
    ) {
      throw new Error("GPU slice lowered statement unexpectedly carries a localId");
    }
    if (statement.kind === "assign") {
      reference(localIds, statement.localId, "GPU slice lowered assign localId");
      reference(atomIds, statement.atomId, "GPU slice lowered assign atomId");
      const local = localsById.get(statement.localId as number)!;
      const atom = atomsById.get(statement.atomId as number)!;
      sameFunction(statement.functionId, local, "lowered assignment local");
      sameFunction(statement.functionId, atom, "lowered assignment atom");
      if (
        local.kind !== "join" || local.mutable !== true || local.typeId !== atom.typeId ||
        statement.reason !== "join"
      ) {
        throw new Error("GPU slice lowered assignment is not an immutable-expression join");
      }
    }
    if (statement.kind === "if") {
      reference(atomIds, statement.conditionAtomId, "GPU slice lowered if condition");
      reference(blockIds, statement.thenBlockId, "GPU slice lowered if then block");
      reference(blockIds, statement.elseBlockId, "GPU slice lowered if else block");
      const condition = atomsById.get(statement.conditionAtomId as number)!;
      sameFunction(statement.functionId, condition, "lowered if condition");
      sameFunction(
        statement.functionId,
        blocksById.get(statement.thenBlockId as number),
        "lowered if branch",
      );
      sameFunction(
        statement.functionId,
        blocksById.get(statement.elseBlockId as number),
        "lowered if branch",
      );
      if (typeKind(condition.typeId) !== "bool") {
        throw new Error("GPU slice lowered if condition is not Bool");
      }
    }
    if (statement.kind === "switch") {
      reference(atomIds, statement.scrutineeAtomId, "GPU slice lowered switch scrutinee");
      reference(layoutIds, statement.layoutId, "GPU slice lowered switch layout");
      const scrutinee = atomsById.get(statement.scrutineeAtomId as number)!;
      const layout = layoutsById.get(statement.layoutId as number)!;
      sameFunction(statement.functionId, scrutinee, "lowered switch scrutinee");
      if (scrutinee.typeId !== layout.typeId) {
        throw new Error("GPU slice lowered switch uses the wrong layout");
      }
      if ((statement.caseIds as number[]).length === 0) {
        throw new Error("GPU slice lowered switch has no cases");
      }
      for (const caseId of statement.caseIds as number[]) {
        reference(caseIds, caseId, "GPU slice lowered switch case");
        const gpuCase = casesById.get(caseId)!;
        sameFunction(statement.functionId, gpuCase, "lowered switch case");
        const ctor = sourceConstructors.get(gpuCase.constructorId as number)!;
        if (ctor.typeNameId !== layout.typeNameId) {
          throw new Error("GPU slice lowered switch case belongs to the wrong layout");
        }
      }
    }
    if (statement.kind === "loop") {
      reference(blockIds, statement.bodyBlockId, "GPU slice lowered loop body");
      sameFunction(
        statement.functionId,
        blocksById.get(statement.bodyBlockId as number),
        "lowered loop body",
      );
      if (!loweredFunctionsById.get(statement.functionId as number)?.recursive) {
        throw new Error("GPU slice non-recursive function contains a loop");
      }
    }
    if (statement.kind === "continue") {
      const targets = statement.targetLocalIds as number[];
      const values = statement.valueAtomIds as number[];
      const fn = loweredFunctionsById.get(statement.functionId as number)!;
      if (
        targets.length === 0 || targets.length !== values.length ||
        JSON.stringify(targets) !== JSON.stringify(fn.loopParamLocalIds)
      ) {
        throw new Error("GPU slice lowered tail continue has incompatible parallel updates");
      }
      for (let index = 0; index < targets.length; index++) {
        reference(localIds, targets[index], "GPU slice lowered continue target");
        reference(atomIds, values[index], "GPU slice lowered continue value");
        const target = localsById.get(targets[index])!;
        const atom = atomsById.get(values[index])!;
        sameFunction(statement.functionId, target, "lowered continue target");
        sameFunction(statement.functionId, atom, "lowered continue value");
        const valueLocal = atom.kind === "local"
          ? localsById.get(atom.localId as number)
          : undefined;
        if (
          target.kind !== "loop-parameter" || atom.typeId !== target.typeId ||
          !valueLocal || valueLocal.kind !== "tail-next"
        ) throw new Error("GPU slice lowered continue does not use isolated tail-next values");
      }
    }
    if (statement.kind === "return") {
      reference(atomIds, statement.atomId, "GPU slice lowered return atomId");
      const atom = atomsById.get(statement.atomId as number)!;
      const source = sourceFunctions.get(statement.functionId as number)!;
      sameFunction(statement.functionId, atom, "lowered return atom");
      if (atom.typeId !== source.resultTypeId) {
        throw new Error("GPU slice lowered return has the wrong type");
      }
    }
  }
}

export function validateGpuSliceElaborationInput(
  value: unknown,
): asserts value is GpuSliceElaborationInput {
  const input = record(value, "GPU slice input");
  if (input.schemaVersion !== GPU_SLICE_SCHEMA_VERSION) {
    throw new Error(`unsupported GPU slice schema version ${String(input.schemaVersion)}`);
  }
  string(input.sourcePath, "GPU slice sourcePath");

  const functions = records(input.functions, "GPU slice functions");
  const types = records(input.types, "GPU slice types");
  const adts = records(input.adts, "GPU slice ADTs");
  const constructors = records(input.constructors, "GPU slice constructors");
  const patterns = records(input.patterns, "GPU slice patterns");
  const params = records(input.params, "GPU slice parameters");
  const lets = records(input.lets, "GPU slice lets");
  const matchArms = records(input.matchArms, "GPU slice match arms");
  const blockItems = records(input.blockItems, "GPU slice block items");
  const blocks = records(input.blocks, "GPU slice blocks");
  const matches = records(input.matches, "GPU slice matches");
  const expressions = records(input.expressions, "GPU slice expressions");
  const recursionGroups = records(input.recursionGroups, "GPU slice recursion groups");
  const recursiveReferences = records(
    input.recursiveReferences,
    "GPU slice recursive references",
  );
  const spans = records(input.spans, "GPU slice spans");

  const functionIds = ids(functions, "id", "GPU slice function");
  const typeIds = ids(types, "id", "GPU slice type");
  const adtIds = ids(adts, "typeNameId", "GPU slice ADT");
  const constructorIds = ids(constructors, "id", "GPU slice constructor");
  const patternIds = ids(patterns, "id", "GPU slice pattern");
  const paramIds = ids(params, "id", "GPU slice parameter");
  const letIds = ids(lets, "id", "GPU slice let");
  const matchArmIds = ids(matchArms, "id", "GPU slice match arm");
  const blockItemIds = ids(blockItems, "id", "GPU slice block item");
  const expressionIds = ids(expressions, "id", "GPU slice expression");
  const recursionGroupIds = ids(recursionGroups, "id", "GPU slice recursion group");
  const spanIds = ids(spans, "id", "GPU slice span");

  const expressionsById = byId(expressions, "id");
  const constructorsById = byId(constructors, "id");
  const functionsById = byId(functions, "id");
  const patternsById = byId(patterns, "id");

  const root = record(input.root, "GPU slice root");
  integer(root.functionId, "GPU slice root functionId");
  integer(root.selectorSpanId, "GPU slice root selectorSpanId");
  if (root.functionId === -1) {
    if (root.selectorSpanId !== -1) {
      throw new Error("an empty GPU slice root must not have a selector span");
    }
    if (
      functions.length || types.length || adts.length || constructors.length || patterns.length ||
      params.length || lets.length || matchArms.length || blockItems.length || blocks.length ||
      matches.length || expressions.length || recursionGroups.length ||
      recursiveReferences.length ||
      spans.length
    ) throw new Error("an empty GPU slice root must have empty program tables");
  } else {
    reference(functionIds, root.functionId, "GPU slice root functionId");
    spanReference(spanIds, root.selectorSpanId, "GPU slice root selectorSpanId");
  }

  for (const span of spans) {
    integers(span, ["id", "line", "col", "start", "end"], "GPU slice span");
    string(span.path, "GPU slice span path");
    if ((span.start as number) < 0 || (span.end as number) < (span.start as number)) {
      throw new Error("GPU slice span has an invalid range");
    }
  }

  for (const type of types) {
    integers(type, ["id", "typeNameId", "result"], "GPU slice type");
    enumValue(type.kind, typeKinds, "GPU slice type kind");
    integerArray(type.items, "GPU slice type items");
    integerArray(type.params, "GPU slice type params");
    for (const item of type.items as number[]) reference(typeIds, item, "GPU slice tuple item");
    for (const param of type.params as number[]) {
      reference(typeIds, param, "GPU slice function param");
    }
    if (type.kind === "tuple") {
      if ((type.items as number[]).length === 0) throw new Error("GPU slice tuple type is empty");
    } else if ((type.items as number[]).length !== 0) {
      throw new Error("only GPU slice tuple types may have items");
    }
    if (type.kind === "function") {
      reference(typeIds, type.result, "GPU slice function type result");
    } else if ((type.params as number[]).length !== 0 || type.result !== -1) {
      throw new Error("only GPU slice function types may have params/result");
    }
    if (type.kind === "adt") reference(adtIds, type.typeNameId, "GPU slice ADT typeNameId");
    if (type.kind !== "adt" && type.kind !== "color" && type.typeNameId !== -1) {
      throw new Error("only GPU slice ADT/color types may carry a typeNameId");
    }
  }

  if (adts.length > 1) throw new Error("GPU slice contains more than one ADT");
  for (const adt of adts) {
    integer(adt.typeNameId, "GPU slice ADT typeNameId");
    string(adt.name, "GPU slice ADT name");
    integerArray(adt.constructorIds, "GPU slice ADT constructors");
    spanReference(spanIds, adt.spanId, "GPU slice ADT spanId");
    for (const ctorId of adt.constructorIds as number[]) {
      reference(constructorIds, ctorId, "GPU slice ADT constructor");
      if (constructorsById.get(ctorId)?.typeNameId !== adt.typeNameId) {
        throw new Error("GPU slice constructor belongs to the wrong ADT");
      }
    }
  }
  for (const constructor of constructors) {
    integers(
      constructor,
      ["id", "typeNameId", "tag", "payloadTypeId"],
      "GPU slice constructor",
    );
    string(constructor.name, "GPU slice constructor name");
    reference(adtIds, constructor.typeNameId, "GPU slice constructor typeNameId");
    if ((constructor.tag as number) < 0) throw new Error("GPU slice constructor tag is negative");
    if (constructor.payloadTypeId !== -1) {
      reference(typeIds, constructor.payloadTypeId, "GPU slice constructor payloadTypeId");
      const payload = types.find((type) => type.id === constructor.payloadTypeId);
      if (payload?.kind !== "f32") throw new Error("GPU slice constructor payload must be f32");
    }
    spanReference(spanIds, constructor.spanId, "GPU slice constructor spanId");
  }

  for (const pattern of patterns) {
    integers(
      pattern,
      ["id", "typeId", "bindingId", "constructorId"],
      "GPU slice pattern",
    );
    enumValue(pattern.context, patternContexts, "GPU slice pattern context");
    enumValue(pattern.kind, patternKinds, "GPU slice pattern kind");
    reference(typeIds, pattern.typeId, "GPU slice pattern typeId");
    integerArray(pattern.children, "GPU slice pattern children");
    for (const child of pattern.children as number[]) {
      reference(patternIds, child, "GPU slice pattern child");
      if (patternsById.get(child)?.context !== pattern.context) {
        throw new Error("GPU slice pattern child has a different context");
      }
    }
    if (pattern.kind === "binding") {
      if ((pattern.bindingId as number) < 0) throw new Error("binding pattern has no bindingId");
    } else if (pattern.bindingId !== -1) {
      throw new Error("non-binding GPU slice pattern has a bindingId");
    }
    if (pattern.kind === "constructor") {
      reference(constructorIds, pattern.constructorId, "GPU slice pattern constructorId");
      if (pattern.context !== "match") {
        throw new Error("constructor pattern is not a match pattern");
      }
    } else if (pattern.constructorId !== -1) {
      throw new Error("non-constructor GPU slice pattern has a constructorId");
    }
    spanReference(spanIds, pattern.spanId, "GPU slice pattern spanId");
  }

  for (const param of params) {
    integers(param, ["id", "patternId", "typeId", "declaredIndex"], "GPU slice parameter");
    reference(patternIds, param.patternId, "GPU slice parameter patternId");
    reference(typeIds, param.typeId, "GPU slice parameter typeId");
    if (patternsById.get(param.patternId as number)?.context !== "parameter") {
      throw new Error("GPU slice parameter references a non-parameter pattern");
    }
    spanReference(spanIds, param.spanId, "GPU slice parameter spanId");
  }
  for (const letRow of lets) {
    integers(letRow, ["id", "patternId", "valueExprId", "declaredIndex"], "GPU slice let");
    reference(patternIds, letRow.patternId, "GPU slice let patternId");
    reference(expressionIds, letRow.valueExprId, "GPU slice let valueExprId");
    if (patternsById.get(letRow.patternId as number)?.context !== "let") {
      throw new Error("GPU slice let references a non-let pattern");
    }
    spanReference(spanIds, letRow.spanId, "GPU slice let spanId");
  }
  for (const arm of matchArms) {
    integers(arm, ["id", "patternId", "bodyExprId", "declaredIndex"], "GPU slice match arm");
    reference(patternIds, arm.patternId, "GPU slice match arm patternId");
    reference(expressionIds, arm.bodyExprId, "GPU slice match arm bodyExprId");
    if (patternsById.get(arm.patternId as number)?.context !== "match") {
      throw new Error("GPU slice match arm references a non-match pattern");
    }
    spanReference(spanIds, arm.spanId, "GPU slice match arm spanId");
  }

  for (const item of blockItems) {
    integers(
      item,
      ["id", "blockExprId", "declaredIndex", "expressionId", "letId"],
      "GPU slice block item",
    );
    if (item.kind !== "expression" && item.kind !== "let") {
      throw new Error("GPU slice block item has an invalid kind");
    }
    reference(expressionIds, item.blockExprId, "GPU slice block item blockExprId");
    if (expressionsById.get(item.blockExprId as number)?.kind !== "block") {
      throw new Error("GPU slice block item owner is not a block expression");
    }
    if (item.kind === "expression") {
      reference(expressionIds, item.expressionId, "GPU slice block item expressionId");
      if (item.letId !== -1) throw new Error("expression block item has a letId");
    } else {
      reference(letIds, item.letId, "GPU slice block item letId");
      if (item.expressionId !== -1) throw new Error("let block item has an expressionId");
    }
    spanReference(spanIds, item.spanId, "GPU slice block item spanId");
  }
  for (const block of blocks) {
    integers(block, ["expressionId", "resultExprId"], "GPU slice block");
    reference(expressionIds, block.expressionId, "GPU slice block expressionId");
    if (expressionsById.get(block.expressionId as number)?.kind !== "block") {
      throw new Error("GPU slice block row owner is not a block expression");
    }
    integerArray(block.itemIds, "GPU slice block itemIds");
    for (const itemId of block.itemIds as number[]) {
      reference(blockItemIds, itemId, "GPU slice block itemId");
    }
    reference(expressionIds, block.resultExprId, "GPU slice block resultExprId");
  }
  for (const match of matches) {
    integers(match, ["expressionId", "valueExprId"], "GPU slice match");
    reference(expressionIds, match.expressionId, "GPU slice match expressionId");
    if (expressionsById.get(match.expressionId as number)?.kind !== "match") {
      throw new Error("GPU slice match row owner is not a match expression");
    }
    reference(expressionIds, match.valueExprId, "GPU slice match valueExprId");
    integerArray(match.armIds, "GPU slice match armIds");
    for (const armId of match.armIds as number[]) {
      reference(matchArmIds, armId, "GPU slice match armId");
    }
  }

  for (const expression of expressions) {
    integers(
      expression,
      ["id", "typeId", "bindingId", "functionId", "constructorId"],
      "GPU slice expression",
    );
    enumValue(expression.kind, expressionKinds, "GPU slice expression kind");
    reference(typeIds, expression.typeId, "GPU slice expression typeId");
    spanReference(spanIds, expression.spanId, "GPU slice expression spanId");
    finiteNumber(expression.numberValue, "GPU slice expression numberValue");
    boolean(expression.boolValue, "GPU slice expression boolValue");
    integerArray(expression.children, "GPU slice expression children");
    for (const child of expression.children as number[]) {
      reference(expressionIds, child, "GPU slice expression child");
    }
    string(expression.semanticId, "GPU slice expression semanticId");
    string(expression.operatorId, "GPU slice expression operatorId");
    if (expression.kind === "var") {
      if ((expression.bindingId as number) < 0) throw new Error("GPU slice var has no bindingId");
    } else if (expression.kind === "call") {
      reference(functionIds, expression.functionId, "GPU slice call functionId");
      if ((expression.bindingId as number) < 0) throw new Error("GPU slice call has no bindingId");
    } else if (expression.kind === "constructor") {
      reference(constructorIds, expression.constructorId, "GPU slice expression constructorId");
    } else if (expression.kind === "color") {
      if (expression.semanticId !== GPU_SEMANTIC_IDS.color) {
        throw new Error("GPU slice color has the wrong semanticId");
      }
    } else if (expression.kind === "binary" || expression.kind === "unary") {
      enumValue(expression.operatorId, operatorIds, "GPU slice expression operatorId");
    }
    if (expression.kind !== "var" && expression.kind !== "call" && expression.bindingId !== -1) {
      throw new Error("GPU slice non-reference expression has a bindingId");
    }
    if (expression.kind !== "call" && expression.functionId !== -1) {
      throw new Error("GPU slice non-call expression has a functionId");
    }
    if (expression.kind !== "constructor" && expression.constructorId !== -1) {
      throw new Error("GPU slice non-constructor expression has a constructorId");
    }
    if (expression.kind !== "color" && expression.semanticId !== "") {
      throw new Error("GPU slice non-color expression has a semanticId");
    }
    if (
      expression.kind !== "binary" && expression.kind !== "unary" && expression.operatorId !== ""
    ) throw new Error("GPU slice non-operator expression has an operatorId");
  }

  const bindingIds = new Set<number>();
  for (const pattern of patterns) {
    if (pattern.kind === "binding") bindingIds.add(pattern.bindingId as number);
  }
  for (const fn of functions) {
    integers(
      fn,
      ["id", "bindingId", "resultTypeId", "bodyExprId", "recursionGroupId"],
      "GPU slice function",
    );
    string(fn.name, "GPU slice function name");
    integerArray(fn.paramIds, "GPU slice function paramIds");
    for (const paramId of fn.paramIds as number[]) {
      reference(paramIds, paramId, "GPU slice function param");
    }
    reference(typeIds, fn.resultTypeId, "GPU slice function resultTypeId");
    reference(expressionIds, fn.bodyExprId, "GPU slice function bodyExprId");
    if (fn.bindingId !== -1) {
      if (bindingIds.has(fn.bindingId as number)) {
        throw new Error("GPU slice function binding collides with a local pattern binding");
      }
      bindingIds.add(fn.bindingId as number);
    }
    if (fn.recursionGroupId !== -1) {
      reference(recursionGroupIds, fn.recursionGroupId, "GPU slice function recursionGroupId");
    }
    spanReference(spanIds, fn.spanId, "GPU slice function spanId");
  }
  for (const expression of expressions) {
    if (expression.kind === "var") {
      reference(bindingIds, expression.bindingId, "GPU slice var bindingId");
    } else if (expression.kind === "call") {
      const target = functionsById.get(expression.functionId as number);
      if (target?.bindingId !== expression.bindingId) {
        throw new Error("GPU slice call bindingId disagrees with its target function");
      }
    }
  }

  for (const group of recursionGroups) {
    integer(group.id, "GPU slice recursion group id");
    integerArray(group.memberFunctionIds, "GPU slice recursion group members");
    if ((group.memberFunctionIds as number[]).length !== 1) {
      throw new Error("GPU slice recursion group must contain exactly one function");
    }
    for (const functionId of group.memberFunctionIds as number[]) {
      reference(functionIds, functionId, "GPU slice recursion group function");
      if (functionsById.get(functionId)?.recursionGroupId !== group.id) {
        throw new Error("GPU slice recursion group disagrees with its function");
      }
    }
    spanReference(spanIds, group.spanId, "GPU slice recursion group spanId");
  }
  for (const referenceRow of recursiveReferences) {
    integers(
      referenceRow,
      ["expressionId", "groupId", "targetFunctionId"],
      "GPU slice recursive reference",
    );
    reference(expressionIds, referenceRow.expressionId, "GPU slice recursive expressionId");
    if (expressionsById.get(referenceRow.expressionId as number)?.kind !== "call") {
      throw new Error("GPU slice recursive reference is not a call expression");
    }
    reference(recursionGroupIds, referenceRow.groupId, "GPU slice recursive groupId");
    reference(functionIds, referenceRow.targetFunctionId, "GPU slice recursive targetFunctionId");
    if (!new Set(["self", "mutual", "external"]).has(String(referenceRow.relation))) {
      throw new Error("GPU slice recursive reference has an invalid relation");
    }
    if (!new Set(["call", "pipe", "value"]).has(String(referenceRow.invocation))) {
      throw new Error("GPU slice recursive reference has an invalid invocation");
    }
    spanReference(spanIds, referenceRow.spanId, "GPU slice recursive reference spanId");
  }
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => record(item, label));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function ids(
  rows: Record<string, unknown>[],
  field: string,
  label: string,
): Set<number> {
  const output = new Set<number>();
  for (const row of rows) {
    integer(row[field], `${label} ${field}`);
    const id = row[field] as number;
    if (output.has(id)) throw new Error(`duplicate ${label} ${id}`);
    output.add(id);
  }
  return output;
}

function byId(
  rows: Record<string, unknown>[],
  field: string,
): Map<number, Record<string, unknown>> {
  return new Map(rows.map((row) => [row[field] as number, row]));
}

function reference(ids: Set<number>, value: unknown, label: string): void {
  if (!ids.has(value as number)) throw new Error(`${label} references missing id ${String(value)}`);
}

function spanReference(ids: Set<number>, value: unknown, label: string): void {
  integer(value, label);
  if (value !== -1) reference(ids, value, label);
}

function integers(row: Record<string, unknown>, fields: string[], label: string): void {
  fields.forEach((field) => integer(row[field], `${label} ${field}`));
}

function integerArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || !value.every(Number.isInteger)) {
    throw new Error(`${label} must be an integer array`);
  }
}

function integer(value: unknown, label: string): void {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
}

function finiteNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function string(value: unknown, label: string): void {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
}

function boolean(value: unknown, label: string): void {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
}

function enumValue(value: unknown, values: Set<string>, label: string): void {
  if (!values.has(String(value))) throw new Error(`${label} has an invalid value ${String(value)}`);
}
