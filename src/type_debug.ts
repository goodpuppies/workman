import type { Decl, Expr, Module, Pattern } from "./ast.ts";
import {
  errorMessage,
  formatError,
  FrontendDiagnosticError,
  renderDiagnosticSummary,
} from "./diagnostics.ts";
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "./ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "./ffi/elab.ts";
import type { InferResult } from "./infer.ts";
import { inferModule, inferModulePartial } from "./infer.ts";
import { loadModuleGraph, type ModuleGraph, type ModuleNode } from "./module_graph.ts";
import { sliceSource, type SourceSpan } from "./source.ts";
import { standardInferOptions } from "./standard_library.ts";
import { prune, type Scheme, show, type Ty } from "./types.ts";
import type { FfiFact, TypeFact } from "./infer/type_facts.ts";
import { collectExprs, collectPatterns } from "./type_debug_collect.ts";

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
    const inferOptions = await standardInferOptions();

    const ffi = new Map<string, ReturnType<typeof prepareFfiElaboration>>();
    for (const node of graph.nodes.values()) {
      const prepared = prepareFfiElaboration(node.module, { filePath: node.path });
      ffi.set(node.path, prepared);
      node.module = prepared.module;
    }

    const firstResults = new Map<string, InferResult>();
    for (const path of graph.order) {
      state.phase = "initial partial inference";
      state.path = path;
      state.node = graph.nodes.get(path);
      const imports = importsFor(path, graph, firstResults);
      const result = inferModulePartial(state.node!.module, imports, inferOptions);
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
      const result = inferModulePartial(state.node!.module, imports, inferOptions);
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
      const result = inferModule(state.node!.module, imports, inferOptions);
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
    state.result && state.node
      ? formatNearbyTypeFacts(state.node.module, state.node.source, state.result, undefined)
      : undefined,
    state.result ? formatFfiFacts(state.result) : undefined,
  ].filter((item): item is string => !!item && item.length > 0).join("\n\n");
}

function hasFatalPartialDiagnostics(result: InferResult): boolean {
  return result.diagnostics.some((item) =>
    item.severity === "error" && !isDelayedFfiPartialDiagnostic(renderDiagnosticSummary(item))
  );
}

function isDelayedFfiPartialDiagnostic(message: string): boolean {
  return message.startsWith("cannot solve unresolved JS FFI type ") ||
    message.startsWith("unresolved JS FFI obligation in ") ||
    message.startsWith("unresolved JS FFI type in ") ||
    message.startsWith("unsolved JS boundary type in ");
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
  const span = diagnostic?.primary.kind === "source" ? diagnostic.primary.span : undefined;
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
      ? formatNearbyTypeFacts(state.node.module, state.node.source, state.result, span)
      : undefined,
    state.result && state.node
      ? formatNearbyExprTypes(state.node.module, state.node.source, state.result, span)
      : undefined,
    state.result ? formatFfiFacts(state.result) : undefined,
    state.result ? formatUnresolvedFfi(state.result, state.node?.source) : undefined,
  ];
  return sections.filter((item): item is string => !!item && item.length > 0).join("\n\n");
}

function formatDiagnostics(result: InferResult): string | undefined {
  if (result.diagnostics.length === 0) return undefined;
  return [
    "diagnostics:",
    ...result.diagnostics.map((item) =>
      `  ${item.severity} ${item.code}: ${renderDiagnosticSummary(item)}` +
      (item.primary.kind === "source"
        ? ` @ ${item.primary.span.line}:${item.primary.span.col}`
        : "")
    ),
  ].join("\n");
}

function formatEnv(result: InferResult, limit: number): string {
  const env = [...result.env.entries()];
  const hiddenStd = env.filter(([name, scheme]) =>
    !name.startsWith("__ffi_") && (scheme.basis || scheme.standardLibrary)
  );
  const entries = env
    .filter(([name, scheme]) =>
      name.startsWith("__ffi_") || (!scheme.basis && !scheme.standardLibrary)
    )
    .slice(-limit);
  const hiddenNote = hiddenStd.length
    ? `note: std env hidden (${hiddenStd.length} bindings)`
    : undefined;
  if (entries.length === 0) {
    return ["environment: <empty>", hiddenNote].filter(Boolean).join("\n");
  }
  return [
    "environment:",
    hiddenNote,
    ...entries.map(([name, scheme]) => `  ${name}: ${formatScheme(scheme)}`),
  ].filter(Boolean).join("\n");
}

function formatScheme(scheme: Scheme): string {
  const vars = scheme.vars.length ? ` forall ${scheme.vars.length}` : "";
  return `${show(scheme.type)}${vars}`;
}

function formatNearbyTypeFacts(
  module: Module,
  source: string,
  result: InferResult,
  span: SourceSpan | undefined,
): string | undefined {
  const exprFacts = collectExprs(module)
    .flatMap((expr) => {
      const fact = result.facts.expressions.get(expr);
      return fact
        ? [{
          node: expr,
          kind: expr.kind as string,
          fact,
          distance: spanDistance(expr.node?.span, span),
        }]
        : [];
    })
    .sort((a, b) =>
      a.distance - b.distance || (a.node.node?.span.start ?? 0) - (b.node.node?.span.start ?? 0)
    )
    .slice(0, 30);
  const patternFacts = collectPatterns(module)
    .flatMap((pattern) => {
      const fact = result.facts.patterns.get(pattern);
      return fact
        ? [{
          node: pattern,
          kind: pattern.kind as string,
          fact,
          distance: spanDistance(pattern.node?.span, span),
        }]
        : [];
    })
    .sort((a, b) =>
      a.distance - b.distance || (a.node.node?.span.start ?? 0) - (b.node.node?.span.start ?? 0)
    )
    .slice(0, 30);
  const all = [...exprFacts, ...patternFacts]
    .sort((a, b) =>
      a.distance - b.distance || (a.node.node?.span.start ?? 0) - (b.node.node?.span.start ?? 0)
    )
    .slice(0, 30);
  if (all.length === 0) return undefined;
  return [
    "nearby type facts:",
    ...all.flatMap(({ node, kind, fact }) => formatNodeFact(node, kind, fact, source)),
  ].join("\n");
}

function formatNodeFact(
  node: Expr | Pattern,
  kind: string,
  fact: TypeFact,
  source: string,
): string[] {
  const span = node.node?.span;
  const loc = span ? `${span.line}:${span.col}` : "?:?";
  const text = span ? compact(sliceSource(source, span)) : kind;
  const lines = [`  ${loc} ${kind} ${JSON.stringify(text)}:`];
  if (fact.instantiated) lines.push(`    type: ${show(fact.instantiated)}`);
  if (fact.general) lines.push(`    general: ${show(fact.general.type)}`);
  if (fact.origin) {
    lines.push(
      `    origin: ${fact.origin.source}${fact.origin.name ? ` ${fact.origin.name}` : ""}`,
    );
  }
  return lines;
}

function formatFfiFacts(result: InferResult): string | undefined {
  const facts = [...result.facts.ffi.values()].slice(0, 40);
  if (facts.length === 0) return undefined;
  return [
    "ffi facts:",
    ...facts.flatMap((fact) =>
      [
        `  ${formatFfiFactHeader(fact)}`,
        `    kind: ${fact.kind}`,
        `    status: ${fact.status}`,
        fact.receiver ? `    receiver: ${show(fact.receiver)}` : undefined,
        fact.binding ? `    binding: ${fact.binding}` : undefined,
        ...(fact.args.length ? [`    args: ${fact.args.map(show).join(", ")}`] : []),
        ...(fact.instantiated ? [`    type: ${show(fact.instantiated)}`] : []),
        ...formatFfiConstraints(fact),
      ].filter((line): line is string => !!line)
    ),
  ].join("\n");
}

function formatFfiFactHeader(fact: FfiFact): string {
  const span = fact.expr?.node?.span ?? fact.placeholder?.node?.span;
  const loc = span ? `${span.line}:${span.col} ` : "";
  return `${loc}?ffi#${fact.id}:${fact.binding ?? fact.path.join(".")}`;
}

function formatFfiConstraints(fact: FfiFact): string[] {
  const constraints = fact.placeholder?.constraints ?? [];
  if (constraints.length === 0) return [];
  return [
    "    constraints:",
    ...constraints.map((constraint) => `      ${show(constraint)}`),
  ];
}

function formatNearbyExprTypes(
  module: Module,
  source: string,
  result: InferResult,
  span: SourceSpan | undefined,
): string | undefined {
  const exprs = collectExprs(module);
  const typed = exprs
    .map((expr) => ({
      expr,
      type: result.types.get(expr),
      distance: spanDistance(expr.node?.span, span),
    }))
    .filter((item): item is { expr: Expr; type: Ty; distance: number } => !!item.type)
    .sort((a, b) =>
      a.distance - b.distance || (a.expr.node?.span.start ?? 0) - (b.expr.node?.span.start ?? 0)
    )
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
