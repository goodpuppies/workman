import { prepareFfiElaboration } from "./ffi/elab.ts";
import type { ImportClause } from "./ast.ts";
import {
  listSource,
  monadSource,
  optionSource,
  resultSource,
  taskSource,
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

const standardModules: StandardModule[] = [
  {
    path: "std/list.wm",
    source: listSource,
    clauses: [{ kind: "Namespace", alias: "List" }],
  },
  {
    path: "std/option.wm",
    source: optionSource,
    clauses: [{ kind: "Namespace", alias: "Option" }],
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
    path: "std/monad.wm",
    source: monadSource,
    clauses: [{ kind: "Namespace", alias: "Monad" }],
  },
];

let standardLibraryPromise: Promise<InitialImport[]> | undefined;

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
  for (const module of standardModules) {
    const result = await inferStandardModule(module);
    for (const clause of module.clauses) out.push({ clause, result });
  }
  return out;
}

async function inferStandardModule(module: StandardModule): Promise<InferResult> {
  const parsed = await parse(module.source, "workman", module.path);
  const prepared = prepareFfiElaboration(parsed).module;
  return inferModule(prepared);
}
