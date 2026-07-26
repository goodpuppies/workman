import type { InferResult } from "../infer.ts";
import type { ModuleGraph, ModuleImportEdge } from "../module_graph.ts";
import type { Expr, Module, TypeExpr } from "../ast.ts";
import {
  type BindingFacts,
  resolveModuleBindingFacts,
  resolveProgramBindingFacts,
} from "../binding_facts.ts";
import type { CoreModule, CorePattern } from "./ast.ts";
import { coreFromSurface } from "./from_surface.ts";
import { gpuOnlyBindingIds } from "../gpu_host_boundary.ts";
import { type GpuFragmentSelectionFacts, resolveGpuFragmentSelections } from "../gpu_selection.ts";
import {
  type NominalConstructorFact,
  type NominalFacts,
  resolveModuleNominalFacts,
  resolveProgramNominalFacts,
} from "../nominal_facts.ts";
import { type BindingId, CoreIdAllocator, type CtorId, type TypeNameId } from "./ids.ts";
import type { MaterializedGpuArtifacts, VisualShaderArtifactV1 } from "../gpu_artifact.ts";
import { type ModuleId, moduleId, type ModuleMap } from "../module_id.ts";

export type CoreConstructorInfo = {
  id: CtorId;
  name: string;
  typeName: string;
  typeNameId: TypeNameId;
  typeId: number;
  moduleId: ModuleId;
  modulePath: string;
  exported: boolean;
  payload?: TypeExpr;
};

export type CoreDynamicExport = {
  name: string;
  bindingId?: BindingId;
  ctorId?: CtorId;
};

export type CoreModuleArtifact = {
  path: string;
  source: string;
  emitName: string;
  imports: ModuleImportEdge[];
  module: CoreModule;
  analysis: InferResult;
  bindings: BindingFacts;
  constructors: CoreConstructorInfo[];
  dynamicExports: CoreDynamicExport[];
};

export type CoreProgram = {
  entry: ModuleId;
  order: ModuleId[];
  modules: ModuleMap<CoreModuleArtifact>;
  constructors: CoreConstructorInfo[];
  nominalFacts: NominalFacts;
  shaderArtifacts: Map<VisualShaderArtifactV1["id"], VisualShaderArtifactV1>;
  standardNamespaces?: {
    id: ModuleId;
    path: string;
    publicName: string;
    emitName: string;
    basisName?: string;
    basisMembers: string[];
    sourceMembers: string[];
  }[];
};

export function coreProgramFromAnalysis(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
  elaboration?: {
    bindings: ModuleMap<BindingFacts>;
    ids: CoreIdAllocator;
    gpuOnlyBindings?: ReadonlySet<BindingId>;
    gpuOnlyTypeNames?: ReadonlySet<TypeNameId>;
    fragmentSelections?: Pick<GpuFragmentSelectionFacts, "selectedCalls" | "selectors">;
    nominalFacts?: NominalFacts;
    materializedGpuArtifacts?: MaterializedGpuArtifacts;
  },
): CoreProgram {
  const ids = elaboration?.ids ?? new CoreIdAllocator();
  const bindingFacts = elaboration?.bindings ?? resolveProgramBindingFacts(graph, ids);
  const nominalFacts = elaboration?.nominalFacts ?? resolveProgramNominalFacts(graph, results, ids);
  const gpuOnlyBindings = elaboration?.gpuOnlyBindings ??
    gpuOnlyBindingIds(graph.order.map((id) => ({
      module: graph.nodes.get(id)!.module,
      bindings: bindingFacts.get(id)!,
    })));
  const modules = new Map<ModuleId, CoreModuleArtifact>();
  const constructors: CoreConstructorInfo[] = [];
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const analysis = results.get(id);
    if (!analysis) throw new Error(`missing analysis result for ${node.path}`);
    const bindings = bindingFacts.get(id)!;
    const module = coreFromSurface(node.module, analysis, bindings, ids, {
      gpuOnlyBindings,
      gpuOnlyTypeNames: elaboration?.gpuOnlyTypeNames,
      selectedFragmentCalls: elaboration?.fragmentSelections?.selectedCalls,
      fragmentEnvironmentArguments: new Map(
        elaboration?.fragmentSelections?.selectors.flatMap((selector) =>
          selector.environmentArgument ? [[selector.call, selector.environmentArgument]] : []
        ) ?? [],
      ),
      materializedGpuArtifacts: elaboration?.materializedGpuArtifacts,
      nominalFacts,
    });
    let importIndex = 0;
    for (const decl of module.decls) {
      if (decl.kind !== "CoreImport") continue;
      decl.target = node.imports[importIndex++]?.target;
    }
    const moduleConstructors = nominalFacts.constructors
      .filter((constructor) => constructor.moduleId === id)
      .map(coreConstructorInfo);
    constructors.push(...moduleConstructors);
    modules.set(id, {
      path: node.path,
      source: node.source,
      emitName: node.emitName,
      imports: node.imports,
      module,
      analysis,
      bindings,
      constructors: moduleConstructors,
      dynamicExports: [],
    });
  }
  for (const id of graph.order) {
    modules.get(id)!.dynamicExports = dynamicExports(modules.get(id)!.module);
  }
  return {
    entry: graph.entry,
    order: graph.order,
    modules,
    constructors,
    nominalFacts,
    shaderArtifacts: collectShaderArtifacts(
      elaboration?.materializedGpuArtifacts,
      elaboration?.fragmentSelections?.selectedCalls,
    ),
  };
}

export function coreProgramFromModule(
  surfaceModule: Module,
  analysis: InferResult,
  source = "<source>",
): CoreProgram {
  const ids = new CoreIdAllocator();
  const id = moduleId(source);
  const bindings = resolveModuleBindingFacts(surfaceModule, ids);
  const nominalFacts = resolveModuleNominalFacts(surfaceModule, analysis, ids, source);
  const gpuOnlyBindings = gpuOnlyBindingIds([{ module: surfaceModule, bindings }]);
  const fragmentSelections = resolveGpuFragmentSelections([{
    moduleId: id,
    path: source,
    module: surfaceModule,
    result: analysis,
    bindings,
  }]);
  const module = coreFromSurface(surfaceModule, analysis, bindings, ids, {
    gpuOnlyBindings,
    selectedFragmentCalls: fragmentSelections.selectedCalls,
    nominalFacts,
  });
  const constructors = nominalFacts.constructors.map(coreConstructorInfo);
  return {
    entry: id,
    order: [id],
    modules: new Map([
      [id, {
        path: source,
        source,
        emitName: "Main",
        imports: [],
        module,
        analysis,
        bindings,
        constructors,
        dynamicExports: dynamicExports(module),
      }],
    ]),
    constructors,
    nominalFacts,
    shaderArtifacts: new Map(),
  };
}

function collectShaderArtifacts(
  materialized: MaterializedGpuArtifacts | undefined,
  selectedCalls: ReadonlySet<Extract<Expr, { kind: "Call" }>> | undefined,
): Map<VisualShaderArtifactV1["id"], VisualShaderArtifactV1> {
  const artifacts = new Map<VisualShaderArtifactV1["id"], VisualShaderArtifactV1>();
  for (const [call, artifact] of materialized ?? []) {
    if (!selectedCalls?.has(call)) {
      throw new Error("completed GPU artifact does not belong to a selected Gpu.fragment call");
    }
    const previous = artifacts.get(artifact.id);
    if (previous && previous !== artifact) {
      throw new Error(`conflicting completed GPU artifacts share ID ${artifact.id}`);
    }
    artifacts.set(artifact.id, artifact);
  }
  return artifacts;
}

export function dynamicExports(module: CoreModule): CoreDynamicExport[] {
  const exports: CoreDynamicExport[] = [];
  for (const decl of module.decls) {
    if (decl.kind === "CoreLet" && decl.exported) {
      exports.push(...decl.bindings.flatMap((binding) => patternBinders(binding.pattern)));
    }
    if (decl.kind === "CoreType" && decl.exported && !decl.alias) {
      exports.push(...decl.ctors.map((ctor) => ({ name: ctor.name, ctorId: ctor.id })));
    }
    if (decl.kind === "CoreRecord" && decl.exported) {
      exports.push({ name: decl.name, bindingId: decl.constructorBindingId });
    }
  }
  return exports;
}

function patternBinders(pattern: CorePattern): CoreDynamicExport[] {
  switch (pattern.kind) {
    case "CorePVar":
      return [{ name: pattern.name, bindingId: pattern.bindingId }];
    case "CorePTuple":
      return pattern.items.flatMap(patternBinders);
    case "CorePRecord":
      return pattern.fields.flatMap((field) => patternBinders(field.pattern));
    case "CorePCtor":
      return pattern.payload ? patternBinders(pattern.payload) : [];
    default:
      return [];
  }
}

function coreConstructorInfo(constructor: NominalConstructorFact): CoreConstructorInfo {
  return {
    id: constructor.id,
    name: constructor.name,
    typeName: constructor.typeName,
    typeNameId: constructor.typeNameId,
    typeId: constructor.inferenceTypeId,
    moduleId: constructor.moduleId,
    modulePath: constructor.modulePath,
    exported: constructor.exported,
    payload: constructor.payload,
  };
}
