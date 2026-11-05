import type { Module } from "./ast.ts";
import type { FfiElaboration } from "./ffi/shared.ts";
import type { InferResult } from "./infer.ts";

/** One module's finished analysis: its elaborated AST, its result and the foreign types it named. */
export type CachedModuleAnalysis = Readonly<{
  module: Module;
  result: InferResult;
  foreignTypeRefs: FfiElaboration["foreignTypeRefs"];
}>;

/**
 * Finished module analyses kept between compiles, keyed by module content (see
 * `moduleContentKeys`). An interactive session keeps one, as an SML top level keeps the static basis
 * of each phrase it has elaborated, so a compile analyzes only the modules that changed.
 *
 * A module is analyzed once and then fixed, like an accepted SML phrase: a later importer can't
 * change how its delayed FFI types were settled.
 */
export class ModuleAnalysisCache {
  #entries = new Map<string, CachedModuleAnalysis>();

  get(key: string): CachedModuleAnalysis | undefined {
    return this.#entries.get(key);
  }

  set(key: string, analysis: CachedModuleAnalysis): void {
    this.#entries.set(key, analysis);
  }
}
