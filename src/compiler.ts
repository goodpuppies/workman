import type { Module } from "./ast.ts";
import { basename, dirname, relative } from "node:path";
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
import { type CompilerFrontendOptions, parseCompilerModule } from "./compiler_frontend.ts";
import { resolveLocalJsModuleSpecifiers } from "./js_module_specifier.ts";
import {
  type FrontendDiagnostic,
  FrontendDiagnosticBundleError,
  genericDiagnostic,
} from "./diagnostics.ts";
import { prune, type Scheme, show, type Ty } from "./types.ts";
import { standardInferOptions } from "./standard_library.ts";
import { assertCompilerFrontendMode } from "./frontend_mode.ts";
import {
  analyzeModuleGraph,
  assertNoPartialDiagnostics,
  StagedAnalysisError,
} from "./staged_analysis.ts";
import { buildProgramAnalysis, type ProgramAnalysis } from "./program_analysis.ts";
import type { GpuFragmentSelectionFacts } from "./gpu_selection.ts";
import type { NominalFacts } from "./nominal_facts.ts";
import type { BindingFacts } from "./binding_facts.ts";
import type { GpuSliceElaborationInput, GpuSliceTypeElaborationOutput } from "./wmslang/v2_dto.ts";
import type { ResolvedPatternFacts } from "./pattern_facts.ts";
import type { RecursionFacts } from "./recursion_facts.ts";
import { loadDefaultWmslangSlangBackend } from "./wmslang/slang_backend.ts";
import { materializeGpuSliceArtifacts } from "./wmslang/materialize.ts";
import { loadWmslangSliceCompiler, type WmslangSliceCompiler } from "./wmslang/v2_loader.ts";

export type CompileOptions = ModuleGraphOptions;
export type CompileArtifact = {
  path: string;
  code: string;
  kind: "entry" | "worker";
};

export type VirtualCompileOptions = CompileOptions & {
  virtualFs: VirtualFileSystem;
};

export async function compile(
  source: string,
  options: CompileOptions = {},
  filePath?: string,
): Promise<string> {
  assertCompilerFrontendMode(options.frontend);
  const { module: ast, result } = await checkPreparedModuleWithoutImports(
    resolveLocalJsModuleSpecifiers(await parseCompilerModule(source, options, filePath), filePath),
    filePath,
  );
  return emitCoreProgram(coreProgramFromModule(ast, result));
}

export type CheckSourceOptions = CompilerFrontendOptions;
export type CoreSourceResult = { module: ReturnType<typeof coreFromSurface>; result: InferResult };
export type CoreFileResult = {
  graph: ModuleGraph;
  results: Map<string, InferResult>;
  bindings: Map<string, BindingFacts>;
  nominalFacts: NominalFacts;
  patternFacts: ResolvedPatternFacts;
  recursionFacts: RecursionFacts;
  fragmentSelections: GpuFragmentSelectionFacts;
  gpuInput: GpuSliceElaborationInput;
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
  assertCompilerFrontendMode(options.frontend);
  return (await checkPreparedModuleWithoutImports(
    resolveLocalJsModuleSpecifiers(await parseCompilerModule(source, options, filePath), filePath),
    filePath,
  )).result;
}

export async function coreSource(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<CoreSourceResult> {
  assertCompilerFrontendMode(options.frontend);
  const { module, result } = await checkPreparedModuleWithoutImports(
    resolveLocalJsModuleSpecifiers(await parseCompilerModule(source, options, filePath), filePath),
    filePath,
  );
  return { module: coreFromSurface(module, result), result };
}

export async function checkSourceSteps(
  source: string,
  options: CheckSourceOptions = {},
  filePath?: string,
): Promise<InferStep[]> {
  assertCompilerFrontendMode(options.frontend);
  const module = prepareFfiElaboration(
    resolveLocalJsModuleSpecifiers(await parseCompilerModule(source, options, filePath), filePath),
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

export async function compileFileArtifacts(
  input: string,
  options: CompileOptions = {},
): Promise<CompileArtifact[]> {
  return await compileFileArtifactsFromCore(await coreFile(input, options), options);
}

export async function compileFileArtifactsFromCore(
  compiled: CoreFileResult,
  options: CompileOptions = {},
  entryTarget: "executable" | "repl" = "executable",
): Promise<CompileArtifact[]> {
  const entry = compiled.graph.entry;
  const outputNames = new Map<string, string>([[entry, "main.mjs"]]);
  const usedNames = new Set(["main.mjs"]);
  const artifacts: CompileArtifact[] = [];
  const emitted = new Set<string>();

  async function emitOne(path: string, kind: CompileArtifact["kind"]) {
    if (emitted.has(path)) return;
    emitted.add(path);
    const { core } = path === entry ? compiled : await coreFile(path, options);
    for (const worker of workerTargets(core)) {
      if (!outputNames.has(worker)) {
        outputNames.set(worker, uniqueWorkerOutputName(worker, usedNames));
      }
    }
    for (const worker of workerTargets(core)) await emitOne(worker, "worker");
    artifacts.push({
      path: outputNames.get(path)!,
      code: emitCoreProgram(core, {
        target: path === entry ? entryTarget : "executable",
        workerSpecifiers: relativeWorkerSpecifiers(outputNames.get(path)!, outputNames),
      }),
      kind,
    });
  }

  await emitOne(entry, "entry");
  return artifacts;
}

export async function compileReplFileArtifacts(
  input: string,
  options: CompileOptions = {},
): Promise<CompileArtifact[]> {
  return await compileFileArtifactsFromCore(await coreFile(input, options), options, "repl");
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
  const analysis = await analyzeFile(input, options);
  return await coreResultFromAnalysis(analysis);
}

async function coreResultFromAnalysis(analysis: ProgramAnalysis): Promise<CoreFileResult> {
  const materializedGpuArtifacts = analysis.gpuInput.root.functionId === -1
    ? undefined
    : await materializeGpuSliceArtifacts(
      analysis,
      await loadDefaultWmslangCompiler(),
      await loadDefaultWmslangSlangBackend(),
    );
  return {
    graph: analysis.graph,
    results: analysis.results,
    bindings: analysis.bindings,
    nominalFacts: analysis.nominalFacts,
    patternFacts: analysis.patternFacts,
    recursionFacts: analysis.recursionFacts,
    fragmentSelections: analysis.fragmentSelections,
    gpuInput: analysis.gpuInput,
    core: coreProgramFromAnalysis(analysis.graph, analysis.results, {
      ...analysis,
      materializedGpuArtifacts,
    }),
  };
}

let defaultWmslangCompiler: Promise<WmslangSliceCompiler> | undefined;

function loadDefaultWmslangCompiler(): Promise<WmslangSliceCompiler> {
  return defaultWmslangCompiler ??= compileDefaultWmslangCompiler();
}

export async function elaborateGpuTypesForLanguageService(
  analysis: ProgramAnalysis,
): Promise<GpuSliceTypeElaborationOutput | undefined> {
  if (analysis.gpuInput.root.functionId === -1) return undefined;
  return (await loadDefaultWmslangCompiler()).elaborateGpuSliceTypes(analysis.gpuInput);
}

async function compileDefaultWmslangCompiler(): Promise<WmslangSliceCompiler> {
  const source = await compileLibraryFile(
    new URL("../tooling/wmslang/compiler.wm", import.meta.url).pathname,
  );
  return await loadWmslangSliceCompiler(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`,
  );
}

function workerTargets(core: CoreProgram): string[] {
  const targets: string[] = [];
  for (const artifact of core.modules.values()) {
    for (const decl of artifact.module.decls) {
      if (decl.kind === "CoreJsImport" && decl.target.kind === "JsWorker") {
        targets.push(decl.target.specifier);
      }
    }
  }
  return [...new Set(targets)];
}

function uniqueWorkerOutputName(path: string, usedNames: Set<string>): string {
  const stem = basename(path).replace(/\.wm$/i, "") || "worker";
  const base = `${stem}.worker.mjs`;
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  let index = 2;
  while (usedNames.has(`${stem}.${index}.worker.mjs`)) index += 1;
  const name = `${stem}.${index}.worker.mjs`;
  usedNames.add(name);
  return name;
}

function relativeWorkerSpecifiers(
  fromOutput: string,
  outputNames: Map<string, string>,
): Map<string, string> {
  const fromDir = dirname(fromOutput);
  return new Map([...outputNames].map(([sourcePath, outputPath]) => {
    const relativePath = relative(fromDir, outputPath).replaceAll("\\", "/");
    const specifier = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return [sourcePath, specifier];
  }));
}

export async function analyzeFile(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<ProgramAnalysis> {
  assertCompilerFrontendMode(options.frontend);
  const graph = await loadModuleGraph(input, options);
  try {
    return buildProgramAnalysis(graph, await analyzeModuleGraph(graph));
  } catch (error) {
    if (error instanceof StagedAnalysisError) {
      throw new ModuleAnalysisError(
        error.node.path,
        error.node.source,
        error.originalError,
        error.phase.startsWith("resolve delayed FFI") ? delayedFfiDiagnostics(error.result) : [],
      );
    }
    throw error;
  }
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
  const analysis = await analyzeVirtual(entryPath, virtualFs, options);
  return await coreResultFromAnalysis(analysis);
}

export function analyzeVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<ProgramAnalysis> {
  return analyzeFile(entryPath, { ...options, virtualFs });
}
