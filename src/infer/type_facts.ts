import type {
  Decl,
  Expr,
  JsImportSpec,
  Pattern,
  RecordExprField,
  RecordPatternField,
  TypeExpr,
} from "../ast.ts";
import type { AstNode } from "../source.ts";
import { basisStructureId, type CompilerSemanticId } from "../compiler_semantics.ts";
import type { StructureSemanticId, ValueId } from "../ids.ts";
import type { GpuOperatorId, OperatorExpr } from "../gpu_operators.ts";
import { prune, type Scheme, type Ty, type TypeInfo } from "../types.ts";
import type { StaticEnv } from "./environment.ts";

export type TypeFacts = {
  expressions: Map<Expr, TypeFact>;
  namespaceValues: Map<Expr, string>;
  patterns: Map<Pattern, TypeFact>;
  patternTypes: Map<Pattern, Ty>;
  operators: Map<OperatorExpr, GpuOperatorId>;
  gpuBuiltins: Map<Extract<Expr, { kind: "Call" }>, string>;
  gpuResourceCalls: Map<Extract<Expr, { kind: "Call" }>, GpuResourceCallFact>;
  gpuOperations: Map<Expr, GpuOperationObligation>;
  primitiveCarriers: Map<Expr, PrimitiveCarrierPlan>;
  bindings: Map<string, TypeFact[]>;
  typeDeclarations: Map<
    Extract<Decl, { kind: "TypeDecl" | "RecordDecl" | "ForeignTypeDecl" }>,
    TypeInfo
  >;
  typeReferences: Map<Extract<TypeExpr, { kind: "TName" }>, TypeReferenceFact>;
  typeExpressions: Map<TypeExpr, Ty>;
  typeVariables: Map<TypeExpr, TypeVariableFact>;
  typeVariableDeclarations: TypeVariableDeclarationFact[];
  structureImports: Map<Extract<Decl, { kind: "ImportDecl" }>, StaticEnv>;
  jsImportSchemes: Map<Extract<Decl, { kind: "JsImportDecl" }> | JsImportSpec, Scheme>;
  recordFields: Map<RecordExprField | RecordPatternField, RecordFieldFact>;
  recordProjections: Map<Extract<Expr, { kind: "Var" }>, RecordProjectionFact[]>;
  ffi: Map<number, FfiFact>;
};

export type GpuOperationShape = "f32" | "f32x2" | "f32x3" | "f32x4";

export type GpuResourceCallFact = {
  operation: "sample" | "load";
  receiverName: string;
  receiverType: Ty;
};

export type GpuOperationRow = {
  id: number;
  args: GpuOperationShape[];
  result: GpuOperationShape;
};

export type GpuOperationObligation = {
  kind: "builtin" | "operator" | "projection";
  identity: string;
  occurrence: Expr;
  args: Ty[];
  result: Ty;
  rows: GpuOperationRow[];
  determiningArgs: number[];
};

export type PrimitiveCarrierPlan = {
  carrier: "Result";
  occurrence: Expr;
  error: Ty;
  operands: ("wrapped" | "pure")[];
  payloadResult: Ty;
};

export type TypeFact = {
  instantiated?: Ty;
  general?: Scheme;
  subject: TypeFactSubject;
  origin?: TypeFactOrigin;
  notes?: TypeFactNote[];
};

export type RecordProjectionFact = {
  name: string;
  partIndex: number;
  record: TypeInfo;
  type: Ty;
};

export type RecordFieldFact = {
  record: TypeInfo;
  type: Ty;
};

export type TypeReferenceFact = {
  info: TypeInfo;
  qualifier?: Readonly<{ name: string; environment: StaticEnv }>;
};

export type TypeVariableFact = {
  type: Ty;
  region: AstNode;
};

export type TypeVariableDeclarationFact = {
  name: string;
  type: Ty;
  declaration: Extract<Decl, { kind: "TypeDecl" | "RecordDecl" }>;
  parameterIndex: number;
  region: AstNode;
};

export type TypeFactSubject =
  | "expr"
  | "pattern"
  | "binding"
  | "constructor"
  | "ffi-obligation"
  | "ffi-reflected"
  | "synthetic";

export type TypeFactOrigin = {
  name?: string;
  source: "local" | "import" | "basis" | "js-import" | "reflected-ffi" | "synthetic";
  semanticId?: CompilerSemanticId;
  valueId?: ValueId;
  structureId?: StructureSemanticId;
};

export type TypeFactNote = {
  kind: "info" | "warning";
  message: string;
};

export type FfiFact = {
  id: number;
  kind: "get" | "call";
  path: string[];
  receiver?: Ty;
  args: Ty[];
  binding?: string;
  expr?: Expr;
  placeholder?: Extract<Ty, { tag: "ffi" }>;
  status: "unresolved" | "resolved";
  instantiated?: Ty;
  origin?: TypeFactOrigin;
  consumed?: FfiConsumedUse;
};

export type FfiConsumedUse = {
  kind: "match" | "binding" | "operator" | "pipe" | "call";
  message: string;
};

export function createTypeFacts(): TypeFacts {
  return {
    expressions: new Map(),
    namespaceValues: new Map(),
    patterns: new Map(),
    patternTypes: new Map(),
    operators: new Map(),
    gpuBuiltins: new Map(),
    gpuResourceCalls: new Map(),
    gpuOperations: new Map(),
    primitiveCarriers: new Map(),
    bindings: new Map(),
    typeDeclarations: new Map(),
    typeReferences: new Map(),
    typeExpressions: new Map(),
    typeVariables: new Map(),
    typeVariableDeclarations: [],
    structureImports: new Map(),
    jsImportSchemes: new Map(),
    recordFields: new Map(),
    recordProjections: new Map(),
    ffi: new Map(),
  };
}

export function recordPrimitiveCarrierFact(
  facts: TypeFacts,
  plan: PrimitiveCarrierPlan,
): void {
  facts.primitiveCarriers.set(plan.occurrence, plan);
}

export function recordGpuOperationFact(
  facts: TypeFacts,
  obligation: GpuOperationObligation,
): void {
  facts.gpuOperations.set(obligation.occurrence, obligation);
}

export function recordGpuBuiltinFact(
  facts: TypeFacts,
  expression: Extract<Expr, { kind: "Call" }>,
  name: string,
): void {
  facts.gpuBuiltins.set(expression, name);
}

export function recordGpuResourceCallFact(
  facts: TypeFacts,
  expression: Extract<Expr, { kind: "Call" }>,
  fact: GpuResourceCallFact,
): void {
  facts.gpuResourceCalls.set(expression, fact);
}

export function recordOperatorFact(
  facts: TypeFacts,
  expression: OperatorExpr,
  operatorId: GpuOperatorId,
) {
  facts.operators.set(expression, operatorId);
}

export function recordPatternType(facts: TypeFacts, pattern: Pattern, type: Ty) {
  facts.patternTypes.set(pattern, type);
}

export function recordTypeDeclarationFact(
  facts: TypeFacts,
  declaration: Extract<Decl, { kind: "TypeDecl" | "RecordDecl" | "ForeignTypeDecl" }>,
  info: TypeInfo,
) {
  facts.typeDeclarations.set(declaration, info);
}

export function recordTypeReferenceFact(
  facts: TypeFacts,
  expression: Extract<TypeExpr, { kind: "TName" }>,
  info: TypeInfo,
  qualifier?: Readonly<{ name: string; environment: StaticEnv }>,
) {
  facts.typeReferences.set(expression, { info, qualifier });
}

export function recordTypeExpressionFact(
  facts: TypeFacts,
  expression: TypeExpr,
  type: Ty,
) {
  facts.typeExpressions.set(expression, type);
}

export function recordTypeVariableFact(
  facts: TypeFacts,
  expression: TypeExpr,
  type: Ty,
  region: AstNode | undefined,
) {
  if (region) facts.typeVariables.set(expression, { type, region });
}

export function recordTypeVariableDeclarationFact(
  facts: TypeFacts,
  declaration: Extract<Decl, { kind: "TypeDecl" | "RecordDecl" }>,
  parameterIndex: number,
  name: string,
  type: Ty,
) {
  if (!declaration.node) return;
  facts.typeVariableDeclarations.push({
    name,
    type,
    declaration,
    parameterIndex,
    region: declaration.node,
  });
}

export function recordRecordFieldFact(
  facts: TypeFacts,
  field: RecordExprField | RecordPatternField,
  record: TypeInfo,
  type: Ty,
) {
  facts.recordFields.set(field, { record, type });
}

export function recordRecordProjectionFact(
  facts: TypeFacts,
  expression: Extract<Expr, { kind: "Var" }>,
  fact: RecordProjectionFact,
) {
  const existing = facts.recordProjections.get(expression) ?? [];
  if (
    existing.some((item) => item.partIndex === fact.partIndex && item.record.id === fact.record.id)
  ) return;
  existing.push(fact);
  facts.recordProjections.set(expression, existing);
}

export function recordExprFact(
  facts: TypeFacts,
  expr: Expr,
  fact: Partial<TypeFact> & Pick<TypeFact, "subject">,
) {
  facts.expressions.set(expr, mergeFact(facts.expressions.get(expr), fact));
}

export function recordPatternFact(
  facts: TypeFacts,
  pattern: Pattern,
  fact: Partial<TypeFact> & Pick<TypeFact, "subject">,
) {
  facts.patterns.set(pattern, mergeFact(facts.patterns.get(pattern), fact));
}

export function recordBindingFact(
  facts: TypeFacts,
  name: string,
  fact: Partial<TypeFact> & Pick<TypeFact, "subject">,
) {
  const existing = facts.bindings.get(name) ?? [];
  facts.bindings.set(name, [...existing, mergeFact(undefined, fact)]);
}

export function recordFfiFact(facts: TypeFacts, fact: FfiFact) {
  facts.ffi.set(fact.id, fact);
}

export function resolveFfiFact(
  facts: TypeFacts,
  id: number,
  instantiated: Ty,
  origin: TypeFactOrigin = { source: "reflected-ffi" },
) {
  const existing = facts.ffi.get(id);
  if (!existing) return;
  facts.ffi.set(id, {
    ...existing,
    status: "resolved",
    instantiated,
    origin,
  });
}

export function recordConsumedFfiUse(
  facts: TypeFacts,
  type: Ty,
  consumed: FfiConsumedUse,
) {
  for (const id of unresolvedFfiIds(type)) {
    const existing = facts.ffi.get(id);
    if (!existing || existing.status === "resolved") continue;
    facts.ffi.set(id, { ...existing, consumed });
  }
}

export function originForScheme(name: string, scheme: Scheme): TypeFactOrigin {
  return {
    name,
    semanticId: scheme.semanticId,
    valueId: scheme.valueId,
    structureId: scheme.valueId && name.includes(".")
      ? basisStructureId(name.split(".")[0])
      : undefined,
    source: scheme.jsImport
      ? "js-import"
      : scheme.basis
      ? "basis"
      : scheme.imported
      ? "import"
      : "local",
  };
}

function mergeFact(
  existing: TypeFact | undefined,
  next: Partial<TypeFact> & Pick<TypeFact, "subject">,
): TypeFact {
  return {
    subject: next.subject ?? existing?.subject ?? "expr",
    instantiated: next.instantiated ?? existing?.instantiated,
    general: next.general ?? existing?.general,
    origin: next.origin ?? existing?.origin,
    notes: [...(existing?.notes ?? []), ...(next.notes ?? [])],
  };
}

function unresolvedFfiIds(type: Ty, out = new Set<number>()): Set<number> {
  const target = prune(type);
  if (target.tag === "ffi") {
    if (!target.instance) out.add(target.id);
    return out;
  }
  if (target.tag === "fn") {
    target.params.forEach((param) => unresolvedFfiIds(param, out));
    unresolvedFfiIds(target.result, out);
  } else if (target.tag === "tuple") {
    target.items.forEach((item) => unresolvedFfiIds(item, out));
  } else if (target.tag === "struct") {
    target.fields.forEach((field) => unresolvedFfiIds(field.type, out));
  } else if (target.tag === "named") {
    target.args.forEach((arg) => unresolvedFfiIds(arg, out));
  }
  return out;
}
