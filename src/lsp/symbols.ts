import type {
  Binding,
  Decl,
  Expr,
  ImportClause,
  MatchArm,
  Module,
  Pattern,
  TypeExpr,
} from "../ast.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { loadModuleGraph, type ModuleGraph, type ModuleNode } from "../module_graph.ts";
import { lineColToOffset, lineStarts, type SourceSpan } from "../source.ts";
import { type LspRange, spanRange } from "./range.ts";
import { binderPatterns, childExpressions, isDecl } from "./symbol_ast.ts";
import { fileUriToPath, pathToFileUri } from "./uri.ts";

export type LspLocation = { uri: string; range: LspRange };

type SymbolKind = "value" | "type";
type Definition = {
  key: string;
  name: string;
  kind: SymbolKind;
  path: string;
  span: SourceSpan;
};
type Occurrence = { path: string; span: SourceSpan; target: Definition; declaration: boolean };
type Scope = { values: Map<string, Definition>; types: Map<string, Definition> };
type ModuleSymbols = {
  values: Map<string, Definition>;
  types: Map<string, Definition>;
  exportedValues: Map<string, Definition>;
  exportedTypes: Map<string, Definition>;
};

export async function definitionAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<LspLocation | null> {
  const index = await buildIndex(fileUriToPath(uri), sourceOverrides, options);
  if (!index) return null;
  const node = index.graph.nodes.get(index.graph.entry);
  if (!node) return null;
  const offset = lineColToOffset(position.line + 1, position.character, lineStarts(node.source));
  const occurrence = occurrenceAt(index.occurrences, index.graph.entry, offset);
  return occurrence ? location(index.graph, occurrence.target) : null;
}

export async function referencesAt(
  uri: string,
  position: { line: number; character: number },
  includeDeclaration: boolean,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<LspLocation[]> {
  const index = await buildIndex(fileUriToPath(uri), sourceOverrides, options);
  if (!index) return [];
  const node = index.graph.nodes.get(index.graph.entry);
  if (!node) return [];
  const offset = lineColToOffset(position.line + 1, position.character, lineStarts(node.source));
  const selected = occurrenceAt(index.occurrences, index.graph.entry, offset);
  if (!selected) return [];
  return index.occurrences
    .filter((item) => item.target.key === selected.target.key)
    .filter((item) => includeDeclaration || !item.declaration)
    .map((item) => occurrenceLocation(index.graph, item))
    .filter((item): item is LspLocation => item !== undefined);
}

async function buildIndex(
  entryPath: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions,
): Promise<{ graph: ModuleGraph; occurrences: Occurrence[] } | null> {
  try {
    const graph = await loadModuleGraph(entryPath, { ...options, sourceOverrides });
    await addOpenDocumentGraphs(graph, sourceOverrides, options);
    const modules = new Map<string, ModuleSymbols>();
    const occurrences: Occurrence[] = [];
    for (const node of graph.nodes.values()) modules.set(node.path, collectTopDefinitions(node));
    for (const node of graph.nodes.values()) {
      collectModuleOccurrences(node, graph, modules, occurrences);
    }
    return { graph, occurrences };
  } catch {
    return null;
  }
}

async function addOpenDocumentGraphs(
  graph: ModuleGraph,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions,
) {
  for (const path of sourceOverrides.keys()) {
    if (!path.endsWith(".wm") || graph.nodes.has(path)) continue;
    try {
      const openGraph = await loadModuleGraph(path, { ...options, sourceOverrides });
      for (const [nodePath, node] of openGraph.nodes) graph.nodes.set(nodePath, node);
      for (const nodePath of openGraph.order) {
        if (!graph.order.includes(nodePath)) graph.order.push(nodePath);
      }
    } catch {
      // One incomplete open buffer should not disable symbols in the requested document.
    }
  }
}

function collectTopDefinitions(node: ModuleNode): ModuleSymbols {
  const values = new Map<string, Definition>();
  const types = new Map<string, Definition>();
  const exportedValues = new Map<string, Definition>();
  const exportedTypes = new Map<string, Definition>();
  for (const decl of node.module.decls) {
    if (decl.kind === "LetDecl") {
      for (const binding of decl.bindings) {
        for (const pattern of binderPatterns(binding.pattern)) {
          const def = definition(node, pattern.name, "value", pattern.node?.span);
          if (def) addDefinition(values, exportedValues, def, decl.exported);
        }
      }
    } else if (decl.kind === "TypeDecl" || decl.kind === "RecordDecl") {
      const typeDef = definition(node, decl.name, "type", nameSpan(node.source, decl, decl.name));
      if (typeDef) addDefinition(types, exportedTypes, typeDef, decl.exported);
      if (decl.kind === "TypeDecl") {
        for (const ctor of decl.ctors) {
          const def = definition(node, ctor.name, "value", nameSpan(node.source, ctor, ctor.name));
          if (def) addDefinition(values, exportedValues, def, decl.exported);
        }
      } else {
        const constructorDef = definition(
          node,
          decl.name,
          "value",
          nameSpan(node.source, decl, decl.name),
        );
        if (constructorDef) {
          addDefinition(values, exportedValues, constructorDef, decl.exported);
        }
      }
    } else if (decl.kind === "ForeignTypeDecl") {
      const def = definition(node, decl.name, "type", nameSpan(node.source, decl, decl.name));
      if (def) types.set(decl.name, def);
    }
  }
  return { values, types, exportedValues, exportedTypes };
}

function addDefinition(
  all: Map<string, Definition>,
  exported: Map<string, Definition>,
  def: Definition,
  isExported: boolean,
) {
  all.set(def.name, def);
  if (isExported) exported.set(def.name, def);
}

function collectModuleOccurrences(
  node: ModuleNode,
  graph: ModuleGraph,
  modules: Map<string, ModuleSymbols>,
  out: Occurrence[],
) {
  const own = modules.get(node.path)!;
  const scope: Scope = { values: new Map(), types: new Map() };
  addImports(node, graph, modules, scope, out);
  for (const [name, def] of own.values) scope.values.set(name, def);
  for (const [name, def] of own.types) scope.types.set(name, def);
  for (const def of [...own.values.values(), ...own.types.values()]) {
    out.push({ path: node.path, span: def.span, target: def, declaration: true });
  }
  for (const decl of node.module.decls) collectDecl(node, decl, scope, out, true);
}

function addImports(
  node: ModuleNode,
  graph: ModuleGraph,
  modules: Map<string, ModuleSymbols>,
  scope: Scope,
  out: Occurrence[],
) {
  for (const edge of node.imports) {
    const targetNode = graph.nodes.get(edge.path);
    const target = modules.get(edge.path);
    if (!targetNode || !target) continue;
    const moduleDef = moduleDefinition(targetNode);
    const decl = node.module.decls.find((item) =>
      item.kind === "ImportDecl" && item.path === edge.specifier
    );
    if (decl?.kind === "ImportDecl" && decl.pathNode?.span) {
      out.push({
        path: node.path,
        span: decl.pathNode.span,
        target: moduleDef,
        declaration: false,
      });
    }
    importClause(
      node,
      decl?.kind === "ImportDecl" ? decl : undefined,
      edge.clause,
      target,
      moduleDef,
      scope,
      out,
    );
  }
}

function importClause(
  node: ModuleNode,
  decl: Extract<Decl, { kind: "ImportDecl" }> | undefined,
  clause: ImportClause,
  target: ModuleSymbols,
  moduleDef: Definition,
  scope: Scope,
  out: Occurrence[],
) {
  if (clause.kind === "All") {
    merge(scope.values, target.exportedValues);
    merge(scope.types, target.exportedTypes);
  } else if (clause.kind === "Namespace") {
    for (const [name, def] of target.exportedValues) {
      scope.values.set(`${clause.alias}.${name}`, def);
    }
    for (const [name, def] of target.exportedTypes) scope.types.set(`${clause.alias}.${name}`, def);
    const span = nameSpan(node.source, clause, clause.alias) ??
      (decl && nameSpan(node.source, decl, clause.alias));
    if (span) out.push({ path: node.path, span, target: moduleDef, declaration: false });
  } else {
    for (const spec of clause.specs) {
      const local = spec.alias ?? spec.name;
      const def = target.exportedValues.get(spec.name);
      const typeDef = target.exportedTypes.get(spec.name);
      if (def) scope.values.set(local, def);
      if (typeDef) scope.types.set(local, typeDef);
      const span = nameSpan(node.source, spec, local) ??
        (decl && nameSpan(node.source, decl, local));
      const imported = def ?? typeDef;
      if (span && imported) {
        out.push({ path: node.path, span, target: imported, declaration: false });
      }
      if (spec.alias && imported) {
        const importedSpan = nameSpan(node.source, spec, spec.name) ??
          (decl && nameSpan(node.source, decl, spec.name));
        if (importedSpan) {
          out.push({ path: node.path, span: importedSpan, target: imported, declaration: false });
        }
      }
    }
  }
}

function collectDecl(
  node: ModuleNode,
  decl: Decl,
  scope: Scope,
  out: Occurrence[],
  topLevel = false,
) {
  if (decl.kind === "LetDecl") {
    const local = childScope(scope);
    if (!topLevel || decl.recursive) defineBindingPatterns(node, decl.bindings, local, out);
    for (const binding of decl.bindings) {
      collectType(node, binding.annotation, local, out);
      collectExpr(node, binding.value, local, out);
    }
    if (!topLevel && !decl.recursive) defineBindingPatterns(node, decl.bindings, scope, out);
    else if (!topLevel) merge(scope.values, local.values);
  } else if (decl.kind === "TypeDecl") {
    for (const ctor of decl.ctors) for (const arg of ctor.args) collectType(node, arg, scope, out);
    collectType(node, decl.alias, scope, out);
  } else if (decl.kind === "RecordDecl") {
    for (const field of decl.fields) collectType(node, field.type, scope, out);
    if (!topLevel) {
      const constructorDef = definition(
        node,
        decl.name,
        "value",
        nameSpan(node.source, decl, decl.name),
      );
      if (constructorDef) {
        scope.values.set(decl.name, constructorDef);
        out.push({
          path: node.path,
          span: constructorDef.span,
          target: constructorDef,
          declaration: true,
        });
      }
    }
  } else if (decl.kind === "JsImportDecl") {
    if (decl.clause.kind === "Named") {
      for (const spec of decl.clause.specs) collectType(node, spec.type, scope, out);
    }
  }
}

function defineBindingPatterns(
  node: ModuleNode,
  bindings: Binding[],
  scope: Scope,
  out: Occurrence[],
) {
  for (const binding of bindings) definePattern(node, binding.pattern, scope, out);
}

function definePattern(node: ModuleNode, pattern: Pattern, scope: Scope, out: Occurrence[]) {
  if (pattern.kind === "PVar" && pattern.node) {
    const def = definition(node, pattern.name, "value", pattern.node.span)!;
    scope.values.set(pattern.name, def);
    out.push({ path: node.path, span: def.span, target: def, declaration: true });
  } else if (pattern.kind === "PCtor") {
    use(node, pattern.name, pattern.node?.span, scope.values, out);
    for (const arg of pattern.args) definePattern(node, arg, scope, out);
  } else if (pattern.kind === "PPinned") {
    use(node, pattern.name, pattern.node?.span, scope.values, out);
  } else if (pattern.kind === "PTuple") {
    for (const item of pattern.items) definePattern(node, item, scope, out);
  } else if (pattern.kind === "PRecord") {
    for (const field of pattern.fields) definePattern(node, field.pattern, scope, out);
  }
}

function collectExpr(node: ModuleNode, expr: Expr, scope: Scope, out: Occurrence[]) {
  if (expr.kind === "Var") useQualified(node, expr.name, expr.node?.span, scope.values, out);
  else if (expr.kind === "Lambda") {
    const local = childScope(scope);
    for (const param of expr.params) {
      collectType(node, param.annotation, local, out);
      definePattern(node, param.pattern, local, out);
    }
    collectExpr(node, expr.body, local, out);
  } else if (expr.kind === "Block") {
    const local = childScope(scope);
    for (const item of expr.items) {
      if (isDecl(item)) collectDecl(node, item, local, out);
      else collectExpr(node, item, local, out);
    }
    collectExpr(node, expr.result, local, out);
  } else if (expr.kind === "Match") {
    collectExpr(node, expr.value, scope, out);
    for (const arm of expr.arms) collectArm(node, arm, scope, out);
  } else {
    for (const child of childExpressions(expr)) collectExpr(node, child, scope, out);
  }
}

function collectArm(node: ModuleNode, arm: MatchArm, scope: Scope, out: Occurrence[]) {
  const local = childScope(scope);
  definePattern(node, arm.pattern, local, out);
  collectExpr(node, arm.body, local, out);
}

function collectType(
  node: ModuleNode,
  type: TypeExpr | undefined,
  scope: Scope,
  out: Occurrence[],
) {
  if (!type) return;
  if (type.kind === "TName") {
    useQualified(node, type.name, type.node?.span, scope.types, out);
    for (const arg of type.args) collectType(node, arg, scope, out);
  } else if (type.kind === "TTuple") {
    for (const item of type.items) collectType(node, item, scope, out);
  } else if (type.kind === "TFn") {
    for (const param of type.params) collectType(node, param, scope, out);
    collectType(node, type.result, scope, out);
  }
}

function useQualified(
  node: ModuleNode,
  name: string,
  span: SourceSpan | undefined,
  env: Map<string, Definition>,
  out: Occurrence[],
) {
  const target = env.get(name);
  if (!span || !target) return;
  const member = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  const memberSpan = narrowSpan(node.source, span, member, true) ?? span;
  out.push({ path: node.path, span: memberSpan, target, declaration: false });
  if (name.includes(".")) {
    const qualifier = name.slice(0, name.indexOf("."));
    const moduleTarget = [...env.entries()].find(([key]) => key.startsWith(`${qualifier}.`))?.[1];
    if (moduleTarget) {
      const qualifierSpan = narrowSpan(node.source, span, qualifier);
      if (qualifierSpan) {
        out.push({
          path: node.path,
          span: qualifierSpan,
          target: moduleFileTarget(moduleTarget),
          declaration: false,
        });
      }
    }
  }
}

function use(
  node: ModuleNode,
  name: string,
  span: SourceSpan | undefined,
  env: Map<string, Definition>,
  out: Occurrence[],
) {
  const target = env.get(name);
  if (span && target) {
    out.push({
      path: node.path,
      span: narrowSpan(node.source, span, name) ?? span,
      target,
      declaration: false,
    });
  }
}

function occurrenceAt(items: Occurrence[], path: string, offset: number): Occurrence | undefined {
  return items.filter((item) => item.path === path && contains(item.span, offset)).sort((a, b) =>
    width(a.span) - width(b.span)
  )[0] ??
    items.filter((item) => item.path === path && item.span.end === offset).sort((a, b) =>
      width(a.span) - width(b.span)
    )[0];
}

function location(graph: ModuleGraph, def: Definition): LspLocation | null {
  const source = graph.nodes.get(def.path)?.source;
  return source === undefined
    ? null
    : { uri: pathToFileUri(def.path), range: spanRange(source, def.span) };
}

function occurrenceLocation(graph: ModuleGraph, item: Occurrence): LspLocation | undefined {
  const source = graph.nodes.get(item.path)?.source;
  return source === undefined
    ? undefined
    : { uri: pathToFileUri(item.path), range: spanRange(source, item.span) };
}

function definition(
  node: ModuleNode,
  name: string,
  kind: SymbolKind,
  span?: SourceSpan,
): Definition | undefined {
  return span
    ? { key: `${kind}:${node.path}:${span.start}:${span.end}`, name, kind, path: node.path, span }
    : undefined;
}

function moduleDefinition(node: ModuleNode): Definition {
  const span = { start: 0, end: Math.min(1, node.source.length), line: 1, col: 0 };
  return { key: `module:${node.path}`, name: node.emitName, kind: "value", path: node.path, span };
}

function moduleFileTarget(def: Definition): Definition {
  return {
    ...def,
    key: `module:${def.path}`,
    span: { ...def.span, start: 0, end: 1, line: 1, col: 0 },
  };
}

function nameSpan(
  source: string,
  value: { node?: { span: SourceSpan } },
  name: string,
): SourceSpan | undefined {
  return value.node ? narrowSpan(source, value.node.span, name) : undefined;
}

function narrowSpan(
  source: string,
  span: SourceSpan,
  text: string,
  fromEnd = false,
): SourceSpan | undefined {
  const haystack = source.slice(span.start, span.end);
  const relative = fromEnd ? haystack.lastIndexOf(text) : haystack.indexOf(text);
  if (relative < 0) return undefined;
  return { ...span, start: span.start + relative, end: span.start + relative + text.length };
}

function childScope(scope: Scope): Scope {
  return { values: new Map(scope.values), types: new Map(scope.types) };
}

function merge(target: Map<string, Definition>, source: Map<string, Definition>) {
  for (const [name, def] of source) target.set(name, def);
}

function contains(span: SourceSpan, offset: number): boolean {
  return span.start <= offset && offset < Math.max(span.start + 1, span.end);
}

function width(span: SourceSpan): number {
  return span.end - span.start;
}
