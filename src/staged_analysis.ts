import type { ImportClause } from "./ast.ts";
import { FrontendDiagnosticError, renderDiagnosticSummary } from "./diagnostics.ts";
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "./ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "./ffi/elab.ts";
import { prepareInitialJsImportReflection } from "./ffi/reflect/types.ts";
import { inferModule, inferModulePartial, type InferResult } from "./infer.ts";
import { rememberExportedSourceDocument } from "./infer/imports.ts";
import { resolveLocalJsModuleSpecifiers } from "./js_module_specifier.ts";
import type { ModuleGraph, ModuleNode } from "./module_graph.ts";
import type { ModuleId, ModuleMap } from "./module_id.ts";
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

  const ffi = new Map<ModuleId, ReturnType<typeof prepareFfiElaboration>>();
  for (const node of graph.nodes.values()) {
    await run("prepare FFI", node, undefined, () => {
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
    const results = new Map<ModuleId, InferResult>();
    for (const id of graph.order) {
      const node = graph.nodes.get(id)!;
      const result = await run(
        "final inference",
        node,
        undefined,
        () => inferModule(node.module, importsFor(node, results), inferOptions),
      );
      rememberExportedSourceDocument(result, node.path, node.source);
      results.set(id, result);
      emit("final inference", node, result);
    }
    return results;
  }

  const firstResults = new Map<ModuleId, InferResult>();
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const result = await run(
      "initial partial inference",
      node,
      undefined,
      () => inferModulePartial(node.module, importsFor(node, firstResults), inferOptions),
    );
    rememberExportedSourceDocument(result, node.path, node.source);
    firstResults.set(id, result);
    emit("initial partial inference", node, result);
    await run("initial partial inference", node, result, () => assertNoPartialDiagnostics(result));
  }

  const contextualizedIds = new Set<ModuleId>();
  for (const id of graph.order) {
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

  const contextualResults = new Map<ModuleId, InferResult>();
  // Imported monomorphic schemes are deliberately shared so constraints from a
  // downstream module can settle an unresolved FFI binding. Once any module's
  // AST changes, those schemes and nominal type identities must be rebuilt as
  // one coherent graph wave; mixing reused dependency results with reinferred
  // consumers retains constraints from the preceding wave.
  const requiresContextualGraphReinference = contextualizedIds.size > 0;
  for (const id of graph.order) {
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
    [...ffi.values()].flatMap((item) =>
      [...item.foreignTypeRefs.values()].map((ref) => [ref.key, ref] as const)
    ),
  );
  for (const id of graph.order) {
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
    graph.order.filter((id) => moduleHasDelayedFfi(graph.nodes.get(id)!.module)),
  );
  const postResolveResults = new Map<ModuleId, InferResult>();
  const postResolutionReinferredIds = new Set<ModuleId>();
  const requiresPostResolutionGraphReinference = idsWithDelayedFfi.size > 0;
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const requiresReinference = requiresPostResolutionGraphReinference;
    const result = await run(
      "post-resolution partial inference",
      node,
      undefined,
      () =>
        requiresReinference
          ? inferModulePartial(node.module, importsFor(node, postResolveResults), inferOptions)
          : contextualResults.get(id)!,
    );
    rememberExportedSourceDocument(result, node.path, node.source);
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

  for (const id of graph.order) {
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

  const results = new Map<ModuleId, InferResult>();
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const result = await run(
      "final inference",
      node,
      undefined,
      () => inferModule(node.module, importsFor(node, results), inferOptions),
    );
    rememberExportedSourceDocument(result, node.path, node.source);
    results.set(id, result);
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

function importsFor(node: ModuleNode, results: ModuleMap<InferResult>): Map<string, InferResult> {
  const imports = new Map<string, InferResult>();
  for (const edge of node.imports) {
    const result = results.get(edge.target);
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
