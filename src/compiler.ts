import type { Module } from "./ast.ts";
import { basename, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type CoreProgram, coreProgramFromAnalysis } from "./core/artifact.ts";
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
  inferModuleRecovered,
  inferModuleWithSteps,
  type InferResult,
  type InferStep,
} from "./infer.ts";
import { rememberExportedSourceDocument } from "./infer/imports.ts";
import { registerModuleCarrier } from "./infer/carriers.ts";
import {
  loadModuleGraph,
  type ModuleGraph,
  type ModuleGraphOptions,
  type ModuleImportEdge,
  type VirtualFileSystem,
} from "./module_graph.ts";
import { jsHostImportName, jsHostModulePath } from "./host_modules.ts";
import { type CompilerFrontendOptions, parseCompilerModule } from "./compiler_frontend.ts";
import { resolveLocalJsModuleSpecifiers } from "./js_module_specifier.ts";
import { type ModuleId, moduleId, type ModuleMap } from "./module_id.ts";
import {
  type FrontendDiagnostic,
  FrontendDiagnosticBundleError,
  FrontendDiagnosticError,
  genericDiagnostic,
} from "./diagnostics.ts";
import { prune, type Scheme, show, type Ty } from "./types.ts";
import {
  libraryImportResults,
  mergeLibraryGraph,
  standardInferOptions,
  standardRuntimeGraph,
  usesStandardLibrary,
  withoutStandardLibrary,
  withStandardLibrary,
} from "./standard_library.ts";
import { assertCompilerFrontendMode, resolveCompilerFrontend } from "./frontend_mode.ts";
import {
  analyzeModuleGraph,
  assertNoPartialDiagnostics,
  externalImportResults,
  requiresFfiStaging,
  StagedAnalysisError,
} from "./staged_analysis.ts";
import {
  buildCoreProgramAnalysis,
  buildPartialProjectSnapshot,
  buildProgramAnalysis,
  type CoreProgramAnalysis,
  currentSourceCompletionFacts,
  currentSourceResolvedDefinitions,
  type ExtendGraph,
  type ProgramAnalysis,
} from "./program_analysis.ts";
import {
  immutableCopy,
  type ProjectSnapshot,
  type ProjectSnapshotContext,
  type SemanticGpuElaboratedSlice,
  type SemanticGpuElaboration,
} from "./module_interface.ts";
import { type GpuFragmentSelectionFacts, resolveGpuFragmentSelections } from "./gpu_selection.ts";
import type { BindingFacts } from "./binding_facts.ts";
import { resolveProgramBindingFacts } from "./binding_facts.ts";
import { assertCaptureContracts } from "./closure_captures.ts";
import { type NominalFacts, resolveProgramNominalFacts } from "./nominal_facts.ts";
import type { GpuSliceElaborationInput } from "./wmslang/v2_dto.ts";
import type { ResolvedPatternFacts } from "./pattern_facts.ts";
import type { RecursionFacts } from "./recursion_facts.ts";
import { CompilerIdAllocator } from "./ids.ts";
import { loadDefaultWmslangSlangBackend } from "./wmslang/slang_backend.ts";
import { materializeGpuSliceArtifacts } from "./wmslang/materialize.ts";
import {
  loadWmslangSliceCompiler,
  WmslangNumericDiagnosticError,
  type WmslangSliceCompiler,
} from "./wmslang/v2_loader.ts";
import {
  defaultWmslangCompilerIdentity,
  loadCachedWmslangCompiler,
} from "./wmslang/compiler_cache.ts";

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
  const path = filePath ?? "<source>";
  const id = moduleId(path);
  const graph: ModuleGraph = {
    entry: id,
    order: [id],
    nodes: new Map([[id, {
      id,
      path,
      source,
      module: ast,
      imports: (await sourceImports(ast, id)).edges,
      emitName: "Main",
    }]]),
  };
  const program = await withStandardLibrary(graph, new Map([[id, result]]));
  const ids = new CompilerIdAllocator();
  const bindings = resolveProgramBindingFacts(program.graph, ids);
  assertCaptureContracts(bindings.values());
  const nominalFacts = resolveProgramNominalFacts(program.graph, program.results, ids);
  const fragmentSelections = resolveGpuFragmentSelections([{
    moduleId: id,
    path,
    module: ast,
    result,
    bindings: bindings.get(id)!,
  }]);
  return emitCoreProgram(
    await coreProgramWithStandardRuntime({
      graph: program.graph,
      results: program.results,
      elaboration: { bindings, ids, nominalFacts, fragmentSelections },
    }),
  );
}

export type CheckSourceOptions = CompilerFrontendOptions;
export type CoreSourceResult = { module: ReturnType<typeof coreFromSurface>; result: InferResult };
export type CoreFileResult = {
  graph: ModuleGraph;
  results: ModuleMap<InferResult>;
  bindings: ModuleMap<BindingFacts>;
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
  const { results: imports } = await sourceImports(module);
  return inferModuleWithSteps(
    module,
    imports,
    await standardInferOptions(module.prelude !== "none"),
  )
    .steps;
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
  const entryId = compiled.graph.entry;
  const entry = compiled.graph.nodes.get(entryId)!.path;
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
  const analysis = await analyzeFile(input);
  return resultsBySourcePath(analysis.graph, analysis.results);
}

export async function coreFile(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<CoreFileResult> {
  const analysis = await analyzeCoreFile(input, options);
  return await coreResultFromAnalysis(analysis, options);
}

async function coreResultFromAnalysis(
  analysis: CoreProgramAnalysis,
  options: ModuleGraphOptions = {},
): Promise<CoreFileResult> {
  options.onStage?.("build core");
  const materializedGpuArtifacts = analysis.gpuInput.root.functionId === -1
    ? undefined
    : await materializeGpuSliceArtifacts(
      analysis,
      await loadDefaultWmslangCompiler(),
      await loadDefaultWmslangSlangBackend(),
    );
  const core = await coreProgramWithStandardRuntime({
    graph: analysis.graph,
    results: analysis.results,
    elaboration: { ...analysis, materializedGpuArtifacts },
  });
  // Consumers of a core result (diagnostics, workers, GPU normalization) are about the program's
  // own modules; library modules are part of `core` and the facts, not of the program graph.
  const program = await withoutStandardLibrary(analysis.graph, analysis.results);
  return {
    graph: program.graph,
    results: program.results,
    bindings: analysis.bindings,
    nominalFacts: analysis.nominalFacts,
    patternFacts: analysis.patternFacts,
    recursionFacts: analysis.recursionFacts,
    fragmentSelections: analysis.fragmentSelections,
    gpuInput: analysis.gpuInput,
    core,
  };
}

/**
 * Build Core for a graph that already contains the library modules (see `withStandardLibrary`).
 * Library modules are ordinary nodes here; the only library-specific output is the namespace
 * description the emitter uses to bind `List`, `Result`, … for program code.
 */
async function coreProgramWithStandardRuntime(input: {
  graph: ModuleGraph;
  results: ModuleMap<InferResult>;
  elaboration?: Parameters<typeof coreProgramFromAnalysis>[2];
}): Promise<CoreProgram> {
  const core = coreProgramFromAnalysis(input.graph, input.results, input.elaboration);
  if (!usesStandardLibrary(input.graph)) return core;
  const standard = await standardRuntimeGraph();
  if (!input.graph.order.some((id) => standard.graph.nodes.has(id))) return core;
  return {
    ...core,
    standardNamespaces: standard.namespaces.map((namespace) => ({
      ...namespace,
      basisName: namespace.hostMembers.length > 0
        ? `__wm_basis_${namespace.publicName}`
        : undefined,
      basisMembers: namespace.hostMembers,
    })),
  };
}

let defaultWmslangCompiler: Promise<WmslangSliceCompiler> | undefined;

function loadDefaultWmslangCompiler(): Promise<WmslangSliceCompiler> {
  return defaultWmslangCompiler ??= compileDefaultWmslangCompiler();
}

/**
 * Elaborate the normalized GPU programs owned by one immutable project snapshot.
 *
 * Tooling consumes this artifact instead of reaching back into ProgramAnalysis, binding maps, or
 * mutable inference state. The snapshot and interface generation tokens make stale results
 * detectable when this query eventually moves behind an incremental scheduler.
 */
export async function elaborateProjectGpuSemantics(
  project: ProjectSnapshot,
): Promise<SemanticGpuElaboration> {
  const compiler = await loadDefaultWmslangCompiler();
  const modules = new Map<ModuleId, readonly SemanticGpuElaboratedSlice[]>();
  for (const [moduleId, moduleInterface] of project.interfaces) {
    if (moduleInterface.gpuFacts.slices.length === 0) continue;
    const slices = moduleInterface.gpuFacts.slices.map((slice) => {
      const input = structuredClone(slice.input) as GpuSliceElaborationInput;
      try {
        return Object.freeze({
          rootId: slice.rootId,
          selectorIds: slice.selectorIds,
          input: slice.input,
          elaboration: immutableCopy(compiler.elaborateGpuSliceTypes(input)),
        });
      } catch (error) {
        if (error instanceof WmslangNumericDiagnosticError) {
          throw error.withLanguageServiceInput(input);
        }
        throw error;
      }
    });
    modules.set(moduleId, Object.freeze(slices));
  }
  return Object.freeze({
    projectSnapshotId: project.id,
    generation: project.generation,
    modules: Object.freeze(modules),
  });
}

async function compileDefaultWmslangCompiler(): Promise<WmslangSliceCompiler> {
  if (typeof Deno === "undefined") {
    return await loadWmslangSliceCompiler(
      new URL("../tooling/wmslang/wmslang.generated.mjs", import.meta.url),
    );
  }
  return await loadCachedWmslangCompiler({
    identity: await defaultWmslangCompilerIdentity(),
    build: () =>
      compileLibraryFile(
        fileURLToPath(new URL("../tooling/wmslang/compiler.wm", import.meta.url)),
      ),
  });
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
  return await analyzeStrictSnapshot(input, options, {});
}

/** Strict analysis for an uncovered document without promoting it to a headed project. */
export async function analyzeStrictDetachedFile(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<ProgramAnalysis> {
  return await analyzeStrictSnapshot(input, options, { kind: "detached" });
}

async function analyzeStrictSnapshot(
  input: string,
  options: ModuleGraphOptions,
  context: ProjectSnapshotContext,
): Promise<ProgramAnalysis> {
  return await analyzeStrict(
    input,
    options,
    async (graph, results) =>
      buildProgramAnalysis(graph, results, context, await libraryExtension(graph)),
  );
}

/** Extends a program graph with the library modules, for facts the tooling snapshot relies on. */
async function libraryExtension(graph: ModuleGraph): Promise<ExtendGraph | undefined> {
  if (!usesStandardLibrary(graph)) return undefined;
  const library = await standardRuntimeGraph();
  return (graph, results) => mergeLibraryGraph(graph, results, library);
}

/** Strict analysis for code generation: the program graph plus the library modules, analyzed once. */
async function analyzeCoreFile(
  input: string,
  options: ModuleGraphOptions,
): Promise<CoreProgramAnalysis> {
  const program = await analyzeStrict(input, options, (graph, results) => ({ graph, results }));
  const combined = await withStandardLibrary(program.graph, program.results);
  return buildCoreProgramAnalysis(combined.graph, combined.results);
}

async function analyzeStrict<T>(
  input: string,
  options: ModuleGraphOptions,
  build: (graph: ModuleGraph, results: ModuleMap<InferResult>) => T | Promise<T>,
): Promise<T> {
  assertCompilerFrontendMode(options.frontend);
  options.onStage?.("load modules");
  const graph = await loadModuleGraph(input, options);
  try {
    options.onStage?.("analyze");
    const total = graph.nodes.size;
    const cleared = new Map<string, Set<string>>();
    return build(
      graph,
      await analyzeModuleGraph(graph, {
        onEvent: ({ phase, node }) => {
          if (!options.onAnalysisProgress) return;
          const seen = cleared.get(phase) ?? new Set<string>();
          seen.add(node.path);
          cleared.set(phase, seen);
          options.onAnalysisProgress(seen.size, total, phase);
        },
      }),
    );
  } catch (error) {
    if (error instanceof StagedAnalysisError) {
      throw new ModuleAnalysisError(
        error.node.path,
        error.node.source,
        error.originalError,
        error.phase.startsWith("resolve delayed FFI") &&
          !(error.originalError instanceof FrontendDiagnosticError)
          ? delayedFfiDiagnostics(error.result)
          : [],
      );
    }
    throw error;
  }
}

/**
 * Produce the compiler-owned semantic snapshot for the current source, retaining independently
 * recoverable top-level phrases and never substituting last-known-good analysis.
 */
export async function analyzeRecoveredFile(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<ProjectSnapshot> {
  return await analyzeRecoveredSnapshot(input, options, "headed");
}

/** Analyze one uncovered document without claiming that it is a main-bearing project head. */
export async function analyzeDetachedFile(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<ProjectSnapshot> {
  return await analyzeRecoveredSnapshot(input, options, "detached");
}

async function analyzeRecoveredSnapshot(
  input: string,
  options: ModuleGraphOptions,
  kind: ProjectSnapshot["kind"],
): Promise<ProjectSnapshot> {
  assertCompilerFrontendMode(options.frontend);
  const graph = await loadModuleGraph(input, { ...options, syntaxRecovery: true });
  const completionFacts = currentSourceCompletionFacts(graph);
  const resolvedDefinitions = currentSourceResolvedDefinitions(graph);
  const inferOptions = await standardInferOptions(usesStandardLibrary(graph));
  const library = await externalImportResults(graph);
  const results = new Map<ModuleId, InferResult>();
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const prepared = prepareFfiElaboration(node.module, { filePath: node.path });
    node.module = prepared.module;
    const imports = new Map<string, InferResult>();
    for (const edge of node.imports) {
      const imported = results.get(edge.target) ?? library.get(edge.target);
      if (imported) imports.set(edge.specifier, imported);
    }
    const recovered = inferModuleRecovered(node.module, imports, inferOptions);
    node.module = recovered.module;
    rememberExportedSourceDocument(recovered.result, node.path, node.source);
    registerModuleCarrier(recovered.result, node.path);
    results.set(id, recovered.result);
  }
  return buildPartialProjectSnapshot(
    graph,
    results,
    {
      kind,
      configuration: {
        frontend: resolveCompilerFrontend(options.frontend, options.surface),
        surface: options.surface ?? "workman",
      },
    },
    { completionFacts, resolvedDefinitions },
    await libraryExtension(graph),
  );
}

async function checkPreparedModuleWithoutImports(
  module: Module,
  filePath?: string,
): Promise<{ module: Module; result: InferResult }> {
  const { results: imports } = await sourceImports(module);
  const prepared = prepareFfiElaboration(module, { filePath });
  const inferOptions = await standardInferOptions(module.prelude !== "none");
  if (!requiresFfiStaging(prepared)) {
    return { module: prepared.module, result: inferModule(prepared.module, imports, inferOptions) };
  }
  const first = assertNoPartialDiagnostics(
    inferModulePartial(prepared.module, imports, inferOptions),
  );
  const contextual = contextualizeDelayedCallbacks(prepared, first);
  const contextualResult = assertNoPartialDiagnostics(
    inferModulePartial(contextual.module, imports, inferOptions),
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
    inferModulePartial(resolved.module, imports, inferOptions),
  );
  const finalResolved = resolveDelayedFfiElaboration(resolved, postResolveResult, {
    foreignTypeRefs,
  });
  return {
    module: finalResolved.module,
    result: inferModule(finalResolved.module, imports, inferOptions),
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

/**
 * Imports of a module compiled from a source string. Only `js.host` imports are allowed, since
 * they name library modules rather than files; anything else needs `checkFile`.
 */
async function sourceImports(
  module: Module,
  referrer: ModuleId = moduleId("<source>"),
): Promise<{ results: Map<string, InferResult>; edges: ModuleImportEdge[] }> {
  const declarations = module.decls.filter((decl) => decl.kind === "ImportDecl");
  if (declarations.length === 0) return { results: new Map(), edges: [] };
  const library = await libraryImportResults();
  const results = new Map<string, InferResult>();
  const edges: ModuleImportEdge[] = [];
  for (const decl of declarations) {
    const name = jsHostImportName(decl.path);
    if (name === undefined) throw new Error("source strings with imports require checkFile");
    const path = jsHostModulePath(name);
    const result = library.get(moduleId(path));
    if (!result) throw new Error(`unknown host module js.host(${JSON.stringify(name)})`);
    results.set(decl.path, result);
    edges.push({
      referrer,
      specifier: decl.path,
      specifierNode: decl.pathNode ?? decl.node,
      target: moduleId(path),
      path,
      clause: decl.clause,
    });
  }
  return { results, edges };
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
  const analysis = await analyzeVirtual(entryPath, virtualFs, options);
  return resultsBySourcePath(analysis.graph, analysis.results);
}

export async function coreVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<CoreFileResult> {
  const analysis = await analyzeCoreFile(entryPath, { ...options, virtualFs });
  return await coreResultFromAnalysis(analysis);
}

export function analyzeVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<ProgramAnalysis> {
  return analyzeFile(entryPath, { ...options, virtualFs });
}

export function analyzeRecoveredVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<ProjectSnapshot> {
  return analyzeRecoveredFile(entryPath, { ...options, virtualFs });
}

export function analyzeDetachedVirtual(
  entryPath: string,
  virtualFs: VirtualFileSystem,
  options: Omit<CompileOptions, "virtualFs"> = {},
): Promise<ProjectSnapshot> {
  return analyzeDetachedFile(entryPath, { ...options, virtualFs });
}

function resultsBySourcePath(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
): Map<string, InferResult> {
  return new Map(graph.order.map((id) => [graph.nodes.get(id)!.path, results.get(id)!]));
}
