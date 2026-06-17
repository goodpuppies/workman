import { prepareFfiElaboration } from "./ffi/elab.ts";
import {
  inferModule,
  type InferModuleOptions,
  type InferResult,
  type InitialImport,
} from "./infer.ts";
import { parse } from "./parser.ts";

type StandardModule = {
  alias: string;
  path: string;
  url: URL;
};

const standardModules: StandardModule[] = [
  {
    alias: "List",
    path: "std/list.wm",
    url: new URL("../std/list.wm", import.meta.url),
  },
  {
    alias: "Option",
    path: "std/option.wm",
    url: new URL("../std/option.wm", import.meta.url),
  },
  {
    alias: "Result",
    path: "std/result.wm",
    url: new URL("../std/result.wm", import.meta.url),
  },
  {
    alias: "Monad",
    path: "std/monad.wm",
    url: new URL("../std/monad.wm", import.meta.url),
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
    out.push({
      alias: module.alias,
      result: await inferStandardModule(module),
    });
  }
  return out;
}

async function inferStandardModule(module: StandardModule): Promise<InferResult> {
  const source = await Deno.readTextFile(module.url);
  const parsed = await parse(source, "workman", module.path);
  const prepared = prepareFfiElaboration(parsed).module;
  return inferModule(prepared);
}
