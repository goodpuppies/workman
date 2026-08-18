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
import { cloneTypeEnv } from "./types.ts";
import { parseCompilerModule } from "./compiler_frontend.ts";
import { type ModuleId, moduleId, type ModuleMap } from "./module_id.ts";
import { BASIS_PROFILES, initialBasis } from "./initial_basis.ts";
import { modifiedStaticEnv, type StaticEnv, staticEnv } from "./infer/environment.ts";
import { standardValueId } from "./compiler_semantics.ts";

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
  results: ModuleMap<InferResult>;
  namespaces: {
    id: ModuleId;
    path: string;
    publicName: string;
    emitName: string;
    hostMembers: string[];
    sourceMembers: string[];
  }[];
}> {
  const modules = await loadStandardModules();
  const ids = new Map(modules.map((module) => [module.path, moduleId(module.path)]));
  const hostStructures = initialBasis(BASIS_PROFILES.default).instantiate().environment.strEnv;
  return {
    graph: {
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
    },
    results: new Map(modules.map((module) => [ids.get(module.path)!, module.result])),
    namespaces: modules.map((module) => ({
      id: ids.get(module.path)!,
      path: module.path,
      publicName: module.alias,
      emitName: `__wm_std_${module.alias}`,
      hostMembers: [...(hostStructures.get(module.alias)?.valEnv.keys() ?? [])]
        .filter((name) => !module.result.exports.has(name)),
      sourceMembers: [...module.result.exports.keys()],
    })),
  };
}

async function loadStandardModulesUncached(): Promise<LoadedStandardModule[]> {
  const loaded: LoadedStandardModule[] = [];
  const results = new Map<string, InferResult>();
  for (const module of standardModules) {
    const inferred = await inferStandardModule(module, results);
    const item = composeInitialStructure(inferred);
    loaded.push(item);
    results.set(item.path, item.result);
  }
  return loaded;
}

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

async function inferStandardModule(
  module: StandardModule,
  loaded: Map<string, InferResult>,
): Promise<LoadedStandardModule> {
  const parsed = await parseCompilerModule(module.source, {}, module.path);
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
