import type { Binding, CtorDecl, Decl, Expr, Pattern } from "../ast.ts";
import type { BindingFacts } from "../binding_facts.ts";
import { GPU_SEMANTIC_IDS } from "../compiler_semantics.ts";
import type {
  GpuFragmentRootFact,
  GpuFragmentSelectionFacts,
  GpuFragmentSelectorFact,
} from "../gpu_selection.ts";
import type { InferResult } from "../infer.ts";
import type { CtorId } from "../ids.ts";
import type { ModuleGraph, ModuleNode } from "../module_graph.ts";
import type { NominalConstructorFact, NominalFacts, NominalTypeFact } from "../nominal_facts.ts";
import type { ResolvedPatternFact, ResolvedPatternFacts } from "../pattern_facts.ts";
import type { RecursionFacts } from "../recursion_facts.ts";
import type { SourceSpan } from "../source.ts";
import { instantiateRecordFields, prune, type Ty } from "../types.ts";
import {
  GPU_SLICE_SCHEMA_VERSION,
  type GpuSliceAdtDto,
  type GpuSliceBlockItemDto,
  type GpuSliceConstructorDto,
  type GpuSliceElaborationInput,
  type GpuSliceEnvironmentDto,
  type GpuSliceEnvironmentFieldDto,
  type GpuSliceExprDto,
  type GpuSliceFunctionDto,
  type GpuSlicePatternDto,
  type GpuSliceSpanDto,
  type GpuSliceTypeDto,
} from "./v2_dto.ts";
import {
  WMSLANG_BUILTIN_CATALOG_IDENTITY,
  WMSLANG_BUILTIN_CATALOG_SCHEMA_VERSION,
  WMSLANG_BUILTIN_OVERLOADS,
} from "./builtin_catalog.generated.ts";
import {
  canonicalGpuType,
  type GpuFunctionSpecialization,
  type GpuFunctionTemplate,
  GpuSpecializationError,
  specializeGpuTemplates,
} from "./v4_specialize.ts";

type LambdaExpr = Extract<Expr, { kind: "Lambda" }>;
type CallExpr = Extract<Expr, { kind: "Call" }>;

export type GpuSliceAnalysis = {
  graph: ModuleGraph;
  results: Map<string, InferResult>;
  bindings: Map<string, BindingFacts>;
  nominalFacts: NominalFacts;
  patternFacts: ResolvedPatternFacts;
  recursionFacts: RecursionFacts;
  fragmentSelections: GpuFragmentSelectionFacts;
};

export type NormalizedGpuSlice = {
  root: GpuFragmentRootFact;
  selectors: GpuFragmentSelectorFact[];
  input: GpuSliceElaborationInput;
};

export class GpuSliceNormalizationError extends Error {
  constructor(
    readonly code:
      | "gpu.fragment.count"
      | "gpu.fragment.cross-module"
      | "gpu.function.unsupported"
      | "gpu.capture.illegal"
      | "gpu.type.unsupported"
      | "gpu.adt.unsupported"
      | "gpu.pattern.unsupported"
      | "gpu.expression.unsupported"
      | "gpu.builtin.ambiguous"
      | "gpu.operation.overload"
      | "gpu.operation.ambiguous"
      | "gpu.operation.unresolved"
      | "gpu.numeric.range"
      | "gpu.recursion.mutual",
    readonly path: string,
    readonly subject: Expr | Pattern | Decl | Binding | CtorDecl | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GpuSliceNormalizationError";
  }
}

export function normalizeGpuSliceProgram(analysis: GpuSliceAnalysis): GpuSliceElaborationInput {
  const selections = analysis.fragmentSelections;
  if (selections.selectors.length === 0) return emptyInput(analysis.graph.entry);
  if (selections.selectors.length !== 1 || selections.roots.length !== 1) {
    throw new GpuSliceNormalizationError(
      "gpu.fragment.count",
      analysis.graph.entry,
      selections.selectors[1]?.call,
      "wmslang v1 accepts exactly one Gpu.fragment selection per program",
    );
  }
  return new SliceNormalizer(analysis).normalize();
}

export function normalizeGpuSlicePrograms(analysis: GpuSliceAnalysis): NormalizedGpuSlice[] {
  const selections = analysis.fragmentSelections;
  return selections.roots.map((root) => {
    const selector = root.selectors[0];
    if (!selector) {
      throw new Error(`selected GPU root ${root.id} has no selector`);
    }
    const narrowed: GpuFragmentSelectionFacts = {
      roots: [root],
      selectors: [selector],
      selectedCalls: new Set([selector.call]),
      selectedLambdas: new Set([root.lambda]),
    };
    return {
      root,
      selectors: [...root.selectors],
      input: normalizeGpuSliceProgram({ ...analysis, fragmentSelections: narrowed }),
    };
  });
}

function emptyInput(sourcePath: string): GpuSliceElaborationInput {
  return {
    schemaVersion: GPU_SLICE_SCHEMA_VERSION,
    sourcePath,
    builtinCatalog: builtinCatalog(),
    root: { functionId: -1, selectorSpanId: -1, environmentId: -1 },
    environments: [],
    environmentFields: [],
    functions: [],
    types: [],
    adts: [],
    constructors: [],
    patterns: [],
    params: [],
    lets: [],
    matchArms: [],
    blockItems: [],
    blocks: [],
    matches: [],
    expressions: [],
    recursionGroups: [],
    recursiveReferences: [],
    spans: [],
  };
}

type FunctionSite = {
  id: number;
  templateId?: number;
  bindingId: number;
  name: string;
  lambda: LambdaExpr;
  binding?: Binding;
};

class SliceNormalizer {
  readonly root: GpuFragmentSelectionFacts["roots"][number];
  readonly selector: GpuFragmentSelectionFacts["selectors"][number];
  readonly path: string;
  readonly node: ModuleNode;
  readonly result: InferResult;
  readonly bindings: BindingFacts;

  readonly functions: GpuSliceFunctionDto[] = [];
  readonly environments: GpuSliceEnvironmentDto[] = [];
  readonly environmentFields: GpuSliceEnvironmentFieldDto[] = [];
  readonly types: GpuSliceTypeDto[] = [];
  readonly adts: GpuSliceAdtDto[] = [];
  readonly constructors: GpuSliceConstructorDto[] = [];
  readonly patterns: GpuSlicePatternDto[] = [];
  readonly params: GpuSliceElaborationInput["params"] = [];
  readonly lets: GpuSliceElaborationInput["lets"] = [];
  readonly matchArms: GpuSliceElaborationInput["matchArms"] = [];
  readonly blockItems: GpuSliceBlockItemDto[] = [];
  readonly blocks: GpuSliceElaborationInput["blocks"] = [];
  readonly matches: GpuSliceElaborationInput["matches"] = [];
  readonly expressions: GpuSliceExprDto[] = [];
  readonly recursionGroups: GpuSliceElaborationInput["recursionGroups"] = [];
  readonly recursiveReferences: GpuSliceElaborationInput["recursiveReferences"] = [];
  readonly spans: GpuSliceSpanDto[] = [];

  readonly #functionSites: FunctionSite[] = [];
  readonly #specializedSites: FunctionSite[] = [];
  readonly #functionByBinding = new Map<number, FunctionSite>();
  readonly #topLevelLambdas = new Map<number, { binding: Binding; lambda: LambdaExpr }>();
  readonly #localLambdas = new Map<number, { binding: Binding; lambda: LambdaExpr }>();
  readonly #inlineLambdaBindings = new Map<LambdaExpr, number>();
  readonly #valueBindingOwner = new Map<number, number>();
  readonly #typesByKey = new Map<string, number>();
  readonly #patternsById = new Map<string, GpuSlicePatternDto>();
  readonly #adtsById = new Map<number, GpuSliceAdtDto>();
  readonly #constructorsById = new Map<number, GpuSliceConstructorDto>();
  readonly #spansByKey = new Map<string, number>();
  readonly #environmentFieldsByName = new Map<string, GpuSliceEnvironmentFieldDto>();
  readonly #environmentFieldTypes = new Map<string, Ty>();
  readonly #usedResourceFieldIndexes = new Set<number>();
  readonly #specializationById = new Map<number, GpuFunctionSpecialization>();
  readonly #functionBindingById = new Map<number, number>();
  readonly #recursionGroupByFunctionId = new Map<number, number>();
  readonly #minimumI32MagnitudeLiterals = new WeakSet<Expr>();
  #environmentBindingId = -1;
  #currentFunctionId = -1;
  #currentTemplateId = -1;
  #currentSpecialization: GpuFunctionSpecialization | undefined;
  #nextSyntheticBindingId = 0;
  #nextInlineBindingId = -2;

  constructor(readonly analysis: GpuSliceAnalysis) {
    this.root = analysis.fragmentSelections.roots[0];
    this.selector = analysis.fragmentSelections.selectors[0];
    this.path = this.root.path;
    this.node = required(analysis.graph.nodes, this.path, "selected root module");
    this.result = required(analysis.results, this.path, "selected root inference result");
    this.bindings = required(analysis.bindings, this.path, "selected root binding facts");
    this.#nextSyntheticBindingId = Math.max(-1, ...this.bindings.local) + 1;
    if (this.selector.path !== this.path) {
      throw new GpuSliceNormalizationError(
        "gpu.fragment.cross-module",
        this.selector.path,
        this.selector.call,
        "wmslang v1 requires the fragment selection and selected root in one module",
      );
    }
  }

  normalize(): GpuSliceElaborationInput {
    this.indexTopLevelLambdas();
    this.indexLocalLambdas();
    this.addEnvironment();
    this.discoverFunctions();
    this.collectOwnedBindings();
    this.validateFunctionCaptures();
    this.specializeFunctions();
    this.addRecursionGroups();
    this.#specializedSites.forEach((site) => this.addFunction(site));
    this.validateResourceFieldsAreUsed();
    return {
      schemaVersion: GPU_SLICE_SCHEMA_VERSION,
      sourcePath: this.path,
      builtinCatalog: builtinCatalog(),
      root: {
        functionId: 0,
        selectorSpanId: this.span(this.selector.call),
        environmentId: this.environments.length === 0 ? -1 : 0,
      },
      environments: this.environments,
      environmentFields: this.environmentFields,
      functions: this.functions,
      types: this.types,
      adts: this.adts,
      constructors: this.constructors,
      patterns: this.patterns,
      params: this.params,
      lets: this.lets,
      matchArms: this.matchArms,
      blockItems: this.blockItems,
      blocks: this.blocks,
      matches: this.matches,
      expressions: this.expressions,
      recursionGroups: this.recursionGroups,
      recursiveReferences: this.recursiveReferences,
      spans: this.spans,
    };
  }

  validateResourceFieldsAreUsed(): void {
    const unused = this.environmentFields.find((field) =>
      field.kind !== "uniform" && !this.#usedResourceFieldIndexes.has(field.declaredIndex)
    );
    if (!unused) return;
    throw this.error(
      "gpu.type.unsupported",
      this.selector.call,
      `shader environment resource ${unused.name} is declared but never used by the selected GPU root; unused resources would make the reflected WebGPU layout ambiguous`,
    );
  }

  indexTopLevelLambdas(): void {
    for (const declaration of this.node.module.decls) {
      if (declaration.kind !== "LetDecl") continue;
      for (const binding of declaration.bindings) {
        if (binding.pattern.kind !== "PVar" || binding.value.kind !== "Lambda") continue;
        const id = this.bindings.binders.get(binding.pattern);
        if (id !== undefined) this.#topLevelLambdas.set(id, { binding, lambda: binding.value });
      }
    }
  }

  indexLocalLambdas(): void {
    this.walk(this.root.lambda.body, (_expression, declaration) => {
      if (declaration?.kind !== "LetDecl") return;
      for (const binding of declaration.bindings) {
        if (binding.pattern.kind !== "PVar" || binding.value.kind !== "Lambda") continue;
        const id = this.bindings.binders.get(binding.pattern);
        if (id !== undefined) this.#localLambdas.set(id, { binding, lambda: binding.value });
      }
    });
  }

  addEnvironment(): void {
    const factory = this.root.factory;
    if (!factory) return;
    if (factory.path !== this.path) {
      throw new GpuSliceNormalizationError(
        "gpu.fragment.cross-module",
        factory.path,
        factory.lambda,
        "the v2 shader factory and its GPU body must be declared in one module",
      );
    }
    if (factory.parameter.pattern.kind !== "PVar") {
      throw this.error(
        "gpu.pattern.unsupported",
        factory.parameter.pattern,
        "the v2 shader environment parameter must be one named record binding",
      );
    }
    const bindingId = this.bindings.binders.get(factory.parameter.pattern);
    const appliedEnvironment = this.selector.environmentArgument
      ? this.result.types.get(this.selector.environmentArgument)
      : undefined;
    const parameterFact = this.analysis.patternFacts.byParam.get(factory.parameter);
    const environmentSource = appliedEnvironment ?? parameterFact?.type;
    const environmentType = environmentSource ? prune(environmentSource) : undefined;
    const typeNameId = environmentType?.tag === "named"
      ? this.analysis.nominalFacts.inferenceTypeIds.get(environmentType.id)
      : undefined;
    const nominal = typeNameId === undefined
      ? undefined
      : this.analysis.nominalFacts.types.find((item) =>
        item.id === typeNameId && item.kind === "record"
      );
    const record = nominal
      ? this.analysis.nominalFacts.records.find((item) => item.typeNameId === nominal.id)
      : undefined;
    const info = record
      ? [...this.result.typeEnv.values()].find((item) => item.id === record.inferenceTypeId)
      : undefined;
    if (bindingId === undefined || environmentType?.tag !== "named" || !record || !info) {
      throw this.error(
        "gpu.type.unsupported",
        factory.parameter.pattern,
        "the shader factory argument must infer one nominal record environment type",
      );
    }
    if (!info.recordFields || record.modulePath !== this.path) {
      throw this.error(
        "gpu.type.unsupported",
        factory.parameter.pattern,
        "the v2 shader environment must use a nominal record declared beside the shader factory",
      );
    }
    if (record.declaration.params.length !== 0 || environmentType.args.length !== 0) {
      throw this.error(
        "gpu.type.unsupported",
        record.declaration,
        "generic shader environment records are outside the initial v2 slice",
      );
    }

    const environmentId = 0;
    const fields = instantiateRecordFields(info, []);
    const normalizedFields = fields.map((field, declaredIndex) => {
      let typeId: number;
      try {
        typeId = this.type(field.type);
      } catch (_error) {
        throw this.error(
          "gpu.type.unsupported",
          record.declaration,
          `shader environment field ${field.name} must be a numeric uniform, Gpu.SampledTexture2D, or Gpu.Sampler`,
        );
      }
      const normalizedType = this.types[typeId];
      const supported = normalizedType.kind === "number" ||
        (normalizedType.kind === "tuple" && normalizedType.items.length >= 2 &&
          normalizedType.items.length <= 4 &&
          normalizedType.items.every((item) => this.types[item]?.kind === "number")) ||
        normalizedType.kind === "sampled-texture-2d" || normalizedType.kind === "sampler";
      if (!supported) {
        throw this.error(
          "gpu.type.unsupported",
          record.declaration,
          `shader environment field ${field.name} must be a numeric uniform, Gpu.SampledTexture2D, or Gpu.Sampler`,
        );
      }
      const kind: GpuSliceEnvironmentFieldDto["kind"] = normalizedType.kind === "sampled-texture-2d"
        ? "sampled-texture-2d"
        : normalizedType.kind === "sampler"
        ? "sampler"
        : "uniform";
      return { field, declaredIndex, typeId, kind };
    });
    const hasUniforms = normalizedFields.some((field) => field.kind === "uniform");
    let resourceIndex = 0;
    normalizedFields.forEach(({ field, declaredIndex, typeId, kind }) => {
      const row: GpuSliceEnvironmentFieldDto = {
        id: this.environmentFields.length,
        environmentId,
        name: field.name,
        declaredIndex,
        kind,
        binding: kind === "uniform" ? 0 : (hasUniforms ? 1 : 0) + resourceIndex++,
        typeId,
        spanId: this.span(record.declaration),
      };
      this.environmentFields.push(row);
      this.#environmentFieldsByName.set(row.name, row);
      this.#environmentFieldTypes.set(row.name, field.type);
    });
    this.#environmentBindingId = bindingId;
    this.environments.push({
      id: environmentId,
      recordId: record.id,
      typeNameId: record.typeNameId,
      name: record.name,
      bindingId,
      fieldIds: this.environmentFields.map((field) => field.id),
      spanId: this.span(record.declaration),
    });
  }

  discoverFunctions(): void {
    const rootBindingId = this.root.bindingId ?? -1;
    this.registerFunction({
      id: 0,
      bindingId: rootBindingId,
      name: this.root.binding?.pattern.kind === "PVar"
        ? this.root.binding.pattern.name
        : "fragment",
      lambda: this.root.lambda,
      binding: this.root.binding,
    });
    for (let index = 0; index < this.#functionSites.length; index++) {
      this.walk(this.#functionSites[index].lambda.body, (expression) => {
        if (expression.kind !== "Call") return;
        const candidates = [expression.callee, ...expression.args];
        for (const candidate of candidates) {
          if (candidate.kind === "Lambda") {
            if (this.#inlineLambdaBindings.has(candidate)) continue;
            const bindingId = this.#nextInlineBindingId--;
            this.#inlineLambdaBindings.set(candidate, bindingId);
            this.registerFunction({
              id: this.#functionSites.length,
              bindingId,
              name: "lambda",
              lambda: candidate,
            });
            continue;
          }
          if (candidate.kind !== "Var") continue;
          if (candidate === expression.callee) {
            if (this.semanticId(candidate) || this.constructorId(candidate) !== -1) continue;
          }
          const bindingId = this.bindings.references.get(candidate);
          if (bindingId === undefined || this.#functionByBinding.has(bindingId)) continue;
          const helper = this.#localLambdas.get(bindingId);
          if (!helper) continue;
          this.registerFunction({
            id: this.#functionSites.length,
            bindingId,
            name: helper.binding.pattern.kind === "PVar" ? helper.binding.pattern.name : "helper",
            lambda: helper.lambda,
            binding: helper.binding,
          });
        }
      });
    }
  }

  specializeFunctions(): void {
    const templates = new Map<number, GpuFunctionTemplate>();
    for (const site of this.#functionSites) {
      templates.set(site.bindingId, this.functionTemplate(site));
    }
    const selected = this.result.types.get(this.selector.argument);
    const selectedType = selected ? prune(selected) : undefined;
    if (!selectedType || selectedType.tag !== "fn" || selectedType.params.length !== 1) {
      throw this.error(
        "gpu.type.unsupported",
        this.selector.argument,
        "selected fragment has no contextual function type",
      );
    }
    const rootSite = requiredObject(this.#functionSites[0], "missing root function site");
    let instances: GpuFunctionSpecialization[];
    try {
      instances = specializeGpuTemplates({
        rootBindingId: rootSite.bindingId,
        rootArgs: unpackCallType(selectedType.params[0], rootSite.lambda.params.length),
        rootResult: selectedType.result,
        templates,
        freshenCallSites: true,
      });
    } catch (error) {
      if (!(error instanceof GpuSpecializationError)) throw error;
      throw this.error(
        error.code === "gpu.operation.overload"
          ? "gpu.operation.overload"
          : error.code === "gpu.operation.ambiguous"
          ? "gpu.operation.ambiguous"
          : error.code === "gpu.operation.unresolved"
          ? "gpu.operation.unresolved"
          : error.code === "gpu.higher-order.unsupported"
          ? "gpu.function.unsupported"
          : "gpu.type.unsupported",
        error.occurrence ?? this.root.lambda,
        error.message,
      );
    }
    const instanceCounts = new Map<number, number>();
    for (const instance of instances) {
      instanceCounts.set(
        instance.template.bindingId,
        (instanceCounts.get(instance.template.bindingId) ?? 0) + 1,
      );
    }
    for (const instance of instances) {
      const templateSite = requiredObject(
        this.#functionSites.find((site) => site.bindingId === instance.template.bindingId),
        `missing function site for ${instance.template.name}`,
      );
      this.#specializationById.set(instance.id, instance);
      this.#functionBindingById.set(instance.id, this.#nextSyntheticBindingId++);
      this.#specializedSites.push({
        ...templateSite,
        id: instance.id,
        templateId: templateSite.id,
        name: (instanceCounts.get(instance.template.bindingId) ?? 0) === 1
          ? templateSite.name
          : `${templateSite.name}__${specializationSuffix(instance)}`,
      });
    }
  }

  functionTemplate(site: FunctionSite): GpuFunctionTemplate {
    const lambdaType = this.result.types.get(site.lambda);
    const resolved = lambdaType ? prune(lambdaType) : undefined;
    if (!resolved || resolved.tag !== "fn") {
      throw this.error("gpu.type.unsupported", site.lambda, "GPU helper has no HM function type");
    }
    const params = site.lambda.params.map((param) =>
      requiredObject(this.analysis.patternFacts.byParam.get(param), "missing GPU parameter fact")
        .type
    );
    const occurrenceTypes = new Map<object, Ty>([[site.lambda, lambdaType!]]);
    const operations: GpuFunctionTemplate["operations"] = [];
    const calls: GpuFunctionTemplate["calls"] = [];
    const equalities: [Ty, Ty][] = [];
    const functionParamBindings = new Map<number, number>();
    site.lambda.params.forEach((param, index) => {
      const bindingId = param.pattern.kind === "PVar"
        ? this.bindings.binders.get(param.pattern)
        : undefined;
      if (bindingId !== undefined) functionParamBindings.set(bindingId, index);
    });
    visitOwnedFunction(
      site.lambda,
      (expression) => {
        const type = this.result.types.get(expression);
        if (type) occurrenceTypes.set(expression, type);
        const operation = this.result.facts.gpuOperations.get(expression);
        if (operation) operations.push(operation);
        if (expression.kind === "Var" && this.#environmentBindingId >= 0) {
          const bindingId = this.bindings.references.get(expression);
          const parts = expression.name.split(".");
          const fieldType = bindingId === this.#environmentBindingId
            ? this.#environmentFieldTypes.get(parts[1])
            : undefined;
          if (type && fieldType) {
            equalities.push([
              type,
              parts.length === 3 ? numberComponent(fieldType, parts[2]) : fieldType,
            ]);
            if (parts.length === 3 && operation?.kind === "projection") {
              equalities.push([operation.args[0], fieldType]);
            }
          }
        }
        if (expression.kind !== "Call" || expression.callee.kind !== "Var") return;
        const targetBindingId = this.bindings.references.get(expression.callee);
        if (targetBindingId === undefined) return;
        const directTarget = this.#functionByBinding.has(targetBindingId)
          ? targetBindingId
          : undefined;
        const targetFunctionParam = functionParamBindings.get(targetBindingId);
        if (directTarget === undefined && targetFunctionParam === undefined) return;
        const result = requiredObject(
          this.result.types.get(expression),
          "missing GPU call result type",
        );
        calls.push({
          occurrence: expression,
          targetBindingId: directTarget,
          targetFunctionParam,
          args: expression.args.map((argument) =>
            requiredObject(this.result.types.get(argument), "missing GPU call argument type")
          ),
          result,
          staticFunctionArgs: expression.args.map((argument) => {
            if (argument.kind === "Lambda") return this.#inlineLambdaBindings.get(argument);
            if (argument.kind !== "Var") return undefined;
            const bindingId = this.bindings.references.get(argument);
            return bindingId !== undefined && this.#localLambdas.has(bindingId)
              ? bindingId
              : undefined;
          }),
        });
      },
      (pattern) => {
        const fact = this.analysis.patternFacts.byPattern.get(pattern);
        if (fact) occurrenceTypes.set(pattern, fact.type);
      },
    );
    return {
      bindingId: site.bindingId,
      name: site.name,
      params,
      result: resolved.result,
      occurrenceTypes,
      equalities,
      operations,
      calls,
    };
  }

  registerFunction(site: FunctionSite): void {
    this.#functionSites.push(site);
    if (site.bindingId >= 0) this.#functionByBinding.set(site.bindingId, site);
  }

  collectOwnedBindings(): void {
    for (const site of this.#functionSites) {
      site.lambda.params.forEach((param) => this.collectPatternBindings(param.pattern, site.id));
      this.collectExpressionBindings(site.lambda.body, site.id);
    }
  }

  validateFunctionCaptures(): void {
    for (const site of this.#functionSites) {
      visitOwnedFunction(
        site.lambda,
        (expression) => {
          if (
            (expression.kind === "Record" || expression.kind === "JsonObject") &&
            expression.fields.some((field) => {
              const type = this.result.types.get(field.value);
              return type !== undefined && prune(type).tag === "fn";
            })
          ) {
            throw this.error(
              "gpu.function.unsupported",
              expression,
              "GPU function values may not be stored in records or survive specialization",
            );
          }
          if (
            expression.kind === "Tuple" && expression.items.some((item) => {
              const type = this.result.types.get(item);
              return type !== undefined && prune(type).tag === "fn";
            })
          ) {
            throw this.error(
              "gpu.function.unsupported",
              expression,
              "GPU function values may not be stored in tuples or survive specialization",
            );
          }
          if (expression.kind !== "Var") return;
          const bindingId = this.bindings.references.get(expression);
          if (bindingId === undefined || bindingId === this.#environmentBindingId) return;
          const expressionType = this.result.types.get(expression);
          if (expressionType && prune(expressionType).tag === "fn") return;
          if (
            this.#functionByBinding.has(bindingId) || this.#localLambdas.has(bindingId) ||
            this.#topLevelLambdas.has(bindingId)
          ) return;
          if (this.#valueBindingOwner.get(bindingId) === site.id) return;
          throw this.error(
            "gpu.capture.illegal",
            expression,
            `GPU-local functions must receive ${expression.name} as a parameter instead of capturing it`,
          );
        },
        () => {},
      );
    }
  }

  collectPatternBindings(pattern: Pattern, functionId: number): void {
    const fact = this.analysis.patternFacts.byPattern.get(pattern);
    if (!fact) return;
    if (fact.bindingId !== undefined) this.#valueBindingOwner.set(fact.bindingId, functionId);
    fact.children.forEach((id) => {
      const child = this.analysis.patternFacts.patterns.find((item) => item.id === id);
      if (child) this.collectPatternBindings(child.pattern, functionId);
    });
  }

  collectExpressionBindings(expression: Expr, functionId: number): void {
    switch (expression.kind) {
      case "Tuple":
      case "JsonArray":
        expression.items.forEach((item) => this.collectExpressionBindings(item, functionId));
        return;
      case "Record":
      case "JsonObject":
        expression.fields.forEach((field) =>
          this.collectExpressionBindings(field.value, functionId)
        );
        return;
      case "FfiGet":
        this.collectExpressionBindings(expression.receiver, functionId);
        return;
      case "FfiCall":
        this.collectExpressionBindings(expression.receiver, functionId);
        expression.args.forEach((argument) => this.collectExpressionBindings(argument, functionId));
        return;
      case "FfiBindingCall":
        expression.args.forEach((argument) => this.collectExpressionBindings(argument, functionId));
        return;
      case "Lambda":
        // Function declarations are collected as independent sites. Any other nested lambda is
        // rejected by expression normalization and must not donate bindings to its owner.
        return;
      case "Call":
        this.collectExpressionBindings(expression.callee, functionId);
        expression.args.forEach((argument) => this.collectExpressionBindings(argument, functionId));
        return;
      case "If":
        this.collectExpressionBindings(expression.cond, functionId);
        this.collectExpressionBindings(expression.thenExpr, functionId);
        this.collectExpressionBindings(expression.elseExpr, functionId);
        return;
      case "Match":
        this.collectExpressionBindings(expression.value, functionId);
        expression.arms.forEach((arm) => {
          this.collectPatternBindings(arm.pattern, functionId);
          this.collectExpressionBindings(arm.body, functionId);
        });
        return;
      case "Panic":
        this.collectExpressionBindings(expression.message, functionId);
        return;
      case "Block":
        expression.items.forEach((item) => {
          if (!isDecl(item)) {
            this.collectExpressionBindings(item, functionId);
            return;
          }
          if (item.kind !== "LetDecl") return;
          item.bindings.forEach((binding) => {
            const bindingId = binding.pattern.kind === "PVar"
              ? this.bindings.binders.get(binding.pattern)
              : undefined;
            if (
              binding.value.kind === "Lambda" && bindingId !== undefined &&
              this.#localLambdas.has(bindingId)
            ) return;
            this.collectPatternBindings(binding.pattern, functionId);
            this.collectExpressionBindings(binding.value, functionId);
          });
        });
        this.collectExpressionBindings(expression.result, functionId);
        return;
      case "Binary":
      case "Pipe":
        this.collectExpressionBindings(expression.left, functionId);
        this.collectExpressionBindings(expression.right, functionId);
        return;
      case "Unary":
        this.collectExpressionBindings(expression.value, functionId);
        return;
      default:
        return;
    }
  }

  addFunction(site: FunctionSite): void {
    const specialization = requiredObject(
      this.#specializationById.get(site.id),
      `missing specialization for ${site.name}`,
    );
    const previousFunctionId = this.#currentFunctionId;
    const previousTemplateId = this.#currentTemplateId;
    const previousSpecialization = this.#currentSpecialization;
    this.#currentFunctionId = site.id;
    this.#currentTemplateId = site.templateId ?? site.id;
    this.#currentSpecialization = specialization;
    const paramIds = site.lambda.params.flatMap((param, index) => {
      if (specialization.staticFunctionParams[index] !== undefined) return [];
      const fact = requiredObject(
        this.analysis.patternFacts.byParam.get(param),
        "missing resolved parameter fact",
      );
      const typeId = site.id === 0 && index === 0
        ? this.rootCoordinateType()
        : this.type(specialization.occurrenceTypes.get(fact.param.pattern) ?? fact.type);
      const patternId = this.addPattern(fact.patternId, "parameter", typeId);
      const paramId = this.params.length;
      this.params.push({
        id: paramId,
        patternId,
        typeId,
        declaredIndex: index,
        spanId: this.span(param),
      });
      return [paramId];
    });
    const resultTypeId = this.type(specialization.result);
    const normalizedParamTypeIds = paramIds.map((paramId) =>
      requiredObject(
        this.params.find((param) => param.id === paramId),
        `missing normalized parameter ${paramId}`,
      ).typeId
    );
    const functionTypeId = this.internType(
      `fn:${normalizedParamTypeIds.join(",")}=>${resultTypeId}`,
      () => ({
        ...baseType("function"),
        params: normalizedParamTypeIds,
        result: resultTypeId,
      }),
    );
    let bodyExprId: number;
    try {
      bodyExprId = this.expr(site.lambda.body);
    } finally {
      this.#currentFunctionId = previousFunctionId;
      this.#currentTemplateId = previousTemplateId;
      this.#currentSpecialization = previousSpecialization;
    }
    this.functions.push({
      id: site.id,
      bindingId: requiredObject(
        this.#functionBindingById.get(site.id),
        `missing cloned function binding for ${site.name}`,
      ),
      sourceBindingId: site.bindingId,
      name: site.name,
      typeId: functionTypeId,
      paramIds,
      resultTypeId,
      bodyExprId,
      recursionGroupId: this.#recursionGroupByFunctionId.get(site.id) ?? -1,
      spanId: this.span(site.lambda),
    });
  }

  addRecursionGroups(): void {
    for (const site of this.#specializedSites) {
      const recursion = site.binding
        ? this.analysis.recursionFacts.byBinding.get(site.binding)
        : undefined;
      if (!recursion) continue;
      const sourceGroup = this.analysis.recursionFacts.groups.find((group) =>
        group.id === recursion.groupId
      );
      if (!sourceGroup || sourceGroup.members.length !== 1) {
        throw new GpuSliceNormalizationError(
          "gpu.recursion.mutual",
          sourceGroup?.path ?? this.path,
          sourceGroup?.declaration ?? site.binding,
          "wmslang v1 accepts only a single-member recursive group",
        );
      }
      const groupId = this.recursionGroups.length;
      this.#recursionGroupByFunctionId.set(site.id, groupId);
      this.recursionGroups.push({
        id: groupId,
        memberFunctionIds: [site.id],
        spanId: this.span(sourceGroup.declaration),
      });
    }
  }

  expr(expression: Expr): number {
    const id = this.expressions.length;
    this.expressions.push(undefined as unknown as GpuSliceExprDto);
    let row: GpuSliceExprRow;
    switch (expression.kind) {
      case "Int":
        if (
          !Number.isSafeInteger(expression.value) || expression.value < -2_147_483_648 ||
          (expression.value > 2_147_483_647 &&
            !(expression.value === 2_147_483_648 &&
              this.#minimumI32MagnitudeLiterals.has(expression)))
        ) {
          throw this.error(
            "gpu.numeric.range",
            expression,
            `GPU integer literal ${expression.value} is outside signed i32 range`,
          );
        }
        row = baseExpr("number", { numberValue: expression.value, numberKind: "i32" });
        break;
      case "Float":
        row = baseExpr("number", { numberValue: expression.value, numberKind: "f32" });
        break;
      case "Bool":
        row = baseExpr("bool", { boolValue: expression.value });
        break;
      case "Void": {
        // A trailing semicolon's expression already appears as its block item.
        // implicitStatement is provenance, not a second executable occurrence.
        row = baseExpr("void");
        break;
      }
      case "Var":
        row = this.varExpr(expression);
        break;
      case "Tuple":
        row = baseExpr("tuple", { children: expression.items.map((item) => this.expr(item)) });
        break;
      case "Call":
        row = this.callExpr(expression, id);
        break;
      case "If":
        row = baseExpr("if", {
          children: [
            this.expr(expression.cond),
            this.expr(expression.thenExpr),
            this.expr(expression.elseExpr),
          ],
        });
        break;
      case "Match": {
        const valueExprId = this.expr(expression.value);
        const armIds = expression.arms.map((arm, index) => {
          const fact = requiredObject(
            this.analysis.patternFacts.byMatchArm.get(arm),
            "missing resolved match-arm fact",
          );
          const patternId = this.addPattern(fact.patternId, "match");
          const bodyExprId = this.expr(arm.body);
          const armId = this.matchArms.length;
          this.matchArms.push({
            id: armId,
            patternId,
            bodyExprId,
            declaredIndex: index,
            spanId: this.span(arm),
          });
          return armId;
        });
        this.matches.push({ expressionId: id, valueExprId, armIds });
        row = baseExpr("match", {
          children: [
            valueExprId,
            ...armIds.map((armId) =>
              requiredObject(
                this.matchArms.find((arm) => arm.id === armId),
                "missing normalized match arm",
              ).bodyExprId
            ),
          ],
        });
        break;
      }
      case "Block":
        row = this.blockExpr(expression, id);
        break;
      case "Binary":
      case "Unary": {
        const operatorId = this.result.facts.operators.get(expression);
        if (!operatorId) {
          throw this.error(
            "gpu.expression.unsupported",
            expression,
            `operator ${expression.op} is outside the v1 catalog`,
          );
        }
        if (
          expression.kind === "Unary" && expression.op === "-" &&
          expression.value.kind === "Int" && expression.value.value === 2_147_483_648
        ) {
          this.#minimumI32MagnitudeLiterals.add(expression.value);
        }
        row = baseExpr(expression.kind === "Binary" ? "binary" : "unary", {
          operatorId,
          children: expression.kind === "Binary"
            ? [this.expr(expression.left), this.expr(expression.right)]
            : [this.expr(expression.value)],
        });
        break;
      }
      default:
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          `${expression.kind} is outside the wmslang v1 expression slice`,
        );
    }
    const type = this.typeForExpr(expression);
    if (!type) {
      throw this.error("gpu.type.unsupported", expression, "missing inferred expression type");
    }
    this.expressions[id] = {
      id,
      typeId: row.kind === "uniform"
        ? requiredObject(
          this.environmentFields.find((field) => field.declaredIndex === row.index),
          `missing shader environment field ${row.index}`,
        ).typeId
        : this.type(type),
      spanId: this.span(expression),
      ownerFunctionId: this.#currentFunctionId,
      ...row,
    };
    return id;
  }

  varExpr(
    expression: Extract<Expr, { kind: "Var" }>,
  ): GpuSliceExprRow {
    const uniform = this.environmentProjectionExpr(expression);
    if (uniform) return uniform;
    const projection = this.vectorProjectionExpr(expression);
    if (projection) return projection;
    const constructorId = this.constructorId(expression);
    if (constructorId >= 0) {
      const constructor = this.addConstructor(constructorId as CtorId);
      if (constructor.payloadTypeId >= 0) {
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          "a payload constructor must be called directly",
        );
      }
      return baseExpr("constructor", { constructorId });
    }
    const bindingId = this.bindings.references.get(expression);
    if (bindingId === undefined) {
      throw this.error(
        "gpu.capture.illegal",
        expression,
        `unresolved GPU value ${expression.name}`,
      );
    }
    if (this.#functionByBinding.has(bindingId) || this.#localLambdas.has(bindingId)) {
      throw this.error(
        "gpu.function.unsupported",
        expression,
        "GPU-local functions may appear only as direct callees and may not escape as values",
      );
    }
    if (this.#topLevelLambdas.has(bindingId)) {
      throw this.error(
        "gpu.function.unsupported",
        expression,
        "top-level helpers are outside the selected lexical GPU island; declare the helper inside the @gpu root",
      );
    }
    if (this.#valueBindingOwner.get(bindingId) !== this.#currentTemplateId) {
      throw this.error(
        "gpu.capture.illegal",
        expression,
        `GPU-local functions must receive ${expression.name} as a parameter instead of capturing it`,
      );
    }
    if (expression.name.includes(".")) {
      throw this.error(
        "gpu.expression.unsupported",
        expression,
        `GPU dotted value ${expression.name} is not a supported vector projection`,
      );
    }
    return baseExpr("var", { bindingId });
  }

  environmentProjectionExpr(
    expression: Extract<Expr, { kind: "Var" }>,
  ): GpuSliceExprRow | undefined {
    if (this.#environmentBindingId < 0) return undefined;
    const parts = expression.name.split(".");
    if (parts.length !== 2 && parts.length !== 3) return undefined;
    const bindingId = this.bindings.references.get(expression);
    if (bindingId !== this.#environmentBindingId) return undefined;
    const field = this.#environmentFieldsByName.get(parts[1]);
    if (!field) {
      throw this.error(
        "gpu.expression.unsupported",
        expression,
        `shader environment ${parts[0]} has no field ${parts[1]}`,
      );
    }
    if (parts.length === 3) {
      const lane = ({ x: 0, y: 1, z: 2, w: 3 } as const)[
        parts[2] as "x" | "y" | "z" | "w"
      ];
      const fieldType = this.types[field.typeId];
      if (
        lane === undefined || fieldType.kind !== "tuple" || lane >= fieldType.items.length ||
        fieldType.items.some((item) => this.types[item]?.kind !== "number")
      ) {
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          `shader environment projection ${expression.name} does not select a valid vector lane`,
        );
      }
      const childId = this.expressions.length;
      this.expressions.push({
        id: childId,
        typeId: field.typeId,
        spanId: this.span(expression),
        ownerFunctionId: this.#currentFunctionId,
        ...baseExpr("uniform", { index: field.declaredIndex }),
      });
      return baseExpr("project", { index: lane, children: [childId] });
    }
    if (field.kind !== "uniform") this.#usedResourceFieldIndexes.add(field.declaredIndex);
    return baseExpr(field.kind === "uniform" ? "uniform" : "resource", {
      index: field.declaredIndex,
    });
  }

  vectorProjectionExpr(
    expression: Extract<Expr, { kind: "Var" }>,
  ): GpuSliceExprRow | undefined {
    const parts = expression.name.split(".");
    if (parts.length !== 2) return undefined;
    const index = ({ x: 0, y: 1, z: 2, w: 3 } as const)[
      parts[1] as "x" | "y" | "z" | "w"
    ];
    if (index === undefined) return undefined;
    const bindingId = this.bindings.references.get(expression);
    if (
      bindingId === undefined ||
      this.#valueBindingOwner.get(bindingId) !== this.#currentTemplateId
    ) return undefined;
    const binding = this.analysis.patternFacts.patterns.find((fact) =>
      fact.bindingId === bindingId
    );
    if (!binding) return undefined;
    const receiverType = this.typeForPattern(binding.pattern, binding.type);
    const receiver = prune(receiverType);
    if (
      receiver.tag !== "tuple" || receiver.items.length < 2 || receiver.items.length > 4 ||
      index >= receiver.items.length ||
      receiver.items.some((item) => {
        const type = prune(item);
        return type.tag !== "prim" || type.name !== "Number";
      })
    ) return undefined;
    const childId = this.expressions.length;
    this.expressions.push({
      id: childId,
      typeId: this.type(receiverType),
      spanId: this.span(expression),
      ownerFunctionId: this.#currentFunctionId,
      ...baseExpr("var", { bindingId }),
    });
    return baseExpr("project", { index, children: [childId] });
  }

  callExpr(
    expression: CallExpr,
    expressionId: number,
  ): GpuSliceExprRow {
    const resourceCall = this.result.facts.gpuResourceCalls.get(expression);
    if (resourceCall) {
      const parts = resourceCall.receiverName.split(".");
      const receiverBindingId = expression.callee.kind === "Var"
        ? this.bindings.references.get(expression.callee)
        : undefined;
      const field = parts.length === 2 && receiverBindingId === this.#environmentBindingId
        ? this.#environmentFieldsByName.get(parts[1])
        : undefined;
      if (!field || field.kind !== "sampled-texture-2d") {
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          "sampled texture calls require a Gpu.SampledTexture2D field from the current shader environment",
        );
      }
      this.#usedResourceFieldIndexes.add(field.declaredIndex);
      const receiverId = this.expressions.length;
      this.expressions.push({
        id: receiverId,
        typeId: field.typeId,
        spanId: this.span(expression.callee),
        ownerFunctionId: this.#currentFunctionId,
        ...baseExpr("resource", { index: field.declaredIndex }),
      });
      return baseExpr("resource-call", {
        resourceOperation: resourceCall.operation,
        children: [receiverId, ...expression.args.map((argument) => this.expr(argument))],
      });
    }
    const builtinName = this.result.facts.gpuBuiltins.get(expression);
    if (builtinName) {
      const unresolved = [...expression.args, expression].some((item) => {
        const type = this.typeForExpr(item);
        return type !== undefined && containsUnresolvedType(type);
      });
      if (unresolved) {
        throw this.error(
          "gpu.builtin.ambiguous",
          expression,
          `Slang builtin ${builtinName} remains unresolved because no reachable GPU use determines its scalar/vector shape`,
        );
      }
      return baseExpr("builtin", {
        builtinName,
        children: expression.args.map((argument) => this.expr(argument)),
      });
    }
    const semanticId = this.semanticId(expression.callee);
    if (semanticId) {
      if (semanticId === GPU_SEMANTIC_IDS.i32 || semanticId === GPU_SEMANTIC_IDS.f32) {
        if (expression.args.length !== 1) {
          throw this.error(
            "gpu.expression.unsupported",
            expression,
            `${semanticId} requires exactly one numeric argument`,
          );
        }
        return baseExpr("convert", {
          semanticId,
          children: [this.expr(expression.args[0])],
        });
      }
      if (semanticId !== GPU_SEMANTIC_IDS.color) {
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          `${semanticId} is not callable inside the static v1 shader slice`,
        );
      }
      return baseExpr("copy", {
        children: expression.args.map((argument) => this.expr(argument)),
      });
    }
    const constructorId = this.constructorId(expression.callee);
    if (constructorId >= 0) {
      const constructor = this.addConstructor(constructorId as CtorId);
      const children = expression.args.map((argument) => this.expr(argument));
      if ((constructor.payloadTypeId < 0 ? 0 : 1) !== children.length) {
        throw this.error(
          "gpu.adt.unsupported",
          expression,
          "v1 constructors are nullary or carry one Number payload",
        );
      }
      return baseExpr("constructor", { constructorId, children });
    }
    if (expression.callee.kind !== "Var") {
      throw this.error(
        "gpu.function.unsupported",
        expression.callee,
        "wmslang v1 calls require one resolved direct callee",
      );
    }
    const bindingId = this.bindings.references.get(expression.callee);
    const targetFunctionId = this.#currentSpecialization?.callTargets.get(expression);
    if (targetFunctionId === undefined) {
      const topLevel = bindingId === undefined ? undefined : this.#topLevelLambdas.get(bindingId);
      throw this.error(
        "gpu.function.unsupported",
        expression.callee,
        topLevel
          ? "top-level helpers are outside the selected lexical GPU island; declare the helper inside the @gpu root"
          : "GPU calls require a first-order helper declared inside the selected @gpu root",
      );
    }
    const targetSpecialization = requiredObject(
      this.#specializationById.get(targetFunctionId),
      "missing target specialization",
    );
    const recursion = this.analysis.recursionFacts.byExpression.get(expression);
    if (recursion) {
      const groupId = requiredObject(
        this.#recursionGroupByFunctionId.get(targetFunctionId),
        "missing cloned recursion group",
      );
      this.recursiveReferences.push({
        expressionId,
        groupId,
        targetFunctionId,
        relation: recursion.relation,
        invocation: recursion.invocation,
        spanId: this.span(expression),
      });
    }
    return baseExpr("call", {
      bindingId: requiredObject(
        this.#functionBindingById.get(targetFunctionId),
        "missing specialized call binding",
      ),
      functionId: targetFunctionId,
      children: expression.args.flatMap((argument, index) =>
        targetSpecialization.staticFunctionParams[index] === undefined ? [this.expr(argument)] : []
      ),
    });
  }

  blockExpr(
    expression: Extract<Expr, { kind: "Block" }>,
    expressionId: number,
  ): GpuSliceExprRow {
    const itemIds: number[] = [];
    expression.items.forEach((item, declaredIndex) => {
      if (isLocalFunctionDeclaration(item, this.bindings, this.#localLambdas)) return;
      const itemId = this.blockItems.length;
      if (!isDecl(item)) {
        const childId = this.expr(item);
        this.blockItems.push({
          id: itemId,
          blockExprId: expressionId,
          declaredIndex,
          kind: "expression",
          expressionId: childId,
          letId: -1,
          spanId: this.span(item),
        });
        itemIds.push(itemId);
        return;
      }
      if (item.kind !== "LetDecl" || item.recursive || item.bindings.length !== 1) {
        throw this.error(
          "gpu.expression.unsupported",
          item,
          "v1 blocks accept one non-recursive immutable binding per let declaration",
        );
      }
      const binding = item.bindings[0];
      const fact = requiredObject(
        this.analysis.patternFacts.byBinding.get(binding),
        "missing resolved let fact",
      );
      const patternId = this.addPattern(fact.patternId, "let");
      const valueExprId = this.expr(binding.value);
      const letId = this.lets.length;
      this.lets.push({
        id: letId,
        patternId,
        valueExprId,
        declaredIndex: fact.declaredIndex,
        spanId: this.span(binding),
      });
      this.blockItems.push({
        id: itemId,
        blockExprId: expressionId,
        declaredIndex,
        kind: "let",
        expressionId: -1,
        letId,
        spanId: this.span(item),
      });
      itemIds.push(itemId);
    });
    const resultExprId = this.expr(expression.result);
    this.blocks.push({ expressionId, itemIds, resultExprId });
    const children = itemIds.map((itemId) => {
      const item = this.blockItems[itemId];
      if (item.kind === "expression") return item.expressionId;
      return requiredObject(this.lets.find((letRow) => letRow.id === item.letId), "missing let row")
        .valueExprId;
    });
    return baseExpr("block", { children: [...children, resultExprId] });
  }

  addPattern(
    patternId: number,
    expectedContext: GpuSlicePatternDto["context"],
    forcedTypeId?: number,
  ): number {
    const key = `${this.#currentFunctionId}:${patternId}`;
    const existing = this.#patternsById.get(key);
    if (existing) return existing.id;
    const fact = requiredObject(
      this.analysis.patternFacts.patterns.find((item) => item.id === patternId),
      `missing resolved pattern ${patternId}`,
    );
    const kind = this.validatePattern(fact, expectedContext);
    const rowId = this.patterns.length;
    this.patterns.push(undefined as unknown as GpuSlicePatternDto);
    const row: GpuSlicePatternDto = {
      id: rowId,
      context: expectedContext,
      kind,
      typeId: forcedTypeId ?? this.type(this.typeForPattern(fact.pattern, fact.type)),
      ownerFunctionId: this.#currentFunctionId,
      bindingId: fact.bindingId ?? -1,
      constructorId: fact.constructorId ?? -1,
      children: fact.children.map((child) => this.addPattern(child, expectedContext)),
      spanId: this.span(fact.pattern),
    };
    if (fact.constructorId !== undefined) this.addConstructor(fact.constructorId);
    this.#patternsById.set(key, row);
    this.patterns[rowId] = row;
    return row.id;
  }

  validatePattern(
    fact: ResolvedPatternFact,
    expectedContext: GpuSlicePatternDto["context"],
  ): GpuSlicePatternDto["kind"] {
    if (fact.context !== expectedContext) {
      throw this.patternError(fact, "pattern context does not match its normalized owner");
    }
    if (fact.kind === "wildcard" || fact.kind === "binding") return fact.kind;
    if (fact.kind === "tuple" && expectedContext !== "match") {
      const children = fact.children.map((id) =>
        requiredObject(
          this.analysis.patternFacts.patterns.find((item) => item.id === id),
          `missing tuple pattern child ${id}`,
        )
      );
      if (children.every((child) => child.kind === "wildcard" || child.kind === "binding")) {
        return "tuple";
      }
    }
    if (fact.kind === "constructor" && expectedContext === "match") {
      const children = fact.children.map((id) =>
        requiredObject(
          this.analysis.patternFacts.patterns.find((item) => item.id === id),
          `missing constructor pattern child ${id}`,
        )
      );
      if (
        children.length <= 1 &&
        children.every((child) => child.kind === "wildcard" || child.kind === "binding")
      ) return "constructor";
    }
    throw this.patternError(fact, `${fact.kind} is outside the restricted v1 pattern slice`);
  }

  patternError(fact: ResolvedPatternFact, message: string): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError(
      "gpu.pattern.unsupported",
      this.path,
      fact.pattern,
      message,
    );
  }

  typeForExpr(expression: Expr): Ty | undefined {
    return this.#currentSpecialization?.occurrenceTypes.get(expression) ??
      this.result.types.get(expression);
  }

  typeForPattern(pattern: Pattern, fallback: Ty): Ty {
    return this.#currentSpecialization?.occurrenceTypes.get(pattern) ?? fallback;
  }

  type(type: Ty): number {
    const target = prune(type);
    if (target.tag === "var") {
      return this.internType("number", () => baseType("number"));
    }
    if (target.tag === "prim") {
      if (target.name === "Number") return this.internType("number", () => baseType("number"));
      if (target.name === "Bool") return this.internType("bool", () => baseType("bool"));
      if (target.name === "Void") return this.internType("void", () => baseType("void"));
      throw this.typeError(`primitive ${target.name} is outside the v1 shader slice`);
    }
    if (target.tag === "tuple") {
      const items = target.items.map((item) => this.type(item));
      return this.internType(`tuple:${items.join(",")}`, () => ({ ...baseType("tuple"), items }));
    }
    if (target.tag === "fn") {
      const params = target.params.map((param) => this.type(param));
      const result = this.type(target.result);
      return this.internType(`fn:${params.join(",")}=>${result}`, () => ({
        ...baseType("function"),
        params,
        result,
      }));
    }
    if (target.tag === "named") {
      if (target.name === "Gpu.SampledTexture2D") {
        return this.internType("sampled-texture-2d", () => baseType("sampled-texture-2d"));
      }
      if (target.name === "Gpu.Sampler") {
        return this.internType("sampler", () => baseType("sampler"));
      }
      const typeNameId = this.analysis.nominalFacts.inferenceTypeIds.get(target.id);
      if (typeNameId === undefined) {
        throw this.typeError(`missing nominal identity for ${target.name}`);
      }
      const nominal = this.analysis.nominalFacts.types.find((item) => item.id === typeNameId);
      if (!nominal || nominal.kind !== "adt") {
        throw this.typeError(`named type ${target.name} is outside the v1 ADT slice`);
      }
      this.addAdt(nominal);
      return this.internType(`adt:${typeNameId}`, () => ({
        ...baseType("adt"),
        typeNameId,
      }));
    }
    throw this.typeError(`${target.tag} is outside the v1 shader type slice`);
  }

  rootCoordinateType(): number {
    const number = this.internType("number", () => baseType("number"));
    return this.internType(`tuple:${number},${number}`, () => ({
      ...baseType("tuple"),
      items: [number, number],
    }));
  }

  addAdt(fact: NominalTypeFact): GpuSliceAdtDto {
    const existing = this.#adtsById.get(fact.id);
    if (existing) return existing;
    if (fact.modulePath !== this.path || fact.declaration.kind !== "TypeDecl") {
      throw this.adtError(fact.declaration, "v1 ADTs must be declared beside the selected root");
    }
    if (fact.declaration.params.length !== 0 || fact.declaration.alias) {
      throw this.adtError(fact.declaration, "v1 accepts one non-generic variant ADT");
    }
    if (this.adts.length !== 0) {
      throw this.adtError(fact.declaration, "v1 accepts only one reachable ADT declaration");
    }
    const constructors = this.analysis.nominalFacts.constructors.filter((item) =>
      item.typeNameId === fact.id
    );
    const row: GpuSliceAdtDto = {
      typeNameId: fact.id,
      name: fact.name,
      constructorIds: constructors.map((item) => item.id),
      spanId: this.span(fact.declaration),
    };
    this.#adtsById.set(row.typeNameId, row);
    this.adts.push(row);
    constructors.forEach((constructor) => this.addConstructorFact(constructor));
    return row;
  }

  addConstructor(id: CtorId): GpuSliceConstructorDto {
    const existing = this.#constructorsById.get(id);
    if (existing) return existing;
    const fact = requiredObject(
      this.analysis.nominalFacts.constructors.find((item) => item.id === id),
      `missing constructor fact ${id}`,
    );
    const nominal = requiredObject(
      this.analysis.nominalFacts.types.find((item) => item.id === fact.typeNameId),
      `missing ADT fact ${fact.typeNameId}`,
    );
    this.addAdt(nominal);
    return requiredObject(this.#constructorsById.get(id), `missing normalized constructor ${id}`);
  }

  addConstructorFact(fact: NominalConstructorFact): GpuSliceConstructorDto {
    const existing = this.#constructorsById.get(fact.id);
    if (existing) return existing;
    let payloadTypeId = -1;
    if (fact.declaration.args.length > 1) {
      throw this.adtError(fact.declaration, "v1 constructors carry at most one Number payload");
    }
    if (fact.declaration.args.length === 1) {
      const payload = fact.declaration.args[0];
      if (payload.kind !== "TName" || payload.name !== "Number" || payload.args.length !== 0) {
        throw this.adtError(fact.declaration, "v1 constructor payloads must be Number");
      }
      payloadTypeId = this.internType("number", () => baseType("number"));
    }
    const row: GpuSliceConstructorDto = {
      id: fact.id,
      typeNameId: fact.typeNameId,
      name: fact.name,
      tag: fact.tag,
      payloadTypeId,
      spanId: this.span(fact.declaration),
    };
    this.#constructorsById.set(row.id, row);
    this.constructors.push(row);
    return row;
  }

  internType(key: string, create: () => Omit<GpuSliceTypeDto, "id">): number {
    const existing = this.#typesByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.types.length;
    this.#typesByKey.set(key, id);
    this.types.push({ id, ...create() });
    return id;
  }

  constructorId(expression: Expr): number {
    return this.analysis.nominalFacts.constructorReferences.get(expression) ?? -1;
  }

  semanticId(expression: Expr): ReturnType<SliceNormalizer["semanticIdValue"]> {
    return this.semanticIdValue(expression);
  }

  semanticIdValue(expression: Expr) {
    return this.result.facts.expressions.get(expression)?.origin?.semanticId;
  }

  span(value: { node?: { span: SourceSpan } }): number {
    const source = value.node?.span;
    if (!source) return -1;
    const key = `${source.start}:${source.end}`;
    const existing = this.#spansByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.spans.length;
    this.#spansByKey.set(key, id);
    this.spans.push({ id, path: this.path, ...source });
    return id;
  }

  walk(
    expression: Expr,
    visitExpression: (expression: Expr, declaration?: Decl) => void,
    visitPattern: (pattern: Pattern) => void = () => {},
  ): void {
    visitExpression(expression);
    switch (expression.kind) {
      case "Tuple":
      case "JsonArray":
        expression.items.forEach((item) => this.walk(item, visitExpression, visitPattern));
        return;
      case "Record":
      case "JsonObject":
        expression.fields.forEach((field) => this.walk(field.value, visitExpression, visitPattern));
        return;
      case "FfiGet":
        this.walk(expression.receiver, visitExpression, visitPattern);
        return;
      case "FfiCall":
        this.walk(expression.receiver, visitExpression, visitPattern);
        expression.args.forEach((arg) => this.walk(arg, visitExpression, visitPattern));
        return;
      case "FfiBindingCall":
        expression.args.forEach((arg) => this.walk(arg, visitExpression, visitPattern));
        return;
      case "Lambda":
        expression.params.forEach((param) => visitPattern(param.pattern));
        this.walk(expression.body, visitExpression, visitPattern);
        return;
      case "Call":
        this.walk(expression.callee, visitExpression, visitPattern);
        expression.args.forEach((arg) => this.walk(arg, visitExpression, visitPattern));
        return;
      case "If":
        [expression.cond, expression.thenExpr, expression.elseExpr].forEach((item) =>
          this.walk(item, visitExpression, visitPattern)
        );
        return;
      case "Match":
        this.walk(expression.value, visitExpression, visitPattern);
        expression.arms.forEach((arm) => {
          visitPattern(arm.pattern);
          this.walk(arm.body, visitExpression, visitPattern);
        });
        return;
      case "Panic":
        this.walk(expression.message, visitExpression, visitPattern);
        return;
      case "Block":
        expression.items.forEach((item) => {
          if (isDecl(item)) {
            visitExpression(expression, item);
            if (item.kind === "LetDecl") {
              item.bindings.forEach((binding) => {
                visitPattern(binding.pattern);
                this.walk(binding.value, visitExpression, visitPattern);
              });
            }
          } else this.walk(item, visitExpression, visitPattern);
        });
        this.walk(expression.result, visitExpression, visitPattern);
        return;
      case "Binary":
      case "Pipe":
        this.walk(expression.left, visitExpression, visitPattern);
        this.walk(expression.right, visitExpression, visitPattern);
        return;
      case "Unary":
        this.walk(expression.value, visitExpression, visitPattern);
        return;
      default:
        return;
    }
  }

  error(
    code: GpuSliceNormalizationError["code"],
    subject: Expr | Decl | Pattern,
    message: string,
  ): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError(code, this.path, subject, message);
  }

  typeError(message: string): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError("gpu.type.unsupported", this.path, undefined, message);
  }

  adtError(
    subject: Decl | CtorDecl,
    message: string,
  ): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError("gpu.adt.unsupported", this.path, subject, message);
  }
}

function containsUnresolvedType(type: Ty): boolean {
  const target = prune(type);
  if (target.tag === "var") return true;
  if (target.tag === "tuple") return target.items.some(containsUnresolvedType);
  if (target.tag === "fn") {
    return target.params.some(containsUnresolvedType) || containsUnresolvedType(target.result);
  }
  if (target.tag === "named") return target.args.some(containsUnresolvedType);
  return false;
}

function unpackCallType(type: Ty, arity: number): Ty[] {
  if (arity === 1) return [type];
  const target = prune(type);
  if (target.tag !== "tuple" || target.items.length !== arity) {
    throw new Error(`GPU function expected ${arity} contextual arguments`);
  }
  return target.items;
}

function specializationSuffix(instance: GpuFunctionSpecialization): string {
  return instance.params.map((param, index) =>
    instance.staticFunctionParams[index] === undefined
      ? canonicalGpuType(param)
      : `Fn${instance.staticFunctionParams[index]}`
  )
    .join("_and_")
    .replaceAll(/[^A-Za-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "") || "unit";
}

function numberComponent(type: Ty, lane: string): Ty {
  const index = ({ x: 0, y: 1, z: 2, w: 3 } as const)[lane as "x" | "y" | "z" | "w"];
  const target = prune(type);
  if (index === undefined || target.tag !== "tuple" || index >= target.items.length) {
    throw new Error(`invalid shader environment vector projection .${lane}`);
  }
  return target.items[index];
}

function visitOwnedFunction(
  lambda: LambdaExpr,
  visitExpression: (expression: Expr) => void,
  visitPattern: (pattern: Pattern) => void,
): void {
  const pattern = (value: Pattern): void => {
    visitPattern(value);
    if (value.kind === "PTuple") value.items.forEach(pattern);
    else if (value.kind === "PRecord") value.fields.forEach((field) => pattern(field.pattern));
    else if (value.kind === "PCtor") value.args.forEach(pattern);
  };
  const expression = (value: Expr): void => {
    visitExpression(value);
    switch (value.kind) {
      case "Tuple":
      case "JsonArray":
        value.items.forEach(expression);
        return;
      case "Record":
      case "JsonObject":
        value.fields.forEach((field) => expression(field.value));
        return;
      case "FfiGet":
        expression(value.receiver);
        return;
      case "FfiCall":
        expression(value.receiver);
        value.args.forEach(expression);
        return;
      case "FfiBindingCall":
        value.args.forEach(expression);
        return;
      case "Lambda":
        return;
      case "Call":
        expression(value.callee);
        value.args.forEach(expression);
        return;
      case "If":
        expression(value.cond);
        expression(value.thenExpr);
        expression(value.elseExpr);
        return;
      case "Match":
        expression(value.value);
        value.arms.forEach((arm) => {
          pattern(arm.pattern);
          expression(arm.body);
        });
        return;
      case "Panic":
        expression(value.message);
        return;
      case "Block":
        value.items.forEach((item) => {
          if (!isDecl(item)) {
            expression(item);
            return;
          }
          if (item.kind !== "LetDecl") return;
          item.bindings.forEach((binding) => {
            if (binding.value.kind === "Lambda") return;
            pattern(binding.pattern);
            expression(binding.value);
          });
        });
        expression(value.result);
        return;
      case "Binary":
      case "Pipe":
        expression(value.left);
        expression(value.right);
        return;
      case "Unary":
        expression(value.value);
        return;
      default:
        return;
    }
  };
  lambda.params.forEach((param) => pattern(param.pattern));
  expression(lambda.body);
}

function builtinCatalog(): GpuSliceElaborationInput["builtinCatalog"] {
  return {
    identity: {
      schemaVersion: WMSLANG_BUILTIN_CATALOG_SCHEMA_VERSION,
      ...WMSLANG_BUILTIN_CATALOG_IDENTITY,
    },
    overloads: WMSLANG_BUILTIN_OVERLOADS.map((overload) => ({
      ...overload,
      params: [...overload.params],
    })),
  };
}

function baseType(kind: GpuSliceTypeDto["kind"]): Omit<GpuSliceTypeDto, "id"> {
  return { kind, typeNameId: -1, items: [], params: [], result: -1 };
}

type GpuSliceExprRow = Omit<
  GpuSliceExprDto,
  "id" | "typeId" | "spanId" | "ownerFunctionId"
>;

function baseExpr(
  kind: GpuSliceExprDto["kind"],
  overrides: Partial<Omit<GpuSliceExprRow, "kind">> = {},
): GpuSliceExprRow {
  return {
    kind,
    bindingId: -1,
    functionId: -1,
    constructorId: -1,
    semanticId: "",
    operatorId: "",
    builtinName: "",
    resourceOperation: "",
    numberValue: 0,
    numberKind: "",
    boolValue: false,
    index: -1,
    children: [],
    ...overrides,
  };
}

function isLocalFunctionDeclaration(
  item: Decl | Expr,
  bindings: BindingFacts,
  localLambdas: ReadonlyMap<number, { binding: Binding; lambda: LambdaExpr }>,
): boolean {
  if (item.kind !== "LetDecl" || item.bindings.length !== 1) return false;
  const binding = item.bindings[0];
  if (binding.pattern.kind !== "PVar" || binding.value.kind !== "Lambda") return false;
  const bindingId = bindings.binders.get(binding.pattern);
  return bindingId !== undefined && localLambdas.has(bindingId);
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function required<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function requiredObject<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
