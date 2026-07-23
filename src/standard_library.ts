import { prepareFfiElaboration } from "./ffi/elab.ts";
import type { ImportClause, Module } from "./ast.ts";
import type { ModuleGraph } from "./module_graph.ts";
import { posix } from "node:path";
import {
  listSource,
  mapSource,
  monadSource,
  optionSource,
  resultSource,
  taskSource,
  traverseSource,
} from "./generated/assets.ts";
import {
  inferModule,
  type InferModuleOptions,
  type InferResult,
  type InitialImport,
} from "./infer.ts";
import { parse } from "./parser.ts";

type StandardModule = {
  path: string;
  source: string;
  clauses: ImportClause[];
};

export type LoadedStandardModule = StandardModule & {
  alias: string;
  module: Module;
  result: InferResult;
};

const standardModules: StandardModule[] = [
  {
    path: "std/list.wm",
    source: listSource,
    clauses: [{ kind: "Namespace", alias: "List" }],
  },
  {
    path: "std/map.wm",
    source: mapSource,
    clauses: [{ kind: "Namespace", alias: "Map" }],
  },
  {
    path: "std/option.wm",
    source: optionSource,
    clauses: [{ kind: "Namespace", alias: "Option" }],
  },
  {
    path: "std/monad.wm",
    source: monadSource,
    clauses: [{ kind: "Namespace", alias: "Monad" }],
  },
  {
    path: "std/result.wm",
    source: resultSource,
    clauses: [{ kind: "Namespace", alias: "Result" }],
  },
  {
    path: "std/task.wm",
    source: taskSource,
    clauses: [{ kind: "Namespace", alias: "Task" }],
  },
  {
    path: "std/traverse.wm",
    source: traverseSource,
    clauses: [{ kind: "Namespace", alias: "Traverse" }],
  },
];

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
    for (const clause of module.clauses) {
      out.push({ clause, result: module.result, standard: true });
    }
  }
  return out;
}

export function loadStandardModules(): Promise<LoadedStandardModule[]> {
  standardModulesPromise ??= loadStandardModulesUncached();
  return standardModulesPromise;
}

export async function standardRuntimeGraph(): Promise<{
  graph: ModuleGraph;
  results: Map<string, InferResult>;
  namespaces: { path: string; publicName: string; emitName: string }[];
}> {
  const modules = await loadStandardModules();
  return {
    graph: {
      entry: modules.at(-1)?.path ?? "std/monad.wm",
      order: modules.map((module) => module.path),
      nodes: new Map(modules.map((module) => [module.path, {
        path: module.path,
        source: module.source,
        module: module.module,
        imports: module.module.decls.flatMap((decl) =>
          decl.kind === "ImportDecl"
            ? [{
              specifier: decl.path,
              path: standardImportPath(module.path, decl.path),
              clause: decl.clause,
            }]
            : []
        ),
        emitName: `__wm_std_${module.alias}`,
      }])),
    },
    results: new Map(modules.map((module) => [module.path, module.result])),
    namespaces: modules.map((module) => ({
      path: module.path,
      publicName: module.alias,
      emitName: `__wm_std_${module.alias}`,
    })),
  };
}

async function loadStandardModulesUncached(): Promise<LoadedStandardModule[]> {
  const loaded: LoadedStandardModule[] = [];
  const results = new Map<string, InferResult>();
  for (const module of standardModules) {
    const item = await inferStandardModule(module, results);
    loaded.push(item);
    results.set(item.path, item.result);
  }
  return loaded;
}

async function inferStandardModule(
  module: StandardModule,
  loaded: Map<string, InferResult>,
): Promise<LoadedStandardModule> {
  const parsed = await parse(module.source, "workman", module.path);
  const prepared = prepareFfiElaboration(parsed).module;
  const clause = module.clauses.find((item) => item.kind === "Namespace");
  if (!clause || clause.kind !== "Namespace") {
    throw new Error(`standard module ${module.path} has no namespace alias`);
  }
  return {
    ...module,
    alias: clause.alias,
    module: prepared,
    result: inferModule(
      prepared,
      new Map(prepared.decls.flatMap((decl) => {
        if (decl.kind !== "ImportDecl") return [];
        const result = loaded.get(standardImportPath(module.path, decl.path));
        if (!result) throw new Error(`standard import ${decl.path} must precede ${module.path}`);
        return [[decl.path, result] as const];
      })),
    ),
  };
}

function standardImportPath(from: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(from), specifier));
}
