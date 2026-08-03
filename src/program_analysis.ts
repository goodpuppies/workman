import { type BindingFacts, resolveProgramBindingFacts } from "./binding_facts.ts";
import type { InferResult } from "./infer.ts";
import { CompilerIdAllocator } from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";
import type { ModuleId, ModuleMap, ReadonlyModuleMap } from "./module_id.ts";
import type { GpuSliceElaborationInput } from "./wmslang/v2_dto.ts";
import {
  type NormalizedGpuSlice,
  normalizeGpuSliceProgram,
  normalizeGpuSlicePrograms,
} from "./wmslang/v2_normalize.ts";
import { gpuOnlyBindingIds } from "./gpu_host_boundary.ts";
import type { BindingId } from "./ids.ts";
import type { TypeNameId } from "./ids.ts";
import { type GpuFragmentSelectionFacts, resolveGpuFragmentSelections } from "./gpu_selection.ts";
import { type NominalFacts, resolveProgramNominalFacts } from "./nominal_facts.ts";
import { type ResolvedPatternFacts, resolveProgramPatternFacts } from "./pattern_facts.ts";
import { type RecursionFacts, resolveProgramRecursionFacts } from "./recursion_facts.ts";
import {
  buildProjectSnapshot,
  type ModuleInterface,
  type ProjectSemanticFacts,
  type ProjectSnapshot,
  type ProjectSnapshotContext,
  semanticCompletionFacts,
} from "./module_interface.ts";

export type CoreProgramAnalysis = {
  graph: ModuleGraph;
  results: ModuleMap<InferResult>;
  bindings: ModuleMap<BindingFacts>;
  nominalFacts: NominalFacts;
  patternFacts: ResolvedPatternFacts;
  recursionFacts: RecursionFacts;
  gpuOnlyBindings: ReadonlySet<BindingId>;
  gpuOnlyTypeNames: ReadonlySet<TypeNameId>;
  fragmentSelections: GpuFragmentSelectionFacts;
  gpuSlices: NormalizedGpuSlice[];
  gpuInput: GpuSliceElaborationInput;
  ids: CompilerIdAllocator;
};

export type ProgramAnalysis = CoreProgramAnalysis & {
  projectSnapshot: ProjectSnapshot;
  interfaces: ReadonlyModuleMap<ModuleInterface>;
};

/** Compiler/codegen facts without the language-service-only module interface snapshot. */
export function buildCoreProgramAnalysis(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
): CoreProgramAnalysis {
  const ids = new CompilerIdAllocator();
  const bindings = resolveProgramBindingFacts(graph, ids);
  const nominalFacts = resolveProgramNominalFacts(graph, results, ids);
  const patternFacts = resolveProgramPatternFacts(graph, results, bindings, nominalFacts, ids);
  const recursionFacts = resolveProgramRecursionFacts(graph, bindings, ids);
  const gpuOnlyBindings = gpuOnlyBindingIds(graph.order.map((id) => ({
    module: graph.nodes.get(id)!.module,
    bindings: bindings.get(id)!,
  })));
  const fragmentSelections = resolveGpuFragmentSelections(graph.order.map((id) => ({
    moduleId: id,
    path: graph.nodes.get(id)!.path,
    module: graph.nodes.get(id)!.module,
    result: results.get(id)!,
    bindings: bindings.get(id)!,
  })));
  const gpuAnalysis = {
    graph,
    results,
    bindings,
    nominalFacts,
    patternFacts,
    recursionFacts,
    fragmentSelections,
  };
  const gpuSlices = normalizeGpuSlicePrograms(gpuAnalysis);
  const gpuInput = gpuSlices[0]?.input ?? normalizeGpuSliceProgram(gpuAnalysis);
  const selectedGpuOnlyBindings = new Set(gpuOnlyBindings);
  for (const root of fragmentSelections.roots) {
    if (root.factory) selectedGpuOnlyBindings.add(root.factory.bindingId);
  }
  for (const slice of gpuSlices) {
    for (const fn of slice.input.functions) {
      if (fn.bindingId >= 0) selectedGpuOnlyBindings.add(fn.bindingId as BindingId);
    }
  }
  const gpuOnlyTypeNames = new Set(
    gpuSlices.flatMap((slice) => slice.input.adts.map((adt) => adt.typeNameId as TypeNameId)),
  );
  return {
    graph,
    results,
    bindings,
    nominalFacts,
    patternFacts,
    recursionFacts,
    gpuOnlyBindings: selectedGpuOnlyBindings,
    gpuOnlyTypeNames,
    fragmentSelections,
    gpuSlices,
    gpuInput,
    ids,
  };
}

export function buildProgramAnalysis(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
  context: ProjectSnapshotContext = {},
): ProgramAnalysis {
  const analysis = buildCoreProgramAnalysis(graph, results);
  const projectSnapshot = buildProjectSnapshot(
    graph,
    results,
    analysis.bindings,
    analysis.nominalFacts,
    context,
    { gpuSelections: analysis.fragmentSelections, gpuSlices: analysis.gpuSlices },
  );
  return {
    ...analysis,
    projectSnapshot,
    interfaces: projectSnapshot.interfaces,
  };
}

/**
 * Build the tooling snapshot certified by partial inference.
 *
 * Declarations at and after the first failed declaration are intentionally absent from the
 * semantic graph. Their syntax remains in the source, diagnostics retain the failed range, and
 * scope queries fall back to the last successfully elaborated checkpoint.
 */
export function buildPartialProjectSnapshot(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
  context: ProjectSnapshotContext = {},
  semanticFacts: ProjectSemanticFacts = {},
): ProjectSnapshot {
  const certified = certifiedPrefixGraph(graph, results);
  const ids = new CompilerIdAllocator();
  const bindings = resolveProgramBindingFacts(certified, ids);
  const nominalFacts = resolveProgramNominalFacts(certified, results, ids);
  const patternFacts = resolveProgramPatternFacts(
    certified,
    results,
    bindings,
    nominalFacts,
    ids,
  );
  const recursionFacts = resolveProgramRecursionFacts(certified, bindings, ids);
  const fragmentSelections = resolveGpuFragmentSelections(certified.order.map((id) => ({
    moduleId: id,
    path: certified.nodes.get(id)!.path,
    module: certified.nodes.get(id)!.module,
    result: results.get(id)!,
    bindings: bindings.get(id)!,
  })));
  let gpuSlices: NormalizedGpuSlice[] | undefined;
  try {
    gpuSlices = normalizeGpuSlicePrograms({
      graph: certified,
      results,
      bindings,
      nominalFacts,
      patternFacts,
      recursionFacts,
      fragmentSelections,
    });
  } catch {
    // Selection/root facts remain useful for unresolved tooling even when normalization fails.
  }
  return buildProjectSnapshot(certified, results, bindings, nominalFacts, context, {
    gpuSelections: fragmentSelections,
    gpuSlices,
    completionFacts: semanticFacts.completionFacts,
  });
}

/** Capture syntax-certified, name-only scopes before failed phrases are transactionally removed. */
export function currentSourceCompletionFacts(
  graph: ModuleGraph,
): ProjectSemanticFacts["completionFacts"] {
  const bindings = resolveProgramBindingFacts(graph, new CompilerIdAllocator());
  return new Map(
    graph.order.map((id) => [
      id,
      semanticCompletionFacts(graph.nodes.get(id)!.module, bindings.get(id)!),
    ]),
  );
}

function certifiedPrefixGraph(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
): ModuleGraph {
  const prefixNodes = new Map([...graph.nodes].map(([id, node]) => {
    const declarationPrefix = Math.max(
      0,
      Math.min(node.module.decls.length, results.get(id)?.elaboration.declarationPrefix ?? 0),
    );
    const decls = node.module.decls.slice(0, declarationPrefix);
    const clauses = new Set(
      decls.filter((decl) => decl.kind === "ImportDecl").map((decl) => decl.clause),
    );
    return [id, {
      ...node,
      module: { ...node.module, decls },
      imports: node.imports.filter((edge) => clauses.has(edge.clause)),
    }] as const;
  }));

  const reachable = new Set<ModuleId>();
  const pending = [graph.entry];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of prefixNodes.get(id)?.imports ?? []) pending.push(edge.target);
  }
  return {
    entry: graph.entry,
    order: graph.order.filter((id) => reachable.has(id)),
    nodes: new Map([...prefixNodes].filter(([id]) => reachable.has(id))),
  };
}
