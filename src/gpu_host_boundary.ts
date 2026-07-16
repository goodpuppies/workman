import type { BindingFacts } from "./binding_facts.ts";
import { collectResolvedBindingSites } from "./binding_sites.ts";
import { isGpuLambda } from "./directives.ts";
import type { Binding, Module } from "./ast.ts";
import type { BindingId } from "./ids.ts";

export type GpuHostBoundaryModule = {
  module: Module;
  bindings: BindingFacts;
};

/**
 * Bindings that exist only to identify a GPU lambda before artifact materialization.
 *
 * Direct marked lambdas and finite immutable PVar aliases are compiler values. They
 * must not become JavaScript functions or aliases on the host Core path.
 */
export function gpuOnlyBindingIds(inputs: GpuHostBoundaryModule[]): Set<BindingId> {
  const sites = collectResolvedBindingSites(inputs);
  const result = new Set<BindingId>();

  for (const site of sites) {
    if (!isGpuLambda(site.binding.value)) continue;
    const id = directBindingId(site.binding, site.bindings);
    if (id !== undefined) result.add(id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const site of sites) {
      if (site.recursive || site.binding.value.kind !== "Var") continue;
      const target = site.bindings.references.get(site.binding.value);
      if (target === undefined || !result.has(target)) continue;
      const id = directBindingId(site.binding, site.bindings);
      if (id === undefined || result.has(id)) continue;
      result.add(id);
      changed = true;
    }
  }

  return result;
}

function directBindingId(binding: Binding, facts: BindingFacts): BindingId | undefined {
  return binding.pattern.kind === "PVar" ? facts.binders.get(binding.pattern) : undefined;
}
