import type { Module } from "./ast.ts";
import {
  type CoreProgram,
  coreProgramFromAnalysis,
  coreProgramFromModule,
} from "./core/artifact.ts";
import { emitCoreProgram } from "./core/emit_js.ts";
import { coreFromSurface } from "./core/from_surface.ts";
import { prepareFfiElaboration } from "./ffi/elab.ts";
import { inferModule, inferModuleWithSteps, type InferResult, type InferStep } from "./infer.ts";
import { loadModuleGraph, type ModuleGraph, type ModuleGraphOptions, type VirtualFileSystem } from "./module_graph.ts";
import { parse, type Surface } from "./parser.ts";

export type CompileOptions = ModuleGraphOptions;

export type VirtualCompileOptions = CompileOptions & {
  virtualFs: VirtualFileSystem;
};

export async function compile(source: string, options: CompileOptions = {}, filePath?: string): Promise<string> {
  const ast = prepareFfiElaboration(await parse(source, options.surface, filePath)).module;
  const result = checkModuleWithoutImports(ast);
  return emitCoreProgram(coreProgramFromModule(ast, result));
}

export type CheckSourceOptions = { surface?: Surface };
export type CoreSourceResult = { module: ReturnType<typeof coreFromSurface>; result: InferResult };
export type CoreFileResult = {
  graph: ModuleGraph;
  results: Map<string, InferResult>;
  core: CoreProgram;
};

export class ModuleAnalysisError extends Error {
  path: string;
  source: string;
  originalError: unknown;

  constructor(path: string, source: string, originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = "ModuleAnalysisError";
    this.path = path;
    this.source = source;
    this.originalError = originalError;
  }
}

export async function checkSource(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<InferResult> {
  return checkModuleWithoutImports(
    prepareFfiElaboration(await parse(source, options.surface, filePath)).module,
  );
}

export async function coreSource(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<CoreSourceResult> {
  const module = prepareFfiElaboration(await parse(source, options.surface, filePath)).module;
  return { module: coreFromSurface(module), result: checkModuleWithoutImports(module) };
}

export async function checkSourceSteps(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<InferStep[]> {
  const module = prepareFfiElaboration(await parse(source, options.surface, filePath)).module;
  if (module.decls.some((decl) => decl.kind === "ImportDecl")) {
    throw new Error("source strings with imports require checkFile");
  }
  return inferModuleWithSteps(module).steps;
}

export async function compileFile(input: string, options: CompileOptions = {}): Promise<string> {
  return emitCoreProgram((await coreFile(input, options)).core);
}

export async function checkFile(input: string): Promise<Map<string, InferResult>> {
  return (await analyzeFile(input)).results;
}

export async function coreFile(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<CoreFileResult> {
  const { graph, results } = await analyzeFile(input, options);
  return { graph, results, core: coreProgramFromAnalysis(graph, results) };
}

export async function analyzeFile(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<{ graph: ModuleGraph; results: Map<string, InferResult> }> {
  const graph = await loadModuleGraph(input, options);
  for (const node of graph.nodes.values()) {
    node.module = prepareFfiElaboration(node.module).module;
  }
  const results = new Map<string, InferResult>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const imports = new Map<string, InferResult>();
    for (const edge of node.imports) {
      imports.set(edge.specifier, results.get(edge.path)!);
    }
    try {
      results.set(path, inferModule(node.module, imports));
    } catch (error) {
      throw new ModuleAnalysisError(path, node.source, error);
    }
  }
  return { graph, results };
}

function checkModuleWithoutImports(module: Module): InferResult {
  if (module.decls.some((decl) => decl.kind === "ImportDecl")) {
    throw new Error("source strings with imports require checkFile");
  }
  return inferModule(module);
}

export async function compileVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<string> {
  return emitCoreProgram((await coreVirtual(entryPath, virtualFs, options)).core);
}

export async function checkVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<Map<string, InferResult>> {
  return (await analyzeVirtual(entryPath, virtualFs, options)).results;
}

export async function coreVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<CoreFileResult> {
  const { graph, results } = await analyzeVirtual(entryPath, virtualFs, options);
  return { graph, results, core: coreProgramFromAnalysis(graph, results) };
}

export async function analyzeVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<{ graph: ModuleGraph; results: Map<string, InferResult> }> {
  return analyzeFile(entryPath, { ...options, virtualFs });
}
