import { compileWorkman } from "./compile.mjs";

export function workman(options = {}) {
  const dependencies = new Map();
  return {
    name: "workman",
    enforce: "pre",
    async load(id) {
      // Leave Vite's explicit asset/text queries to Vite.
      if (!id.endsWith(".wm")) return null;
      const result = await compileWorkman(id, options);
      dependencies.set(id, new Set(result.dependencies));
      for (const path of result.dependencies) this.addWatchFile(path);
      return { code: result.code, map: null };
    },
    hotUpdate(context) {
      const modules = new Set(context.modules);
      for (const [entry, paths] of dependencies) {
        if (!paths.has(context.file)) continue;
        for (const module of this.environment.moduleGraph.getModulesByFile(entry) ?? []) {
          this.environment.moduleGraph.invalidateModule(module, new Set(), context.timestamp, true);
          modules.add(module);
        }
      }
      return [...modules];
    },
  };
}
