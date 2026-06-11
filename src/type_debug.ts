import type { Decl, Expr, Module } from "./ast.ts";
import { errorMessage, formatError, FrontendDiagnosticError } from "./diagnostics.ts";
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "./ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "./ffi/elab.ts";
import type { InferResult } from "./infer.ts";
import { inferModule, inferModulePartial } from "./infer.ts";
import { loadModuleGraph, type ModuleGraph, type ModuleNode } from "./module_graph.ts";
import { sliceSource, type SourceSpan } from "./source.ts";
import { prune, show, type Scheme, type Ty } from "./types.ts";

type DebugState = {
  graph?: ModuleGraph;
  path?: string;
  node?: ModuleNode;
  phase: string;
  result?: InferResult;
};

export async function typeDebugFile(input: string): Promise<string> {
  const state: DebugState = { phase: "load module graph" };
  try {
    const graph = await loadModuleGraph(input);
    state.graph = graph;

    const ffi = new Map<string, ReturnType<typeof prepareFfiElaboration>>();
    for (const node of graph.nodes.values()) {
      const prepared = prepareFfiElaboration(node.module);
      ffi.set(node.path, prepared);
      node.module = prepared.module;
    }

    const firstResults = new Map<string, InferResult>();
    for (const path of graph.order) {
      state.phase = "initial partial inference";
      state.path = path;
      state.node = graph.nodes.get(path);
      const imports = importsFor(path, graph, firstResults);
      const result = inferModulePartial(state.node!.module, imports);
      firstResults.set(path, result);
      state.result = result;
      if (hasFatalPartialDiagnostics(result)) return formatRecoveredDiagnostics(state);
    }

    for (const path of graph.order) {
      state.phase = "contextualize delayed callbacks";
      state.path = path;
      state.node = graph.nodes.get(path);
      state.result = firstResults.get(path);
      const contextual = contextualizeDelayedCallbacks(ffi.get(path)!, state.result!);
      ffi.set(path, contextual);
      state.node!.module = contextual.module;
    }

    const contextualResults = new Map<string, InferResult>();
    for (const path of graph.order) {
      state.phase = "contextual partial inference";
      state.path = path;
      state.node = graph.nodes.get(path);
      const imports = importsFor(path, graph, contextualResults);
      const result = inferModulePartial(state.node!.module, imports);
      contextualResults.set(path, result);
      state.result = result;
      if (hasFatalPartialDiagnostics(result)) return formatRecoveredDiagnostics(state);
    }

    const foreignTypeRefs = new Map(
      [...ffi.values()].flatMap((item) =>
        [...item.foreignTypeRefs.values()].map((ref) => [ref.key, ref] as const)
      ),
    );

    for (const path of graph.order) {
      state.phase = "resolve delayed FFI";
      state.path = path;
      state.node = graph.nodes.get(path);
      state.result = contextualResults.get(path);
      const resolved = resolveDelayedFfiElaboration(ffi.get(path)!, state.result!, {
        foreignTypeRefs,
      });
      state.node!.module = resolved.module;
    }

    const finalResults = new Map<string, InferResult>();
    for (const path of graph.order) {
      state.phase = "final inference";
      state.path = path;
      state.node = graph.nodes.get(path);
      const imports = importsFor(path, graph, finalResults);
      const result = inferModule(state.node!.module, imports);
      finalResults.set(path, result);
      state.result = result;
    }

    const entry = finalResults.get(graph.entry);
    return [
      `type-debug: ok`,
      `entry: ${graph.entry}`,
      entry ? formatEnv(entry, 80) : "",
    ].filter(Boolean).join("\n");
  } catch (error) {
    return formatDebugFailure(error, state);
  }
}

function formatRecoveredDiagnostics(state: DebugState): string {
  return [
    "type-debug: failed",
    `phase: ${state.phase}`,
    state.path ? `module: ${state.path}` : undefined,
    "error: recoverable diagnostics were produced before later type phases",
    state.result ? formatDiagnostics(state.result) : undefined,
    state.result ? formatEnv(state.result, 100) : undefined,
  ].filter((item): item is string => !!item && item.length > 0).join("\n\n");
}

function hasFatalPartialDiagnostics(result: InferResult): boolean {
  return result.diagnostics.some((item) =>
    item.severity === "error" && !isDelayedFfiPartialDiagnostic(item.message)
  );
}

function isDelayedFfiPartialDiagnostic(message: string): boolean {
  return message.startsWith("top-level free type variable in ") ||
    message.startsWith("unresolved JS FFI type in ");
}

function importsFor(
  path: string,
  graph: ModuleGraph,
  results: Map<string, InferResult>,
): Map<string, InferResult> {
  const node = graph.nodes.get(path)!;
  const imports = new Map<string, InferResult>();
  for (const edge of node.imports) {
    const result = results.get(edge.path);
    if (result) imports.set(edge.specifier, result);
  }
  return imports;
}

function formatDebugFailure(error: unknown, state: DebugState): string {
  const diagnostic = error instanceof FrontendDiagnosticError ? error.diagnostic : undefined;
  const span = diagnostic?.span;
  const source = state.node?.source;
  const path = state.path ?? state.node?.path;
  const sections = [
    "type-debug: failed",
    `phase: ${state.phase}`,
    path ? `module: ${path}` : undefined,
    `error: ${errorMessage(error)}`,
    span && source ? formatError(errorMessage(error), path, source, span).trimEnd() : undefined,
    state.result ? formatDiagnostics(state.result) : undefined,
    state.result ? formatEnv(state.result, 100) : undefined,
    state.result && state.node
      ? formatNearbyExprTypes(state.node.module, state.node.source, state.result, span)
      : undefined,
    state.result ? formatUnresolvedFfi(state.result, state.node?.source) : undefined,
  ];
  return sections.filter((item): item is string => !!item && item.length > 0).join("\n\n");
}

function formatDiagnostics(result: InferResult): string | undefined {
  if (result.diagnostics.length === 0) return undefined;
  return [
    "diagnostics:",
    ...result.diagnostics.map((item) =>
      `  ${item.severity} ${item.code}: ${item.message}` +
      (item.span ? ` @ ${item.span.line}:${item.span.col}` : "")
    ),
  ].join("\n");
}

function formatEnv(result: InferResult, limit: number): string {
  const entries = [...result.env.entries()]
    .filter(([name, scheme]) => !scheme.basis || name.startsWith("__ffi_"))
    .slice(-limit);
  if (entries.length === 0) return "environment: <empty>";
  return [
    "environment:",
    ...entries.map(([name, scheme]) => `  ${name}: ${formatScheme(scheme)}`),
  ].join("\n");
}

function formatScheme(scheme: Scheme): string {
  const vars = scheme.vars.length ? ` forall ${scheme.vars.length}` : "";
  return `${show(scheme.type)}${vars}`;
}

function formatNearbyExprTypes(
  module: Module,
  source: string,
  result: InferResult,
  span: SourceSpan | undefined,
): string | undefined {
  const exprs = collectExprs(module);
  const typed = exprs
    .map((expr) => ({ expr, type: result.types.get(expr), distance: spanDistance(expr.node?.span, span) }))
    .filter((item): item is { expr: Expr; type: Ty; distance: number } => !!item.type)
    .sort((a, b) => a.distance - b.distance || (a.expr.node?.span.start ?? 0) - (b.expr.node?.span.start ?? 0))
    .slice(0, 30);
  if (typed.length === 0) return undefined;
  return [
    "nearby expression types:",
    ...typed.map(({ expr, type }) => {
      const loc = expr.node?.span ? `${expr.node.span.line}:${expr.node.span.col}` : "?:?";
      const text = expr.node?.span ? compact(sliceSource(source, expr.node.span)) : expr.kind;
      return `  ${loc} ${expr.kind} ${JSON.stringify(text)}: ${show(type)}`;
    }),
  ].join("\n");
}

function formatUnresolvedFfi(result: InferResult, source: string | undefined): string | undefined {
  const items = [...result.types.entries()]
    .flatMap(([expr, type]) => collectUnresolvedFfi(type).map((ffi) => ({ expr, ffi })))
    .slice(0, 40);
  if (items.length === 0) return undefined;
  return [
    "unresolved ffi values:",
    ...items.map(({ expr, ffi }) => {
      const span = expr.node?.span;
      const loc = span ? `${span.line}:${span.col}` : "?:?";
      const text = span && source ? ` ${JSON.stringify(compact(sliceSource(source, span)))}` : "";
      return `  ${loc}${text}: ${show(ffi)}`;
    }),
  ].join("\n");
}

function collectUnresolvedFfi(type: Ty): Ty[] {
  const target = prune(type);
  if (target.tag === "ffi") return [target];
  if (target.tag === "fn") {
    return [...target.params.flatMap(collectUnresolvedFfi), ...collectUnresolvedFfi(target.result)];
  }
  if (target.tag === "tuple") return target.items.flatMap(collectUnresolvedFfi);
  if (target.tag === "named") return target.args.flatMap(collectUnresolvedFfi);
  return [];
}

function spanDistance(a: SourceSpan | undefined, b: SourceSpan | undefined): number {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  if (a.start <= b.end && b.start <= a.end) return 0;
  return Math.min(Math.abs(a.end - b.start), Math.abs(b.end - a.start));
}

function compact(text: string): string {
  const squashed = text.replace(/\s+/g, " ").trim();
  return squashed.length > 100 ? `${squashed.slice(0, 97)}...` : squashed;
}

function collectExprs(module: Module): Expr[] {
  const out: Expr[] = [];
  const visitDecl = (decl: Decl) => {
    if (decl.kind !== "LetDecl") return;
    for (const binding of decl.bindings) visitExpr(binding.value);
  };
  const visitExpr = (expr: Expr) => {
    out.push(expr);
    switch (expr.kind) {
      case "Tuple":
      case "JsonArray":
        expr.items.forEach(visitExpr);
        break;
      case "Record":
      case "JsonObject":
        expr.fields.forEach((field) => visitExpr(field.value));
        break;
      case "FfiGet":
        visitExpr(expr.receiver);
        break;
      case "FfiCall":
        visitExpr(expr.receiver);
        expr.args.forEach(visitExpr);
        break;
      case "Lambda":
        visitExpr(expr.body);
        break;
      case "Call":
        visitExpr(expr.callee);
        expr.args.forEach(visitExpr);
        break;
      case "If":
        visitExpr(expr.cond);
        visitExpr(expr.thenExpr);
        visitExpr(expr.elseExpr);
        break;
      case "Match":
        visitExpr(expr.value);
        expr.arms.forEach((arm) => visitExpr(arm.body));
        break;
      case "Panic":
        visitExpr(expr.message);
        break;
      case "Block":
        for (const item of expr.items) {
          if (isDecl(item)) visitDecl(item);
          else visitExpr(item);
        }
        visitExpr(expr.result);
        break;
      case "Binary":
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case "Unary":
        visitExpr(expr.value);
        break;
      case "Pipe":
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        break;
    }
  };
  module.decls.forEach(visitDecl);
  return out;
}

function isDecl(item: Decl | Expr): item is Decl {
  return item.kind.endsWith("Decl");
}
