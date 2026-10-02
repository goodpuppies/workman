import type { ImportClause, Module } from "./ast.ts";
import type { ModuleGraph } from "./module_graph.ts";
import { posix } from "node:path";
import { libraryJsSources, librarySources } from "./generated/assets.ts";
import type { InferModuleOptions, InferResult, InitialImport } from "./infer.ts";
import { analyzeModuleGraph } from "./staged_analysis.ts";
import { cloneTypeEnv } from "./types.ts";
import { parseCompilerModule } from "./compiler_frontend.ts";
import { type ModuleId, moduleId, type ModuleMap } from "./module_id.ts";
import { BASIS_PROFILES, initialBasis } from "./initial_basis.ts";
import { modifiedStaticEnv, type StaticEnv, staticEnv } from "./infer/environment.ts";
import { standardValueId } from "./compiler_semantics.ts";
import { LIBRARY_JS_SCHEME, resolveLibraryJsModuleSpecifiers } from "./js_module_specifier.ts";

export type StandardModule = {
  path: string;
  source: string;
  alias: string;
  clauses: ImportClause[];
  module: Module;
};

export type LoadedStandardModule = StandardModule & {
  result: InferResult;
};

let standardLibraryPromise: Promise<InitialImport[]> | undefined;
let standardModulesPromise: Promise<LoadedStandardModule[]> | undefined;

export function loadStandardLibrary(): Promise<InitialImport[]> {
  standardLibraryPromise ??= loadStandardLibraryUncached();
  return standardLibraryPromise;
}

export async function standardInferOptions(): Promise<InferModuleOptions> {
  return {
    initialImports: await loadStandardLibrary(),
  };
}

async function loadStandardLibraryUncached(): Promise<InitialImport[]> {
  const out: InitialImport[] = [];
  for (const module of await loadStandardModules()) {
    if (!isAutoOpened(module.path)) continue;
    for (const clause of module.clauses) {
      out.push({ clause, result: module.result, standard: true });
    }
  }
  return out;
}

/**
 * Host helper modules (`host/js/`) are never opened implicitly: a program reaches one through an
 * explicit `js.host` import edge (BD17). Layer 1 and layer 2 modules are opened as namespaces.
 */
function isAutoOpened(path: string): boolean {
  return !path.startsWith("host/");
}

/**
 * Results of the library modules by module id, for import edges that name a library module
 * (`js.host`) from a graph that does not contain it.
 */
export async function libraryImportResults(): Promise<ModuleMap<InferResult>> {
  return new Map(
    (await loadStandardModules()).map((module) => [moduleId(module.path), module.result]),
  );
}

export function loadStandardModules(): Promise<LoadedStandardModule[]> {
  standardModulesPromise ??= loadStandardModulesUncached();
  return standardModulesPromise;
}

export async function standardRuntimeGraph(): Promise<{
  graph: ModuleGraph;
  results: ModuleMap<InferResult>;
  namespaces: {
    id: ModuleId;
    path: string;
    publicName: string;
    /** Reached only through an explicit import edge, never bound as a global namespace. */
    importOnly: boolean;
    emitName: string;
    hostMembers: string[];
    sourceMembers: string[];
  }[];
}> {
  const modules = await loadStandardModules();
  const graph = libraryGraph(modules);
  const ids = new Map(modules.map((module) => [module.path, moduleId(module.path)]));
  const hostStructures = initialBasis(BASIS_PROFILES.default).instantiate().environment.strEnv;
  return {
    graph,
    results: new Map(modules.map((module) => [ids.get(module.path)!, module.result])),
    namespaces: modules.map((module) => ({
      id: ids.get(module.path)!,
      path: module.path,
      publicName: module.alias,
      importOnly: !isAutoOpened(module.path),
      emitName: `__wm_std_${module.alias}`,
      hostMembers: [...(hostStructures.get(module.alias)?.valEnv.keys() ?? [])]
        .filter((name) => !module.result.exports.has(name)),
      sourceMembers: [...module.result.exports.keys()],
    })),
  };
}

/**
 * Add the library modules to a program graph as ordinary nodes, so whole-program analysis
 * (bindings, nominal facts, patterns, elaboration) sees library declarations exactly as it sees a
 * user import. Programs whose modules all opt out of the prelude are returned unchanged.
 *
 * Library modules are placed after the program's modules. Emitted module definitions are
 * requested explicitly and do not depend on this order; what it decides is identity allocation,
 * so the program's binding, type and constructor ids do not shift when the library changes. The
 * exception is a library module the program imports explicitly (`js.host`): it and its own imports
 * come first, since whole-program passes visit a module's imports before the module.
 */
export async function withStandardLibrary(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
): Promise<{ graph: ModuleGraph; results: ModuleMap<InferResult> }> {
  if (!usesStandardLibrary(graph)) return { graph, results };
  return mergeLibraryGraph(graph, results, await standardRuntimeGraph());
}

function usesStandardLibrary(graph: ModuleGraph): boolean {
  return ![...graph.nodes.values()].every((node) => node.module.prelude === "none");
}

/** The synchronous half of `withStandardLibrary`, for callers that already hold the library. */
export function mergeLibraryGraph(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
  library: { graph: ModuleGraph; results: ModuleMap<InferResult> },
): { graph: ModuleGraph; results: ModuleMap<InferResult> } {
  if (!usesStandardLibrary(graph)) return { graph, results };
  if (graph.order.some((id) => library.graph.nodes.has(id))) return { graph, results };
  const imported = new Set<ModuleId>();
  const visit = (id: ModuleId) => {
    const node = library.graph.nodes.get(id);
    if (!node || imported.has(id)) return;
    imported.add(id);
    node.imports.forEach((edge) => visit(edge.target));
  };
  for (const node of graph.nodes.values()) node.imports.forEach((edge) => visit(edge.target));
  const first = library.graph.order.filter((id) => imported.has(id));
  const rest = library.graph.order.filter((id) => !imported.has(id));
  return {
    graph: {
      entry: graph.entry,
      order: [...first, ...graph.order, ...rest],
      nodes: new Map([...library.graph.nodes, ...graph.nodes]),
    },
    results: new Map([...library.results, ...results]),
  };
}

/** The program's own modules: `graph` and `results` without the nodes `withStandardLibrary` added. */
export async function withoutStandardLibrary(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
): Promise<{ graph: ModuleGraph; results: ModuleMap<InferResult> }> {
  const library = (await standardRuntimeGraph()).graph.nodes;
  if (!graph.order.some((id) => library.has(id))) return { graph, results };
  const order = graph.order.filter((id) => !library.has(id));
  return {
    graph: {
      entry: graph.entry,
      order,
      nodes: new Map(order.map((id) => [id, graph.nodes.get(id)!])),
    },
    results: new Map(order.flatMap((id) => results.has(id) ? [[id, results.get(id)!]] : [])),
  };
}

/**
 * Infer the library through the same staged pipeline as a program, so library modules get the FFI
 * elaboration their JavaScript primitive imports need. Library modules see the initial basis and
 * their own imports, never the library's initial imports.
 */
async function loadStandardModulesUncached(): Promise<LoadedStandardModule[]> {
  const modules = await discoverStandardModules();
  const graph = libraryGraph(modules);
  const results = await analyzeModuleGraph(graph, { inferOptions: {} });
  return modules.map((module) => {
    const id = moduleId(module.path);
    return composeInitialStructure({
      ...module,
      module: graph.nodes.get(id)!.module,
      result: results.get(id)!,
    });
  });
}

/** Module graph of the library alone, in import order. Each call builds fresh nodes. */
function libraryGraph(modules: readonly StandardModule[]): ModuleGraph {
  const ids = new Map(modules.map((module) => [module.path, moduleId(module.path)]));
  return {
    entry: ids.get(modules.at(-1)?.path ?? "") ?? moduleId("std/monad.wm"),
    order: modules.map((module) => ids.get(module.path)!),
    nodes: new Map(modules.map((module) => [ids.get(module.path)!, {
      id: ids.get(module.path)!,
      path: module.path,
      source: module.source,
      module: module.module,
      imports: module.module.decls.flatMap((decl) =>
        decl.kind === "ImportDecl"
          ? [{
            referrer: ids.get(module.path)!,
            specifier: decl.path,
            specifierNode: decl.pathNode ?? decl.node,
            target: ids.get(standardImportPath(module.path, decl.path))!,
            path: standardImportPath(module.path, decl.path),
            clause: decl.clause,
          }]
          : []
      ),
      emitName: `__wm_std_${module.alias}`,
    }])),
  };
}

/**
 * Overlay a library module's exports on the initial-basis structure of the same name. That
 * structure holds only layer-0 material qualified by the library's namespace: compiler-owned types
 * (`Word8.Word`, `Word8Vector.Vector`) and the pervasive constructors (`List.Cons`, `Option.Some`,
 * `Result.Ok`). No library value is defined in TypeScript any more.
 */
function composeInitialStructure(module: LoadedStandardModule): LoadedStandardModule {
  const source = withStandardValueIds(module.result.exportedStructure, module.path);
  const host = initialBasis(BASIS_PROFILES.default)
    .instantiate()
    .environment.strEnv.get(module.alias);
  const environment = host ? modifiedStaticEnv(host, source) : source;
  return {
    ...module,
    result: {
      ...module.result,
      exportedStructure: {
        ...environment,
        adts: module.result.exportedStructure.adts,
      },
    },
  };
}

function withStandardValueIds(
  environment: StaticEnv,
  modulePath: string,
  prefix = "",
): StaticEnv {
  return staticEnv(
    new Map([...environment.strEnv].map(([name, nested]) => [
      name,
      withStandardValueIds(nested, modulePath, prefix ? `${prefix}.${name}` : name),
    ])),
    cloneTypeEnv(environment.tyEnv),
    new Map([...environment.valEnv].map(([name, scheme]) => {
      const qualified = prefix ? `${prefix}.${name}` : name;
      return [name, { ...scheme, valueId: standardValueId(modulePath, qualified) }];
    })),
  );
}

/**
 * Namespace alias of a library module, derived from its snake_case file name:
 * `std/list.wm` defines `List` and `basis/word8_vector.wm` defines `Word8Vector`.
 */
export function libraryModuleAlias(path: string): string {
  return posix.basename(path, ".wm")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Parse library sources (by default the generated library) and order the modules so that imports
 * come first. Exported so tests can supply sources without regenerating assets.
 */
export async function discoverStandardModules(
  sources: Readonly<Record<string, string>> = librarySources,
  jsSources: Readonly<Record<string, string>> = libraryJsSources,
): Promise<StandardModule[]> {
  const modules = await Promise.all(
    Object.entries(sources).map(async ([path, source]): Promise<StandardModule> => {
      const alias = libraryModuleAlias(path);
      const parsed = await parseCompilerModule(source, {}, path);
      return {
        path,
        source,
        alias,
        clauses: [{ kind: "Namespace", alias }],
        module: resolveLibraryJsModuleSpecifiers(parsed, path),
      };
    }),
  );
  const byAlias = new Map<string, string>();
  for (const module of modules) {
    const existing = byAlias.get(module.alias);
    if (existing) {
      throw new Error(
        `library modules ${existing} and ${module.path} both define namespace ${module.alias}`,
      );
    }
    byAlias.set(module.alias, module.path);
    for (const decl of module.module.decls) {
      if (decl.kind !== "JsImportDecl" || decl.target.kind !== "JsModule") continue;
      const { specifier } = decl.target;
      if (!specifier.startsWith(LIBRARY_JS_SCHEME)) continue;
      const path = specifier.slice(LIBRARY_JS_SCHEME.length);
      if (!(path in jsSources)) {
        throw new Error(`library module ${module.path} imports missing JavaScript file ${path}`);
      }
    }
  }
  return orderByImports(modules);
}

/**
 * Depth-first topological order over library imports. Modules are visited in path order, so the
 * result is deterministic and independent of how the sources were enumerated.
 */
function orderByImports(modules: StandardModule[]): StandardModule[] {
  const byPath = new Map(modules.map((module) => [module.path, module]));
  const state = new Map<string, "visiting" | "done">();
  const ordered: StandardModule[] = [];
  const visit = (module: StandardModule, chain: string[]) => {
    const current = state.get(module.path);
    if (current === "done") return;
    if (current === "visiting") {
      throw new Error(`library import cycle: ${[...chain, module.path].join(" -> ")}`);
    }
    state.set(module.path, "visiting");
    for (const decl of module.module.decls) {
      if (decl.kind !== "ImportDecl") continue;
      const target = standardImportPath(module.path, decl.path);
      const imported = byPath.get(target);
      if (!imported) {
        throw new Error(`library module ${module.path} imports missing library module ${target}`);
      }
      visit(imported, [...chain, module.path]);
    }
    state.set(module.path, "done");
    ordered.push(module);
  };
  for (const path of [...byPath.keys()].sort()) visit(byPath.get(path)!, []);
  return ordered;
}

function standardImportPath(from: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(from), specifier));
}
