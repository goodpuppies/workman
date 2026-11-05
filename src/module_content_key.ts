import type { ModuleId } from "./module_id.ts";

/** What a content key needs to know about one module. */
export type KeyedModule = {
  path: string;
  source: string;
  imports: readonly { target: ModuleId }[];
};

/**
 * Keys each module by its path, its source and the keys of the modules it imports, so a key stays
 * the same exactly as long as neither the module nor anything it reaches has changed. An import of a
 * module outside `modules`, such as a library module, contributes a number that stands for that
 * module for the life of the process, which is as long as any analysis keyed this way is kept.
 */
export function moduleContentKeys(
  modules: ReadonlyMap<ModuleId, KeyedModule>,
  order: readonly ModuleId[],
): Map<ModuleId, string> {
  const keys = new Map<ModuleId, string>();
  const keyOf = (moduleId: ModuleId): string => {
    const known = keys.get(moduleId);
    if (known !== undefined) return known;
    const module = modules.get(moduleId);
    if (!module) return `outside:${outsideOrdinal(moduleId)}`;
    keys.set(moduleId, module.path); // A cycle can't reach here: module imports are acyclic.
    const dependencies = module.imports.map((edge) => keyOf(edge.target)).sort();
    const key = `${module.path}#${stableHash([module.source, ...dependencies].join("\0"))}`;
    keys.set(moduleId, key);
    return key;
  };
  order.forEach((moduleId) => keyOf(moduleId));
  return keys;
}

const outsideOrdinals = new WeakMap<ModuleId, number>();

function outsideOrdinal(moduleId: ModuleId): number {
  let ordinal = outsideOrdinals.get(moduleId);
  if (ordinal === undefined) {
    ordinal = nextOutsideOrdinal++;
    outsideOrdinals.set(moduleId, ordinal);
  }
  return ordinal;
}

let nextOutsideOrdinal = 0;

/**
 * FNV-1a over UTF-16 units next to a second hash with another multiplier, as sixteen hex digits.
 * Analysis reuses a module by its key, so a collision would silently reuse the wrong analysis; 64
 * bits keep that out of reach for the few hundred modules a session sees.
 */
function stableHash(text: string): string {
  let low = 0x811c9dc5;
  let high = 0x050c5d1f;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    low = Math.imul(low ^ unit, 0x01000193) >>> 0;
    high = Math.imul(high ^ unit, 0x5bd1e995) >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
