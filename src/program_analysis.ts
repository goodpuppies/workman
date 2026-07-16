import { type BindingFacts, resolveProgramBindingFacts } from "./binding_facts.ts";
import type { InferResult } from "./infer.ts";
import { CompilerIdAllocator } from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";
import type { GpuSliceElaborationInput } from "./wmslang/v2_dto.ts";
import { normalizeGpuSliceProgram } from "./wmslang/v2_normalize.ts";
import { gpuOnlyBindingIds } from "./gpu_host_boundary.ts";
import type { BindingId } from "./ids.ts";
import type { TypeNameId } from "./ids.ts";
import { type GpuFragmentSelectionFacts, resolveGpuFragmentSelections } from "./gpu_selection.ts";
import { type NominalFacts, resolveProgramNominalFacts } from "./nominal_facts.ts";
import { type ResolvedPatternFacts, resolveProgramPatternFacts } from "./pattern_facts.ts";
import { type RecursionFacts, resolveProgramRecursionFacts } from "./recursion_facts.ts";

export type ProgramAnalysis = {
  graph: ModuleGraph;
  results: Map<string, InferResult>;
  bindings: Map<string, BindingFacts>;
  nominalFacts: NominalFacts;
  patternFacts: ResolvedPatternFacts;
  recursionFacts: RecursionFacts;
  gpuOnlyBindings: ReadonlySet<BindingId>;
  gpuOnlyTypeNames: ReadonlySet<TypeNameId>;
  fragmentSelections: GpuFragmentSelectionFacts;
  gpuInput: GpuSliceElaborationInput;
  ids: CompilerIdAllocator;
};

export function buildProgramAnalysis(
  graph: ModuleGraph,
  results: Map<string, InferResult>,
): ProgramAnalysis {
  const ids = new CompilerIdAllocator();
  const bindings = resolveProgramBindingFacts(graph, ids);
  const nominalFacts = resolveProgramNominalFacts(graph, results, ids);
  const patternFacts = resolveProgramPatternFacts(graph, results, bindings, nominalFacts, ids);
  const recursionFacts = resolveProgramRecursionFacts(graph, bindings, ids);
  const gpuOnlyBindings = gpuOnlyBindingIds(graph.order.map((path) => ({
    module: graph.nodes.get(path)!.module,
    bindings: bindings.get(path)!,
  })));
  const fragmentSelections = resolveGpuFragmentSelections(graph.order.map((path) => ({
    path,
    module: graph.nodes.get(path)!.module,
    result: results.get(path)!,
    bindings: bindings.get(path)!,
  })));
  const gpuInput = normalizeGpuSliceProgram({
    graph,
    results,
    bindings,
    nominalFacts,
    patternFacts,
    recursionFacts,
    fragmentSelections,
  });
  const selectedGpuOnlyBindings = new Set(gpuOnlyBindings);
  for (const root of fragmentSelections.roots) {
    if (root.factory) selectedGpuOnlyBindings.add(root.factory.bindingId);
  }
  for (const fn of gpuInput.functions) {
    if (fn.bindingId >= 0) selectedGpuOnlyBindings.add(fn.bindingId as BindingId);
  }
  const gpuOnlyTypeNames = new Set(
    gpuInput.adts.map((adt) => adt.typeNameId as TypeNameId),
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
    gpuInput,
    ids,
  };
}
