import type { CtorDecl, Expr, Module, Pattern } from "./ast.ts";
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
  type VirtualFileSystem,
} from "./module_graph.ts";
import { type CompilerFrontendOptions, parseCompilerModule } from "./compiler_frontend.ts";
import { resolveLocalJsModuleSpecifiers } from "./js_module_specifier.ts";
import { type ModuleId, moduleId, type ModuleMap } from "./module_id.ts";
import {
  type FrontendDiagnostic,
  FrontendDiagnosticBundleError,
  genericDiagnostic,
} from "./diagnostics.ts";
import { prune, type Scheme, show, type Ty } from "./types.ts";
import { standardInferOptions, standardRuntimeGraph } from "./standard_library.ts";
import { assertCompilerFrontendMode, resolveCompilerFrontend } from "./frontend_mode.ts";
import {
  analyzeModuleGraph,
  assertNoPartialDiagnostics,
  StagedAnalysisError,
} from "./staged_analysis.ts";
import {
  buildCoreProgramAnalysis,
  buildPartialProjectSnapshot,
  buildProgramAnalysis,
  type CoreProgramAnalysis,
  currentSourceCompletionFacts,
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
      imports: [],
      emitName: "Main",
    }]]),
  };
  const results = new Map([[id, result]]);
  const ids = new CompilerIdAllocator();
  const bindings = resolveProgramBindingFacts(graph, ids);
  const nominalFacts = resolveProgramNominalFacts(graph, results, ids);
  const fragmentSelections = resolveGpuFragmentSelections([{
    moduleId: id,
    path,
    module: ast,
    result,
    bindings: bindings.get(id)!,
  }]);
  return emitCoreProgram(
    await coreProgramWithStandardRuntime({
      graph,
      results,
      ids,
      bindings,
      nominalFacts,
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
    ids: analysis.ids,
    bindings: analysis.bindings,
    nominalFacts: analysis.nominalFacts,
    elaboration: { ...analysis, materializedGpuArtifacts },
  });
  return {
    graph: analysis.graph,
    results: analysis.results,
    bindings: analysis.bindings,
    nominalFacts: analysis.nominalFacts,
    patternFacts: analysis.patternFacts,
    recursionFacts: analysis.recursionFacts,
    fragmentSelections: analysis.fragmentSelections,
    gpuInput: analysis.gpuInput,
    core,
  };
}

async function coreProgramWithStandardRuntime(input: {
  graph: ModuleGraph;
  results: ModuleMap<InferResult>;
  ids: CompilerIdAllocator;
  bindings: ModuleMap<BindingFacts>;
  nominalFacts: NominalFacts;
  elaboration?: Parameters<typeof coreProgramFromAnalysis>[2];
}): Promise<CoreProgram> {
  if ([...input.graph.nodes.values()].every((node) => node.module.prelude === "none")) {
    return coreProgramFromAnalysis(input.graph, input.results, {
      ...input.elaboration,
      bindings: input.bindings,
      ids: input.ids,
      nominalFacts: input.nominalFacts,
    });
  }
  const standard = await standardRuntimeGraph();
  const standardBindings = resolveProgramBindingFacts(standard.graph, input.ids);
  const standardNominalFacts = resolveProgramNominalFacts(
    standard.graph,
    standard.results,
    input.ids,
  );
  const nominalFacts = mergeStandardNominalFacts(
    input.nominalFacts,
    standardNominalFacts,
    input.results,
  );
  const userCore = coreProgramFromAnalysis(input.graph, input.results, {
    ...input.elaboration,
    bindings: input.bindings,
    ids: input.ids,
    nominalFacts,
  });
  const standardCore = coreProgramFromAnalysis(standard.graph, standard.results, {
    bindings: standardBindings,
    ids: input.ids,
    nominalFacts,
    gpuOnlyBindings: new Set(),
  });
  return {
    ...userCore,
    order: [...standard.graph.order, ...userCore.order],
    modules: new Map([...standardCore.modules, ...userCore.modules]),
    constructors: [...standardCore.constructors, ...userCore.constructors],
    nominalFacts,
    standardNamespaces: standard.namespaces.map((namespace) => ({
      ...namespace,
      basisName: namespace.hostMembers.length > 0
        ? `__wm_basis_${namespace.publicName}`
        : undefined,
      basisMembers: namespace.hostMembers,
    })),
  };
}

function mergeStandardNominalFacts(
  user: NominalFacts,
  standard: NominalFacts,
  userResults: ModuleMap<InferResult>,
): NominalFacts {
  const constructorReferences = new Map<Expr | Pattern, import("./ids.ts").CtorId>([
    ...standard.constructorReferences,
    ...user.constructorReferences,
  ]);
  const importedConstructor = (declaration: CtorDecl | undefined) =>
    declaration === undefined ? undefined : standard.constructorDeclarations.get(declaration);
  for (const result of userResults.values()) {
    for (const [expression, fact] of result.facts.expressions) {
      const id = importedConstructor(fact.general?.constructorDecl);
      if (fact.subject === "constructor" && id !== undefined) {
        constructorReferences.set(expression, id);
      }
    }
    for (const [pattern, fact] of result.facts.patterns) {
      const id = importedConstructor(fact.general?.constructorDecl);
      if (fact.subject === "constructor" && id !== undefined) {
        constructorReferences.set(pattern, id);
      }
    }
  }
  return {
    types: [...user.types, ...standard.types],
    records: [...user.records, ...standard.records],
    fields: [...user.fields, ...standard.fields],
    constructors: [...user.constructors, ...standard.constructors],
    typeDeclarations: new Map([...user.typeDeclarations, ...standard.typeDeclarations]),
    recordDeclarations: new Map([...user.recordDeclarations, ...standard.recordDeclarations]),
    fieldDeclarations: new Map([...user.fieldDeclarations, ...standard.fieldDeclarations]),
    constructorDeclarations: new Map([
      ...user.constructorDeclarations,
      ...standard.constructorDeclarations,
    ]),
    inferenceTypeIds: new Map([...user.inferenceTypeIds, ...standard.inferenceTypeIds]),
    recordTypeIds: new Map([...user.recordTypeIds, ...standard.recordTypeIds]),
    fieldIds: new Map([...user.fieldIds, ...standard.fieldIds]),
    constructorReferences,
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
    (graph, results) => buildProgramAnalysis(graph, results, context),
  );
}

async function analyzeCoreFile(
  input: string,
  options: ModuleGraphOptions,
): Promise<CoreProgramAnalysis> {
  return await analyzeStrict(input, options, buildCoreProgramAnalysis);
}

async function analyzeStrict<T>(
  input: string,
  options: ModuleGraphOptions,
  build: (graph: ModuleGraph, results: ModuleMap<InferResult>) => T,
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
        error.phase.startsWith("resolve delayed FFI") ? delayedFfiDiagnostics(error.result) : [],
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
  const inferOptions = await standardInferOptions();
  const results = new Map<ModuleId, InferResult>();
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const prepared = prepareFfiElaboration(node.module, { filePath: node.path });
    node.module = prepared.module;
    const imports = new Map<string, InferResult>();
    for (const edge of node.imports) {
      const imported = results.get(edge.target);
      if (imported) imports.set(edge.specifier, imported);
    }
    const recovered = inferModuleRecovered(node.module, imports, inferOptions);
    node.module = recovered.module;
    rememberExportedSourceDocument(recovered.result, node.path, node.source);
    registerModuleCarrier(recovered.result, node.path);
    results.set(id, recovered.result);
  }
  return buildPartialProjectSnapshot(graph, results, {
    kind,
    configuration: {
      frontend: resolveCompilerFrontend(options.frontend, options.surface),
      surface: options.surface ?? "workman",
    },
  }, { completionFacts });
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
  const analysis = await analyzeVirtual(entryPath, virtualFs, options);
  return resultsBySourcePath(analysis.graph, analysis.results);
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
