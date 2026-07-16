export const GPU_ELABORATION_SCHEMA_VERSION = 1 as const;

export type GpuSpanDto = {
  id: number;
  path: string;
  line: number;
  col: number;
  start: number;
  end: number;
};

export type GpuTypeDto = {
  id: number;
  kind:
    | "unknown"
    | "number"
    | "bool"
    | "void"
    | "string"
    | "vector"
    | "tuple"
    | "function"
    | "named";
  name: string;
  representation: "" | "abstract" | "i32" | "f32";
  width: number;
  items: number[];
  params: number[];
  result: number;
};

export type GpuBindingDto = {
  id: number;
  name: string;
  typeId: number;
  definitionExprId: number;
  spanId: number;
  scope: "parameter" | "local" | "module" | "imported";
};

export type GpuParamDto = {
  bindingId: number;
  name: string;
  typeId: number;
};

export type GpuExprDto = {
  id: number;
  kind: string;
  typeId: number;
  spanId: number;
  bindingId: number;
  name: string;
  operator: string;
  numberValue: number;
  boolValue: boolean;
  children: number[];
  capability: "gpu" | "host-ffi" | "unsupported";
};

export type GpuRootDto = {
  regionId: number;
  functionId: number;
  bindingId: number;
};

export type GpuFunctionDto = {
  id: number;
  regionId: number;
  bindingId: number;
  name: string;
  params: GpuParamDto[];
  resultTypeId: number;
  bodyExprId: number;
  spanId: number;
  capability: "gpu-only" | "candidate";
};

export type GpuElaborationInput = {
  schemaVersion: typeof GPU_ELABORATION_SCHEMA_VERSION;
  roots: GpuRootDto[];
  functions: GpuFunctionDto[];
  bindings: GpuBindingDto[];
  types: GpuTypeDto[];
  expressions: GpuExprDto[];
  spans: GpuSpanDto[];
};

export type TypedGpuExprDto = GpuExprDto;
export type TypedGpuFunctionDto = Omit<GpuFunctionDto, "capability"> & {
  capability: "gpu-only" | "gpu-eligible" | "cpu-only";
};

export type GpuCaptureDto = {
  regionId: number;
  bindingId: number;
  typeId: number;
  spanId: number;
  category: "constant" | "uniform" | "resource" | "function" | "illegal";
};

export type GpuRepresentationFactDto = {
  typeId: number;
  representation: "i32" | "f32";
};

export type GpuSpecializationDto = {
  id: number;
  functionId: number;
  bindingId: number;
  name: string;
  paramTypeIds: number[];
  resultTypeId: number;
  paramRepresentations: ("i32" | "f32" | "")[];
  resultRepresentation: "i32" | "f32" | "";
  typeFacts: GpuRepresentationFactDto[];
};

export type GpuRootSpecializationDto = {
  regionId: number;
  specializationId: number;
};

export type GpuSpecializedCallDto = {
  callerSpecializationId: number;
  expressionId: number;
  targetSpecializationId: number;
};

export type GpuIrParamDto = {
  bindingId: number;
  name: string;
  typeId: number;
  representation: "i32" | "f32" | "";
};

export type GpuIrExprDto = {
  id: number;
  specializationId: number;
  sourceExprId: number;
  kind: string;
  typeId: number;
  representation: "i32" | "f32" | "";
  spanId: number;
  bindingId: number;
  name: string;
  operator: string;
  numberValue: number;
  boolValue: boolean;
  children: number[];
  capability: "gpu" | "host-ffi" | "unsupported";
  valueKind: "none" | "literal" | "local" | "capture" | "function" | "unresolved";
  callTargetSpecializationId: number;
};

export type GpuIrFunctionDto = {
  specializationId: number;
  functionId: number;
  bindingId: number;
  name: string;
  params: GpuIrParamDto[];
  resultTypeId: number;
  resultRepresentation: "i32" | "f32" | "";
  bodyExprId: number;
  spanId: number;
};

export type GpuDiagnosticDto = {
  code: string;
  message: string;
  spanId: number;
};

export type GpuCompilationOutput = {
  schemaVersion: typeof GPU_ELABORATION_SCHEMA_VERSION;
  functions: TypedGpuFunctionDto[];
  captures: GpuCaptureDto[];
  specializations: GpuSpecializationDto[];
  rootSpecializations: GpuRootSpecializationDto[];
  calls: GpuSpecializedCallDto[];
  irFunctions: GpuIrFunctionDto[];
  irExpressions: GpuIrExprDto[];
  types: GpuTypeDto[];
  expressions: TypedGpuExprDto[];
  diagnostics: GpuDiagnosticDto[];
};
