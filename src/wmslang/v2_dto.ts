import type { CompilerSemanticId } from "../compiler_semantics.ts";
import type { GpuOperatorId } from "../gpu_operators.ts";

export const GPU_SLICE_SCHEMA_VERSION = 2 as const;

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
  kind: "f32" | "bool" | "void" | "tuple" | "function" | "adt" | "color";
  typeNameId: number;
  items: number[];
  params: number[];
  result: number;
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
    | "tuple"
    | "call"
    | "constructor"
    | "color"
    | "if"
    | "match"
    | "block"
    | "binary"
    | "unary";
  typeId: number;
  spanId: number;
  bindingId: number;
  functionId: number;
  constructorId: number;
  semanticId: "" | CompilerSemanticId;
  operatorId: "" | GpuOperatorId;
  numberValue: number;
  boolValue: boolean;
  children: number[];
};

export type GpuSliceFunctionDto = {
  id: number;
  bindingId: number;
  name: string;
  paramIds: number[];
  resultTypeId: number;
  bodyExprId: number;
  recursionGroupId: number;
  spanId: number;
};

export type GpuSliceRootDto = {
  functionId: number;
  selectorSpanId: number;
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
  root: GpuSliceRootDto;
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
    | "tuple"
    | "call"
    | "constructor"
    | "color"
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
  numberValue: number;
  boolValue: boolean;
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
  boolValue: boolean;
};

export type GpuSliceLoweredOperationDto = {
  id: number;
  functionId: number;
  kind:
    | "copy"
    | "tuple"
    | "project"
    | "call"
    | "construct"
    | "color"
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
