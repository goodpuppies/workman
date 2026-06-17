import { prepareFfiElaboration } from "./ffi/elab.ts";
import type { ImportClause } from "./ast.ts";
import {
  inferModule,
  type InferModuleOptions,
  type InferResult,
  type InitialImport,
} from "./infer.ts";
import { parse } from "./parser.ts";

type StandardModule = {
  path: string;
  url: URL;
  clauses: ImportClause[];
};

const standardModules: StandardModule[] = [
  {
    path: "std/list.wm",
    url: new URL("../std/list.wm", import.meta.url),
    clauses: [{ kind: "Namespace", alias: "List" }],
  },
  {
    path: "std/option.wm",
    url: new URL("../std/option.wm", import.meta.url),
    clauses: [{ kind: "Namespace", alias: "Option" }],
  },
  {
    path: "std/result.wm",
    url: new URL("../std/result.wm", import.meta.url),
    clauses: [{ kind: "Namespace", alias: "Result" }],
  },
  {
    path: "std/task.wm",
    url: new URL("../std/task.wm", import.meta.url),
    clauses: [{ kind: "Namespace", alias: "Task" }],
  },
  {
    path: "std/monad.wm",
    url: new URL("../std/monad.wm", import.meta.url),
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
  const source = await Deno.readTextFile(module.url);
  const parsed = await parse(source, "workman", module.path);
  const prepared = prepareFfiElaboration(parsed).module;
  return inferModule(prepared);
}
