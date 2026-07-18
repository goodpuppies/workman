import type { ImportClause } from "./ast.ts";
import { FrontendDiagnosticError, renderDiagnosticSummary } from "./diagnostics.ts";
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "./ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "./ffi/elab.ts";
import { prepareInitialJsImportReflection } from "./ffi/reflect/types.ts";
import { inferModule, inferModulePartial, type InferResult } from "./infer.ts";
import { resolveLocalJsModuleSpecifiers } from "./js_module_specifier.ts";
import type { ModuleGraph, ModuleNode } from "./module_graph.ts";
import { standardInferOptions } from "./standard_library.ts";
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
  onEvent?: (event: StagedAnalysisEvent) => void;
  onTiming?: (event: StagedAnalysisTimingEvent) => void;
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
): Promise<Map<string, InferResult>> {
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

  const ffi = new Map<string, ReturnType<typeof prepareFfiElaboration>>();
  for (const node of graph.nodes.values()) {
    await run("prepare FFI", node, undefined, () => {
      const prepared = prepareFfiElaboration(node.module, {
        filePath: node.path,
        importedRecordFields: importedRecordFields(node, graph),
      });
      ffi.set(node.path, prepared);
      node.module = prepared.module;
      emit("prepare FFI", node);
    });
  }

  const standardLibraryStarted = performance.now();
  const inferOptions = await standardInferOptions();
  options.onTiming?.({
    phase: "load standard library",
    milliseconds: performance.now() - standardLibraryStarted,
  });

  const requiresFfiStaging =
    [...ffi.values()].some((item) =>
      item.bindings.size > 0 || item.foreignTypeRefs.size > 0 ||
      (item.sourceJsImports?.length ?? 0) > 0
    ) || [...graph.nodes.values()].some((node) =>
      collectExprs(node.module).some((expr) =>
        expr.kind === "FfiGet" || expr.kind === "FfiCall" || expr.kind === "FfiBindingCall"
      )
    );
  if (!requiresFfiStaging) {
    const results = new Map<string, InferResult>();
    for (const path of graph.order) {
      const node = graph.nodes.get(path)!;
      const result = await run(
        "final inference",
        node,
        undefined,
        () => inferModule(node.module, importsFor(node, results), inferOptions),
      );
      results.set(path, result);
      emit("final inference", node, result);
    }
    return results;
  }

  const firstResults = new Map<string, InferResult>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const result = await run(
      "initial partial inference",
      node,
      undefined,
      () => inferModulePartial(node.module, importsFor(node, firstResults), inferOptions),
    );
    firstResults.set(path, result);
    emit("initial partial inference", node, result);
    await run("initial partial inference", node, result, () => assertNoPartialDiagnostics(result));
  }

  const contextualizedPaths = new Set<string>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    await run("contextualize delayed callbacks", node, firstResults.get(path), () => {
      const previous = ffi.get(path)!;
      const contextual = contextualizeDelayedCallbacks(previous, firstResults.get(path)!);
      if (contextual !== previous) contextualizedPaths.add(path);
      ffi.set(path, contextual);
      node.module = contextual.module;
      emit("contextualize delayed callbacks", node, firstResults.get(path));
    });
  }

  const contextualResults = new Map<string, InferResult>();
  const contextuallyReinferredPaths = new Set<string>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const requiresReinference = contextualizedPaths.has(path) ||
      node.imports.some((edge) => contextuallyReinferredPaths.has(edge.path));
    const result = await run(
      "contextual partial inference",
      node,
      undefined,
      () =>
        requiresReinference
          ? inferModulePartial(node.module, importsFor(node, contextualResults), inferOptions)
          : firstResults.get(path)!,
    );
    if (requiresReinference) contextuallyReinferredPaths.add(path);
    contextualResults.set(path, result);
    emit("contextual partial inference", node, result);
    await run(
      "contextual partial inference",
      node,
      result,
      () => assertNoPartialDiagnostics(result),
    );
  }

  const foreignTypeRefs = new Map(
    [...ffi.values()].flatMap((item) =>
      [...item.foreignTypeRefs.values()].map((ref) => [ref.key, ref] as const)
    ),
  );
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const result = contextualResults.get(path)!;
    await run("resolve delayed FFI", node, result, () => {
      emit("resolve delayed FFI", node, result);
      const resolved = resolveDelayedFfiElaboration(ffi.get(path)!, result, {
        foreignTypeRefs,
        dynamicFallback: false,
      });
      ffi.set(path, resolved);
      node.module = resolved.module;
    });
  }

  const pathsWithDelayedFfi = new Set(
    graph.order.filter((path) => moduleHasDelayedFfi(graph.nodes.get(path)!.module)),
  );
  const postResolveResults = new Map<string, InferResult>();
  const postResolutionReinferredPaths = new Set<string>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const requiresReinference = pathsWithDelayedFfi.has(path) ||
      node.imports.some((edge) => postResolutionReinferredPaths.has(edge.path));
    const result = await run(
      "post-resolution partial inference",
      node,
      undefined,
      () =>
        requiresReinference
          ? inferModulePartial(node.module, importsFor(node, postResolveResults), inferOptions)
          : contextualResults.get(path)!,
    );
    if (requiresReinference) postResolutionReinferredPaths.add(path);
    postResolveResults.set(path, result);
    emit("post-resolution partial inference", node, result);
    await run(
      "post-resolution partial inference",
      node,
      result,
      () => assertNoPartialDiagnostics(result),
    );
  }

  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const result = postResolveResults.get(path)!;
    await run("resolve delayed FFI (second pass)", node, result, () => {
      emit("resolve delayed FFI (second pass)", node, result);
      if (!postResolutionReinferredPaths.has(path)) return;
      const resolved = resolveDelayedFfiElaboration(ffi.get(path)!, result, { foreignTypeRefs });
      ffi.set(path, resolved);
      node.module = resolved.module;
    });
  }

  const results = new Map<string, InferResult>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const result = await run(
      "final inference",
      node,
      undefined,
      () => inferModule(node.module, importsFor(node, results), inferOptions),
    );
    results.set(path, result);
    emit("final inference", node, result);
  }
  return results;
}

function moduleHasDelayedFfi(module: ModuleNode["module"]): boolean {
  return collectExprs(module).some((expr) =>
    expr.kind === "FfiGet" || expr.kind === "FfiCall" || expr.kind === "FfiBindingCall"
  );
}

export function isDelayedFfiPartialDiagnostic(message: string): boolean {
  return message.startsWith("cannot solve unresolved JS FFI type ") ||
    message.startsWith("unresolved JS FFI obligation in ") ||
    message.startsWith("unresolved JS FFI type in ") ||
    message.startsWith("unsolved JS boundary type in ") ||
    message.includes("?ffi#");
}

export function assertNoPartialDiagnostics(result: InferResult): InferResult {
  const diagnostic = result.diagnostics.find((item) =>
    item.severity === "error" && !isDelayedFfiPartialDiagnostic(renderDiagnosticSummary(item))
  );
  if (diagnostic) throw new FrontendDiagnosticError(diagnostic);
  return result;
}

function importsFor(node: ModuleNode, results: Map<string, InferResult>): Map<string, InferResult> {
  const imports = new Map<string, InferResult>();
  for (const edge of node.imports) {
    const result = results.get(edge.path);
    if (result) imports.set(edge.specifier, result);
  }
  return imports;
}

function importedRecordFields(node: ModuleNode, graph: ModuleGraph): Set<string> {
  const fields = new Set<string>();
  for (const edge of node.imports) {
    const imported = graph.nodes.get(edge.path);
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
