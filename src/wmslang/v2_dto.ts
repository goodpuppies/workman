import type { CompilerSemanticId } from "../compiler_semantics.ts";
import type { GpuOperatorId } from "../gpu_operators.ts";

export const GPU_SLICE_SCHEMA_VERSION = 5 as const;

export type GpuSliceBuiltinCatalogIdentityDto = {
  schemaVersion: number;
  slangVersion: string;
  sourceSha256: string;
};

export type GpuSliceBuiltinOverloadDto = {
  id: number;
  name: string;
  params: GpuSliceBuiltinValueType[];
  result: GpuSliceBuiltinValueType;
  sourceSignature: string;
};

export type GpuSliceBuiltinValueType =
  | "f32"
  | "f32x2"
  | "f32x3"
  | "f32x4"
  | "i32"
  | "i32x2"
  | "i32x3"
  | "i32x4";

export type GpuSliceBuiltinCatalogDto = {
  identity: GpuSliceBuiltinCatalogIdentityDto;
  overloads: GpuSliceBuiltinOverloadDto[];
};

export type GpuSliceSpanDto = {
  id: number;
  path: string;
  line: number;
  col: number;
  start: number;
  end: number;
};

export type GpuSliceTypeDto = {
  id: number;
  kind:
    | "number"
    | "bool"
    | "void"
    | "tuple"
    | "function"
    | "adt"
    | "sampled-texture-2d"
    | "sampler";
  typeNameId: number;
  items: number[];
  params: number[];
  result: number;
};

export type GpuSliceShaderTypeDto = {
  id: number;
  kind:
    | "f32"
    | "i32"
    | "bool"
    | "void"
    | "vector"
    | "tuple"
    | "function"
    | "adt"
    | "sampled-texture-2d"
    | "sampler";
  typeNameId: number;
  items: number[];
  params: number[];
  result: number;
};

export type GpuSliceTypeEvidenceDto = {
  typeId: number;
  semanticKind: GpuSliceTypeDto["kind"];
  shaderKind: GpuSliceShaderTypeDto["kind"];
  reason:
    | "shader-number-f32"
    | "homogeneous-numeric-tuple-default"
    | "semantic-product"
    | "semantic-shape";
};

export type GpuSliceAdtDto = {
  typeNameId: number;
  name: string;
  constructorIds: number[];
  spanId: number;
};

export type GpuSliceConstructorDto = {
  id: number;
  typeNameId: number;
  name: string;
  tag: number;
  payloadTypeId: number;
  spanId: number;
};

export type GpuSlicePatternDto = {
  id: number;
  context: "parameter" | "let" | "match";
  kind: "wildcard" | "binding" | "tuple" | "constructor";
  typeId: number;
  ownerFunctionId: number;
  bindingId: number;
  constructorId: number;
  children: number[];
  spanId: number;
};

export type GpuSliceParamDto = {
  id: number;
  patternId: number;
  typeId: number;
  declaredIndex: number;
  spanId: number;
};

export type GpuSliceLetDto = {
  id: number;
  patternId: number;
  valueExprId: number;
  declaredIndex: number;
  spanId: number;
};

export type GpuSliceMatchArmDto = {
  id: number;
  patternId: number;
  bodyExprId: number;
  declaredIndex: number;
  spanId: number;
};

export type GpuSliceBlockItemDto = {
  id: number;
  blockExprId: number;
  declaredIndex: number;
  kind: "expression" | "let";
  expressionId: number;
  letId: number;
  spanId: number;
};

export type GpuSliceBlockDto = {
  expressionId: number;
  itemIds: number[];
  resultExprId: number;
};

export type GpuSliceMatchDto = {
  expressionId: number;
  valueExprId: number;
  armIds: number[];
};

export type GpuSliceExprDto = {
  id: number;
  kind:
    | "number"
    | "bool"
    | "void"
    | "var"
    | "uniform"
    | "resource"
    | "resource-call"
    | "project"
    | "copy"
    | "convert"
    | "tuple"
    | "call"
    | "builtin"
    | "constructor"
    | "if"
    | "match"
    | "block"
    | "binary"
    | "unary";
  typeId: number;
  spanId: number;
  ownerFunctionId: number;
  bindingId: number;
  functionId: number;
  constructorId: number;
  semanticId: "" | CompilerSemanticId;
  operatorId: "" | GpuOperatorId;
  builtinName: string;
  resourceOperation: "" | "sample" | "load";
  numberValue: number;
  numberKind: "" | "i32" | "f32";
  boolValue: boolean;
  index: number;
  children: number[];
};

export type GpuSliceFunctionDto = {
  id: number;
  bindingId: number;
  sourceBindingId: number;
  name: string;
  typeId: number;
  paramIds: number[];
  resultTypeId: number;
  bodyExprId: number;
  recursionGroupId: number;
  spanId: number;
};

export type GpuSliceOccurrenceTypeDto = {
  kind: "expression" | "pattern" | "function";
  sourceId: number;
  typeId: number;
  shaderTypeId: number;
  spanId: number;
  representationEvidence: "" | "i32" | "f32";
  representation: "" | "i32" | "f32";
};

export type GpuSliceBuiltinSelectionDto = {
  expressionId: number;
  overloadId: number;
};

export type GpuSliceTypeElaborationOutput = {
  schemaVersion: typeof GPU_SLICE_SCHEMA_VERSION;
  shaderTypes: GpuSliceShaderTypeDto[];
  typeEvidence: GpuSliceTypeEvidenceDto[];
  occurrences: GpuSliceOccurrenceTypeDto[];
  builtinSelections: GpuSliceBuiltinSelectionDto[];
};

export type GpuSliceRootDto = {
  functionId: number;
  selectorSpanId: number;
  environmentId: number;
};

export type GpuSliceEnvironmentFieldDto = {
  id: number;
  environmentId: number;
  name: string;
  declaredIndex: number;
  kind: "uniform" | "sampled-texture-2d" | "sampler";
  binding: number;
  typeId: number;
  spanId: number;
};

export type GpuSliceEnvironmentDto = {
  id: number;
  recordId: number;
  typeNameId: number;
  name: string;
  bindingId: number;
  fieldIds: number[];
  spanId: number;
};

export type GpuSliceRecursionGroupDto = {
  id: number;
  memberFunctionIds: number[];
  spanId: number;
};

export type GpuSliceRecursiveReferenceDto = {
  expressionId: number;
  groupId: number;
  targetFunctionId: number;
  relation: "self" | "mutual" | "external";
  invocation: "call" | "pipe" | "value";
  spanId: number;
};

export type GpuSliceElaborationInput = {
  schemaVersion: typeof GPU_SLICE_SCHEMA_VERSION;
  sourcePath: string;
  builtinCatalog: GpuSliceBuiltinCatalogDto;
  root: GpuSliceRootDto;
  environments: GpuSliceEnvironmentDto[];
  environmentFields: GpuSliceEnvironmentFieldDto[];
  functions: GpuSliceFunctionDto[];
  types: GpuSliceTypeDto[];
  adts: GpuSliceAdtDto[];
  constructors: GpuSliceConstructorDto[];
  patterns: GpuSlicePatternDto[];
  params: GpuSliceParamDto[];
  lets: GpuSliceLetDto[];
  matchArms: GpuSliceMatchArmDto[];
  blockItems: GpuSliceBlockItemDto[];
  blocks: GpuSliceBlockDto[];
  matches: GpuSliceMatchDto[];
  expressions: GpuSliceExprDto[];
  recursionGroups: GpuSliceRecursionGroupDto[];
  recursiveReferences: GpuSliceRecursiveReferenceDto[];
  spans: GpuSliceSpanDto[];
};

export type GpuSliceDiagnosticDto = {
  code: string;
  message: string;
  spanId: number;
  related: GpuSliceDiagnosticRelatedDto[];
};

export type GpuSliceDiagnosticRelatedDto = {
  spanId: number;
  label: string;
};

export type GpuSliceIrExprDto = {
  id: number;
  functionId: number;
  sourceExprId: number;
  kind:
    | "number"
    | "bool"
    | "void"
    | "local"
    | "uniform"
    | "resource"
    | "resource-call"
    | "project"
    | "copy"
    | "convert"
    | "tuple"
    | "call"
    | "builtin"
    | "constructor"
    | "if"
    | "match"
    | "let"
    | "sequence"
    | "binary"
    | "unary"
    | "tail-call";
  typeId: number;
  spanId: number;
  bindingId: number;
  patternId: number;
  targetFunctionId: number;
  constructorId: number;
  semanticId: "" | CompilerSemanticId;
  operatorId: "" | GpuOperatorId;
  builtinName: string;
  builtinOverloadId: number;
  resourceOperation: "" | "sample" | "load";
  numberValue: number;
  numberKind: "" | "i32" | "f32";
  boolValue: boolean;
  index: number;
  children: number[];
  armIds: number[];
};

export type GpuSliceIrMatchArmDto = {
  id: number;
  sourceArmId: number;
  patternId: number;
  bodyExprId: number;
  spanId: number;
};

export type GpuSliceIrFunctionDto = {
  functionId: number;
  bindingId: number;
  name: string;
  paramIds: number[];
  resultTypeId: number;
  bodyExprId: number;
  recursionGroupId: number;
  spanId: number;
};

export type GpuSliceAdtLayoutDto = {
  id: number;
  typeId: number;
  typeNameId: number;
  fieldIds: number[];
  spanId: number;
};

export type GpuSliceAdtFieldDto = {
  id: number;
  layoutId: number;
  constructorId: number;
  tag: number;
  typeId: number;
  spanId: number;
};

export type GpuSliceLoweredLocalDto = {
  id: number;
  functionId: number;
  kind: "parameter" | "loop-parameter" | "binding" | "temporary" | "join" | "tail-next";
  typeId: number;
  bindingId: number;
  mutable: boolean;
  spanId: number;
};

export type GpuSliceLoweredAtomDto = {
  id: number;
  functionId: number;
  kind: "local" | "number" | "bool" | "void";
  typeId: number;
  sourceExprId: number;
  spanId: number;
  localId: number;
  numberValue: number;
  numberKind: "" | "i32" | "f32";
  boolValue: boolean;
};

export type GpuSliceLoweredOperationDto = {
  id: number;
  functionId: number;
  kind:
    | "copy"
    | "convert"
    | "tuple"
    | "uniform"
    | "resource"
    | "resource-call"
    | "project"
    | "call"
    | "builtin"
    | "construct"
    | "binary"
    | "unary"
    | "payload";
  typeId: number;
  sourceExprId: number;
  spanId: number;
  targetFunctionId: number;
  constructorId: number;
  layoutId: number;
  fieldId: number;
  operatorId: "" | GpuOperatorId;
  semanticId: "" | CompilerSemanticId;
  builtinName: string;
  builtinOverloadId: number;
  resourceOperation: "" | "sample" | "load";
  index: number;
  args: number[];
};

export type GpuSliceLoweredStatementDto = {
  id: number;
  functionId: number;
  kind: "let" | "assign" | "if" | "switch" | "loop" | "continue" | "return";
  sourceExprId: number;
  spanId: number;
  localId: number;
  operationId: number;
  atomId: number;
  conditionAtomId: number;
  thenBlockId: number;
  elseBlockId: number;
  scrutineeAtomId: number;
  layoutId: number;
  caseIds: number[];
  bodyBlockId: number;
  targetLocalIds: number[];
  valueAtomIds: number[];
  reason: "" | "binding" | "temporary" | "join" | "loop-initial" | "tail-next";
};

export type GpuSliceLoweredBlockDto = {
  id: number;
  functionId: number;
  statementIds: number[];
};

export type GpuSliceLoweredCaseDto = {
  id: number;
  functionId: number;
  constructorId: number;
  tag: number;
  blockId: number;
  spanId: number;
};

export type GpuSliceLoweredFunctionDto = {
  functionId: number;
  physicalParamLocalIds: number[];
  loopParamLocalIds: number[];
  bodyBlockId: number;
  recursive: boolean;
  spanId: number;
};

export type GpuSliceCompilationOutput = {
  schemaVersion: typeof GPU_SLICE_SCHEMA_VERSION;
  program: GpuSliceElaborationInput;
  shaderTypes: GpuSliceShaderTypeDto[];
  typeEvidence: GpuSliceTypeEvidenceDto[];
  occurrences: GpuSliceOccurrenceTypeDto[];
  builtinSelections: GpuSliceBuiltinSelectionDto[];
  irFunctions: GpuSliceIrFunctionDto[];
  irExpressions: GpuSliceIrExprDto[];
  irMatchArms: GpuSliceIrMatchArmDto[];
  adtLayouts: GpuSliceAdtLayoutDto[];
  adtFields: GpuSliceAdtFieldDto[];
  loweredFunctions: GpuSliceLoweredFunctionDto[];
  loweredLocals: GpuSliceLoweredLocalDto[];
  loweredAtoms: GpuSliceLoweredAtomDto[];
  loweredOperations: GpuSliceLoweredOperationDto[];
  loweredStatements: GpuSliceLoweredStatementDto[];
  loweredBlocks: GpuSliceLoweredBlockDto[];
  loweredCases: GpuSliceLoweredCaseDto[];
  slangSource: string;
  diagnostics: GpuSliceDiagnosticDto[];
};
