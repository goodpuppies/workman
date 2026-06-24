import type { Module } from "./ast.ts";
import {
  type CoreProgram,
  coreProgramFromAnalysis,
  coreProgramFromModule,
} from "./core/artifact.ts";
import { emitCoreProgram } from "./core/emit_js.ts";
import { coreFromSurface } from "./core/from_surface.ts";
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "./ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "./ffi/elab.ts";
import {
  inferModule,
  inferModulePartial,
  inferModuleWithSteps,
  type InferResult,
  type InferStep,
} from "./infer.ts";
import {
  loadModuleGraph,
  type ModuleGraph,
  type ModuleGraphOptions,
  type VirtualFileSystem,
} from "./module_graph.ts";
import { parse, type Surface } from "./parser.ts";
import { resolveLocalJsModuleSpecifiers } from "./js_module_specifier.ts";
import {
  type FrontendDiagnostic,
  FrontendDiagnosticBundleError,
  FrontendDiagnosticError,
  genericDiagnostic,
  renderDiagnosticSummary,
} from "./diagnostics.ts";
import { prune, type Scheme, show, type Ty } from "./types.ts";
import { standardInferOptions } from "./standard_library.ts";

export type CompileOptions = ModuleGraphOptions;

export type VirtualCompileOptions = CompileOptions & {
  virtualFs: VirtualFileSystem;
};

export async function compile(
  source: string,
  options: CompileOptions = {},
  filePath?: string,
): Promise<string> {
  const { module: ast, result } = await checkPreparedModuleWithoutImports(
    resolveLocalJsModuleSpecifiers(await parse(source, options.surface, filePath), filePath),
    filePath,
  );
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
  diagnostics: FrontendDiagnostic[];

  constructor(
    path: string,
    source: string,
    originalError: unknown,
    diagnostics: FrontendDiagnostic[] = [],
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = "ModuleAnalysisError";
    this.path = path;
    this.source = source;
    this.originalError = originalError;
    this.diagnostics = diagnostics;
  }
}

export async function checkSource(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<InferResult> {
  return (await checkPreparedModuleWithoutImports(
    resolveLocalJsModuleSpecifiers(await parse(source, options.surface, filePath), filePath),
    filePath,
  )).result;
}

export async function coreSource(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<CoreSourceResult> {
  const { module, result } = await checkPreparedModuleWithoutImports(
    resolveLocalJsModuleSpecifiers(await parse(source, options.surface, filePath), filePath),
    filePath,
  );
  return { module: coreFromSurface(module, result), result };
}

export async function checkSourceSteps(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<InferStep[]> {
  const module = prepareFfiElaboration(
    resolveLocalJsModuleSpecifiers(await parse(source, options.surface, filePath), filePath),
    { filePath },
  ).module;
  if (module.decls.some((decl) => decl.kind === "ImportDecl")) {
    throw new Error("source strings with imports require checkFile");
  }
  return inferModuleWithSteps(module, new Map(), await standardInferOptions()).steps;
}

export async function compileFile(input: string, options: CompileOptions = {}): Promise<string> {
  return emitCoreProgram((await coreFile(input, options)).core);
}

export async function compileLibraryFile(
  input: string,
  options: CompileOptions = {},
): Promise<string> {
  return emitCoreProgram((await coreFile(input, options)).core, { target: "library" });
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
  const ffi = new Map<string, ReturnType<typeof prepareFfiElaboration>>();
  for (const node of graph.nodes.values()) {
    node.module = resolveLocalJsModuleSpecifiers(node.module, node.path);
    const prepared = prepareFfiElaboration(node.module, { filePath: node.path });
    ffi.set(node.path, prepared);
    node.module = prepared.module;
  }
  const results = new Map<string, InferResult>();
  const firstResults = new Map<string, InferResult>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const imports = new Map<string, InferResult>();
    for (const edge of node.imports) {
      imports.set(edge.specifier, firstResults.get(edge.path)!);
    }
    try {
      firstResults.set(
        path,
        assertNoPartialDiagnostics(
          inferModulePartial(node.module, imports, await standardInferOptions()),
        ),
      );
    } catch (error) {
      throw new ModuleAnalysisError(path, node.source, error);
    }
  }
  const contextualResults = new Map<string, InferResult>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    try {
      const contextual = contextualizeDelayedCallbacks(ffi.get(path)!, firstResults.get(path)!);
      ffi.set(path, contextual);
      node.module = contextual.module;
    } catch (error) {
      throw new ModuleAnalysisError(path, node.source, error);
    }
  }
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const imports = new Map<string, InferResult>();
    for (const edge of node.imports) {
      imports.set(edge.specifier, contextualResults.get(edge.path)!);
    }
    try {
      contextualResults.set(
        path,
        assertNoPartialDiagnostics(
          inferModulePartial(node.module, imports, await standardInferOptions()),
        ),
      );
    } catch (error) {
      throw new ModuleAnalysisError(path, node.source, error);
    }
  }
  const foreignTypeRefs = new Map(
    [...ffi.values()].flatMap((item) =>
      [...item.foreignTypeRefs.values()].map((ref) => [ref.key, ref])
    ),
  );
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    try {
      const prepared = ffi.get(path)!;
      const contextualResult = contextualResults.get(path)!;
      const resolved = resolveDelayedFfiElaboration(prepared, contextualResult, {
        foreignTypeRefs,
        dynamicFallback: false,
      });
      ffi.set(path, resolved);
      node.module = resolved.module;
    } catch (error) {
      throw new ModuleAnalysisError(
        path,
        node.source,
        error,
        delayedFfiDiagnostics(contextualResults.get(path)),
      );
    }
  }
  const postResolveResults = new Map<string, InferResult>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const imports = new Map<string, InferResult>();
    for (const edge of node.imports) {
      imports.set(edge.specifier, postResolveResults.get(edge.path)!);
    }
    try {
      postResolveResults.set(
        path,
        assertNoPartialDiagnostics(
          inferModulePartial(node.module, imports, await standardInferOptions()),
        ),
      );
    } catch (error) {
      throw new ModuleAnalysisError(path, node.source, error);
    }
  }
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    try {
      const prepared = ffi.get(path)!;
      const postResolveResult = postResolveResults.get(path)!;
      const resolved = resolveDelayedFfiElaboration(prepared, postResolveResult, {
        foreignTypeRefs,
      });
      ffi.set(path, resolved);
      node.module = resolved.module;
    } catch (error) {
      throw new ModuleAnalysisError(
        path,
        node.source,
        error,
        delayedFfiDiagnostics(postResolveResults.get(path)),
      );
    }
  }
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const imports = new Map<string, InferResult>();
    for (const edge of node.imports) {
      imports.set(edge.specifier, results.get(edge.path)!);
    }
    try {
      results.set(path, inferModule(node.module, imports, await standardInferOptions()));
    } catch (error) {
      throw new ModuleAnalysisError(path, node.source, error);
    }
  }
  return { graph, results };
}

function assertNoPartialDiagnostics(result: InferResult): InferResult {
  const diagnostic = result.diagnostics.find((item) =>
    item.severity === "error" && !isDelayedFfiPartialDiagnostic(renderDiagnosticSummary(item))
  );
  if (diagnostic) throw new FrontendDiagnosticError(diagnostic);
  return result;
}

function isDelayedFfiPartialDiagnostic(message: string): boolean {
  return message.startsWith("cannot solve unresolved JS FFI type ") ||
    message.startsWith("unresolved JS FFI obligation in ") ||
    message.startsWith("unresolved JS FFI type in ") ||
    message.startsWith("unsolved JS boundary type in ") ||
    message.includes("?ffi#");
}

async function checkPreparedModuleWithoutImports(
  module: Module,
  filePath?: string,
): Promise<{ module: Module; result: InferResult }> {
  assertNoSourceImports(module);
  const prepared = prepareFfiElaboration(module, { filePath });
  const inferOptions = await standardInferOptions();
  const first = assertNoPartialDiagnostics(
    inferModulePartial(prepared.module, new Map(), inferOptions),
  );
  const contextual = contextualizeDelayedCallbacks(prepared, first);
  const contextualResult = assertNoPartialDiagnostics(
    inferModulePartial(contextual.module, new Map(), inferOptions),
  );
  const foreignTypeRefs = new Map(
    [...contextual.foreignTypeRefs.values()].map((ref) => [ref.key, ref]),
  );
  let resolved: ReturnType<typeof resolveDelayedFfiElaboration>;
  try {
    resolved = resolveDelayedFfiElaboration(contextual, contextualResult, {
      foreignTypeRefs,
      dynamicFallback: false,
    });
  } catch (error) {
    throw new FrontendDiagnosticBundleError(error, delayedFfiDiagnostics(contextualResult));
  }
  const postResolveResult = assertNoPartialDiagnostics(
    inferModulePartial(resolved.module, new Map(), inferOptions),
  );
  const finalResolved = resolveDelayedFfiElaboration(resolved, postResolveResult, {
    foreignTypeRefs,
  });
  return {
    module: finalResolved.module,
    result: await inferModuleWithoutImports(finalResolved.module),
  };
}

function delayedFfiDiagnostics(result: InferResult | undefined): FrontendDiagnostic[] {
  if (!result) return [];
  const leaking = [...result.env.entries()].filter(([, scheme]) =>
    containsUnresolvedFfi(scheme.type)
  );
  if (leaking.length === 0) return [];
  return leaking.map(([name, scheme]) => ({
    ...genericDiagnostic(
      "error",
      "ffi.unresolved",
      unresolvedFfiMessage(name, scheme),
      scheme.node,
    ),
  }));
}

function unresolvedFfiMessage(name: string, scheme: Scheme): string {
  return `unresolved JS FFI obligation in ${name}: ${
    show(scheme.type)
  }; this JS member access must be resolved by FFI reflection before it can escape a top-level binding`;
}

function containsUnresolvedFfi(type: Ty): boolean {
  const target = prune(type);
  if (target.tag === "ffi") return true;
  if (target.tag === "fn") {
    return target.params.some(containsUnresolvedFfi) || containsUnresolvedFfi(target.result);
  }
  if (target.tag === "tuple") return target.items.some(containsUnresolvedFfi);
  if (target.tag === "struct") {
    return target.fields.some((field) => containsUnresolvedFfi(field.type));
  }
  if (target.tag === "named") return target.args.some(containsUnresolvedFfi);
  return false;
}

async function inferModuleWithoutImports(module: Module): Promise<InferResult> {
  assertNoSourceImports(module);
  return inferModule(module, new Map(), await standardInferOptions());
}

function assertNoSourceImports(module: Module): void {
  if (module.decls.some((decl) => decl.kind === "ImportDecl")) {
    throw new Error("source strings with imports require checkFile");
  }
}

export async function compileVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<string> {
  return emitCoreProgram((await coreVirtual(entryPath, virtualFs, options)).core);
}

export async function compileLibraryVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<string> {
  return emitCoreProgram((await coreVirtual(entryPath, virtualFs, options)).core, {
    target: "library",
  });
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
