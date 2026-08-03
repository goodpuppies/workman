import type { Decl, Expr, ImportClause, JsImportSpec, Module, Pattern } from "./ast.ts";
import { isQualified, parseLongId, pathOf } from "./ast.ts";
import type {
  BindingFacts,
  BindingScopeCheckpoint,
  BindingScopeSnapshot,
} from "./binding_facts.ts";
import { basisCtorId } from "./basis.ts";
import { basisStructureId } from "./compiler_semantics.ts";
import type { FrontendDiagnostic } from "./diagnostics.ts";
import { resolveCompilerFrontend } from "./frontend_mode.ts";
import { discoverGpuRegions } from "./directives.ts";
import type { GpuFragmentSelectionFacts } from "./gpu_selection.ts";
import { isDecl } from "./infer/ast_utils.ts";
import type { StructureEnv } from "./infer.ts";
import type {
  BindingId,
  CtorId,
  FieldId,
  GpuRootId,
  GpuSelectorId,
  StructureId,
  StructureSemanticId,
  TypeNameId,
  TypeVariableId,
  ValueId,
} from "./ids.ts";
import type { ModuleGraph, ModuleImportEdge, ModuleNode } from "./module_graph.ts";
import type { ModuleId, ModuleMap } from "./module_id.ts";
import type { NominalFacts } from "./nominal_facts.ts";
import type { InferResult } from "./infer.ts";
import type { BasisProfileName } from "./initial_basis.ts";
import type { BasisGeneration } from "./initial_basis.ts";
import {
  createSemanticTypeArena,
  type SemanticType,
  type SemanticTypeArena,
  type SemanticTypeId,
} from "./semantic_types.ts";
import { type AstNode, offsetToLineCol, type SourceSpan } from "./source.ts";
import { prune, type Scheme, type Ty } from "./types.ts";
import type { GpuSliceElaborationInput, GpuSliceTypeElaborationOutput } from "./wmslang/v2_dto.ts";
import type { NormalizedGpuSlice } from "./wmslang/v2_normalize.ts";
import { WMSLANG_BUILTIN_OVERLOADS } from "./wmslang/builtin_catalog.generated.ts";

declare const interfaceGenerationBrand: unique symbol;
export type InterfaceGeneration = object & {
  readonly [interfaceGenerationBrand]: true;
};

declare const projectSnapshotIdBrand: unique symbol;
export type ProjectSnapshotId = object & {
  readonly [projectSnapshotIdBrand]: true;
};

export type ModuleCompleteness = Readonly<{
  syntax: "complete" | "recovered" | "unavailable";
  imports: "complete" | "partial" | "unavailable";
  elaboration: "complete" | "partial" | "unavailable";
  occurrences: "complete" | "partial" | "unavailable";
  scopes: "complete" | "partial" | "unavailable";
  ffi: "complete" | "partial" | "unavailable" | "not-applicable";
  gpu: "complete" | "partial" | "unavailable" | "not-applicable";
  recoveryBoundaries: readonly Readonly<{ start: number; end: number }>[];
}>;

export type DeclarationOrigin =
  | Readonly<{
    kind: "value";
    moduleId: ModuleId;
    bindingId: BindingId;
    visibility: "public";
    span: SourceSpan;
  }>
  | Readonly<{
    kind: "type";
    moduleId: ModuleId;
    typeNameId: TypeNameId;
    visibility: "public";
    span: SourceSpan;
  }>
  | Readonly<{
    kind: "constructor";
    moduleId: ModuleId;
    ctorId: CtorId;
    visibility: "public";
    span: SourceSpan;
  }>;

export type ImportTarget = Readonly<{
  sourceName: string;
  localName: string;
  value?: BindingId;
  type?: TypeNameId;
  constructor?: CtorId;
}>;

export type ModuleImportOccurrence = Readonly<{
  declaration: Extract<Decl, { kind: "ImportDecl" }>;
  clause: ImportClause;
  edge: ModuleImportEdge;
  target: ModuleId;
  structureAlias?: Readonly<{ name: string; id: StructureId }>;
  targets: readonly ImportTarget[];
}>;

export type SemanticOccurrenceTarget =
  | Readonly<{ kind: "value"; id: ValueId }>
  | Readonly<{ kind: "structure"; id: StructureSemanticId }>
  | Readonly<{ kind: "type"; id: TypeNameId }>
  | Readonly<{ kind: "constructor"; id: CtorId }>
  | Readonly<{ kind: "field"; id: FieldId }>
  | Readonly<{ kind: "type-variable"; id: TypeVariableId }>
  | Readonly<{ kind: "module"; id: ModuleId }>;

export type ModuleSemanticOccurrence = Readonly<{
  name: string;
  role:
    | "declaration"
    | "reference"
    | "qualifier"
    | "import-path"
    | "import-source"
    | "import-alias";
  target: SemanticOccurrenceTarget;
  span: SourceSpan;
  inferredType?: SemanticOccurrenceType;
  declaration?: Readonly<{
    moduleId: ModuleId;
    visibility: "public" | "private";
  }>;
}>;

export type SemanticOccurrenceType = Readonly<{
  id: SemanticTypeId;
  generalized: boolean;
  quantifiedVariables: number;
}>;

export type SemanticCarrierOperation = Readonly<{
  carrier: "Result";
  span: SourceSpan;
  operands: readonly ("wrapped" | "pure")[];
  errorType: SemanticTypeId;
  payloadResultType: SemanticTypeId;
}>;

export type SemanticTypedNode = Readonly<{
  kind: "expression" | "pattern" | "type-expression";
  label: string;
  span: SourceSpan;
  type: SemanticOccurrenceType;
  generalType?: SemanticOccurrenceType;
  presentation?: "generated-ffi-receiver";
}>;

export type SemanticTopLevelDeclaration = Readonly<{
  kind: "value" | "function" | "datatype" | "record" | "foreign-type";
  name: string;
  target: SemanticOccurrenceTarget;
  span: SourceSpan;
  selectionSpan: SourceSpan;
  constructors?: readonly Readonly<{
    name: string;
    id: CtorId;
    span: SourceSpan;
    selectionSpan: SourceSpan;
  }>[];
}>;

export type SemanticGpuOperation = Readonly<{
  kind: "builtin" | "operator" | "projection";
  identity: string;
  span: SourceSpan;
  args: readonly SemanticTypeId[];
  result: SemanticTypeId;
  rows: readonly Readonly<{
    id: number;
    args: readonly string[];
    result: string;
  }>[];
  determiningArgs: readonly number[];
}>;

export type SemanticGpuFragmentRoot = Readonly<{
  id: GpuRootId;
  span: SourceSpan;
  bindingId?: BindingId;
  selectorIds: readonly GpuSelectorId[];
  factory?: Readonly<{
    bindingId: BindingId;
    span: SourceSpan;
    parameter?: SourceSpan;
  }>;
}>;

export type SemanticGpuFragmentSelector = Readonly<{
  id: GpuSelectorId;
  rootId: GpuRootId;
  span: SourceSpan;
  argument: SourceSpan;
  environmentArgument?: SourceSpan;
}>;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

export type SemanticGpuSlice = Readonly<{
  rootId: GpuRootId;
  selectorIds: readonly GpuSelectorId[];
  input: DeepReadonly<GpuSliceElaborationInput>;
}>;

export type SemanticGpuElaboratedSlice = Readonly<{
  rootId: GpuRootId;
  selectorIds: readonly GpuSelectorId[];
  input: DeepReadonly<GpuSliceElaborationInput>;
  elaboration: DeepReadonly<GpuSliceTypeElaborationOutput>;
}>;

export type SemanticGpuElaboration = Readonly<{
  projectSnapshotId: ProjectSnapshotId;
  generation: InterfaceGeneration;
  modules: ReadonlyMap<ModuleId, readonly SemanticGpuElaboratedSlice[]>;
}>;

export type SemanticGpuFacts = Readonly<{
  operations: readonly SemanticGpuOperation[];
  builtins: readonly Readonly<{ name: string; span: SourceSpan }>[];
  resources: readonly Readonly<{
    operation: "sample" | "load";
    receiverName: string;
    receiverType: SemanticTypeId;
    span: SourceSpan;
  }>[];
  roots: readonly SemanticGpuFragmentRoot[];
  selectors: readonly SemanticGpuFragmentSelector[];
  slices: readonly SemanticGpuSlice[];
}>;

export type SemanticCompletionScopeNames = Readonly<{
  values: readonly string[];
  structures: readonly string[];
  types: readonly string[];
  constructors: readonly string[];
}>;

export type SemanticCompletionFacts = Readonly<{
  gpuRegions: readonly SourceSpan[];
  scopes: Readonly<{
    nodes: readonly Readonly<{ span: SourceSpan; names: SemanticCompletionScopeNames }>[];
    checkpoints: readonly Readonly<{
      container: SourceSpan;
      offset: number;
      names: SemanticCompletionScopeNames;
    }>[];
  }>;
}>;

export type SemanticExpectedType = Readonly<{
  span: SourceSpan;
  type: SemanticTypeId;
}>;

export type SemanticInferredTypeHint = Readonly<{
  kind: "binding" | "parameter" | "result";
  span: SourceSpan;
  type: SemanticOccurrenceType;
}>;

export type SemanticParameterHint = Readonly<{
  name: string;
  span: SourceSpan;
}>;

export type SemanticCallableDefinition = Readonly<{
  name: string;
  target: BindingId;
  parameterStages: readonly (readonly string[] | undefined)[];
}>;

export type SemanticCallSite = Readonly<{
  span: SourceSpan;
  activationStart: number;
  callee: string;
  parameters: readonly Readonly<{ name?: string; type: SemanticTypeId }>[];
  result: SemanticTypeId;
  arguments: readonly SourceSpan[];
  implicitParameters: number;
}>;

export type SemanticSignatureHelp = Readonly<{
  callee: string;
  parameters: readonly Readonly<{
    name?: string;
    type: Readonly<{ moduleId: ModuleId; id: SemanticTypeId }>;
  }>[];
  result: Readonly<{ moduleId: ModuleId; id: SemanticTypeId }>;
  activeParameter: number;
}>;

export type SemanticTokenFact = Readonly<{
  span: SourceSpan;
  kind:
    | "namespace"
    | "type"
    | "type-parameter"
    | "parameter"
    | "variable"
    | "property"
    | "constructor"
    | "function";
  modifiers: readonly ("declaration" | "readonly" | "default-library")[];
}>;

export type SemanticWorkspaceSymbolFact = Readonly<{
  projectSnapshotId: ProjectSnapshotId;
  moduleId: ModuleId;
  path: string;
  name: string;
  kind: "module" | SemanticTopLevelDeclaration["kind"] | "constructor";
  span: SourceSpan;
  selectionSpan: SourceSpan;
  containerName?: string;
}>;

export type SemanticCompletionCandidate = Readonly<{
  name: string;
  kind:
    | "value"
    | "constructor"
    | "type"
    | "structure"
    | "field"
    | "keyword"
    | "gpu-builtin"
    | "file"
    | "folder";
  origin:
    | "lexical"
    | "recovery"
    | "namespace"
    | "record"
    | "keyword"
    | "gpu"
    | "import";
  rank: number;
  proximity?: number;
  expectedCompatibility?: "compatible" | "unknown" | "incompatible";
  type?: Readonly<{
    moduleId: ModuleId;
    occurrence: SemanticOccurrenceType;
  }>;
  overloads?: readonly Readonly<{
    params: readonly string[];
    result: string;
  }>[];
}>;

export type SemanticCompletionResult = Readonly<{
  prefix: string;
  expectedType?: Readonly<{ moduleId: ModuleId; type: SemanticTypeId }>;
  candidates: readonly SemanticCompletionCandidate[];
}>;

export type SemanticStructureMember = Readonly<{
  name: string;
  kind: "value" | "constructor" | "type" | "structure";
  type?: SemanticOccurrenceType;
}>;

export type SemanticScopeTargetType = Readonly<{
  target: SemanticOccurrenceTarget;
  type: SemanticOccurrenceType;
}>;

export type SemanticJsTarget =
  | Readonly<{ kind: "global-root" }>
  | Readonly<{ kind: "global"; path: string }>
  | Readonly<{ kind: "meta" }>
  | Readonly<{ kind: "module"; specifier: string }>
  | Readonly<{ kind: "worker"; specifier: string }>
  | Readonly<{ kind: "receiver"; path: readonly string[] }>
  | Readonly<{ kind: "constructor"; path: string }>;

export type SemanticJsImport = Readonly<{
  span: SourceSpan;
  target: SemanticJsTarget;
  unsafe: boolean;
  typeOnly: boolean;
  structureAlias?: Readonly<{ name: string; id: StructureId }>;
  bindings: readonly Readonly<{
    sourceName: string;
    localName: string;
    id: BindingId;
    fallible: boolean;
    type?: SemanticOccurrenceType;
  }>[];
}>;

export type SemanticFfiFacts = Readonly<{
  imports: readonly SemanticJsImport[];
  calls: readonly Readonly<{
    label: string;
    span: SourceSpan;
    type: SemanticOccurrenceType;
    receiverElided: true;
  }>[];
  foreignTypes: readonly Readonly<{
    name: string;
    id: TypeNameId;
    foreignKey?: string;
    span: SourceSpan;
  }>[];
}>;

export type SemanticTypeVariableRegion = Readonly<{
  id: TypeVariableId;
  name: string;
  scope: SourceSpan;
  binder?: SourceSpan;
  occurrences: readonly SourceSpan[];
}>;

export type ProjectSemanticOccurrence = Readonly<{
  moduleId: ModuleId;
  occurrence: ModuleSemanticOccurrence;
}>;

export type SemanticRenamePlan = Readonly<{
  kind: "local-import-alias" | "target";
  placeholder: string;
  selection: SourceSpan;
  occurrences: readonly ProjectSemanticOccurrence[];
}>;

export type SemanticDocumentHighlight = Readonly<{
  occurrence: ModuleSemanticOccurrence;
  access: "read" | "write";
}>;

export type SemanticScopeValue =
  | Readonly<{ kind: "value"; id: ValueId }>
  | Readonly<{ kind: "constructor"; id: CtorId }>;

export type SemanticScope = Readonly<{
  values: ReadonlyMap<string, SemanticScopeValue>;
  structures: ReadonlyMap<string, StructureSemanticId>;
  types: ReadonlyMap<string, TypeNameId>;
  typeVariables: ReadonlyMap<string, TypeVariableId>;
}>;

export type ModuleSemanticScopes = Readonly<{
  initial: SemanticScope;
  nodes: readonly Readonly<{ span: SourceSpan; scope: SemanticScope }>[];
  checkpoints: readonly Readonly<{
    container: SourceSpan;
    offset: number;
    scope: SemanticScope;
  }>[];
}>;

export type ModuleInterface = Readonly<{
  projectSnapshotId: ProjectSnapshotId;
  moduleId: ModuleId;
  path: string;
  sourceSpan: SourceSpan;
  generation: InterfaceGeneration;
  basis: Readonly<{
    profile: BasisProfileName;
    generation: BasisGeneration;
  }>;
  publicEnvironment: StructureEnv;
  origins: ReadonlyMap<string, readonly DeclarationOrigin[]>;
  dependencies: readonly ModuleImportEdge[];
  reverseDependencies: readonly ModuleId[];
  imports: readonly ModuleImportOccurrence[];
  occurrences: readonly ModuleSemanticOccurrence[];
  scopes: ModuleSemanticScopes;
  initialScopeTypes: readonly SemanticScopeTargetType[];
  structureMembers: ReadonlyMap<StructureSemanticId, readonly SemanticStructureMember[]>;
  typeVariables: readonly SemanticTypeVariableRegion[];
  declarations: readonly SemanticTopLevelDeclaration[];
  typedNodes: readonly SemanticTypedNode[];
  carrierOperations: readonly SemanticCarrierOperation[];
  gpuFacts: SemanticGpuFacts;
  completionFacts: SemanticCompletionFacts;
  expectedTypes: readonly SemanticExpectedType[];
  inferredTypeHints: readonly SemanticInferredTypeHint[];
  parameterHints: readonly SemanticParameterHint[];
  callableDefinitions: readonly SemanticCallableDefinition[];
  callSites: readonly SemanticCallSite[];
  semanticTokens: readonly SemanticTokenFact[];
  ffiFacts: SemanticFfiFacts;
  semanticTypes: readonly SemanticType[];
  diagnostics: readonly FrontendDiagnostic[];
  completeness: ModuleCompleteness;
}>;

export type ProjectSnapshot = Readonly<{
  id: ProjectSnapshotId;
  kind: "headed" | "detached";
  head: ModuleId;
  configuration: ProjectConfiguration;
  basisGenerations: ReadonlyMap<BasisProfileName, BasisGeneration>;
  generation: InterfaceGeneration;
  interfaces: ReadonlyMap<ModuleId, ModuleInterface>;
}>;

export type ProjectConfiguration = Readonly<{
  frontend: "v2";
  surface: "workman" | "wmsml";
}>;

export type ProjectSnapshotContext = Readonly<{
  kind?: "headed" | "detached";
  configuration?: Partial<ProjectConfiguration>;
}>;

export type ProjectSemanticFacts = Readonly<{
  gpuSelections?: GpuFragmentSelectionFacts;
  gpuSlices?: readonly NormalizedGpuSlice[];
  completionFacts?: ReadonlyMap<ModuleId, SemanticCompletionFacts>;
}>;

export function buildProjectSnapshot(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
  bindings: ModuleMap<BindingFacts>,
  nominalFacts: NominalFacts,
  context: ProjectSnapshotContext = {},
  semanticFacts: ProjectSemanticFacts = {},
): ProjectSnapshot {
  const projectSnapshotId = projectSnapshotToken();
  const generation = generationToken();
  const reverse = reverseDependencies(graph);
  const targetTypes = semanticTargetTypes(results, bindings, nominalFacts);
  const callableParameters = semanticCallableParameters(graph, bindings);
  const interfaces = new Map<ModuleId, ModuleInterface>();
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const result = results.get(id)!;
    const moduleBindings = bindings.get(id)!;
    const imports = Object.freeze(
      importOccurrences(node.module.decls, node.imports, bindings, nominalFacts),
    );
    const typeArena = createSemanticTypeArena(nominalFacts);
    const typeVariables = semanticTypeVariableRegions(node.source, result);
    const occurrences = Object.freeze(
      annotateDeclarationOwnership(
        semanticOccurrences(
          id,
          node.source,
          node.imports,
          imports,
          moduleBindings,
          nominalFacts,
          result,
          typeArena,
          typeVariables,
          targetTypes,
        ),
        id,
        moduleBindings,
        nominalFacts,
      ),
    );
    const scopes = semanticScopes(moduleBindings, result, nominalFacts);
    const initialScopeTypes = semanticInitialScopeTypes(result, typeArena);
    const structureMembers = semanticStructureMembers(result, nominalFacts, typeArena);
    const declarations = semanticTopLevelDeclarations(
      node.module.decls,
      node.source,
      moduleBindings,
      nominalFacts,
    );
    const typedNodes = semanticTypedNodes(result, moduleBindings, typeArena);
    const carrierOperations = semanticCarrierOperations(result, typeArena);
    const gpuFacts = semanticGpuFacts(
      id,
      result,
      semanticFacts.gpuSelections,
      semanticFacts.gpuSlices,
      typeArena,
    );
    const completionFacts = semanticFacts.completionFacts?.get(id) ??
      semanticCompletionFacts(node.module, moduleBindings);
    const expectedTypes = semanticExpectedTypes(result, typeArena);
    const inferredTypeHints = semanticInferredTypeHints(
      node.module,
      node.source,
      result,
      typedNodes,
    );
    const parameterHints = semanticParameterHints(
      result,
      moduleBindings,
      callableParameters,
    );
    const callableDefinitions = semanticCallableDefinitions(
      moduleBindings,
      callableParameters,
    );
    const callSites = semanticCallSites(
      node.source,
      result,
      moduleBindings,
      callableParameters,
      typeArena,
    );
    const ffiFacts = semanticFfiFacts(
      id,
      node.module.decls,
      node.source,
      moduleBindings,
      nominalFacts,
      result,
      typeArena,
    );
    const semanticTypes = typeArena.finish();
    const semanticTokens = semanticTokenFacts(
      occurrences,
      semanticTypes,
      semanticParameterTargets(node.module, moduleBindings),
    );
    interfaces.set(
      id,
      Object.freeze({
        projectSnapshotId,
        moduleId: id,
        path: node.path,
        sourceSpan: Object.freeze({
          line: 1,
          col: 0,
          start: 0,
          end: node.source.length,
        }),
        generation,
        basis: Object.freeze({
          profile: result.basis.profile.name,
          generation: result.basis.generation,
        }),
        publicEnvironment: result.exportedStructure,
        origins: declarationOrigins(id, node.source, moduleBindings, nominalFacts),
        dependencies: Object.freeze([...node.imports]),
        reverseDependencies: Object.freeze([...(reverse.get(id) ?? [])]),
        imports,
        occurrences,
        scopes,
        initialScopeTypes,
        structureMembers,
        typeVariables,
        declarations,
        typedNodes,
        carrierOperations,
        gpuFacts,
        completionFacts,
        expectedTypes,
        inferredTypeHints,
        parameterHints,
        callableDefinitions,
        callSites,
        semanticTokens,
        ffiFacts,
        semanticTypes,
        diagnostics: Object.freeze([
          ...(node.syntaxDiagnostics ?? []),
          ...(node.importDiagnostics ?? []),
          ...result.diagnostics,
        ]),
        // Reaching this builder means strict parsing, graph loading, staged FFI preparation, and
        // final host inference completed. Warnings do not make those facts partial. The first
        // The occurrence artifact deliberately reports partial coverage until every
        // recovery-produced and role-specific source mapping is represented. Final specialized GPU
        // occurrence types are not yet part of this artifact.
        completeness: analysisCompleteness(
          result,
          node,
          ffiFacts,
          gpuFacts,
        ),
      }),
    );
  }
  return Object.freeze({
    id: projectSnapshotId,
    kind: context.kind ?? "headed",
    head: graph.entry,
    configuration: Object.freeze({
      frontend: resolveCompilerFrontend(
        context.configuration?.frontend,
        context.configuration?.surface,
      ),
      surface: context.configuration?.surface ?? "workman",
    }),
    basisGenerations: new Map(
      [...results.values()].map((result) => [
        result.basis.profile.name,
        result.basis.generation,
      ]),
    ),
    generation,
    interfaces,
  });
}

function semanticTopLevelDeclarations(
  declarations: readonly Decl[],
  source: string,
  bindings: BindingFacts,
  nominalFacts: NominalFacts,
): readonly SemanticTopLevelDeclaration[] {
  const output: SemanticTopLevelDeclaration[] = [];
  for (const declaration of declarations) {
    if (!declaration.node) continue;
    if (declaration.kind === "LetDecl") {
      for (const binding of declaration.bindings) {
        for (const pattern of topLevelPatternBinders(binding.pattern)) {
          const id = bindings.binders.get(pattern);
          if (id === undefined || !pattern.node) continue;
          output.push(Object.freeze({
            kind: binding.value.kind === "Lambda" ? "function" : "value",
            name: pattern.name,
            target: Object.freeze({ kind: "value", id }),
            span: Object.freeze({ ...declaration.node.span }),
            selectionSpan: Object.freeze({ ...pattern.node.span }),
          }));
        }
      }
      continue;
    }
    if (
      declaration.kind !== "TypeDecl" &&
      declaration.kind !== "RecordDecl" &&
      declaration.kind !== "ForeignTypeDecl"
    ) continue;
    const typeFact = nominalFacts.types.find((fact) => fact.declaration === declaration);
    const selectionSpan = identifierSpan(source, declaration.node, declaration.name, "first");
    if (!typeFact || !selectionSpan) continue;
    const constructors = declaration.kind === "TypeDecl"
      ? declaration.ctors.flatMap((constructor) => {
        const fact = nominalFacts.constructors.find((candidate) =>
          candidate.declaration === constructor
        );
        const constructorSpan = constructor.node &&
          identifierSpan(source, constructor.node, constructor.name, "first");
        return fact && constructor.node && constructorSpan
          ? [Object.freeze({
            name: constructor.name,
            id: fact.id,
            span: Object.freeze({ ...constructor.node.span }),
            selectionSpan: Object.freeze(constructorSpan),
          })]
          : [];
      })
      : undefined;
    output.push(Object.freeze({
      kind: declaration.kind === "TypeDecl"
        ? "datatype"
        : declaration.kind === "RecordDecl"
        ? "record"
        : "foreign-type",
      name: declaration.name,
      target: Object.freeze({ kind: "type", id: typeFact.id }),
      span: Object.freeze({ ...declaration.node.span }),
      selectionSpan: Object.freeze(selectionSpan),
      constructors: constructors && Object.freeze(constructors),
    }));
  }
  return Object.freeze(output);
}

function topLevelPatternBinders(
  pattern: Pattern,
): Extract<Pattern, { kind: "PVar" }>[] {
  if (pattern.kind === "PVar") return [pattern];
  if (pattern.kind === "PTuple") return pattern.items.flatMap(topLevelPatternBinders);
  if (pattern.kind === "PRecord") {
    return pattern.fields.flatMap((field) => topLevelPatternBinders(field.pattern));
  }
  return [];
}

type SemanticTypeSource = Readonly<{
  type: Ty;
  scheme?: Scheme;
}>;

function semanticTargetTypes(
  results: ModuleMap<InferResult>,
  bindings: ModuleMap<BindingFacts>,
  nominalFacts: NominalFacts,
): ReadonlyMap<string, SemanticTypeSource> {
  const types = new Map<string, SemanticTypeSource>();
  for (const [moduleId, moduleBindings] of bindings) {
    const result = results.get(moduleId)!;
    for (const [pattern, id] of moduleBindings.binders) {
      const fact = result.facts.patterns.get(pattern);
      const type = fact?.instantiated ?? result.facts.patternTypes.get(pattern);
      if (!type) continue;
      types.set(
        semanticTargetKey({ kind: "value", id }),
        Object.freeze({ type, scheme: fact?.general }),
      );
    }
    for (const [declaration, id] of moduleBindings.recordConstructors) {
      const scheme = result.facts.bindings.get(declaration.name)?.find((fact) =>
        fact.general?.status === "record-constructor" &&
        fact.general.node === declaration.node
      )?.general;
      if (!scheme) continue;
      types.set(
        semanticTargetKey({ kind: "value", id }),
        Object.freeze({ type: scheme.type, scheme }),
      );
    }
  }
  for (const constructor of nominalFacts.constructors) {
    const result = results.get(constructor.moduleId);
    const scheme = result?.facts.bindings.get(constructor.name)?.find((fact) =>
      fact.general?.constructorDecl === constructor.declaration
    )?.general;
    if (!scheme) continue;
    types.set(
      semanticTargetKey({ kind: "constructor", id: constructor.id }),
      Object.freeze({ type: scheme.type, scheme }),
    );
  }
  return types;
}

function semanticFfiFacts(
  moduleId: ModuleId,
  declarations: readonly Decl[],
  source: string,
  bindings: BindingFacts,
  nominalFacts: NominalFacts,
  result: InferResult,
  typeArena: SemanticTypeArena,
): SemanticFfiFacts {
  const jsDeclarations = declarations
    .filter((declaration): declaration is Extract<Decl, { kind: "JsImportDecl" }> =>
      declaration.kind === "JsImportDecl" && declaration.node !== undefined
    );
  const imports = jsDeclarations
    .filter((declaration) =>
      declaration.sourceClause !== undefined ||
      declaration.clause.kind !== "Named" ||
      declaration.clause.specs.some((spec) => spec.sourceName === undefined)
    )
    .map((declaration) => {
      const clause = declaration.sourceClause ?? declaration.clause;
      const importedBindings: SemanticJsImport["bindings"] = clause.kind === "Namespace"
        ? (() => {
          const id = bindings.jsImportBinders.get(declaration);
          const scheme = result.facts.jsImportSchemes.get(declaration);
          const namespace = id === undefined ? [] : [Object.freeze({
            sourceName: clause.alias,
            localName: clause.alias,
            id,
            fallible: false,
            type: semanticOccurrenceType(typeArena, scheme?.type, scheme),
          })];
          const members = jsDeclarations.flatMap((candidate) =>
            candidate === declaration || candidate.node !== declaration.node ||
              candidate.clause.kind !== "Named"
              ? []
              : candidate.clause.specs.flatMap((spec) => {
                if (!spec.sourceName?.startsWith(`${clause.alias}.`)) return [];
                const memberId = bindings.jsImportBinders.get(spec);
                const memberScheme = result.facts.jsImportSchemes.get(spec);
                if (memberId === undefined) return [];
                return [Object.freeze({
                  sourceName: spec.name,
                  localName: spec.sourceName,
                  id: memberId,
                  fallible: spec.fallible ?? false,
                  type: semanticOccurrenceType(
                    typeArena,
                    memberScheme?.type,
                    memberScheme,
                  ),
                })];
              })
          );
          return [...namespace, ...members];
        })()
        : clause.specs.filter((spec) => spec.sourceName === undefined).flatMap((spec) => {
          const id = bindings.jsImportBinders.get(spec);
          if (id === undefined) return [];
          const scheme = result.facts.jsImportSchemes.get(spec) ??
            jsImportSourceScheme(id, bindings, result);
          return [Object.freeze({
            sourceName: spec.name,
            localName: spec.alias ?? spec.name,
            id,
            fallible: spec.fallible ?? false,
            type: semanticOccurrenceType(typeArena, scheme?.type, scheme),
          })];
        });
      const structureId = bindings.jsStructureBinders.get(declaration);
      return Object.freeze({
        span: Object.freeze({ ...declaration.node!.span }),
        target: semanticJsTarget(declaration.target),
        unsafe: clause.unsafe ?? false,
        typeOnly: declaration.typeOnly ?? false,
        structureAlias: clause.kind === "Named" && clause.alias && structureId !== undefined
          ? Object.freeze({ name: clause.alias, id: structureId })
          : undefined,
        bindings: Object.freeze(importedBindings),
      });
    });
  const foreignTypes = nominalFacts.types
    .flatMap((fact) => {
      const declaration = fact.declaration;
      if (
        fact.moduleId !== moduleId ||
        declaration.kind !== "ForeignTypeDecl" ||
        !declaration.node
      ) return [];
      const span = identifierSpan(
        source,
        declaration.node,
        declaration.name,
        "first",
      );
      return span
        ? [Object.freeze({
          name: fact.name,
          id: fact.id,
          foreignKey: declaration.foreignKey,
          span: Object.freeze(span),
        })]
        : [];
    });
  const calls = [...result.types]
    .flatMap(([expression]) => {
      if (
        expression.kind !== "Call" ||
        expression.callee.kind !== "Var" ||
        !expression.callee.name.startsWith("__ffi_") ||
        !expression.node
      ) return [];
      const scheme = result.env.get(expression.callee.name);
      const type = semanticOccurrenceType(typeArena, scheme?.type, scheme);
      if (!type) return [];
      const label = expression.callee.sourceName ??
        displayGeneratedFfiName(expression.callee.name);
      return [Object.freeze({
        label,
        span: Object.freeze(
          identifierSpan(source, expression.node, label, "last") ??
            expression.node.span,
        ),
        type,
        receiverElided: true as const,
      })];
    })
    .sort((left, right) => left.span.start - right.span.start);
  return Object.freeze({
    imports: Object.freeze(imports),
    calls: Object.freeze(calls),
    foreignTypes: Object.freeze(foreignTypes),
  });
}

function displayGeneratedFfiName(name: string): string {
  const tokens = name.replace(/^__ffi_/, "").replace(/_\d+$/, "").split("_").filter(Boolean);
  for (let size = Math.floor(tokens.length / 2); size > 0; size--) {
    const left = tokens.slice(tokens.length - size * 2, tokens.length - size);
    const right = tokens.slice(tokens.length - size);
    if (left.join("\0") === right.join("\0")) return right.join("_");
  }
  return tokens.at(-1) ?? name;
}

function semanticJsTarget(
  target: Extract<Decl, { kind: "JsImportDecl" }>["target"],
): SemanticJsTarget {
  switch (target.kind) {
    case "JsGlobalRoot":
      return Object.freeze({ kind: "global-root" });
    case "JsGlobal":
      return Object.freeze({ kind: "global", path: target.path });
    case "JsMeta":
      return Object.freeze({ kind: "meta" });
    case "JsModule":
      return Object.freeze({ kind: "module", specifier: target.specifier });
    case "JsWorker":
      return Object.freeze({ kind: "worker", specifier: target.specifier });
    case "JsReceiver":
      return Object.freeze({ kind: "receiver", path: Object.freeze([...target.path]) });
    case "JsConstructor":
      return Object.freeze({ kind: "constructor", path: target.path });
  }
}

function semanticGpuFacts(
  moduleId: ModuleId,
  result: InferResult,
  selections: GpuFragmentSelectionFacts | undefined,
  normalizedSlices: readonly NormalizedGpuSlice[] | undefined,
  typeArena: SemanticTypeArena,
): SemanticGpuFacts {
  const operations = [...result.facts.gpuOperations.values()]
    .flatMap((operation) =>
      operation.occurrence.node
        ? [Object.freeze({
          kind: operation.kind,
          identity: operation.identity,
          span: Object.freeze({ ...operation.occurrence.node.span }),
          args: Object.freeze(operation.args.map((type) => typeArena.snapshot(type))),
          result: typeArena.snapshot(operation.result),
          rows: Object.freeze(
            operation.rows.map((row) =>
              Object.freeze({
                id: row.id,
                args: Object.freeze([...row.args]),
                result: row.result,
              })
            ),
          ),
          determiningArgs: Object.freeze([...operation.determiningArgs]),
        })]
        : []
    )
    .sort((left, right) => left.span.start - right.span.start);
  const builtins = [...result.facts.gpuBuiltins]
    .flatMap(([expression, name]) =>
      expression.node
        ? [Object.freeze({
          name,
          span: Object.freeze({ ...expression.node.span }),
        })]
        : []
    )
    .sort((left, right) => left.span.start - right.span.start);
  const resources = [...result.facts.gpuResourceCalls]
    .flatMap(([expression, resource]) =>
      expression.node
        ? [Object.freeze({
          ...resource,
          receiverType: typeArena.snapshot(resource.receiverType),
          span: Object.freeze({ ...expression.node.span }),
        })]
        : []
    )
    .sort((left, right) => left.span.start - right.span.start);
  const roots = (selections?.roots ?? [])
    .filter((root) => root.moduleId === moduleId && root.lambda.node)
    .map((root) =>
      Object.freeze({
        id: root.id,
        span: Object.freeze({ ...root.lambda.node!.span }),
        bindingId: root.bindingId,
        selectorIds: Object.freeze(root.selectors.map((selector) => selector.id)),
        factory: root.factory?.lambda.node
          ? Object.freeze({
            bindingId: root.factory.bindingId,
            span: Object.freeze({ ...root.factory.lambda.node.span }),
            parameter: root.factory.parameter.node
              ? Object.freeze({ ...root.factory.parameter.node.span })
              : undefined,
          })
          : undefined,
      })
    )
    .sort((left, right) => left.span.start - right.span.start);
  const selectors = (selections?.selectors ?? [])
    .filter((selector) =>
      selector.moduleId === moduleId && selector.call.node && selector.argument.node
    )
    .map((selector) =>
      Object.freeze({
        id: selector.id,
        rootId: selector.rootId,
        span: Object.freeze({ ...selector.call.node!.span }),
        argument: Object.freeze({ ...selector.argument.node!.span }),
        environmentArgument: selector.environmentArgument?.node
          ? Object.freeze({ ...selector.environmentArgument.node.span })
          : undefined,
      })
    )
    .sort((left, right) => left.span.start - right.span.start);
  const slices = (normalizedSlices ?? [])
    .filter((slice) => slice.root.moduleId === moduleId)
    .map((slice) =>
      Object.freeze({
        rootId: slice.root.id,
        selectorIds: Object.freeze(slice.selectors.map((selector) => selector.id)),
        input: immutableCopy(slice.input),
      })
    );
  return Object.freeze({
    operations: Object.freeze(operations),
    builtins: Object.freeze(builtins),
    resources: Object.freeze(resources),
    roots: Object.freeze(roots),
    selectors: Object.freeze(selectors),
    slices: Object.freeze(slices),
  });
}

function semanticTypedNodes(
  result: InferResult,
  bindings: BindingFacts,
  typeArena: SemanticTypeArena,
): readonly SemanticTypedNode[] {
  const nodes: SemanticTypedNode[] = [];
  for (const [expression, type] of result.types) {
    if (!expression.node) continue;
    const fact = result.facts.expressions.get(expression);
    const bindingId = expression.kind === "Var" ? bindings.references.get(expression) : undefined;
    nodes.push(Object.freeze({
      kind: "expression",
      label: semanticExpressionLabel(expression),
      span: Object.freeze({ ...expression.node.span }),
      type: semanticOccurrenceType(typeArena, fact?.instantiated ?? type)!,
      generalType: semanticOccurrenceType(typeArena, undefined, fact?.general),
      presentation: bindingId !== undefined && bindings.jsImportSourceBindings.has(bindingId)
        ? "generated-ffi-receiver"
        : undefined,
    }));
  }
  for (const [pattern, type] of result.facts.patternTypes) {
    if (!pattern.node) continue;
    const fact = result.facts.patterns.get(pattern);
    nodes.push(Object.freeze({
      kind: "pattern",
      label: semanticPatternLabel(pattern),
      span: Object.freeze({ ...pattern.node.span }),
      type: semanticOccurrenceType(
        typeArena,
        fact?.instantiated ?? type,
        fact?.general,
      )!,
    }));
  }
  for (const [expression, type] of result.facts.typeExpressions) {
    if (!expression.node) continue;
    nodes.push(Object.freeze({
      kind: "type-expression",
      label: semanticTypeExpressionLabel(expression),
      span: Object.freeze({ ...expression.node.span }),
      type: semanticOccurrenceType(typeArena, type)!,
    }));
  }
  return Object.freeze(
    nodes.sort((left, right) =>
      left.span.start - right.span.start ||
      left.span.end - right.span.end ||
      typedNodeKindOrder(left.kind) - typedNodeKindOrder(right.kind)
    ),
  );
}

function semanticExpectedTypes(
  result: InferResult,
  typeArena: SemanticTypeArena,
): readonly SemanticExpectedType[] {
  return Object.freeze(
    [...result.facts.expectedExpressions]
      .flatMap(([expression, type]) =>
        expression.node
          ? [Object.freeze({
            span: Object.freeze({ ...expression.node.span }),
            type: typeArena.snapshot(type),
          })]
          : []
      )
      .sort((left, right) =>
        left.span.start - right.span.start ||
        left.span.end - right.span.end
      ),
  );
}

function semanticInferredTypeHints(
  module: Module,
  source: string,
  result: InferResult,
  typedNodes: readonly SemanticTypedNode[],
): readonly SemanticInferredTypeHint[] {
  const hints: SemanticInferredTypeHint[] = [];
  const addPattern = (
    pattern: Pattern,
    kind: SemanticInferredTypeHint["kind"],
    suppress: boolean,
    includeVariables = false,
  ) => {
    if (!suppress && pattern.kind === "PVar" && pattern.node) {
      const typed = typedNodes.find((candidate) =>
        candidate.kind === "pattern" &&
        candidate.label === pattern.name &&
        sameSpan(candidate.span, pattern.node!.span)
      );
      const inferred = [...result.facts.patternTypes].find(([candidate]) =>
        candidate.kind === "PVar" &&
        candidate.name === pattern.name &&
        candidate.node !== undefined &&
        sameSpan(candidate.node.span, pattern.node!.span)
      )?.[1];
      const type = typed?.generalType ?? typed?.type;
      if (
        type &&
        (kind !== "parameter" || includeVariables ||
          (inferred !== undefined && prune(inferred).tag !== "var"))
      ) {
        const span = identifierSpan(source, pattern.node, pattern.name, "first");
        if (span) {
          hints.push(Object.freeze({
            kind,
            span: Object.freeze(span),
            type,
          }));
        }
      }
      return;
    }
    if (pattern.kind === "PTuple") {
      pattern.items.forEach((item) => addPattern(item, kind, suppress, includeVariables));
    } else if (pattern.kind === "PRecord") {
      pattern.fields.forEach((field) =>
        addPattern(field.pattern, kind, suppress, includeVariables)
      );
    } else if (pattern.kind === "PCtor") {
      pattern.args.forEach((argument) => addPattern(argument, kind, suppress, includeVariables));
    } else if (pattern.kind === "PAscribed") {
      addPattern(pattern.pattern, kind, true, includeVariables);
    }
  };
  const addDirectLambdaResult = (lambda: Extract<Expr, { kind: "Lambda" }>) => {
    if (
      !lambda.node || lambda.returnAnnotation != null ||
      lambda.trailingReturnAnnotation != null
    ) return;
    const typed = typedNodes.find((candidate) =>
      candidate.kind === "expression" && sameSpan(candidate.span, lambda.node!.span)
    );
    const end = lambdaParameterListEnd(source, lambda);
    if (!typed || end === undefined) return;
    const position = offsetToLineCol(source, end);
    hints.push(Object.freeze({
      kind: "result",
      span: Object.freeze({ ...position, start: end, end }),
      type: typed.type,
    }));
  };
  const visitDecl = (declaration: Decl) => {
    if (declaration.kind !== "LetDecl") return;
    for (const binding of declaration.bindings) {
      const obvious = binding.pattern.kind === "PVar" && obviousInferredType(binding.value);
      const directLambda = binding.pattern.kind === "PVar" && binding.value.kind === "Lambda";
      addPattern(
        binding.pattern,
        "binding",
        binding.annotation != null || obvious || directLambda,
      );
      if (
        binding.pattern.kind === "PVar" && binding.value.kind === "Lambda" &&
        binding.annotation == null
      ) {
        binding.value.params.forEach((parameter) =>
          addPattern(
            parameter.pattern,
            "parameter",
            parameter.annotation != null,
            true,
          )
        );
        addDirectLambdaResult(binding.value);
        visitExpr(binding.value.body);
      } else {
        visitExpr(binding.value, binding.annotation != null);
      }
    }
  };
  const visitExpr = (expression: Expr, suppressLambdaParams = false): void => {
    switch (expression.kind) {
      case "Tuple":
      case "JsonArray":
        expression.items.forEach((item) => visitExpr(item));
        return;
      case "Record":
      case "JsonObject":
        expression.fields.forEach((field) => visitExpr(field.value));
        return;
      case "FfiGet":
        visitExpr(expression.receiver);
        return;
      case "FfiCall":
        visitExpr(expression.receiver);
        expression.args.forEach((argument) => visitExpr(argument));
        return;
      case "FfiBindingCall":
        expression.args.forEach((argument) => visitExpr(argument));
        return;
      case "Lambda":
        expression.params.forEach((parameter) =>
          addPattern(
            parameter.pattern,
            "parameter",
            suppressLambdaParams || parameter.annotation != null,
          )
        );
        visitExpr(expression.body);
        return;
      case "Call":
        visitExpr(expression.callee);
        expression.args.forEach((argument) => visitExpr(argument));
        return;
      case "If":
        visitExpr(expression.cond);
        visitExpr(expression.thenExpr);
        visitExpr(expression.elseExpr);
        return;
      case "Match":
        visitExpr(expression.value);
        expression.arms.forEach((arm) => visitExpr(arm.body));
        return;
      case "Panic":
        visitExpr(expression.message);
        return;
      case "Block":
        expression.items.forEach((item) => isDecl(item) ? visitDecl(item) : visitExpr(item));
        visitExpr(expression.result);
        return;
      case "Ascribed":
        visitExpr(expression.value, true);
        return;
      case "Binary":
        visitExpr(expression.left);
        visitExpr(expression.right);
        return;
      case "Unary":
        visitExpr(expression.value);
        return;
      case "Pipe":
        visitExpr(expression.left);
        visitExpr(expression.right);
        return;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        return;
    }
  };
  module.decls.forEach(visitDecl);
  return Object.freeze(
    hints.sort((left, right) =>
      left.span.start - right.span.start ||
      left.span.end - right.span.end
    ),
  );
}

function obviousInferredType(expression: Expr): boolean {
  return expression.kind === "Int" || expression.kind === "Float" ||
    expression.kind === "String" || expression.kind === "Bool" ||
    expression.kind === "Void";
}

function lambdaParameterListEnd(
  source: string,
  lambda: Extract<Expr, { kind: "Lambda" }>,
): number | undefined {
  if (!lambda.node) return undefined;
  let start = lambda.node.span.start;
  while (/\s/.test(source[start] ?? "")) start++;
  if (source[start] !== "(") return undefined;
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let offset = start; offset < lambda.node.span.end; offset++) {
    const character = source[offset];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth++;
    else if (character === ")" && --depth === 0) return offset + 1;
  }
  return undefined;
}

type SemanticCallableParameterStages = readonly (readonly string[] | undefined)[];

function semanticCallableParameters(
  graph: ModuleGraph,
  bindings: ModuleMap<BindingFacts>,
): ReadonlyMap<BindingId, SemanticCallableParameterStages> {
  const callables = new Map<BindingId, SemanticCallableParameterStages>();
  for (const moduleId of graph.order) {
    const module = graph.nodes.get(moduleId)?.module;
    const moduleBindings = bindings.get(moduleId);
    if (!module || !moduleBindings) continue;
    const visitDecl = (declaration: Decl) => {
      if (declaration.kind === "RecordDecl") {
        const target = [...moduleBindings.recordConstructors].find(([candidate]) =>
          candidate.name === declaration.name &&
          candidate.node !== undefined &&
          declaration.node !== undefined &&
          sameSpan(candidate.node.span, declaration.node.span)
        )?.[1];
        if (target !== undefined) {
          callables.set(
            target,
            Object.freeze([
              Object.freeze(declaration.fields.map((field) => field.name)),
            ]),
          );
        }
        return;
      }
      if (declaration.kind !== "LetDecl") return;
      for (const binding of declaration.bindings) {
        if (
          binding.pattern.kind === "PVar" &&
          binding.pattern.node &&
          binding.value.kind === "Lambda"
        ) {
          const bindingName = binding.pattern.name;
          const id = [...moduleBindings.binders].find(([candidate]) =>
            candidate.kind === "PVar" &&
            candidate.name === bindingName &&
            candidate.node !== undefined &&
            sameSpan(candidate.node.span, binding.pattern.node!.span)
          )?.[1];
          const stages = callableParameterStages(binding.value);
          if (id !== undefined) callables.set(id, stages);
        }
        visitExpr(binding.value);
      }
    };
    const visitExpr = (expression: Expr): void => {
      switch (expression.kind) {
        case "Tuple":
        case "JsonArray":
          expression.items.forEach(visitExpr);
          return;
        case "Record":
        case "JsonObject":
          expression.fields.forEach((field) => visitExpr(field.value));
          return;
        case "FfiGet":
          visitExpr(expression.receiver);
          return;
        case "FfiCall":
          visitExpr(expression.receiver);
          expression.args.forEach(visitExpr);
          return;
        case "FfiBindingCall":
          expression.args.forEach(visitExpr);
          return;
        case "Lambda":
          visitExpr(expression.body);
          return;
        case "Call":
          visitExpr(expression.callee);
          expression.args.forEach(visitExpr);
          return;
        case "If":
          visitExpr(expression.cond);
          visitExpr(expression.thenExpr);
          visitExpr(expression.elseExpr);
          return;
        case "Match":
          visitExpr(expression.value);
          expression.arms.forEach((arm) => visitExpr(arm.body));
          return;
        case "Panic":
          visitExpr(expression.message);
          return;
        case "Block":
          expression.items.forEach((item) => isDecl(item) ? visitDecl(item) : visitExpr(item));
          visitExpr(expression.result);
          return;
        case "Ascribed":
          visitExpr(expression.value);
          return;
        case "Binary":
          visitExpr(expression.left);
          visitExpr(expression.right);
          return;
        case "Unary":
          visitExpr(expression.value);
          return;
        case "Pipe":
          visitExpr(expression.left);
          visitExpr(expression.right);
          return;
        case "Int":
        case "Float":
        case "String":
        case "Bool":
        case "Void":
        case "Var":
          return;
      }
    };
    module.decls.forEach(visitDecl);
  }
  return callables;
}

function callableParameterNames(
  lambda: Extract<Expr, { kind: "Lambda" }>,
): readonly string[] | undefined {
  if (!lambda.params.every((parameter) => parameter.pattern.kind === "PVar")) return;
  return Object.freeze(
    lambda.params.map((parameter) =>
      (parameter.pattern as Extract<Pattern, { kind: "PVar" }>).name
    ),
  );
}

function callableParameterStages(
  lambda: Extract<Expr, { kind: "Lambda" }>,
): SemanticCallableParameterStages {
  const stages: (readonly string[] | undefined)[] = [];
  let current: Expr = lambda;
  while (current.kind === "Lambda") {
    stages.push(callableParameterNames(current));
    current = lambdaResultExpression(current.body);
  }
  return Object.freeze(stages);
}

function semanticCallableDefinitions(
  bindings: BindingFacts,
  callables: ReadonlyMap<BindingId, SemanticCallableParameterStages>,
): readonly SemanticCallableDefinition[] {
  return Object.freeze(
    [
      ...[...bindings.binders].flatMap(([pattern, target]) => {
        const parameterStages = callables.get(target);
        return pattern.kind === "PVar" && parameterStages
          ? [Object.freeze({
            name: pattern.name,
            target,
            parameterStages,
          })]
          : [];
      }),
      ...[...bindings.recordConstructors].flatMap(([declaration, target]) => {
        const parameterStages = callables.get(target);
        return parameterStages
          ? [Object.freeze({
            name: declaration.name,
            target,
            parameterStages,
          })]
          : [];
      }),
    ]
      .sort((left, right) => left.name.localeCompare(right.name) || left.target - right.target),
  );
}

function lambdaResultExpression(expression: Expr): Expr {
  return expression.kind === "Block" ? lambdaResultExpression(expression.result) : expression;
}

function semanticParameterHints(
  result: InferResult,
  bindings: BindingFacts,
  callables: ReadonlyMap<BindingId, SemanticCallableParameterStages>,
): readonly SemanticParameterHint[] {
  const hints: SemanticParameterHint[] = [];
  for (const [expression] of result.types) {
    if (expression.kind !== "Call") continue;
    const names = parameterNamesForCallee(expression.callee, bindings, callables);
    if (!names || names.length !== expression.args.length) continue;
    expression.args.forEach((argument, index) => {
      if (!argument.node || argumentUsesParameterName(argument, names[index])) return;
      hints.push(Object.freeze({
        name: names[index],
        span: Object.freeze({ ...argument.node.span }),
      }));
    });
  }
  return Object.freeze(
    hints.sort((left, right) =>
      left.span.start - right.span.start ||
      left.span.end - right.span.end
    ),
  );
}

function semanticCallSites(
  source: string,
  result: InferResult,
  bindings: BindingFacts,
  callables: ReadonlyMap<BindingId, SemanticCallableParameterStages>,
  typeArena: SemanticTypeArena,
): readonly SemanticCallSite[] {
  const sites: SemanticCallSite[] = [];
  for (const [expression] of result.types) {
    if (expression.kind === "Call") {
      addSemanticCallSite(
        sites,
        expression,
        expression.callee,
        expression.args,
        0,
        source,
        result,
        bindings,
        callables,
        typeArena,
      );
    } else if (
      expression.kind === "Pipe" &&
      expression.right.kind === "Call"
    ) {
      addSemanticCallSite(
        sites,
        expression.right,
        expression.right.callee,
        expression.right.args,
        1,
        source,
        result,
        bindings,
        callables,
        typeArena,
      );
    }
  }
  const seen = new Set<string>();
  return Object.freeze(
    sites
      .sort((left, right) =>
        left.span.start - right.span.start ||
        left.span.end - right.span.end
      )
      .filter((site) => {
        const key = `${site.span.start}:${site.span.end}:${site.activationStart}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  );
}

function addSemanticCallSite(
  sites: SemanticCallSite[],
  call: Expr,
  callee: Expr,
  args: readonly Expr[],
  implicitParameters: number,
  source: string,
  result: InferResult,
  bindings: BindingFacts,
  callables: ReadonlyMap<BindingId, SemanticCallableParameterStages>,
  typeArena: SemanticTypeArena,
): void {
  if (!call.node || !callee.node || args.some((argument) => !argument.node)) return;
  const calleeFact = result.facts.expressions.get(callee);
  const inferredCallee = calleeFact?.instantiated ?? result.types.get(callee);
  if (!inferredCallee) return;
  const calleeType = prune(inferredCallee);
  if (calleeType.tag !== "fn") return;
  const arity = args.length + implicitParameters;
  const parameterTypes = callParameterTypes(calleeType, arity);
  if (!parameterTypes || parameterTypes.length !== arity) return;
  const names = parameterNamesForCallee(callee, bindings, callables);
  const bounds = callSyntaxBounds(source, call, args);
  if (!bounds) return;
  sites.push(Object.freeze({
    span: Object.freeze({ ...call.node.span, end: bounds.end }),
    activationStart: bounds.activationStart,
    callee: semanticCalleeLabel(callee),
    parameters: Object.freeze(
      parameterTypes.map((type, index) =>
        Object.freeze({
          name: names?.length === arity ? names[index] : undefined,
          type: typeArena.snapshot(type),
        })
      ),
    ),
    result: typeArena.snapshot(calleeType.result),
    arguments: Object.freeze(
      args.map((argument) => Object.freeze({ ...argument.node!.span })),
    ),
    implicitParameters,
  }));
}

function callSyntaxBounds(
  source: string,
  call: Expr,
  args: readonly Expr[],
): Readonly<{ activationStart: number; end: number }> | undefined {
  if (!call.node || args.length === 0 || !args[0].node || !args.at(-1)?.node) return;
  const before = args[0].node.span.start;
  const open = source.lastIndexOf("(", before);
  if (
    open >= call.node.span.start &&
    open < before &&
    source.slice(open + 1, before).trim().length === 0
  ) {
    return Object.freeze({
      activationStart: open + 1,
      end: matchingCallEnd(source, open) ?? call.node.span.end,
    });
  }
  return Object.freeze({
    activationStart: before,
    end: args.at(-1)!.node!.span.end,
  });
}

function matchingCallEnd(source: string, open: number): number | undefined {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return index + 1;
  }
  return undefined;
}

function semanticCalleeLabel(callee: Expr): string {
  if (callee.kind === "Call") return semanticCalleeLabel(callee.callee);
  return callee.kind === "Lambda" ? "<lambda>" : semanticExpressionLabel(callee);
}

function callParameterTypes(
  callee: Extract<Ty, { tag: "fn" }>,
  arity: number,
): readonly Ty[] | undefined {
  if (callee.params.length === arity) return callee.params;
  if (callee.params.length !== 1) return;
  const parameter = prune(callee.params[0]);
  if (arity > 1 && parameter.tag === "tuple" && parameter.items.length === arity) {
    return parameter.items;
  }
  return arity === 1 ? [callee.params[0]] : undefined;
}

function parameterNamesForCallee(
  callee: Expr,
  bindings: BindingFacts,
  callables: ReadonlyMap<BindingId, SemanticCallableParameterStages>,
): readonly string[] | undefined {
  let stage = 0;
  let root = callee;
  while (root.kind === "Call") {
    stage++;
    root = root.callee;
  }
  if (root.kind === "Lambda") return callableParameterStages(root)[stage];
  if (root.kind !== "Var") return;
  const id = bindings.references.get(root);
  return id === undefined ? undefined : callables.get(id)?.[stage];
}

function semanticParameterTargets(
  module: Module,
  bindings: BindingFacts,
): ReadonlySet<BindingId> {
  const targets = new Set<BindingId>();
  const addPattern = (pattern: Pattern): void => {
    if (pattern.kind === "PVar") {
      const target = bindings.binders.get(pattern);
      if (target !== undefined) targets.add(target);
      return;
    }
    if (pattern.kind === "PTuple") {
      pattern.items.forEach(addPattern);
    } else if (pattern.kind === "PRecord") {
      pattern.fields.forEach((field) => addPattern(field.pattern));
    } else if (pattern.kind === "PCtor") {
      pattern.args.forEach(addPattern);
    } else if (pattern.kind === "PAscribed") {
      addPattern(pattern.pattern);
    }
  };
  const visitDeclaration = (declaration: Decl): void => {
    if (declaration.kind !== "LetDecl") return;
    declaration.bindings.forEach((binding) => visitExpression(binding.value));
  };
  const visitExpression = (expression: Expr): void => {
    switch (expression.kind) {
      case "Tuple":
      case "JsonArray":
        expression.items.forEach(visitExpression);
        return;
      case "Record":
      case "JsonObject":
        expression.fields.forEach((field) => visitExpression(field.value));
        return;
      case "FfiGet":
        visitExpression(expression.receiver);
        return;
      case "FfiCall":
        visitExpression(expression.receiver);
        expression.args.forEach(visitExpression);
        return;
      case "FfiBindingCall":
        expression.args.forEach(visitExpression);
        return;
      case "Lambda":
        expression.params.forEach((parameter) => addPattern(parameter.pattern));
        visitExpression(expression.body);
        return;
      case "Call":
        visitExpression(expression.callee);
        expression.args.forEach(visitExpression);
        return;
      case "If":
        visitExpression(expression.cond);
        visitExpression(expression.thenExpr);
        visitExpression(expression.elseExpr);
        return;
      case "Match":
        visitExpression(expression.value);
        expression.arms.forEach((arm) => visitExpression(arm.body));
        return;
      case "Panic":
        visitExpression(expression.message);
        return;
      case "Block":
        expression.items.forEach((item) =>
          isDecl(item) ? visitDeclaration(item) : visitExpression(item)
        );
        visitExpression(expression.result);
        return;
      case "Ascribed":
        visitExpression(expression.value);
        return;
      case "Binary":
        visitExpression(expression.left);
        visitExpression(expression.right);
        return;
      case "Unary":
        visitExpression(expression.value);
        return;
      case "Pipe":
        visitExpression(expression.left);
        visitExpression(expression.right);
        return;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        return;
    }
  };
  module.decls.forEach(visitDeclaration);
  return targets;
}

function semanticTokenFacts(
  occurrences: readonly ModuleSemanticOccurrence[],
  semanticTypes: readonly SemanticType[],
  parameterTargets: ReadonlySet<BindingId>,
): readonly SemanticTokenFact[] {
  const candidates = occurrences
    .filter((occurrence) => occurrence.role !== "import-path")
    .map((occurrence) => {
      const kind = semanticTokenKind(occurrence, semanticTypes, parameterTargets);
      return Object.freeze({
        span: occurrence.span,
        kind,
        modifiers: Object.freeze(
          occurrence.role === "declaration" || occurrence.role === "import-alias"
            ? ["declaration" as const]
            : [],
        ),
      });
    }).sort((left, right) =>
      left.span.start - right.span.start ||
      left.span.end - right.span.end ||
      semanticTokenKindOrder(left.kind) - semanticTokenKindOrder(right.kind)
    );
  const tokens: SemanticTokenFact[] = [];
  for (const candidate of candidates) {
    const previous = tokens.at(-1);
    if (
      previous &&
      candidate.span.start === previous.span.start &&
      candidate.span.end === previous.span.end
    ) continue;
    if (previous && candidate.span.start < previous.span.end) continue;
    tokens.push(candidate);
  }
  return Object.freeze(tokens);
}

function semanticTokenKind(
  occurrence: ModuleSemanticOccurrence,
  semanticTypes: readonly SemanticType[],
  parameterTargets: ReadonlySet<BindingId>,
): SemanticTokenFact["kind"] {
  switch (occurrence.target.kind) {
    case "structure":
    case "module":
      return "namespace";
    case "type":
      return "type";
    case "type-variable":
      return "type-parameter";
    case "field":
      return "property";
    case "constructor":
      return "constructor";
    case "value": {
      if (parameterTargets.has(occurrence.target.id as BindingId)) return "parameter";
      const type = occurrence.inferredType === undefined
        ? undefined
        : semanticTypes[occurrence.inferredType.id];
      return type?.shape.kind === "function" ? "function" : "variable";
    }
  }
}

function semanticTokenKindOrder(kind: SemanticTokenFact["kind"]): number {
  return kind === "type"
    ? 0
    : kind === "type-parameter"
    ? 1
    : kind === "constructor"
    ? 2
    : kind === "function"
    ? 3
    : kind === "parameter"
    ? 4
    : kind === "property"
    ? 5
    : kind === "namespace"
    ? 6
    : 7;
}

function argumentUsesParameterName(argument: Expr, parameter: string): boolean {
  if (argument.kind !== "Var") return false;
  const spelling = argument.sourceName ?? argument.name;
  return !isQualified(parseLongId(spelling)) && spelling === parameter;
}

function semanticExpressionLabel(expression: Expr): string {
  return expression.kind === "Var" ? expression.sourceName ?? expression.name : expression.kind;
}

function semanticPatternLabel(pattern: Pattern): string {
  return pattern.kind === "PVar" || pattern.kind === "PPinned" ? pattern.name : pattern.kind;
}

function semanticTypeExpressionLabel(expression: import("./ast.ts").TypeExpr): string {
  return expression.kind === "TName" ? expression.name : expression.kind;
}

function semanticCarrierOperations(
  result: InferResult,
  typeArena: SemanticTypeArena,
): readonly SemanticCarrierOperation[] {
  return Object.freeze(
    [...result.facts.primitiveCarriers.values()]
      .flatMap((plan) =>
        plan.occurrence.node
          ? [Object.freeze({
            carrier: plan.carrier,
            span: Object.freeze({ ...plan.occurrence.node.span }),
            operands: Object.freeze([...plan.operands]),
            errorType: typeArena.snapshot(plan.error),
            payloadResultType: typeArena.snapshot(plan.payloadResult),
          })]
          : []
      )
      .sort((left, right) => left.span.start - right.span.start),
  );
}

function annotateDeclarationOwnership(
  occurrences: readonly ModuleSemanticOccurrence[],
  moduleId: ModuleId,
  bindings: BindingFacts,
  nominalFacts: NominalFacts,
): ModuleSemanticOccurrence[] {
  const publicTargets = new Set<string>();
  for (const id of bindings.exports.values()) {
    publicTargets.add(semanticTargetKey({ kind: "value", id }));
  }
  for (const fact of nominalFacts.types) {
    if (fact.moduleId === moduleId && fact.exported) {
      publicTargets.add(semanticTargetKey({ kind: "type", id: fact.id }));
    }
  }
  for (const fact of nominalFacts.constructors) {
    if (fact.moduleId === moduleId && fact.exported) {
      publicTargets.add(semanticTargetKey({ kind: "constructor", id: fact.id }));
    }
  }
  for (const fact of nominalFacts.fields) {
    if (fact.moduleId === moduleId && fact.exported) {
      publicTargets.add(semanticTargetKey({ kind: "field", id: fact.id }));
    }
  }
  const localStructures = new Set<StructureSemanticId>([
    ...bindings.structureBinders.values(),
    ...bindings.jsStructureBinders.values(),
  ]);
  return occurrences.map((occurrence) => {
    const localAlias = occurrence.role === "import-alias" &&
      ((occurrence.target.kind === "value" &&
        typeof occurrence.target.id === "number" &&
        bindings.local.has(occurrence.target.id)) ||
        (occurrence.target.kind === "structure" &&
          localStructures.has(occurrence.target.id)));
    if (occurrence.role !== "declaration" && !localAlias) return occurrence;
    const key = semanticTargetKey(occurrence.target);
    return Object.freeze({
      ...occurrence,
      declaration: Object.freeze({
        moduleId,
        visibility: publicTargets.has(key) ? "public" : "private",
      }),
    });
  });
}

function semanticTargetKey(target: SemanticOccurrenceTarget): string {
  return `${target.kind}:${String(target.id)}`;
}

/** Snapshot-local conservative invalidation: a change invalidates the module and every importer. */
export function dependentInterfaceClosure(
  interfaces: ReadonlyMap<ModuleId, ModuleInterface>,
  changed: Iterable<ModuleId>,
): ReadonlySet<ModuleId> {
  const invalid = new Set<ModuleId>(changed);
  const pending = [...invalid];
  while (pending.length > 0) {
    const id = pending.pop()!;
    for (const dependent of interfaces.get(id)?.reverseDependencies ?? []) {
      if (invalid.has(dependent)) continue;
      invalid.add(dependent);
      pending.push(dependent);
    }
  }
  return invalid;
}

export function semanticOccurrenceAt(
  moduleInterface: ModuleInterface,
  offset: number,
): ModuleSemanticOccurrence | undefined {
  return semanticOccurrencesAt(moduleInterface, offset)[0];
}

export function semanticOccurrencesAt(
  moduleInterface: ModuleInterface,
  offset: number,
): readonly ModuleSemanticOccurrence[] {
  return moduleInterface.occurrences
    .filter((item) => item.span.start <= offset && offset < item.span.end)
    .sort((left, right) =>
      (left.span.end - left.span.start) - (right.span.end - right.span.start) ||
      occurrenceRoleOrder(left.role) - occurrenceRoleOrder(right.role)
    );
}

export function semanticOccurrencesForTarget(
  project: ProjectSnapshot,
  target: SemanticOccurrenceTarget,
): readonly ProjectSemanticOccurrence[] {
  const occurrences: ProjectSemanticOccurrence[] = [];
  for (const [moduleId, moduleInterface] of project.interfaces) {
    for (const occurrence of moduleInterface.occurrences) {
      if (occurrence.target.kind !== target.kind || occurrence.target.id !== target.id) continue;
      occurrences.push(Object.freeze({ moduleId, occurrence }));
    }
  }
  return Object.freeze(occurrences);
}

/**
 * Select a safe, project-local rename group. Import aliases retain their target semantic identity,
 * so their occurrence role and local spelling distinguish alias-only rename from target rename.
 */
export function semanticRenameAt(
  project: ProjectSnapshot,
  moduleId: ModuleId,
  offset: number,
): SemanticRenamePlan | undefined {
  const moduleInterface = project.interfaces.get(moduleId);
  if (!moduleInterface || !renameSnapshotIsComplete(project)) return;
  const selection = semanticOccurrenceSelectionAt(moduleInterface, offset);
  if (!selection || selection.targets.some(({ kind }) => kind === "module")) return;
  const { primary, targets: selectedTargets, localAlias } = selection;
  if (
    selectedTargets.some(({ kind }) => kind === "field") &&
    moduleInterface.diagnostics.some((diagnostic) =>
      diagnostic.code === "record.ambiguous-projection" &&
      diagnostic.primary.kind === "source" &&
      spansOverlap(diagnostic.primary.span, primary.span)
    )
  ) return;

  if (localAlias) {
    const occurrences = moduleInterface.occurrences
      .filter((occurrence) =>
        selectedTargets.some((target) => sameSemanticTarget(target, occurrence.target)) &&
        occurrence.name === primary.name &&
        (occurrence.role === "import-alias" ||
          occurrence.role === "reference" ||
          occurrence.role === "qualifier")
      )
      .map((occurrence) => Object.freeze({ moduleId, occurrence }));
    return occurrences.length === 0 ? undefined : Object.freeze({
      kind: "local-import-alias",
      placeholder: primary.name,
      selection: primary.span,
      occurrences: freezeDistinctProjectOccurrences(occurrences),
    });
  }

  const occurrences: ProjectSemanticOccurrence[] = [];
  for (const [ownerId, owner] of project.interfaces) {
    for (const occurrence of owner.occurrences) {
      if (!selectedTargets.some((target) => sameSemanticTarget(target, occurrence.target))) {
        continue;
      }
      if (occurrence.name !== primary.name || occurrence.role === "import-alias") continue;
      occurrences.push(Object.freeze({ moduleId: ownerId, occurrence }));
    }
  }
  if (
    occurrences.length === 0 ||
    !occurrences.some(({ occurrence }) => occurrence.declaration !== undefined)
  ) return;
  return Object.freeze({
    kind: "target",
    placeholder: primary.name,
    selection: primary.span,
    occurrences: freezeDistinctProjectOccurrences(occurrences),
  });
}

/** Select identity-correct read/write highlights within one module interface. */
export function semanticDocumentHighlightsAt(
  moduleInterface: ModuleInterface,
  offset: number,
): readonly SemanticDocumentHighlight[] {
  const selection = semanticOccurrenceSelectionAt(moduleInterface, offset);
  if (!selection) return [];
  const occurrences = moduleInterface.occurrences.filter((occurrence) =>
    selection.targets.some((target) => sameSemanticTarget(target, occurrence.target)) &&
    (!selection.localAlias ||
      (occurrence.name === selection.primary.name &&
        (occurrence.role === "import-alias" ||
          occurrence.role === "reference" ||
          occurrence.role === "qualifier")))
  );
  const distinct = freezeDistinctProjectOccurrences(
    occurrences.map((occurrence) =>
      Object.freeze({ moduleId: moduleInterface.moduleId, occurrence })
    ),
  );
  return Object.freeze(distinct.map(({ occurrence }) =>
    Object.freeze({
      occurrence,
      access: occurrence.role === "declaration" || occurrence.role === "import-alias"
        ? "write"
        : "read",
    })
  ));
}

type SemanticOccurrenceSelection = Readonly<{
  primary: ModuleSemanticOccurrence;
  targets: readonly SemanticOccurrenceTarget[];
  localAlias: boolean;
}>;

function semanticOccurrenceSelectionAt(
  moduleInterface: ModuleInterface,
  offset: number,
): SemanticOccurrenceSelection | undefined {
  const selected = semanticOccurrencesAt(moduleInterface, offset);
  if (selected.length === 0) return;
  const primary = selected[0];
  const targets = selected
    .filter((occurrence) =>
      occurrence.name === primary.name && sameSpan(occurrence.span, primary.span)
    )
    .map((occurrence) => occurrence.target);
  const matchingAliases = moduleInterface.occurrences.filter((occurrence) =>
    occurrence.role === "import-alias" &&
    occurrence.name === primary.name &&
    targets.some((target) => sameSemanticTarget(target, occurrence.target))
  );
  const localAlias = primary.role === "import-alias" ||
    ((primary.role === "reference" || primary.role === "qualifier") &&
      matchingAliases.length > 0);
  if (!localAlias) return Object.freeze({ primary, targets: Object.freeze(targets), localAlias });
  const aliasTargets = matchingAliases.flatMap((alias) =>
    moduleInterface.occurrences
      .filter((occurrence) =>
        occurrence.role === "import-alias" &&
        occurrence.name === alias.name &&
        sameSpan(occurrence.span, alias.span)
      )
      .map((occurrence) => occurrence.target)
  );
  return Object.freeze({
    primary,
    targets: Object.freeze(aliasTargets),
    localAlias,
  });
}

export function semanticRenameNameIsValid(plan: SemanticRenamePlan, name: string): boolean {
  if (workmanKeywords.has(name)) return false;
  return /^[A-Z]/.test(plan.placeholder)
    ? /^[A-Z][A-Za-z0-9_]*$/.test(name)
    : /^[a-z_][A-Za-z0-9_]*$/.test(name);
}

const workmanKeywords = new Set([
  "from",
  "import",
  "as",
  "let",
  "rec",
  "and",
  "type",
  "record",
  "if",
  "else",
  "match",
  "true",
  "false",
  "void",
]);

function renameSnapshotIsComplete(project: ProjectSnapshot): boolean {
  return [...project.interfaces.values()].every(({ completeness }) =>
    completeness.syntax === "complete" &&
    completeness.imports === "complete" &&
    completeness.elaboration === "complete"
  );
}

function freezeDistinctProjectOccurrences(
  occurrences: readonly ProjectSemanticOccurrence[],
): readonly ProjectSemanticOccurrence[] {
  const seen = new Map<ModuleId, Set<string>>();
  return Object.freeze(occurrences.filter(({ moduleId, occurrence }) => {
    const spans = seen.get(moduleId) ?? new Set<string>();
    const key = `${occurrence.span.start}:${occurrence.span.end}`;
    if (spans.has(key)) return false;
    spans.add(key);
    seen.set(moduleId, spans);
    return true;
  }));
}

function sameSemanticTarget(
  left: SemanticOccurrenceTarget,
  right: SemanticOccurrenceTarget,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function spansOverlap(left: SourceSpan, right: SourceSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

export type SemanticSourceLocation = Readonly<{
  moduleId: ModuleId;
  path: string;
  span: SourceSpan;
  occurrence?: ModuleSemanticOccurrence;
}>;

export function semanticDefinitionsForTarget(
  project: ProjectSnapshot,
  target: SemanticOccurrenceTarget,
): readonly SemanticSourceLocation[] {
  if (target.kind === "module") {
    const moduleInterface = project.interfaces.get(target.id);
    return moduleInterface
      ? [Object.freeze({
        moduleId: target.id,
        path: moduleInterface.path,
        span: moduleInterface.sourceSpan,
      })]
      : [];
  }
  if (target.kind === "structure") {
    for (const moduleInterface of project.interfaces.values()) {
      const imported = moduleInterface.imports.find((item) =>
        item.structureAlias?.id === target.id
      );
      if (!imported) continue;
      const targetInterface = project.interfaces.get(imported.target);
      if (!targetInterface) return [];
      return [Object.freeze({
        moduleId: imported.target,
        path: targetInterface.path,
        span: targetInterface.sourceSpan,
      })];
    }
  }
  return Object.freeze(
    semanticOccurrencesForTarget(project, target)
      .filter(({ occurrence }) => occurrence.declaration !== undefined)
      .map(({ moduleId, occurrence }) => {
        const moduleInterface = project.interfaces.get(moduleId)!;
        return Object.freeze({
          moduleId,
          path: moduleInterface.path,
          span: occurrence.span,
          occurrence,
        });
      }),
  );
}

export function semanticDefinitionsAt(
  project: ProjectSnapshot,
  moduleId: ModuleId,
  offset: number,
): readonly SemanticSourceLocation[] {
  const moduleInterface = project.interfaces.get(moduleId);
  if (!moduleInterface) return [];
  const occurrence = semanticOccurrenceAt(moduleInterface, offset);
  return occurrence ? semanticDefinitionsForTarget(project, occurrence.target) : [];
}

/** Resolve the nominal declarations named by the selected occurrence's compiler-owned type. */
export function semanticTypeDefinitionsAt(
  project: ProjectSnapshot,
  moduleId: ModuleId,
  offset: number,
): readonly SemanticSourceLocation[] {
  const moduleInterface = project.interfaces.get(moduleId);
  if (!moduleInterface) return [];
  const selected = semanticOccurrencesAt(moduleInterface, offset);
  const directTypes = selected
    .filter((occurrence) => occurrence.target.kind === "type")
    .map((occurrence) => occurrence.target as Extract<SemanticOccurrenceTarget, { kind: "type" }>);
  const typeNames = directTypes.length > 0
    ? directTypes.map(({ id }) => id)
    : semanticTypeNameIdsAt(moduleInterface, selected, offset);
  const locations = typeNames.flatMap((id) =>
    semanticDefinitionsForTarget(project, { kind: "type", id })
  );
  const seen = new Map<ModuleId, Set<string>>();
  return Object.freeze(locations.filter((location) => {
    const spans = seen.get(location.moduleId) ?? new Set<string>();
    const key = `${location.span.start}:${location.span.end}`;
    if (spans.has(key)) return false;
    spans.add(key);
    seen.set(location.moduleId, spans);
    return true;
  }));
}

function semanticTypeNameIdsAt(
  moduleInterface: ModuleInterface,
  occurrences: readonly ModuleSemanticOccurrence[],
  offset: number,
): readonly TypeNameId[] {
  const roots = occurrences.flatMap((occurrence) =>
    occurrence.inferredType ? [occurrence.inferredType.id] : []
  );
  if (roots.length === 0) {
    const node = semanticTypedNodeAt(moduleInterface, offset);
    if (node) roots.push(node.type.id);
  }
  const names: TypeNameId[] = [];
  const seenTypes = new Set<SemanticTypeId>();
  const seenNames = new Set<TypeNameId>();
  const visit = (id: SemanticTypeId) => {
    if (seenTypes.has(id)) return;
    seenTypes.add(id);
    const shape = moduleInterface.semanticTypes[id]?.shape;
    if (!shape) return;
    switch (shape.kind) {
      case "named":
        if (shape.typeNameId !== undefined && !seenNames.has(shape.typeNameId)) {
          seenNames.add(shape.typeNameId);
          names.push(shape.typeNameId);
        }
        shape.args.forEach(visit);
        return;
      case "function":
        shape.params.forEach(visit);
        visit(shape.result);
        return;
      case "tuple":
        shape.items.forEach(visit);
        return;
      case "structural-record":
        shape.fields.forEach((field) => visit(field.type));
        return;
      default:
        return;
    }
  };
  roots.forEach(visit);
  return names;
}

export function semanticScopeAt(
  moduleInterface: ModuleInterface,
  offset: number,
): SemanticScope {
  const containers = moduleInterface.scopes.checkpoints.map((checkpoint) => checkpoint.container);
  const node = moduleInterface.scopes.nodes
    .filter(({ span }) =>
      !containers.some((container) => sameSpan(container, span)) &&
      span.start <= offset &&
      offset < span.end
    )
    .sort((left, right) =>
      (left.span.end - left.span.start) - (right.span.end - right.span.start) ||
      right.span.start - left.span.start
    )[0];
  const checkpoint = moduleInterface.scopes.checkpoints
    .filter(({ container, offset: checkpointOffset }) =>
      container.start <= offset &&
      offset < container.end &&
      checkpointOffset <= offset
    )
    .sort((left, right) =>
      (left.container.end - left.container.start) -
        (right.container.end - right.container.start) ||
      right.offset - left.offset
    )[0];
  const nodeWidth = node ? node.span.end - node.span.start : Number.POSITIVE_INFINITY;
  const checkpointWidth = checkpoint
    ? checkpoint.container.end - checkpoint.container.start
    : Number.POSITIVE_INFINITY;
  const trailing = !node && !checkpoint
    ? outermostTrailingSemanticCheckpoint(moduleInterface.scopes.checkpoints, offset)
    : undefined;
  const base = checkpointWidth <= nodeWidth
    ? checkpoint?.scope ?? trailing?.scope ?? moduleInterface.scopes.initial
    : node?.scope ?? trailing?.scope ?? moduleInterface.scopes.initial;
  const active = moduleInterface.typeVariables
    .filter(({ scope }) => scope.start <= offset && offset < scope.end)
    .sort((left, right) =>
      (right.scope.end - right.scope.start) - (left.scope.end - left.scope.start) ||
      left.scope.start - right.scope.start
    );
  if (active.length === 0) return base;
  const typeVariables = new Map(base.typeVariables);
  for (const variable of active) typeVariables.set(variable.name, variable.id);
  return freezeSemanticScope(
    new Map(base.values),
    new Map(base.structures),
    new Map(base.types),
    typeVariables,
  );
}

/**
 * Preserve current-source lexical names for completion even when elaboration transactionally
 * removes the containing phrase. These facts intentionally carry no semantic identities.
 */
export function semanticCompletionFacts(
  module: Module,
  bindings: BindingFacts,
): SemanticCompletionFacts {
  const names = (scope: BindingScopeSnapshot): SemanticCompletionScopeNames =>
    Object.freeze({
      values: sortedNames(scope.values),
      structures: sortedNames(scope.structures),
      types: sortedNames(scope.types),
      constructors: sortedNames(scope.constructors),
    });
  return Object.freeze({
    gpuRegions: Object.freeze(
      discoverGpuRegions(module)
        .flatMap(({ lambda }) => lambda.node ? [Object.freeze({ ...lambda.node.span })] : [])
        .sort((left, right) => left.start - right.start),
    ),
    scopes: Object.freeze({
      nodes: Object.freeze(
        [...bindings.scopeNodes].map(([node, scope]) =>
          Object.freeze({
            span: Object.freeze({ ...node.span }),
            names: names(scope),
          })
        ),
      ),
      checkpoints: Object.freeze(
        bindings.scopeCheckpoints.map((checkpoint) =>
          Object.freeze({
            container: Object.freeze({ ...checkpoint.container.span }),
            offset: checkpoint.offset,
            names: names(checkpoint.scope),
          })
        ),
      ),
    }),
  });
}

function sortedNames(values: ReadonlyMap<string, unknown>): readonly string[] {
  return Object.freeze([...values.keys()].sort((left, right) => left.localeCompare(right)));
}

/** Compiler-owned, protocol-neutral completion query for contextual GPU builtins. */
export function semanticGpuBuiltinCompletionsAt(
  moduleInterface: ModuleInterface,
  offset: number,
  prefix: string,
): readonly SemanticCompletionCandidate[] {
  if (
    !moduleInterface.completionFacts.gpuRegions.some((span) =>
      span.start <= offset && offset <= span.end
    )
  ) return [];
  const shadowed = new Set(completionScopeNamesAt(moduleInterface.completionFacts, offset).values);
  const candidates = new Map<
    string,
    NonNullable<SemanticCompletionCandidate["overloads"]>[number][]
  >();
  for (const overload of WMSLANG_BUILTIN_OVERLOADS) {
    if (shadowed.has(overload.name) || !overload.name.startsWith(prefix)) continue;
    const family = candidates.get(overload.name) ?? [];
    family.push(Object.freeze({
      params: Object.freeze([...overload.params]),
      result: overload.result,
    }));
    candidates.set(overload.name, family);
  }
  return Object.freeze(
    [...candidates]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, overloads]) =>
        Object.freeze({
          name,
          kind: "gpu-builtin",
          origin: "gpu",
          rank: 40,
          overloads: Object.freeze(overloads),
        })
      ),
  );
}

/** Compiler-owned general completion query over one current project snapshot. */
export function semanticCompletionsAt(
  project: ProjectSnapshot,
  moduleId: ModuleId,
  source: string,
  offset: number,
): SemanticCompletionResult {
  const moduleInterface = project.interfaces.get(moduleId);
  if (!moduleInterface) return Object.freeze({ prefix: "", candidates: Object.freeze([]) });
  const context = completionContext(source, offset);
  const scope = semanticScopeAt(moduleInterface, offset);
  const recovery = completionScopeNamesAt(moduleInterface.completionFacts, offset);
  let candidates: SemanticCompletionCandidate[];

  if (context.qualifier) {
    const structure = scope.structures.get(context.qualifier);
    candidates = structure !== undefined
      ? namespaceCompletionCandidates(project, moduleInterface, structure)
      : recordCompletionCandidates(project, scope, context.qualifier);
  } else if (context.typePosition) {
    candidates = [
      ...[...scope.types].map(([name, id]) => {
        const target = Object.freeze({ kind: "type" as const, id });
        return completionCandidate(
          name,
          "type",
          "lexical",
          completionLexicalMetadata(moduleInterface, target, offset),
          completionTypeForTarget(project, target),
        );
      }),
      ...[...scope.typeVariables].map(([name, id]) =>
        completionCandidate(
          name,
          "type",
          "lexical",
          completionTypeVariableMetadata(moduleInterface, id, offset),
        )
      ),
      ...recovery.types
        .filter((name) => !scope.types.has(name))
        .map((name) => completionCandidate(name, "type", "recovery", 30)),
    ];
  } else {
    candidates = [
      ...[...scope.values].map(([name, target]) =>
        completionCandidate(
          name,
          target.kind,
          "lexical",
          completionLexicalMetadata(moduleInterface, target, offset),
          completionTypeForTarget(project, target),
        )
      ),
      ...[...scope.structures].map(([name, id]) => {
        const target = Object.freeze({ kind: "structure" as const, id });
        return completionCandidate(
          name,
          "structure",
          "lexical",
          completionLexicalMetadata(moduleInterface, target, offset),
        );
      }),
      ...recovery.values
        .filter((name) => !scope.values.has(name))
        .map((name) => completionCandidate(name, "value", "recovery", 30)),
      ...recovery.constructors
        .filter((name) => !scope.values.has(name))
        .map((name) => completionCandidate(name, "constructor", "recovery", 30)),
      ...recovery.structures
        .filter((name) => !scope.structures.has(name))
        .map((name) => completionCandidate(name, "structure", "recovery", 30)),
      ...workmanCompletionKeywords.map((name) =>
        completionCandidate(name, "keyword", "keyword", 80)
      ),
      ...semanticGpuBuiltinCompletionsAt(moduleInterface, offset, context.prefix),
    ];
  }

  const expectedType = expectedCompletionTypeAt(moduleInterface, offset);
  const ranked = expectedType !== undefined
    ? candidates.map((candidate) =>
      Object.freeze({
        ...candidate,
        expectedCompatibility: completionTypeCompatibility(
          project,
          candidate.type,
          moduleInterface,
          expectedType,
        ),
      })
    )
    : candidates;
  const filtered = ranked
    .filter(({ name }) => name.startsWith(context.prefix))
    .sort((left, right) =>
      left.rank - right.rank ||
      completionCompatibilityOrder(left.expectedCompatibility) -
        completionCompatibilityOrder(right.expectedCompatibility) ||
      completionProximity(left) - completionProximity(right) ||
      Number(right.name === context.prefix) - Number(left.name === context.prefix) ||
      left.name.localeCompare(right.name) ||
      completionKindOrder(left.kind) - completionKindOrder(right.kind)
    );
  const seen = new Set<string>();
  return Object.freeze({
    prefix: context.prefix,
    expectedType: expectedType === undefined
      ? undefined
      : Object.freeze({ moduleId, type: expectedType }),
    candidates: Object.freeze(filtered.filter((candidate) => {
      const key = `${candidate.kind}:${candidate.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })),
  });
}

/** Compiler-owned signature selection for the innermost active call site. */
export function semanticSignatureHelpAt(
  project: ProjectSnapshot,
  moduleId: ModuleId,
  source: string,
  offset: number,
): SemanticSignatureHelp | undefined {
  const moduleInterface = project.interfaces.get(moduleId);
  if (!moduleInterface) return;
  const site = moduleInterface.callSites
    .filter(({ span, activationStart }) => activationStart <= offset && offset <= span.end)
    .sort((left, right) =>
      (left.span.end - left.span.start) - (right.span.end - right.span.start) ||
      right.span.start - left.span.start
    )[0];
  if (site && site.parameters.length > 0) {
    const completedArguments = site.arguments.filter((argument) => argument.end < offset).length;
    const explicitParameter = site.arguments.length === 0
      ? 0
      : Math.min(completedArguments, site.arguments.length - 1);
    return Object.freeze({
      callee: site.callee,
      parameters: Object.freeze(
        site.parameters.map((parameter) =>
          Object.freeze({
            name: parameter.name,
            type: Object.freeze({
              moduleId: moduleInterface.moduleId,
              id: parameter.type,
            }),
          })
        ),
      ),
      result: Object.freeze({
        moduleId: moduleInterface.moduleId,
        id: site.result,
      }),
      activeParameter: Math.min(
        site.parameters.length - 1,
        site.implicitParameters + explicitParameter,
      ),
    });
  }
  const recovered = recoveredCallContext(source, offset);
  if (!recovered) return;
  const resolved = recoveredCallable(
    project,
    moduleInterface,
    recovered.callee,
    offset,
  );
  if (!resolved) return;
  return semanticSignatureFromType(
    resolved.owner,
    recovered.callee,
    resolved.type,
    resolved.names,
    recovered.activeParameter,
  );
}

/** Return compiler-classified semantic symbol tokens for one immutable module interface. */
export function semanticTokensForModule(
  moduleInterface: ModuleInterface,
): readonly SemanticTokenFact[] {
  return moduleInterface.semanticTokens;
}

/** Aggregate declaration facts without treating indexed-but-inactive files as project members. */
export function semanticWorkspaceSymbols(
  projects: Iterable<ProjectSnapshot>,
): readonly SemanticWorkspaceSymbolFact[] {
  const facts: SemanticWorkspaceSymbolFact[] = [];
  for (const project of projects) {
    for (const [moduleId, moduleInterface] of project.interfaces) {
      facts.push(Object.freeze({
        projectSnapshotId: project.id,
        moduleId,
        path: moduleInterface.path,
        name: moduleInterface.path,
        kind: "module",
        span: moduleInterface.sourceSpan,
        selectionSpan: Object.freeze({
          ...moduleInterface.sourceSpan,
          end: Math.min(
            moduleInterface.sourceSpan.end,
            moduleInterface.sourceSpan.start + 1,
          ),
        }),
      }));
      for (const declaration of moduleInterface.declarations) {
        facts.push(Object.freeze({
          projectSnapshotId: project.id,
          moduleId,
          path: moduleInterface.path,
          name: declaration.name,
          kind: declaration.kind,
          span: declaration.span,
          selectionSpan: declaration.selectionSpan,
        }));
        for (const constructor of declaration.constructors ?? []) {
          facts.push(Object.freeze({
            projectSnapshotId: project.id,
            moduleId,
            path: moduleInterface.path,
            name: constructor.name,
            kind: "constructor",
            span: constructor.span,
            selectionSpan: constructor.selectionSpan,
            containerName: declaration.name,
          }));
        }
      }
    }
  }
  return Object.freeze(facts);
}

function recoveredCallContext(
  source: string,
  offset: number,
): Readonly<{ callee: string; activeParameter: number }> | undefined {
  const stack: number[] = [];
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  const limit = Math.max(0, Math.min(offset, source.length));
  for (let index = 0; index < limit; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index++;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") stack.push(index);
    else if (char === ")") stack.pop();
  }
  for (const open of stack.reverse()) {
    const callee = source.slice(0, open)
      .match(/([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*$/)?.[1];
    if (!callee) continue;
    return Object.freeze({
      callee,
      activeParameter: topLevelCommaCount(source, open + 1, limit),
    });
  }
  return undefined;
}

function topLevelCommaCount(source: string, start: number, end: number): number {
  const stack: string[] = [];
  let commas = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < end; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index++;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") stack.push(char);
    else if (char === ")" || char === "]" || char === "}") stack.pop();
    else if (char === "," && stack.length === 0) commas++;
  }
  return commas;
}

function recoveredCallable(
  project: ProjectSnapshot,
  owner: ModuleInterface,
  callee: string,
  offset: number,
):
  | Readonly<{
    owner: ModuleInterface;
    type: SemanticTypeId;
    names?: readonly string[];
  }>
  | undefined {
  // `callee` is raw text scanned from unparsed current source near the cursor, so its
  // path is reconstructed through the one sanctioned constructor.
  const calleePath = parseLongId(callee);
  const scope = semanticScopeAt(owner, offset);
  if (!isQualified(calleePath)) {
    const target = scope.values.get(callee);
    if (!target) return;
    const type = completionTypeForTarget(project, target);
    if (!type) return;
    const typeOwner = project.interfaces.get(type.moduleId);
    if (!typeOwner) return;
    return Object.freeze({
      owner: typeOwner,
      type: type.occurrence.id,
      names: callableNamesForTarget(project, target),
    });
  }
  const qualifier = calleePath.qualifiers[0];
  const member = [...calleePath.qualifiers.slice(1), calleePath.id].join(".");
  const structure = scope.structures.get(qualifier);
  if (structure === undefined) return;
  const imported = owner.imports.find(({ structureAlias }) => structureAlias?.id === structure);
  if (imported) {
    const targetOwner = project.interfaces.get(imported.target);
    const occurrence = targetOwner?.occurrences.find((candidate) =>
      candidate.role === "declaration" &&
      candidate.declaration?.visibility === "public" &&
      candidate.name === member &&
      candidate.inferredType !== undefined &&
      (candidate.target.kind === "value" ||
        candidate.target.kind === "constructor")
    );
    if (!targetOwner || !occurrence?.inferredType) return;
    return Object.freeze({
      owner: targetOwner,
      type: occurrence.inferredType.id,
      names: callableNamesForTarget(project, occurrence.target),
    });
  }
  const builtIn = owner.structureMembers.get(structure)?.find((candidate) =>
    candidate.name === member && candidate.type !== undefined
  );
  if (builtIn?.type) {
    return Object.freeze({ owner, type: builtIn.type.id });
  }
  const ffi = owner.ffiFacts.imports
    .find(({ structureAlias }) => structureAlias?.id === structure)
    ?.bindings.find((binding) => binding.sourceName === member && binding.type !== undefined);
  return ffi?.type ? Object.freeze({ owner, type: ffi.type.id }) : undefined;
}

function callableNamesForTarget(
  project: ProjectSnapshot,
  target: SemanticOccurrenceTarget,
): readonly string[] | undefined {
  if (target.kind !== "value" || typeof target.id !== "number") return;
  for (const moduleInterface of project.interfaces.values()) {
    const definition = moduleInterface.callableDefinitions.find((candidate) =>
      candidate.target === target.id
    );
    if (definition) return definition.parameterStages[0];
  }
  return undefined;
}

function semanticSignatureFromType(
  owner: ModuleInterface,
  callee: string,
  type: SemanticTypeId,
  names: readonly string[] | undefined,
  activeParameter: number,
): SemanticSignatureHelp | undefined {
  const shape = owner.semanticTypes[type]?.shape;
  if (shape?.kind !== "function") return;
  const arity = names?.length ?? Math.max(1, activeParameter + 1);
  let parameterTypes = shape.params;
  if (shape.params.length === 1 && arity > 1) {
    const parameter = owner.semanticTypes[shape.params[0]]?.shape;
    if (parameter?.kind === "tuple" && parameter.items.length === arity) {
      parameterTypes = parameter.items;
    }
  }
  if (parameterTypes.length !== arity) {
    if (shape.params.length !== 1) return;
    parameterTypes = shape.params;
  }
  return Object.freeze({
    callee,
    parameters: Object.freeze(
      parameterTypes.map((parameter, index) =>
        Object.freeze({
          name: names?.length === parameterTypes.length ? names[index] : undefined,
          type: Object.freeze({ moduleId: owner.moduleId, id: parameter }),
        })
      ),
    ),
    result: Object.freeze({ moduleId: owner.moduleId, id: shape.result }),
    activeParameter: Math.min(parameterTypes.length - 1, activeParameter),
  });
}

function completionLexicalMetadata(
  moduleInterface: ModuleInterface,
  target: SemanticOccurrenceTarget,
  offset: number,
): Readonly<{ rank: number; proximity?: number }> {
  const localDeclaration = moduleInterface.occurrences
    .filter((occurrence) =>
      occurrence.role === "declaration" &&
      sameSemanticTarget(occurrence.target, target) &&
      occurrence.span.end <= offset
    )
    .sort((left, right) => right.span.end - left.span.end)[0];
  if (localDeclaration) {
    return Object.freeze({
      rank: 10,
      proximity: offset - localDeclaration.span.end,
    });
  }
  const imported = moduleInterface.imports.find((item) =>
    item.targets.some((projected) =>
      importTargetIdentities(projected).some((identity) => sameSemanticTarget(identity, target))
    ) || (target.kind === "structure" && item.structureAlias?.id === target.id)
  );
  const importAlias = moduleInterface.occurrences
    .filter((occurrence) =>
      occurrence.role === "import-alias" &&
      sameSemanticTarget(occurrence.target, target) &&
      occurrence.span.end <= offset
    )
    .sort((left, right) => right.span.end - left.span.end)[0];
  const importedEnd = importAlias?.span.end ?? imported?.declaration.node?.span.end;
  if (importedEnd !== undefined) {
    return Object.freeze({
      rank: 20,
      proximity: Math.max(0, offset - importedEnd),
    });
  }
  if (
    moduleInterface.initialScopeTypes.some((entry) => sameSemanticTarget(entry.target, target)) ||
    (target.kind === "structure" && moduleInterface.structureMembers.has(target.id))
  ) return Object.freeze({ rank: 30 });
  return Object.freeze({ rank: 20 });
}

function completionTypeVariableMetadata(
  moduleInterface: ModuleInterface,
  id: TypeVariableId,
  offset: number,
): Readonly<{ rank: number; proximity?: number }> {
  const variable = moduleInterface.typeVariables.find((candidate) => candidate.id === id);
  return Object.freeze({
    rank: 5,
    proximity: variable?.binder && variable.binder.end <= offset
      ? offset - variable.binder.end
      : undefined,
  });
}

function expectedCompletionTypeAt(
  moduleInterface: ModuleInterface,
  offset: number,
): SemanticTypeId | undefined {
  return moduleInterface.expectedTypes
    .filter(({ span }) => span.start <= offset && offset <= span.end)
    .sort((left, right) =>
      (left.span.end - left.span.start) - (right.span.end - right.span.start) ||
      right.span.start - left.span.start
    )[0]?.type;
}

function completionTypeCompatibility(
  project: ProjectSnapshot,
  candidate: SemanticCompletionCandidate["type"],
  expectedOwner: ModuleInterface,
  expected: SemanticTypeId,
): "compatible" | "unknown" | "incompatible" {
  if (!candidate) return "unknown";
  const candidateOwner = project.interfaces.get(candidate.moduleId);
  if (!candidateOwner) return "unknown";
  return semanticTypeCompatibility(
    candidateOwner,
    candidate.occurrence.id,
    expectedOwner,
    expected,
    new Set(),
  );
}

function semanticTypeCompatibility(
  leftOwner: ModuleInterface,
  leftId: SemanticTypeId,
  rightOwner: ModuleInterface,
  rightId: SemanticTypeId,
  visited: Set<string>,
): "compatible" | "unknown" | "incompatible" {
  const visitKey = `${leftOwner.path}:${leftId}|${rightOwner.path}:${rightId}`;
  if (visited.has(visitKey)) return "unknown";
  visited.add(visitKey);
  const result = semanticTypeCompatibilityInner(
    leftOwner,
    leftId,
    rightOwner,
    rightId,
    visited,
  );
  visited.delete(visitKey);
  return result;
}

function semanticTypeCompatibilityInner(
  leftOwner: ModuleInterface,
  leftId: SemanticTypeId,
  rightOwner: ModuleInterface,
  rightId: SemanticTypeId,
  visited: Set<string>,
): "compatible" | "unknown" | "incompatible" {
  const left = leftOwner.semanticTypes[leftId]?.shape;
  const right = rightOwner.semanticTypes[rightId]?.shape;
  if (
    !left || !right || left.kind === "variable" || right.kind === "variable" ||
    left.kind === "ffi" || right.kind === "ffi"
  ) return "unknown";
  if (left.kind !== right.kind) return "incompatible";
  switch (left.kind) {
    case "primitive":
      return left.name === (right as typeof left).name ? "compatible" : "incompatible";
    case "named": {
      const other = right as typeof left;
      const sameIdentity = left.typeNameId !== undefined && other.typeNameId !== undefined
        ? left.typeNameId === other.typeNameId
        : left.foreignKey !== undefined || other.foreignKey !== undefined
        ? left.foreignKey === other.foreignKey
        : left.inferenceTypeId === other.inferenceTypeId;
      if (!sameIdentity || left.args.length !== other.args.length) return "incompatible";
      return combineCompletionCompatibility(
        left.args.map((id, index) =>
          semanticTypeCompatibility(
            leftOwner,
            id,
            rightOwner,
            other.args[index],
            visited,
          )
        ),
      );
    }
    case "function": {
      const other = right as typeof left;
      if (left.params.length !== other.params.length) return "incompatible";
      return combineCompletionCompatibility([
        ...left.params.map((id, index) =>
          semanticTypeCompatibility(
            leftOwner,
            id,
            rightOwner,
            other.params[index],
            visited,
          )
        ),
        semanticTypeCompatibility(
          leftOwner,
          left.result,
          rightOwner,
          other.result,
          visited,
        ),
      ]);
    }
    case "tuple": {
      const other = right as typeof left;
      if (left.items.length !== other.items.length) return "incompatible";
      return combineCompletionCompatibility(
        left.items.map((id, index) =>
          semanticTypeCompatibility(
            leftOwner,
            id,
            rightOwner,
            other.items[index],
            visited,
          )
        ),
      );
    }
    case "structural-record": {
      const other = right as typeof left;
      if (
        left.fields.length !== other.fields.length ||
        left.fields.some((field, index) => field.name !== other.fields[index]?.name)
      ) return "incompatible";
      return combineCompletionCompatibility(
        left.fields.map((field, index) =>
          semanticTypeCompatibility(
            leftOwner,
            field.type,
            rightOwner,
            other.fields[index].type,
            visited,
          )
        ),
      );
    }
  }
}

function combineCompletionCompatibility(
  items: readonly ("compatible" | "unknown" | "incompatible")[],
): "compatible" | "unknown" | "incompatible" {
  if (items.some((item) => item === "incompatible")) return "incompatible";
  return items.some((item) => item === "unknown") ? "unknown" : "compatible";
}

function completionCompatibilityOrder(
  compatibility: SemanticCompletionCandidate["expectedCompatibility"],
): number {
  return compatibility === "compatible" ? 0 : compatibility === "unknown" ? 1 : 2;
}

function completionProximity(candidate: SemanticCompletionCandidate): number {
  return candidate.proximity ?? Number.MAX_SAFE_INTEGER;
}

function completionCandidate(
  name: string,
  kind: SemanticCompletionCandidate["kind"],
  origin: SemanticCompletionCandidate["origin"],
  ranking: number | Readonly<{ rank: number; proximity?: number }>,
  type?: SemanticCompletionCandidate["type"],
): SemanticCompletionCandidate {
  const { rank, proximity } = typeof ranking === "number"
    ? { rank: ranking, proximity: undefined }
    : ranking;
  return Object.freeze({ name, kind, origin, rank, proximity, type });
}

function completionTypeForTarget(
  project: ProjectSnapshot,
  target: SemanticOccurrenceTarget,
): SemanticCompletionCandidate["type"] | undefined {
  const typed = semanticOccurrencesForTarget(project, target)
    .find(({ occurrence }) =>
      occurrence.declaration !== undefined && occurrence.inferredType !== undefined
    ) ??
    semanticOccurrencesForTarget(project, target)
      .find(({ occurrence }) => occurrence.inferredType !== undefined);
  if (typed?.occurrence.inferredType) {
    return Object.freeze({
      moduleId: typed.moduleId,
      occurrence: typed.occurrence.inferredType,
    });
  }
  for (const moduleInterface of project.interfaces.values()) {
    const initial = moduleInterface.initialScopeTypes.find((entry) =>
      sameSemanticTarget(entry.target, target)
    );
    if (initial) {
      return Object.freeze({
        moduleId: moduleInterface.moduleId,
        occurrence: initial.type,
      });
    }
  }
  return undefined;
}

function namespaceCompletionCandidates(
  project: ProjectSnapshot,
  owner: ModuleInterface,
  structure: StructureSemanticId,
): SemanticCompletionCandidate[] {
  const imported = owner.imports.find(({ structureAlias }) => structureAlias?.id === structure);
  if (imported) {
    const target = project.interfaces.get(imported.target);
    if (!target) return [];
    return target.occurrences.flatMap((occurrence) => {
      if (
        occurrence.role !== "declaration" ||
        occurrence.declaration?.visibility !== "public" ||
        (occurrence.target.kind !== "value" &&
          occurrence.target.kind !== "constructor" &&
          occurrence.target.kind !== "type")
      ) return [];
      return [completionCandidate(
        occurrence.name,
        occurrence.target.kind,
        "namespace",
        10,
        occurrence.inferredType
          ? Object.freeze({
            moduleId: target.moduleId,
            occurrence: occurrence.inferredType,
          })
          : undefined,
      )];
    });
  }
  const builtIn = owner.structureMembers.get(structure);
  if (builtIn) {
    return builtIn.map((member) =>
      completionCandidate(
        member.name,
        member.kind,
        "namespace",
        10,
        member.type
          ? Object.freeze({ moduleId: owner.moduleId, occurrence: member.type })
          : undefined,
      )
    );
  }
  const ffi = owner.ffiFacts.imports.find(({ structureAlias }) => structureAlias?.id === structure);
  return ffi
    ? ffi.bindings.map((binding) =>
      completionCandidate(
        binding.sourceName,
        "value",
        "namespace",
        10,
        binding.type
          ? Object.freeze({ moduleId: owner.moduleId, occurrence: binding.type })
          : undefined,
      )
    )
    : [];
}

function recordCompletionCandidates(
  project: ProjectSnapshot,
  scope: SemanticScope,
  receiverName: string,
): SemanticCompletionCandidate[] {
  const value = scope.values.get(receiverName);
  if (!value) return [];
  const typeRef = completionTypeForTarget(project, value);
  if (!typeRef) return [];
  const owner = project.interfaces.get(typeRef.moduleId);
  const shape = owner?.semanticTypes[typeRef.occurrence.id]?.shape;
  if (!owner || shape?.kind !== "named" || shape.typeNameId === undefined) return [];
  const candidates: SemanticCompletionCandidate[] = [];
  for (const moduleInterface of project.interfaces.values()) {
    const declaration = moduleInterface.declarations.find(({ kind, target }) =>
      kind === "record" &&
      target.kind === "type" &&
      target.id === shape.typeNameId
    );
    if (!declaration) continue;
    for (const occurrence of moduleInterface.occurrences) {
      if (
        occurrence.target.kind !== "field" ||
        occurrence.role !== "declaration" ||
        occurrence.span.start < declaration.span.start ||
        occurrence.span.end > declaration.span.end
      ) continue;
      candidates.push(completionCandidate(
        occurrence.name,
        "field",
        "record",
        10,
        occurrence.inferredType
          ? Object.freeze({
            moduleId: moduleInterface.moduleId,
            occurrence: occurrence.inferredType,
          })
          : undefined,
      ));
    }
  }
  return candidates;
}

function completionContext(
  source: string,
  offset: number,
): Readonly<{ prefix: string; qualifier?: string; typePosition: boolean }> {
  const before = source.slice(0, Math.max(0, Math.min(offset, source.length)));
  const prefix = before.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  const prefixStart = before.length - prefix.length;
  const preceding = before.slice(0, prefixStart);
  const qualifier = preceding.match(/([A-Za-z_][A-Za-z0-9_]*)\.\s*$/)?.[1];
  const typePosition = qualifier === undefined &&
    /(?::|<|\btype\s+[A-Z][A-Za-z0-9_]*\s*=)\s*$/.test(preceding);
  return Object.freeze({ prefix, qualifier, typePosition });
}

const workmanCompletionKeywords = Object.freeze([
  "from",
  "let",
  "type",
  "record",
  "if",
  "match",
  "true",
  "false",
  "void",
]);

function completionKindOrder(kind: SemanticCompletionCandidate["kind"]): number {
  return kind === "value"
    ? 0
    : kind === "constructor"
    ? 1
    : kind === "field"
    ? 2
    : kind === "type"
    ? 3
    : kind === "structure"
    ? 4
    : kind === "gpu-builtin"
    ? 5
    : kind === "file"
    ? 6
    : kind === "folder"
    ? 7
    : 8;
}

function completionScopeNamesAt(
  facts: SemanticCompletionFacts,
  offset: number,
): SemanticCompletionScopeNames {
  const containers = facts.scopes.checkpoints.map((checkpoint) => checkpoint.container);
  const node = facts.scopes.nodes
    .filter(({ span }) =>
      !containers.some((container) => sameSpan(container, span)) &&
      span.start <= offset &&
      offset < span.end
    )
    .sort((left, right) =>
      (left.span.end - left.span.start) - (right.span.end - right.span.start) ||
      right.span.start - left.span.start
    )[0];
  const checkpoint = facts.scopes.checkpoints
    .filter(({ container, offset: checkpointOffset }) =>
      container.start <= offset &&
      offset < container.end &&
      checkpointOffset <= offset
    )
    .sort((left, right) =>
      (left.container.end - left.container.start) -
        (right.container.end - right.container.start) ||
      right.offset - left.offset
    )[0];
  const trailing = !node && !checkpoint
    ? outermostTrailingCompletionCheckpoint(facts.scopes.checkpoints, offset)
    : undefined;
  if (!node) return checkpoint?.names ?? trailing?.names ?? emptyCompletionScopeNames;
  if (!checkpoint) return node.names;
  const nodeWidth = node.span.end - node.span.start;
  const checkpointWidth = checkpoint.container.end - checkpoint.container.start;
  return checkpointWidth <= nodeWidth ? checkpoint.names : node.names;
}

function outermostTrailingSemanticCheckpoint(
  checkpoints: ModuleSemanticScopes["checkpoints"],
  offset: number,
): ModuleSemanticScopes["checkpoints"][number] | undefined {
  return checkpoints
    .filter((candidate) => candidate.offset <= offset)
    .sort((left, right) =>
      left.container.start - right.container.start ||
      (right.container.end - right.container.start) -
        (left.container.end - left.container.start) ||
      right.offset - left.offset
    )[0];
}

function outermostTrailingCompletionCheckpoint(
  checkpoints: SemanticCompletionFacts["scopes"]["checkpoints"],
  offset: number,
): SemanticCompletionFacts["scopes"]["checkpoints"][number] | undefined {
  return checkpoints
    .filter((candidate) => candidate.offset <= offset)
    .sort((left, right) =>
      left.container.start - right.container.start ||
      (right.container.end - right.container.start) -
        (left.container.end - left.container.start) ||
      right.offset - left.offset
    )[0];
}

const emptyCompletionScopeNames: SemanticCompletionScopeNames = Object.freeze({
  values: Object.freeze([]),
  structures: Object.freeze([]),
  types: Object.freeze([]),
  constructors: Object.freeze([]),
});

export function semanticTypedNodeAt(
  moduleInterface: ModuleInterface,
  offset: number,
): SemanticTypedNode | undefined {
  return semanticTypedNodesAt(moduleInterface, offset)[0];
}

export function semanticTypedNodesAt(
  moduleInterface: ModuleInterface,
  offset: number,
): readonly SemanticTypedNode[] {
  return moduleInterface.typedNodes
    .filter((item) => item.span.start <= offset && offset < item.span.end)
    .sort((left, right) =>
      (left.span.end - left.span.start) - (right.span.end - right.span.start) ||
      typedNodeKindOrder(left.kind) - typedNodeKindOrder(right.kind)
    );
}

function generationToken(): InterfaceGeneration {
  return Object.freeze(Object.create(null)) as InterfaceGeneration;
}

function projectSnapshotToken(): ProjectSnapshotId {
  return Object.freeze(Object.create(null)) as ProjectSnapshotId;
}

function analysisCompleteness(
  result: InferResult,
  node: ModuleNode,
  ffiFacts: SemanticFfiFacts,
  gpuFacts: SemanticGpuFacts,
): ModuleCompleteness {
  const complete = result.elaboration.complete;
  const recoveryBoundaries = distinctBoundaries([
    ...(node.syntaxRecoveryBoundaries ?? []),
    ...(node.importRecoveryBoundaries ?? []),
    ...result.elaboration.recoveryBoundaries,
  ]);
  return Object.freeze({
    syntax: node.syntaxStatus ?? "complete",
    imports: (node.importDiagnostics?.length ?? 0) > 0 ||
        result.elaboration.failure === "import"
      ? "partial"
      : "complete",
    elaboration: complete ? "complete" : "partial",
    // Occurrence and scope coverage are audited by the `[module update A608]`
    // regressions: every authored named node has an occurrence in its span, and
    // every reference/qualifier occurrence is reproducible from the scope at its
    // own offset with the same identity. A failed phrase contributes no
    // occurrences or scope entries, so recovered analyses remain partial.
    occurrences: complete ? "complete" : "partial",
    scopes: complete ? "complete" : "partial",
    ffi: !complete ? "partial" : ffiFacts.imports.length === 0 &&
        ffiFacts.calls.length === 0 &&
        ffiFacts.foreignTypes.length === 0
      ? "not-applicable"
      : "complete",
    gpu: !complete ? "partial" : gpuFacts.operations.length === 0 &&
        gpuFacts.builtins.length === 0 &&
        gpuFacts.resources.length === 0 &&
        gpuFacts.roots.length === 0 &&
        gpuFacts.selectors.length === 0 &&
        gpuFacts.slices.length === 0
      ? "not-applicable"
      : "complete",
    recoveryBoundaries: Object.freeze(
      recoveryBoundaries.map((boundary) => Object.freeze({ ...boundary })),
    ),
  });
}

function distinctBoundaries(
  boundaries: readonly Readonly<{ start: number; end: number }>[],
): Readonly<{ start: number; end: number }>[] {
  const seen = new Set<string>();
  return boundaries.filter((boundary) => {
    const key = `${boundary.start}:${boundary.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function semanticScopes(
  bindings: BindingFacts,
  result: InferResult,
  nominalFacts: NominalFacts,
): ModuleSemanticScopes {
  const initial = initialSemanticScope(result, nominalFacts);
  const nodes = [...bindings.scopeNodes].map(([node, scope]) =>
    Object.freeze({
      span: Object.freeze({ ...node.span }),
      scope: overlayBindingScope(
        initial,
        scope,
        nominalFacts,
        bindings.jsImportSourceBindings,
      ),
    })
  );
  const checkpoints = bindings.scopeCheckpoints.map((checkpoint) =>
    semanticScopeCheckpoint(
      initial,
      checkpoint,
      nominalFacts,
      bindings.jsImportSourceBindings,
    )
  );
  return Object.freeze({
    initial,
    nodes: Object.freeze(nodes),
    checkpoints: Object.freeze(checkpoints),
  });
}

function semanticStructureMembers(
  result: InferResult,
  nominalFacts: NominalFacts,
  typeArena: SemanticTypeArena,
): ReadonlyMap<StructureSemanticId, readonly SemanticStructureMember[]> {
  const structures = new Map<StructureSemanticId, readonly SemanticStructureMember[]>();
  for (const [name, environment] of result.initialStructure.strEnv) {
    const members: SemanticStructureMember[] = [];
    for (const [memberName, scheme] of environment.valEnv) {
      members.push(Object.freeze({
        name: memberName,
        kind: scheme.status === "constructor" || scheme.status === "record-constructor"
          ? "constructor"
          : "value",
        type: semanticOccurrenceType(typeArena, scheme.type, scheme),
      }));
    }
    for (const [memberName, info] of environment.tyEnv) {
      const id = nominalFacts.inferenceTypeIds.get(info.id);
      members.push(Object.freeze({
        name: memberName,
        kind: "type",
        type: id === undefined ? undefined : semanticOccurrenceType(typeArena, {
          tag: "named",
          id: info.id,
          name: memberName,
          args: [],
        }),
      }));
    }
    for (const memberName of environment.strEnv.keys()) {
      members.push(Object.freeze({ name: memberName, kind: "structure" }));
    }
    structures.set(
      basisStructureId(name),
      Object.freeze(members.sort((left, right) =>
        left.name.localeCompare(right.name) ||
        completionKindOrder(left.kind) - completionKindOrder(right.kind)
      )),
    );
  }
  return structures;
}

function semanticInitialScopeTypes(
  result: InferResult,
  typeArena: SemanticTypeArena,
): readonly SemanticScopeTargetType[] {
  return Object.freeze(
    [...result.initialStructure.valEnv].flatMap(([name, scheme]) => {
      const target: SemanticOccurrenceTarget | undefined =
        scheme.status === "constructor" || scheme.status === "record-constructor"
          ? (() => {
            const id = basisCtorId(name);
            return id === undefined ? undefined : { kind: "constructor", id: id as CtorId };
          })()
          : scheme.valueId === undefined
          ? undefined
          : { kind: "value", id: scheme.valueId };
      const type = semanticOccurrenceType(typeArena, scheme.type, scheme);
      return target && type ? [Object.freeze({ target: Object.freeze(target), type })] : [];
    }),
  );
}

function initialSemanticScope(result: InferResult, nominalFacts: NominalFacts): SemanticScope {
  const values = new Map<string, SemanticScopeValue>();
  for (const [name, scheme] of result.initialStructure.valEnv) {
    if (scheme.status === "constructor") {
      const constructor = basisCtorId(name);
      if (constructor !== undefined) {
        values.set(name, Object.freeze({ kind: "constructor", id: constructor as CtorId }));
        continue;
      }
    }
    if (scheme.valueId !== undefined) {
      values.set(name, Object.freeze({ kind: "value", id: scheme.valueId }));
    }
  }
  const structures = new Map<string, StructureSemanticId>(
    [...result.initialStructure.strEnv].map(([name]) => [name, basisStructureId(name)]),
  );
  const types = new Map<string, TypeNameId>();
  for (const [name, info] of result.initialStructure.tyEnv) {
    const id = nominalFacts.inferenceTypeIds.get(info.id);
    if (id !== undefined) types.set(name, id);
  }
  return freezeSemanticScope(values, structures, types);
}

function overlayBindingScope(
  initial: SemanticScope,
  bindings: BindingScopeSnapshot,
  nominalFacts?: NominalFacts,
  generatedJsBindings: ReadonlyMap<BindingId, BindingId> = new Map(),
): SemanticScope {
  const values = new Map(initial.values);
  for (const [name, id] of bindings.values) {
    if (generatedJsBindings.has(id)) continue;
    // Receiver-model FFI lowering installs `__ffi_*` helper bindings with no authored
    // relation entry; like related generated bindings, they are compiler-only lowering
    // identities and never appear in source scopes.
    if (name.startsWith("__ffi_")) continue;
    values.set(name, Object.freeze({ kind: "value", id }));
  }
  if (nominalFacts) {
    for (const [name, declaration] of bindings.constructors) {
      const id = nominalFacts.constructorDeclarations.get(declaration);
      if (id !== undefined) {
        values.set(name, Object.freeze({ kind: "constructor", id }));
      }
    }
  }
  const structures = new Map(initial.structures);
  for (const [name, id] of bindings.structures) structures.set(name, id);
  const types = new Map(initial.types);
  if (nominalFacts) {
    for (const [name, declaration] of bindings.types) {
      const id = nominalFacts.typeDeclarations.get(declaration);
      if (id !== undefined) types.set(name, id);
    }
  }
  return freezeSemanticScope(values, structures, types);
}

function semanticScopeCheckpoint(
  initial: SemanticScope,
  checkpoint: BindingScopeCheckpoint,
  nominalFacts: NominalFacts,
  generatedJsBindings: ReadonlyMap<BindingId, BindingId>,
): Readonly<{ container: SourceSpan; offset: number; scope: SemanticScope }> {
  return Object.freeze({
    container: Object.freeze({ ...checkpoint.container.span }),
    offset: checkpoint.offset,
    scope: overlayBindingScope(
      initial,
      checkpoint.scope,
      nominalFacts,
      generatedJsBindings,
    ),
  });
}

function freezeSemanticScope(
  values: Map<string, SemanticScopeValue>,
  structures: Map<string, StructureSemanticId>,
  types: Map<string, TypeNameId>,
  typeVariables: Map<string, TypeVariableId> = new Map(),
): SemanticScope {
  return Object.freeze({ values, structures, types, typeVariables });
}

function sameSpan(left: SourceSpan, right: SourceSpan): boolean {
  return left.start === right.start && left.end === right.end;
}

export function immutableCopy<T>(value: T): DeepReadonly<T> {
  return deepFreeze(structuredClone(value)) as DeepReadonly<T>;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function semanticOccurrences(
  moduleId: ModuleId,
  source: string,
  imports: readonly ModuleImportEdge[],
  importFacts: readonly ModuleImportOccurrence[],
  bindings: BindingFacts,
  nominalFacts: NominalFacts,
  result: InferResult,
  typeArena: SemanticTypeArena,
  typeVariables: readonly SemanticTypeVariableRegion[],
  targetTypes: ReadonlyMap<string, SemanticTypeSource>,
): ModuleSemanticOccurrence[] {
  const occurrences: ModuleSemanticOccurrence[] = [];
  for (const edge of imports) {
    addSemanticOccurrence(
      occurrences,
      edge.specifier,
      "import-path",
      { kind: "module", id: edge.target },
      edge.specifierNode,
      source,
    );
  }
  for (const imported of importFacts) {
    if (imported.clause.kind !== "Named") continue;
    for (const spec of imported.clause.specs) {
      const target = imported.targets.find((item) =>
        item.sourceName === spec.name && item.localName === (spec.alias ?? spec.name)
      );
      if (!target) continue;
      for (const semanticTarget of importTargetIdentities(target)) {
        const targetType = targetTypes.get(semanticTargetKey(semanticTarget));
        const inferredType = semanticOccurrenceType(
          typeArena,
          targetType?.type,
          targetType?.scheme,
        );
        addSemanticOccurrence(
          occurrences,
          spec.name,
          "import-source",
          semanticTarget,
          spec.node ?? imported.declaration.node,
          source,
          "first",
          inferredType,
        );
        if (spec.alias) {
          addSemanticOccurrence(
            occurrences,
            spec.alias,
            "import-alias",
            semanticTarget,
            spec.node ?? imported.declaration.node,
            source,
            "last",
            inferredType,
          );
        }
      }
    }
  }
  for (const [pattern, id] of bindings.binders) {
    if (pattern.kind !== "PVar") continue;
    const fact = result.facts.patterns.get(pattern);
    addSemanticOccurrence(
      occurrences,
      pattern.name,
      "declaration",
      { kind: "value", id },
      pattern.node,
      source,
      "first",
      semanticOccurrenceType(
        typeArena,
        fact?.instantiated ?? result.facts.patternTypes.get(pattern),
        fact?.general,
      ),
    );
  }
  for (const [declaration, id] of bindings.recordConstructors) {
    const scheme = result.facts.bindings.get(declaration.name)?.find((fact) =>
      fact.general?.status === "record-constructor" &&
      fact.general.node === declaration.node
    )?.general;
    addSemanticOccurrence(
      occurrences,
      declaration.name,
      "declaration",
      { kind: "value", id },
      declaration.node,
      source,
      "first",
      semanticOccurrenceType(typeArena, scheme?.type, scheme),
    );
  }
  for (const [site, id] of bindings.jsImportBinders) {
    let declaration: Extract<Decl, { kind: "JsImportDecl" }> | undefined;
    let spec: JsImportSpec | undefined;
    if (isJsImportDeclaration(site)) declaration = site;
    else spec = site;
    if (spec?.sourceName) continue;
    const name = declaration?.clause.kind === "Namespace"
      ? declaration.clause.alias
      : spec?.alias ?? spec?.name ?? "";
    const node = declaration?.clause.kind === "Namespace"
      ? declaration.clause.node ?? declaration.node
      : spec?.node;
    const scheme = result.facts.jsImportSchemes.get(site) ??
      jsImportSourceScheme(id, bindings, result);
    addSemanticOccurrence(
      occurrences,
      name,
      spec?.alias ? "import-alias" : "declaration",
      { kind: "value", id },
      node,
      source,
      spec?.alias ? "last" : "first",
      semanticOccurrenceType(typeArena, scheme?.type, scheme),
    );
    if (spec?.alias) {
      addSemanticOccurrence(
        occurrences,
        spec.name,
        "import-source",
        { kind: "value", id },
        spec.node,
        source,
        "first",
        semanticOccurrenceType(typeArena, scheme?.type, scheme),
      );
    }
  }
  for (const [declaration, id] of bindings.jsStructureBinders) {
    const clause = declaration.sourceClause ?? declaration.clause;
    if (clause.kind !== "Named" || !clause.alias) continue;
    addSemanticOccurrence(
      occurrences,
      clause.alias,
      "import-alias",
      { kind: "structure", id },
      clause.node ?? declaration.node,
      source,
      "last",
    );
  }
  for (const [reference, id] of bindings.references) {
    if (nominalFacts.constructorReferences.has(reference)) continue;
    const spelling = reference.kind === "Var"
      ? reference.sourceName ?? reference.name
      : reference.kind === "PPinned"
      ? reference.name
      : "";
    // `sourceName` is an authored FFI spelling with no parsed node, so the path is
    // reconstructed through the one sanctioned constructor rather than ad-hoc splits.
    const spellingPath = parseLongId(spelling);
    const qualified = bindings.structureReferences.has(reference) ||
      (reference.kind === "Var" &&
        (bindings.sourceStructureReferences.has(reference) ||
          (reference.sourceName !== undefined && isQualified(spellingPath) &&
            bindings.jsImportSourceBindings.has(id))));
    const name = qualified ? spellingPath.id : spellingPath.qualifiers[0] ?? spellingPath.id;
    const fact = isPattern(reference)
      ? result.facts.patterns.get(reference)
      : result.facts.expressions.get(reference);
    const type = isPattern(reference)
      ? result.facts.patternTypes.get(reference)
      : result.types.get(reference);
    addSemanticOccurrence(
      occurrences,
      name,
      "reference",
      { kind: "value", id: bindings.jsImportSourceBindings.get(id) ?? id },
      reference.node,
      source,
      qualified ? "last" : "first",
      semanticOccurrenceType(typeArena, fact?.instantiated ?? type),
    );
  }
  for (const [expression, fact] of result.facts.expressions) {
    if (expression.kind !== "Var" || fact.origin?.valueId === undefined) continue;
    addExternalValueOccurrences(
      occurrences,
      expression.name,
      expression.node,
      fact.origin.valueId,
      fact.origin.structureId,
      source,
      semanticOccurrenceType(typeArena, fact.instantiated ?? result.types.get(expression)),
    );
  }
  for (const [pattern, fact] of result.facts.patterns) {
    if (
      pattern.kind !== "PPinned" || fact.origin?.valueId === undefined
    ) continue;
    addExternalValueOccurrences(
      occurrences,
      pattern.name,
      pattern.node,
      fact.origin.valueId,
      fact.origin.structureId,
      source,
      semanticOccurrenceType(
        typeArena,
        fact.instantiated ?? result.facts.patternTypes.get(pattern),
      ),
    );
  }
  for (const [declaration, id] of bindings.structureBinders) {
    if (declaration.clause.kind !== "Namespace") continue;
    addSemanticOccurrence(
      occurrences,
      declaration.clause.alias,
      "import-alias",
      { kind: "structure", id },
      declaration.clause.node ?? declaration.node,
      source,
      "last",
    );
  }
  for (
    const [reference, id] of [
      ...bindings.structureReferences,
      ...bindings.sourceStructureReferences,
    ]
  ) {
    if (
      reference.kind !== "Var" && reference.kind !== "PCtor" &&
      reference.kind !== "PPinned"
    ) continue;
    const qualifierPath = reference.kind === "Var" && reference.sourceName !== undefined
      ? parseLongId(reference.sourceName)
      : pathOf(reference);
    addSemanticOccurrence(
      occurrences,
      qualifierPath.qualifiers[0] ?? qualifierPath.id,
      "qualifier",
      { kind: "structure", id },
      reference.node,
      source,
      "first",
    );
  }
  for (const fact of nominalFacts.types) {
    if (fact.moduleId !== moduleId) continue;
    addSemanticOccurrence(
      occurrences,
      fact.name,
      "declaration",
      { kind: "type", id: fact.id },
      fact.declaration.node,
      source,
      "first",
    );
  }
  for (const [reference, referenceFact] of result.facts.typeReferences) {
    const id = nominalFacts.inferenceTypeIds.get(referenceFact.info.id);
    if (id === undefined) continue;
    if (referenceFact.qualifier) {
      const declaration = [...result.facts.structureImports].find(([, environment]) =>
        environment === referenceFact.qualifier!.environment
      )?.[0];
      const structureId = declaration ? bindings.structureBinders.get(declaration) : undefined;
      if (structureId !== undefined) {
        addSemanticOccurrence(
          occurrences,
          referenceFact.qualifier.name,
          "qualifier",
          { kind: "structure", id: structureId },
          reference.node,
          source,
          "first",
        );
      }
    }
    addSemanticOccurrence(
      occurrences,
      pathOf(reference).id,
      "reference",
      { kind: "type", id },
      reference.node,
      source,
      "last",
    );
  }
  for (const fact of nominalFacts.fields) {
    if (fact.moduleId !== moduleId) continue;
    const record = nominalFacts.records.find((candidate) => candidate.id === fact.recordId);
    const info = record ? result.facts.typeDeclarations.get(record.declaration) : undefined;
    addSemanticOccurrence(
      occurrences,
      fact.name,
      "declaration",
      { kind: "field", id: fact.id },
      fact.declaration.node,
      source,
      "first",
      semanticOccurrenceType(typeArena, info?.recordFields?.[fact.declaredIndex]?.type),
    );
  }
  for (const [field, fieldFact] of result.facts.recordFields) {
    const id = nominalFacts.fieldIds.get(fieldFact.record.id)?.get(field.name);
    if (id === undefined) continue;
    addSemanticOccurrence(
      occurrences,
      field.name,
      "reference",
      { kind: "field", id },
      field.node,
      source,
      "first",
      semanticOccurrenceType(typeArena, fieldFact.type),
    );
  }
  for (const [expression, projections] of result.facts.recordProjections) {
    for (const projection of projections) {
      const id = nominalFacts.fieldIds.get(projection.record.id)?.get(projection.name);
      const span = dottedNameSegmentSpan(
        source,
        expression.node,
        expression.name,
        projection.partIndex,
      );
      if (id === undefined || !span) continue;
      addSemanticOccurrenceAtSpan(
        occurrences,
        projection.name,
        "reference",
        { kind: "field", id },
        span,
        semanticOccurrenceType(typeArena, projection.type),
      );
    }
  }
  for (const fact of nominalFacts.constructors) {
    if (fact.moduleId !== moduleId) continue;
    const scheme = result.facts.bindings.get(fact.name)?.find((binding) =>
      binding.general?.constructorDecl === fact.declaration
    )?.general;
    addSemanticOccurrence(
      occurrences,
      fact.name,
      "declaration",
      { kind: "constructor", id: fact.id },
      fact.declaration.node,
      source,
      "first",
      semanticOccurrenceType(typeArena, scheme?.type, scheme),
    );
  }
  for (const [reference, id] of nominalFacts.constructorReferences) {
    const belongsToModule = isPattern(reference)
      ? result.facts.patterns.has(reference as Pattern)
      : result.facts.expressions.has(reference as Expr);
    if (!belongsToModule) continue;
    const name = reference.kind === "Var" || reference.kind === "PCtor" ? pathOf(reference).id : "";
    const referenceFact = isPattern(reference)
      ? result.facts.patterns.get(reference)
      : result.facts.expressions.get(reference);
    const type = isPattern(reference)
      ? result.facts.patternTypes.get(reference)
      : result.types.get(reference);
    addSemanticOccurrence(
      occurrences,
      name,
      "reference",
      { kind: "constructor", id },
      reference.node,
      source,
      "last",
      semanticOccurrenceType(typeArena, referenceFact?.instantiated ?? type),
    );
  }
  for (const variable of typeVariables) {
    if (variable.binder) {
      addSemanticOccurrenceAtSpan(
        occurrences,
        variable.name,
        "declaration",
        { kind: "type-variable", id: variable.id },
        variable.binder,
      );
    }
    for (const span of variable.occurrences) {
      addSemanticOccurrenceAtSpan(
        occurrences,
        variable.name,
        "reference",
        { kind: "type-variable", id: variable.id },
        span,
      );
    }
  }
  return occurrences.sort((left, right) =>
    left.span.start - right.span.start || left.span.end - right.span.end ||
    occurrenceRoleOrder(left.role) - occurrenceRoleOrder(right.role)
  );
}

function semanticTypeVariableRegions(
  source: string,
  result: InferResult,
): readonly SemanticTypeVariableRegion[] {
  type MutableRegion = {
    id: TypeVariableId;
    name: string;
    scope: SourceSpan;
    binder?: SourceSpan;
    occurrences: SourceSpan[];
  };
  const byRegion = new Map<AstNode, Map<TypeVariableId, MutableRegion>>();
  const ensure = (
    region: AstNode,
    id: TypeVariableId,
    name: string,
  ): MutableRegion => {
    let variables = byRegion.get(region);
    if (!variables) {
      variables = new Map();
      byRegion.set(region, variables);
    }
    let variable = variables.get(id);
    if (!variable) {
      variable = {
        id,
        name,
        scope: Object.freeze({ ...region.span }),
        occurrences: [],
      };
      variables.set(id, variable);
    }
    return variable;
  };

  for (const [expression, fact] of result.facts.typeVariables) {
    if (
      fact.type.tag !== "var" || !expression.node ||
      (expression.kind !== "TVar" && expression.kind !== "TName")
    ) continue;
    const variable = ensure(
      fact.region,
      fact.type.id as TypeVariableId,
      expression.name,
    );
    variable.occurrences.push(Object.freeze({ ...expression.node.span }));
  }
  for (const declaration of result.facts.typeVariableDeclarations) {
    if (declaration.type.tag !== "var") continue;
    const variable = ensure(
      declaration.region,
      declaration.type.id as TypeVariableId,
      declaration.name,
    );
    variable.binder = typeParameterBinderSpan(
      source,
      declaration.declaration,
      declaration.parameterIndex,
      declaration.name,
    );
  }

  return Object.freeze(
    [...byRegion.values()]
      .flatMap((variables) => [...variables.values()])
      .map((variable) =>
        Object.freeze({
          id: variable.id,
          name: variable.name,
          scope: variable.scope,
          binder: variable.binder && Object.freeze({ ...variable.binder }),
          occurrences: Object.freeze(
            variable.occurrences
              .sort((left, right) => left.start - right.start)
              .map((span) => Object.freeze({ ...span })),
          ),
        })
      )
      .sort((left, right) =>
        left.scope.start - right.scope.start ||
        left.scope.end - right.scope.end ||
        left.id - right.id
      ),
  );
}

function typeParameterBinderSpan(
  source: string,
  declaration: Extract<Decl, { kind: "TypeDecl" | "RecordDecl" }>,
  parameterIndex: number,
  expectedName: string,
): SourceSpan | undefined {
  if (!declaration.node) return undefined;
  const declarationText = source.slice(declaration.node.span.start, declaration.node.span.end);
  const headerEnd = declarationText.indexOf("=");
  const header = headerEnd < 0 ? declarationText : declarationText.slice(0, headerEnd);
  const parametersStart = header.indexOf("<");
  const parametersEnd = parametersStart < 0 ? -1 : header.indexOf(">", parametersStart + 1);
  if (parametersStart < 0 || parametersEnd < 0) return undefined;
  const parameters = header.slice(parametersStart + 1, parametersEnd);
  const tokens = [...parameters.matchAll(/'?[A-Za-z_][A-Za-z0-9_']*/g)];
  const token = tokens[parameterIndex];
  if (!token || token[0] !== expectedName || token.index === undefined) return undefined;
  const start = declaration.node.span.start + parametersStart + 1 + token.index;
  const position = offsetToLineCol(source, start);
  return {
    line: position.line,
    col: position.col,
    start,
    end: start + expectedName.length,
  };
}

function importTargetIdentities(target: ImportTarget): SemanticOccurrenceTarget[] {
  const identities: SemanticOccurrenceTarget[] = [];
  if (target.value !== undefined) identities.push({ kind: "value", id: target.value });
  if (target.type !== undefined) identities.push({ kind: "type", id: target.type });
  if (target.constructor !== undefined) {
    identities.push({ kind: "constructor", id: target.constructor });
  }
  return identities;
}

function addSemanticOccurrence(
  output: ModuleSemanticOccurrence[],
  name: string,
  role: ModuleSemanticOccurrence["role"],
  target: SemanticOccurrenceTarget,
  node: AstNode | undefined,
  source: string,
  occurrence: "first" | "last" = "first",
  inferredType?: SemanticOccurrenceType,
): void {
  if (!node || name.length === 0) return;
  const span = identifierSpan(source, node, name, occurrence);
  if (!span) return;
  addSemanticOccurrenceAtSpan(output, name, role, target, span, inferredType);
}

function addSemanticOccurrenceAtSpan(
  output: ModuleSemanticOccurrence[],
  name: string,
  role: ModuleSemanticOccurrence["role"],
  target: SemanticOccurrenceTarget,
  span: SourceSpan,
  inferredType?: SemanticOccurrenceType,
): void {
  output.push(Object.freeze({
    name,
    role,
    target: Object.freeze(target),
    span: Object.freeze(span),
    inferredType,
  }));
}

function semanticOccurrenceType(
  arena: SemanticTypeArena,
  type: Ty | undefined,
  scheme?: Scheme,
): SemanticOccurrenceType | undefined {
  const selected = scheme?.type ?? type;
  if (!selected) return undefined;
  return Object.freeze({
    id: arena.snapshot(selected),
    generalized: scheme !== undefined,
    quantifiedVariables: scheme?.vars.length ?? 0,
  });
}

function addExternalValueOccurrences(
  output: ModuleSemanticOccurrence[],
  name: string,
  node: AstNode | undefined,
  valueId: ValueId,
  structureId: StructureSemanticId | undefined,
  source: string,
  inferredType: SemanticOccurrenceType | undefined,
): void {
  // `name` is a basis/standard spelling from a compiler-owned table, so the path is
  // constructed once through the sanctioned constructor.
  const path = parseLongId(name);
  if (structureId !== undefined && isQualified(path)) {
    addSemanticOccurrence(
      output,
      path.qualifiers[0],
      "qualifier",
      { kind: "structure", id: structureId },
      node,
      source,
      "first",
    );
  }
  addSemanticOccurrence(
    output,
    path.id,
    "reference",
    { kind: "value", id: valueId },
    node,
    source,
    "last",
    inferredType,
  );
}

function dottedNameSegmentSpan(
  source: string,
  node: AstNode | undefined,
  name: string,
  partIndex: number,
): SourceSpan | undefined {
  if (!node) return undefined;
  const parts = name.split(".");
  const part = parts[partIndex];
  if (part === undefined) return undefined;
  const nodeText = source.slice(node.span.start, node.span.end);
  const nameStart = nodeText.indexOf(name);
  if (nameStart < 0) return undefined;
  const prefix = parts.slice(0, partIndex).join(".");
  const start = node.span.start + nameStart + prefix.length + (partIndex === 0 ? 0 : 1);
  const position = offsetToLineCol(source, start);
  return {
    line: position.line,
    col: position.col,
    start,
    end: start + part.length,
  };
}

function identifierSpan(
  source: string,
  node: AstNode,
  name: string,
  occurrence: "first" | "last",
): SourceSpan | undefined {
  const text = source.slice(node.span.start, node.span.end);
  const relative = occurrence === "first" ? text.indexOf(name) : text.lastIndexOf(name);
  if (relative < 0) return undefined;
  const start = node.span.start + relative;
  const position = offsetToLineCol(source, start);
  return {
    line: position.line,
    col: position.col,
    start,
    end: start + name.length,
  };
}

function occurrenceRoleOrder(role: ModuleSemanticOccurrence["role"]): number {
  return role === "declaration"
    ? 0
    : role === "import-path"
    ? 1
    : role === "import-source"
    ? 2
    : role === "import-alias"
    ? 3
    : role === "qualifier"
    ? 4
    : 5;
}

function typedNodeKindOrder(kind: SemanticTypedNode["kind"]): number {
  return kind === "type-expression" ? 0 : kind === "pattern" ? 1 : 2;
}

function isPattern(value: Expr | Pattern): value is Pattern {
  return value.kind === "PWildcard" || value.kind === "PVar" || value.kind === "PInt" ||
    value.kind === "PString" || value.kind === "PBool" || value.kind === "PVoid" ||
    value.kind === "PPinned" || value.kind === "PTuple" || value.kind === "PRecord" ||
    value.kind === "PCtor";
}

function isJsImportDeclaration(
  value: Extract<Decl, { kind: "JsImportDecl" }> | JsImportSpec,
): value is Extract<Decl, { kind: "JsImportDecl" }> {
  return "kind" in value && value.kind === "JsImportDecl";
}

function jsImportSourceScheme(
  sourceId: BindingId,
  bindings: BindingFacts,
  result: InferResult,
): Scheme | undefined {
  for (const [generatedId, authoredId] of bindings.jsImportSourceBindings) {
    if (authoredId !== sourceId) continue;
    for (const [site, id] of bindings.jsImportBinders) {
      if (id !== generatedId) continue;
      const scheme = result.facts.jsImportSchemes.get(site);
      if (scheme) return scheme;
    }
  }
  return undefined;
}

function reverseDependencies(graph: ModuleGraph): ModuleMap<ModuleId[]> {
  const reverse = new Map<ModuleId, ModuleId[]>();
  for (const id of graph.order) reverse.set(id, []);
  for (const id of graph.order) {
    for (const edge of graph.nodes.get(id)!.imports) {
      const dependents = reverse.get(edge.target)!;
      if (!dependents.includes(id)) dependents.push(id);
    }
  }
  return reverse;
}

function declarationOrigins(
  moduleId: ModuleId,
  source: string,
  bindings: BindingFacts,
  nominalFacts: NominalFacts,
): ReadonlyMap<string, readonly DeclarationOrigin[]> {
  const origins = new Map<string, DeclarationOrigin[]>();
  for (const [name, bindingId] of bindings.exports) {
    const binder = [...bindings.binders].find(([pattern, id]) =>
      id === bindingId && pattern.kind === "PVar" && pattern.name === name
    )?.[0];
    const record = [...bindings.recordConstructors].find(([, id]) => id === bindingId)?.[0];
    const node = binder?.node ?? record?.node;
    const span = node ? identifierSpan(source, node, name, "first") : undefined;
    if (span) {
      addOrigin(
        origins,
        name,
        Object.freeze({ kind: "value", moduleId, bindingId, visibility: "public", span }),
      );
    }
  }
  for (const fact of nominalFacts.types) {
    if (fact.moduleId !== moduleId || !fact.exported) continue;
    const span = fact.declaration.node
      ? identifierSpan(source, fact.declaration.node, fact.name, "first")
      : undefined;
    if (!span) continue;
    addOrigin(
      origins,
      fact.name,
      Object.freeze({
        kind: "type",
        moduleId,
        typeNameId: fact.id,
        visibility: "public",
        span,
      }),
    );
  }
  for (const fact of nominalFacts.constructors) {
    if (fact.moduleId !== moduleId || !fact.exported) continue;
    const span = fact.declaration.node
      ? identifierSpan(source, fact.declaration.node, fact.name, "first")
      : undefined;
    if (!span) continue;
    addOrigin(
      origins,
      fact.name,
      Object.freeze({
        kind: "constructor",
        moduleId,
        ctorId: fact.id,
        visibility: "public",
        span,
      }),
    );
  }
  return new Map([...origins].map(([name, items]) => [name, Object.freeze(items)]));
}

function addOrigin(
  origins: Map<string, DeclarationOrigin[]>,
  name: string,
  origin: DeclarationOrigin,
): void {
  const items = origins.get(name) ?? [];
  items.push(origin);
  origins.set(name, items);
}

function importOccurrences(
  declarations: Decl[],
  edges: readonly ModuleImportEdge[],
  bindings: ModuleMap<BindingFacts>,
  nominalFacts: NominalFacts,
): ModuleImportOccurrence[] {
  const occurrences: ModuleImportOccurrence[] = [];
  let edgeIndex = 0;
  for (const declaration of declarations) {
    if (declaration.kind !== "ImportDecl") continue;
    const edge = edges[edgeIndex++];
    if (!edge) throw new Error(`missing resolved edge for import ${declaration.path}`);
    const targetBindings = bindings.get(edge.target)!;
    const structureId = bindings.get(edge.referrer)!.structureBinders.get(declaration);
    occurrences.push(Object.freeze({
      declaration,
      clause: edge.clause,
      edge,
      target: edge.target,
      structureAlias: edge.clause.kind === "Namespace" && structureId !== undefined
        ? Object.freeze({ name: edge.clause.alias, id: structureId })
        : undefined,
      targets: Object.freeze(projectedTargets(edge, targetBindings, nominalFacts)),
    }));
  }
  return occurrences;
}

function projectedTargets(
  edge: ModuleImportEdge,
  bindings: BindingFacts,
  nominalFacts: NominalFacts,
): ImportTarget[] {
  const names = edge.clause.kind === "Named"
    ? edge.clause.specs.map((spec) => ({
      sourceName: spec.name,
      localName: spec.alias ?? spec.name,
    }))
    : edge.clause.kind === "All" || edge.clause.kind === "Namespace"
    ? [
      ...new Set([
        ...bindings.exports.keys(),
        ...nominalFacts.types.filter((fact) => fact.moduleId === edge.target && fact.exported).map((
          fact,
        ) => fact.name),
      ]),
    ].map((name) => ({ sourceName: name, localName: name }))
    : [];
  return names.map(({ sourceName, localName }) => {
    const type = nominalFacts.types.find((fact) =>
      fact.moduleId === edge.target && fact.exported && fact.name === sourceName
    );
    const constructor = nominalFacts.constructors.find((fact) =>
      fact.moduleId === edge.target && fact.exported && fact.name === sourceName
    );
    return Object.freeze({
      sourceName,
      localName,
      value: bindings.exports.get(sourceName),
      type: type?.id,
      constructor: constructor?.id,
    });
  });
}
