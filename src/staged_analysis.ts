import type { ImportClause } from "./ast.ts";
import { FrontendDiagnosticError, renderDiagnosticSummary } from "./diagnostic_model.ts";
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "./ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "./ffi/elab.ts";
import { type FfiElaboration } from "./ffi/shared.ts";
import { prepareCImports } from "./ffi/c/prepare.ts";
import { prepareInitialJsImportReflection } from "./ffi/reflect/types.ts";
import {
  inferModule,
  type InferModuleOptions,
  inferModulePartial,
  type InferResult,
} from "./infer.ts";
import { rememberExportedSourceDocument } from "./infer/imports.ts";
import { registerModuleCarrier } from "./infer/carriers.ts";
import { resolveLocalJsModuleSpecifiers } from "./js_module_specifier.ts";
import type { ModuleGraph, ModuleNode } from "./module_graph.ts";
import type { CachedModuleAnalysis, ModuleAnalysisCache } from "./module_analysis_cache.ts";
import { moduleContentKeys } from "./module_content_key.ts";
import type { ModuleId, ModuleMap } from "./module_id.ts";
import {
  libraryImportResults,
  reachesOnDemandLibrary,
  standardInferOptions,
  usesStandardLibrary,
} from "./standard_library.ts";
import { collectExprs } from "./type_debug_collect.ts";

export type StagedAnalysisPhase =
  | "prepare JS reflection"
  | "prepare FFI"
  | "initial partial inference"
  | "contextualize delayed callbacks"
  | "contextual partial inference"
  | "resolve delayed FFI"
  | "post-resolution partial inference"
  | "resolve delayed FFI (second pass)"
  | "final inference";

export type StagedAnalysisEvent = {
  phase: StagedAnalysisPhase;
  node: ModuleNode;
  result?: InferResult;
};

export type StagedAnalysisOptions = {
  /** Only this module needs declaration snapshots for REPL result displays. */
  captureStepsFor?: ModuleId;
  /** Inference options for every module. Defaults to the standard library's initial imports. */
  inferOptions?: InferModuleOptions;
  /** Results for import edges that leave the graph. Defaults to the library modules it reaches. */
  externalResults?: ModuleMap<InferResult>;
  onEvent?: (event: StagedAnalysisEvent) => void;
  /**
   * Finished analyses to reuse, and to keep the new ones in once the whole graph succeeds. A reused
   * module skips every phase and serves its importers as it did when it was analyzed. Ignored when
   * `inferOptions` is given, since the key doesn't cover it.
   */
  cache?: ModuleAnalysisCache;
  onTiming?: (event: StagedAnalysisTimingEvent) => void;
  /**
   * Awaited after each phase of each module. Analysis otherwise stays on the microtask queue, so
   * a caller drawing progress can use this to let timers and signals run. No cost when unset.
   */
  afterStep?: () => void | Promise<void>;
};

export type StagedAnalysisTimingEvent = {
  phase: StagedAnalysisPhase | "load standard library";
  node?: ModuleNode;
  milliseconds: number;
};

export class StagedAnalysisError extends Error {
  constructor(
    readonly phase: StagedAnalysisPhase,
    readonly node: ModuleNode,
    readonly originalError: unknown,
    readonly result?: InferResult,
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = "StagedAnalysisError";
  }
}

// This is the single semantic pipeline for whole-module analysis. Consumers such
// as type-debug may observe the phases, but must not reproduce them themselves.
export async function analyzeModuleGraph(
  graph: ModuleGraph,
  options: StagedAnalysisOptions = {},
): Promise<ModuleMap<InferResult>> {
  const emit = (phase: StagedAnalysisPhase, node: ModuleNode, result?: InferResult) => {
    options.onEvent?.({ phase, node, result });
  };
  const run = async <T>(
    phase: StagedAnalysisPhase,
    node: ModuleNode,
    result: InferResult | undefined,
    action: () => T | Promise<T>,
  ): Promise<T> => {
    const started = performance.now();
    try {
      return await action();
    } catch (error) {
      throw new StagedAnalysisError(phase, node, error, result);
    } finally {
      options.onTiming?.({ phase, node, milliseconds: performance.now() - started });
      await options.afterStep?.();
    }
  };

  for (const node of graph.nodes.values()) {
    node.module = resolveLocalJsModuleSpecifiers(node.module, node.path);
  }
  const firstNode = graph.nodes.get(graph.order[0]);
  if (firstNode) {
    await run("prepare JS reflection", firstNode, undefined, () => {
      prepareInitialJsImportReflection(
        [...graph.nodes.values()].map((node) => ({
          filePath: node.path,
          decls: node.module.decls.filter((decl) => decl.kind === "JsImportDecl"),
        })),
      );
    });
  }

  const cache = options.inferOptions ? undefined : options.cache;
  const prelude = usesStandardLibrary(graph);
  const keys = cache ? moduleContentKeys(graph.nodes, graph.order) : new Map<ModuleId, string>();
  const cacheKey = (id: ModuleId, captureSteps = id === options.captureStepsFor) =>
    `${keys.get(id)}|${prelude ? "prelude" : "bare"}|${captureSteps ? "steps" : "no-steps"}`;
  const cached = new Map<ModuleId, CachedModuleAnalysis>();
  for (const id of graph.order) {
    // An accepted REPL phrase retains its snapshots when it becomes a dependency. A result
    // without snapshots cannot serve a later request that needs them.
    const analysis = cache?.get(cacheKey(id)) ??
      (id !== options.captureStepsFor ? cache?.get(cacheKey(id, true)) : undefined);
    if (!analysis) continue;
    cached.set(id, analysis);
    graph.nodes.get(id)!.module = analysis.module;
  }
  const fresh = graph.order.filter((id) => !cached.has(id));
  const freshNodes = [...graph.nodes.values()].filter((node) => !cached.has(node.id));
  const cachedResults = () => new Map([...cached].map(([id, analysis]) => [id, analysis.result]));
  const finish = (results: ModuleMap<InferResult>): ModuleMap<InferResult> => {
    if (cache) {
      for (const id of fresh) {
        cache.set(cacheKey(id), {
          module: graph.nodes.get(id)!.module,
          result: results.get(id)!,
          foreignTypeRefs: ffi.get(id)!.foreignTypeRefs,
        });
      }
    }
    return new Map(graph.order.map((id) => [id, results.get(id)!]));
  };

  const external = options.externalResults ?? await externalImportResults(graph);
  const importsFor = (node: ModuleNode, results: ModuleMap<InferResult>) =>
    importResults(node, results, external);

  const ffi = new Map<ModuleId, FfiElaboration>();
  for (const node of freshNodes) {
    await run("prepare FFI", node, undefined, async () => {
      node.module = await prepareCImports(node.module);
      const prepared = prepareFfiElaboration(node.module, {
        filePath: node.path,
        importedRecordFields: importedRecordFields(node, graph),
      });
      ffi.set(node.id, prepared);
      node.module = prepared.module;
      emit("prepare FFI", node);
    });
  }

  const standardLibraryStarted = performance.now();
  const inferOptions = options.inferOptions ??
    await standardInferOptions(prelude);
  options.onTiming?.({
    phase: "load standard library",
    milliseconds: performance.now() - standardLibraryStarted,
  });

  if (![...ffi.values()].some(requiresFfiStaging)) {
    const results: ModuleMap<InferResult> = cachedResults();
    for (const id of fresh) {
      const node = graph.nodes.get(id)!;
      const result = await run(
        "final inference",
        node,
        undefined,
        () =>
          inferModule(node.module, importsFor(node, results), {
            ...inferOptions,
            captureSteps: id === options.captureStepsFor,
          }),
      );
      rememberExportedSourceDocument(result, node.path, node.source);
      registerModuleCarrier(result, node.path);
      results.set(id, result);
      emit("final inference", node, result);
    }
    return finish(results);
  }

  const firstResults: ModuleMap<InferResult> = cachedResults();
  for (const id of fresh) {
    const node = graph.nodes.get(id)!;
    const result = await run(
      "initial partial inference",
      node,
      undefined,
      () => inferModulePartial(node.module, importsFor(node, firstResults), inferOptions),
    );
    rememberExportedSourceDocument(result, node.path, node.source);
    registerModuleCarrier(result, node.path);
    firstResults.set(id, result);
    emit("initial partial inference", node, result);
    await run("initial partial inference", node, result, () => assertNoPartialDiagnostics(result));
  }

  const contextualizedIds = new Set<ModuleId>();
  for (const id of fresh) {
    const node = graph.nodes.get(id)!;
    await run("contextualize delayed callbacks", node, firstResults.get(id), () => {
      const previous = ffi.get(id)!;
      const contextual = contextualizeDelayedCallbacks(previous, firstResults.get(id)!);
      if (contextual !== previous) contextualizedIds.add(id);
      ffi.set(id, contextual);
      node.module = contextual.module;
      emit("contextualize delayed callbacks", node, firstResults.get(id));
    });
  }

  const contextualResults: ModuleMap<InferResult> = cachedResults();
  // Imported monomorphic schemes are deliberately shared so constraints from a
  // downstream module can settle an unresolved FFI binding. Once any module's
  // AST changes, those schemes and nominal type identities must be rebuilt as
  // one coherent graph wave; mixing reused dependency results with reinferred
  // consumers retains constraints from the preceding wave.
  const requiresContextualGraphReinference = contextualizedIds.size > 0;
  for (const id of fresh) {
    const node = graph.nodes.get(id)!;
    const requiresReinference = requiresContextualGraphReinference;
    const result = await run(
      "contextual partial inference",
      node,
      undefined,
      () =>
        requiresReinference
          ? inferModulePartial(node.module, importsFor(node, contextualResults), inferOptions)
          : firstResults.get(id)!,
    );
    rememberExportedSourceDocument(result, node.path, node.source);
    registerModuleCarrier(result, node.path);
    contextualResults.set(id, result);
    emit("contextual partial inference", node, result);
    await run(
      "contextual partial inference",
      node,
      result,
      () => assertNoPartialDiagnostics(result),
    );
  }

  const foreignTypeRefs = new Map(
    [
      ...[...cached.values()].map((analysis) => analysis.foreignTypeRefs),
      ...[...ffi.values()].map((item) => item.foreignTypeRefs),
    ]
      .flatMap((refs) => [...refs.values()].map((ref) => [ref.key, ref] as const)),
  );
  for (const id of fresh) {
    const node = graph.nodes.get(id)!;
    const result = contextualResults.get(id)!;
    await run("resolve delayed FFI", node, result, () => {
      emit("resolve delayed FFI", node, result);
      const resolved = resolveDelayedFfiElaboration(ffi.get(id)!, result, {
        foreignTypeRefs,
        dynamicFallback: false,
      });
      ffi.set(id, resolved);
      node.module = resolved.module;
    });
  }

  const idsWithDelayedFfi = new Set(
    fresh.filter((id) => moduleHasDelayedFfi(graph.nodes.get(id)!.module)),
  );
  const postResolveResults: ModuleMap<InferResult> = cachedResults();
  const postResolutionReinferredIds = new Set<ModuleId>();
  const requiresPostResolutionGraphReinference = idsWithDelayedFfi.size > 0;
  for (const id of fresh) {
    const node = graph.nodes.get(id)!;
    const requiresReinference = requiresPostResolutionGraphReinference;
    const result = await run(
      "post-resolution partial inference",
      node,
      undefined,
      () =>
        requiresReinference
          ? inferModulePartial(node.module, importsFor(node, postResolveResults), {
            ...inferOptions,
            defaultPrimitiveReceivers: true,
          })
          : contextualResults.get(id)!,
    );
    rememberExportedSourceDocument(result, node.path, node.source);
    registerModuleCarrier(result, node.path);
    if (requiresReinference) postResolutionReinferredIds.add(id);
    postResolveResults.set(id, result);
    emit("post-resolution partial inference", node, result);
    await run(
      "post-resolution partial inference",
      node,
      result,
      () => assertNoPartialDiagnostics(result),
    );
  }

  for (const id of fresh) {
    const node = graph.nodes.get(id)!;
    const result = postResolveResults.get(id)!;
    await run("resolve delayed FFI (second pass)", node, result, () => {
      emit("resolve delayed FFI (second pass)", node, result);
      if (!postResolutionReinferredIds.has(id)) return;
      const resolved = resolveDelayedFfiElaboration(ffi.get(id)!, result, { foreignTypeRefs });
      ffi.set(id, resolved);
      node.module = resolved.module;
    });
  }

  const results: ModuleMap<InferResult> = cachedResults();
  for (const id of fresh) {
    const node = graph.nodes.get(id)!;
    const result = await run(
      "final inference",
      node,
      undefined,
      () =>
        inferModule(node.module, importsFor(node, results), {
          ...inferOptions,
          captureSteps: id === options.captureStepsFor,
        }),
    );
    rememberExportedSourceDocument(result, node.path, node.source);
    registerModuleCarrier(result, node.path);
    results.set(id, result);
    emit("final inference", node, result);
  }
  return finish(results);
}

function moduleHasDelayedFfi(module: ModuleNode["module"]): boolean {
  return collectExprs(module).some((expr) =>
    expr.kind === "FfiGet" || expr.kind === "FfiCall" || expr.kind === "FfiBindingCall"
  );
}

/** Use the staged pipeline whenever preparation or receiver access leaves FFI work. */
export function requiresFfiStaging(prepared: FfiElaboration): boolean {
  return prepared.bindings.size > 0 || prepared.foreignTypeRefs.size > 0 ||
    moduleHasDelayedFfi(prepared.module);
}

export function isDelayedFfiPartialDiagnostic(message: string): boolean {
  return message.startsWith("cannot solve unresolved JS FFI type ") ||
    message.startsWith("unresolved JS FFI obligation in ") ||
    message.startsWith("unresolved JS FFI type in ") ||
    message.startsWith("cannot generalize JS FFI boundary in ") ||
    message.includes("?ffi#");
}

export function assertNoPartialDiagnostics(result: InferResult): InferResult {
  const diagnostic = result.diagnostics.find((item) =>
    item.severity === "error" && !isDelayedFfiPartialDiagnostic(renderDiagnosticSummary(item))
  );
  if (diagnostic) throw new FrontendDiagnosticError(diagnostic);
  return result;
}

/** Results for import edges that leave the graph: library modules named by `js.host`. */
export async function externalImportResults(graph: ModuleGraph): Promise<ModuleMap<InferResult>> {
  const leaves = [...graph.nodes.values()].some((node) =>
    node.imports.some((edge) => !graph.nodes.has(edge.target))
  );
  return leaves ? await libraryImportResults(reachesOnDemandLibrary(graph)) : new Map();
}

function importResults(
  node: ModuleNode,
  results: ModuleMap<InferResult>,
  external: ModuleMap<InferResult>,
): Map<string, InferResult> {
  const imports = new Map<string, InferResult>();
  for (const edge of node.imports) {
    const result = results.get(edge.target) ?? external.get(edge.target);
    if (result) imports.set(edge.specifier, result);
  }
  return imports;
}

function importedRecordFields(node: ModuleNode, graph: ModuleGraph): Set<string> {
  const fields = new Set<string>();
  for (const edge of node.imports) {
    const imported = graph.nodes.get(edge.target);
    if (!imported) continue;
    for (const decl of imported.module.decls) {
      if (decl.kind !== "RecordDecl" || !importsRecord(edge.clause, decl.name)) continue;
      for (const field of decl.fields) fields.add(field.name);
    }
  }
  return fields;
}

function importsRecord(clause: ImportClause, name: string): boolean {
  return clause.kind === "All" || clause.kind === "Namespace" ||
    clause.specs.some((spec) => spec.name === name);
}
