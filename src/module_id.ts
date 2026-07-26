/**
 * Compiler-owned identity of one resolved Workman source unit.
 *
 * The current local resolver backs this with a canonical path and the virtual
 * resolver backs it with a snapshot-stable normalized path. Consumers must not
 * derive display paths, source specifiers, or backend names from the value.
 */
declare const moduleIdBrand: unique symbol;

export type ModuleId = Readonly<{ readonly [moduleIdBrand]: "ModuleId" }>;
export type ModuleMap<T> = Map<ModuleId, T>;
export type ReadonlyModuleMap<T> = ReadonlyMap<ModuleId, T>;

const moduleIds = new Map<string, ModuleId>();

/**
 * Construct an identity at a resolver/compiler source-unit boundary.
 *
 * This remains exported for synthetic compiler-owned modules and source-string
 * compilation. Ordinary graph consumers should only receive ModuleIds.
 */
export function moduleId(identity: string): ModuleId {
  if (identity.length === 0) throw new Error("module identity must not be empty");
  const existing = moduleIds.get(identity);
  if (existing) return existing;
  const created = Object.freeze(Object.create(null)) as ModuleId;
  moduleIds.set(identity, created);
  return created;
}
