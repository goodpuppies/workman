import type {
  CtorDecl,
  Decl,
  Expr,
  ImportClause,
  JsImportSpec,
  Module,
  Pattern,
} from "./ast.ts";
import type { BindingId, CompilerIdAllocator, StructureId } from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";
import type { ModuleId, ModuleMap } from "./module_id.ts";
import type { AstNode } from "./source.ts";

export type BindingScopeSnapshot = Readonly<{
  values: ReadonlyMap<string, BindingId>;
  structures: ReadonlyMap<string, StructureId>;
  types: ReadonlyMap<string, TypeScopeDeclaration>;
  constructors: ReadonlyMap<string, CtorDecl>;
}>;

type TypeScopeDeclaration = Extract<
  Decl,
  { kind: "TypeDecl" | "RecordDecl" | "ForeignTypeDecl" }
>;

export type BindingScopeCheckpoint = Readonly<{
  container: AstNode;
  offset: number;
  scope: BindingScopeSnapshot;
}>;

export type BindingFacts = {
  binders: Map<Pattern, BindingId>;
  recordConstructors: Map<Extract<Decl, { kind: "RecordDecl" }>, BindingId>;
  references: Map<Expr | Pattern, BindingId>;
  structureBinders: Map<Extract<Decl, { kind: "ImportDecl" }>, StructureId>;
  structureReferences: Map<Expr | Pattern, StructureId>;
  /** Authored qualifier retained when lowering replaces the executable expression spelling. */
  sourceStructureReferences: Map<Expr, StructureId>;
  local: Set<BindingId>;
  exports: Map<string, BindingId>;
  typeExports: Map<string, TypeScopeDeclaration>;
  constructorExports: Map<string, CtorDecl>;
  jsImportBinders: Map<Extract<Decl, { kind: "JsImportDecl" }> | JsImportSpec, BindingId>;
  /** Compiler-generated JS binding -> authored import binding. Lowering identities stay distinct. */
  jsImportSourceBindings: Map<BindingId, BindingId>;
  jsStructureBinders: Map<Extract<Decl, { kind: "JsImportDecl" }>, StructureId>;
  scopeNodes: Map<AstNode, BindingScopeSnapshot>;
  scopeCheckpoints: BindingScopeCheckpoint[];
};

type ValueEnv = Map<string, BindingId>;
type BindingEnv = {
  values: ValueEnv;
  types: Map<string, TypeScopeDeclaration>;
  constructors: Map<string, CtorDecl>;
  structures: Map<string, {
    id: StructureId;
    values: ReadonlyMap<string, BindingId>;
  }>;
};

export function resolveProgramBindingFacts(
  graph: ModuleGraph,
  ids: CompilerIdAllocator,
): ModuleMap<BindingFacts> {
  const results = new Map<ModuleId, BindingFacts>();
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const imports = node.imports.map((edge) => ({
      clause: edge.clause,
      facts: results.get(edge.target)!,
    }));
    results.set(id, resolveModuleBindingFacts(node.module, ids, imports));
  }
  return results;
}

export function resolveModuleBindingFacts(
  module: Module,
  ids: CompilerIdAllocator,
  imports: { clause: ImportClause; facts: BindingFacts }[] = [],
): BindingFacts {
  const facts: BindingFacts = {
    binders: new Map(),
    recordConstructors: new Map(),
    references: new Map(),
    structureBinders: new Map(),
    structureReferences: new Map(),
    sourceStructureReferences: new Map(),
    local: new Set(),
    exports: new Map(),
    typeExports: new Map(),
    constructorExports: new Map(),
    jsImportBinders: new Map(),
    jsImportSourceBindings: new Map(),
    jsStructureBinders: new Map(),
    scopeNodes: new Map(),
    scopeCheckpoints: [],
  };
  let env = emptyBindingEnv();
  recordScope(facts, module.node, env);
  recordCheckpoint(facts, module.node, module.node?.span.start, env);
  let importIndex = 0;
  for (const decl of module.decls) {
    recordScope(facts, decl.node, env);
    if (decl.kind === "ImportDecl") {
      const imported = imports[importIndex++];
      if (imported) env = addImport(env, decl, imported.clause, imported.facts, facts, ids);
      recordCheckpoint(facts, module.node, decl.node?.span.end, env);
      continue;
    }
    env = resolveDecl(decl, env, facts, ids, true);
    recordCheckpoint(facts, module.node, decl.node?.span.end, env);
  }
  return facts;
}

export function bindingScopeAt(
  facts: BindingFacts,
  offset: number,
): BindingScopeSnapshot | undefined {
  const containers = new Set(facts.scopeCheckpoints.map((checkpoint) => checkpoint.container));
  const node = [...facts.scopeNodes]
    .filter(([candidate]) =>
      !containers.has(candidate) &&
      candidate.span.start <= offset &&
      offset < candidate.span.end
    )
    .sort(([left], [right]) =>
      (left.span.end - left.span.start) - (right.span.end - right.span.start) ||
      right.span.start - left.span.start
    )[0];
  const checkpoint = facts.scopeCheckpoints
    .filter((checkpoint) =>
      checkpoint.container.span.start <= offset &&
      offset < checkpoint.container.span.end &&
      checkpoint.offset <= offset
    )
    .sort((left, right) =>
      (left.container.span.end - left.container.span.start) -
        (right.container.span.end - right.container.span.start) ||
      right.offset - left.offset
    )[0];
  if (!node) return checkpoint?.scope;
  if (!checkpoint) return node[1];
  const nodeWidth = node[0].span.end - node[0].span.start;
  const checkpointWidth = checkpoint.container.span.end - checkpoint.container.span.start;
  return checkpointWidth <= nodeWidth ? checkpoint.scope : node[1];
}

function emptyBindingEnv(): BindingEnv {
  return { values: new Map(), types: new Map(), constructors: new Map(), structures: new Map() };
}

function cloneBindingEnv(env: BindingEnv): BindingEnv {
  return {
    values: new Map(env.values),
    types: new Map(env.types),
    constructors: new Map(env.constructors),
    structures: new Map(env.structures),
  };
}

function snapshotBindingEnv(env: BindingEnv): BindingScopeSnapshot {
  return Object.freeze({
    values: new Map(env.values),
    structures: new Map([...env.structures].map(([name, structure]) => [name, structure.id])),
    types: new Map(env.types),
    constructors: new Map(env.constructors),
  });
}

function recordScope(facts: BindingFacts, node: AstNode | undefined, env: BindingEnv): void {
  if (node) facts.scopeNodes.set(node, snapshotBindingEnv(env));
}

function recordCheckpoint(
  facts: BindingFacts,
  container: AstNode | undefined,
  offset: number | undefined,
  env: BindingEnv,
): void {
  if (!container || offset === undefined) return;
  facts.scopeCheckpoints.push(Object.freeze({
    container,
    offset,
    scope: snapshotBindingEnv(env),
  }));
}

function addImport(
  env: BindingEnv,
  decl: Extract<Decl, { kind: "ImportDecl" }>,
  clause: ImportClause,
  importedFacts: BindingFacts,
  facts: BindingFacts,
  ids: CompilerIdAllocator,
): BindingEnv {
  const next = cloneBindingEnv(env);
  if (clause.kind === "Namespace") {
    const id = ids.structure();
    facts.structureBinders.set(decl, id);
    next.structures.set(clause.alias, { id, values: importedFacts.exports });
  } else if (clause.kind === "All") {
    for (const [name, id] of importedFacts.exports) next.values.set(name, id);
    for (const [name, declaration] of importedFacts.typeExports) {
      next.types.set(name, declaration);
    }
    for (const [name, declaration] of importedFacts.constructorExports) {
      next.constructors.set(name, declaration);
    }
  } else {
    for (const spec of clause.specs) {
      const localName = spec.alias ?? spec.name;
      const id = importedFacts.exports.get(spec.name);
      if (id !== undefined) next.values.set(localName, id);
      const type = importedFacts.typeExports.get(spec.name);
      if (type !== undefined) next.types.set(localName, type);
      const constructor = importedFacts.constructorExports.get(spec.name);
      if (constructor !== undefined) next.constructors.set(localName, constructor);
    }
  }
  return next;
}

function resolveDecl(
  decl: Decl,
  env: BindingEnv,
  facts: BindingFacts,
  ids: CompilerIdAllocator,
  topLevel = false,
): BindingEnv {
  recordScope(facts, decl.node, env);
  if (decl.kind === "ForeignTypeDecl") {
    const next = cloneBindingEnv(env);
    next.types.set(decl.name, decl);
    if (topLevel) facts.typeExports.set(decl.name, decl);
    return next;
  }
  if (decl.kind === "JsImportDecl") {
    const next = cloneBindingEnv(env);
    if (decl.clause.kind === "Namespace") {
      const id = ids.binding();
      facts.jsImportBinders.set(decl, id);
      facts.local.add(id);
      next.values.set(decl.clause.alias, id);
      return next;
    }
    const values = new Map<string, BindingId>();
    for (const spec of decl.clause.specs) {
      const sourceName = spec.sourceName ?? spec.alias ?? spec.name;
      const id = ids.binding();
      facts.jsImportBinders.set(spec, id);
      facts.local.add(id);
      if (spec.sourceName) {
        const sourceId = existingJsImportBinding(facts, spec, sourceName);
        if (sourceId !== undefined) facts.jsImportSourceBindings.set(id, sourceId);
      }
      values.set(spec.alias ?? spec.name, id);
    }
    const sourceValues = new Map<string, BindingId>();
    if (decl.sourceClause?.kind === "Named") {
      for (const spec of decl.sourceClause.specs) {
        const id = ids.binding();
        facts.jsImportBinders.set(spec, id);
        facts.local.add(id);
        sourceValues.set(spec.alias ?? spec.name, id);
      }
      for (const spec of decl.clause.specs) {
        if (!spec.sourceName) continue;
        const generatedId = facts.jsImportBinders.get(spec);
        const sourceId = sourceValues.get(spec.sourceName);
        if (generatedId !== undefined && sourceId !== undefined) {
          facts.jsImportSourceBindings.set(generatedId, sourceId);
        }
      }
    }
    if (decl.clause.alias) {
      const id = ids.structure();
      facts.jsStructureBinders.set(decl, id);
      next.structures.set(decl.clause.alias, { id, values });
    } else {
      for (const [name, id] of values) next.values.set(name, id);
    }
    if (decl.sourceClause?.kind === "Named" && decl.sourceClause.alias) {
      const id = ids.structure();
      facts.jsStructureBinders.set(decl, id);
      next.structures.set(decl.sourceClause.alias, { id, values: sourceValues });
    } else if (decl.sourceClause?.kind === "Named") {
      for (const [name, id] of sourceValues) next.values.set(name, id);
    }
    return next;
  }
  if (decl.kind === "TypeDecl") {
    const next = cloneBindingEnv(env);
    next.types.set(decl.name, decl);
    if (decl.exported) facts.typeExports.set(decl.name, decl);
    for (const constructor of decl.ctors) {
      next.constructors.set(constructor.name, constructor);
      if (decl.exported) facts.constructorExports.set(constructor.name, constructor);
    }
    return next;
  }
  if (decl.kind === "RecordDecl") {
    const id = ids.binding();
    facts.recordConstructors.set(decl, id);
    facts.local.add(id);
    const next = cloneBindingEnv(env);
    next.values.set(decl.name, id);
    next.types.set(decl.name, decl);
    if (decl.exported) {
      facts.exports.set(decl.name, id);
      facts.typeExports.set(decl.name, decl);
    }
    return next;
  }
  if (decl.kind !== "LetDecl") return env;
  if (decl.recursive) {
    const recursive = cloneBindingEnv(env);
    for (const binding of decl.bindings) {
      addPatternBinders(binding.pattern, recursive.values, facts, ids);
    }
    for (const binding of decl.bindings) resolveExpr(binding.value, recursive, facts, ids);
    publishExports(decl, facts);
    return recursive;
  }
  for (const binding of decl.bindings) {
    resolvePatternReferences(binding.pattern, env, facts);
    resolveExpr(binding.value, env, facts, ids);
  }
  const next = cloneBindingEnv(env);
  for (const binding of decl.bindings) {
    addPatternBinders(binding.pattern, next.values, facts, ids);
  }
  publishExports(decl, facts);
  return next;
}

function publishExports(decl: Extract<Decl, { kind: "LetDecl" }>, facts: BindingFacts): void {
  if (!decl.exported) return;
  for (const binding of decl.bindings) {
    for (const pattern of binderPatterns(binding.pattern)) {
      facts.exports.set(pattern.name, facts.binders.get(pattern)!);
    }
  }
}

function resolveExpr(
  expr: Expr,
  env: BindingEnv,
  facts: BindingFacts,
  ids: CompilerIdAllocator,
): void {
  recordScope(facts, expr.node, env);
  switch (expr.kind) {
    case "Var": {
      const structure = lookupStructure(env, expr.name);
      if (structure !== undefined) facts.structureReferences.set(expr, structure);
      if (expr.sourceName) {
        const sourceStructure = lookupStructure(env, expr.sourceName);
        if (sourceStructure !== undefined) {
          facts.sourceStructureReferences.set(expr, sourceStructure);
        }
      }
      const id = lookupValue(env, expr.name);
      if (id !== undefined) facts.references.set(expr, id);
      return;
    }
    case "Tuple":
    case "JsonArray":
      expr.items.forEach((item) => resolveExpr(item, env, facts, ids));
      return;
    case "Record":
      expr.fields.forEach((field) => resolveExpr(field.value, env, facts, ids));
      return;
    case "JsonObject":
      expr.fields.forEach((field) => resolveExpr(field.value, env, facts, ids));
      return;
    case "FfiGet":
      resolveExpr(expr.receiver, env, facts, ids);
      return;
    case "FfiCall":
      resolveExpr(expr.receiver, env, facts, ids);
      expr.args.forEach((arg) => resolveExpr(arg, env, facts, ids));
      return;
    case "FfiBindingCall":
      expr.args.forEach((arg) => resolveExpr(arg, env, facts, ids));
      return;
    case "Lambda": {
      const local = cloneBindingEnv(env);
      for (const param of expr.params) resolvePatternReferences(param.pattern, env, facts);
      for (const param of expr.params) {
        addPatternBinders(param.pattern, local.values, facts, ids);
      }
      resolveExpr(expr.body, local, facts, ids);
      return;
    }
    case "Call":
      resolveExpr(expr.callee, env, facts, ids);
      expr.args.forEach((arg) => resolveExpr(arg, env, facts, ids));
      return;
    case "If":
      resolveExpr(expr.cond, env, facts, ids);
      resolveExpr(expr.thenExpr, env, facts, ids);
      resolveExpr(expr.elseExpr, env, facts, ids);
      return;
    case "Match":
      resolveExpr(expr.value, env, facts, ids);
      for (const arm of expr.arms) {
        resolvePatternReferences(arm.pattern, env, facts);
        const local = cloneBindingEnv(env);
        addPatternBinders(arm.pattern, local.values, facts, ids);
        resolveExpr(arm.body, local, facts, ids);
      }
      return;
    case "Panic":
      resolveExpr(expr.message, env, facts, ids);
      return;
    case "Block": {
      let local = cloneBindingEnv(env);
      recordCheckpoint(facts, expr.node, expr.node?.span.start, local);
      for (const item of expr.items) {
        if (isDecl(item)) local = resolveDecl(item, local, facts, ids);
        else resolveExpr(item, local, facts, ids);
        recordCheckpoint(facts, expr.node, item.node?.span.end, local);
      }
      resolveExpr(expr.result, local, facts, ids);
      return;
    }
    case "Binary":
      resolveExpr(expr.left, env, facts, ids);
      resolveExpr(expr.right, env, facts, ids);
      return;
    case "Unary":
      resolveExpr(expr.value, env, facts, ids);
      return;
    case "Pipe":
      resolveExpr(expr.left, env, facts, ids);
      resolveExpr(expr.right, env, facts, ids);
      return;
    default:
      return;
  }
}

function resolvePatternReferences(pattern: Pattern, env: BindingEnv, facts: BindingFacts): void {
  recordScope(facts, pattern.node, env);
  if (pattern.kind === "PPinned") {
    const structure = lookupStructure(env, pattern.name);
    if (structure !== undefined) facts.structureReferences.set(pattern, structure);
    const id = lookupValue(env, pattern.name);
    if (id !== undefined) facts.references.set(pattern, id);
    return;
  }
  if (pattern.kind === "PTuple") {
    pattern.items.forEach((item) => resolvePatternReferences(item, env, facts));
  } else if (pattern.kind === "PRecord") {
    pattern.fields.forEach((field) => resolvePatternReferences(field.pattern, env, facts));
  } else if (pattern.kind === "PCtor") {
    const structure = lookupStructure(env, pattern.name);
    if (structure !== undefined) facts.structureReferences.set(pattern, structure);
    pattern.args.forEach((arg) => resolvePatternReferences(arg, env, facts));
  }
}

function lookupValue(env: BindingEnv, name: string): BindingId | undefined {
  const direct = env.values.get(name);
  if (direct !== undefined) return direct;
  const dot = name.indexOf(".");
  if (dot >= 0) {
    const base = name.slice(0, dot);
    return env.structures.get(base)?.values.get(name.slice(dot + 1)) ?? env.values.get(base);
  }
  return env.structures.get(name)?.values.get("carrier");
}

function existingJsImportBinding(
  facts: BindingFacts,
  spec: JsImportSpec,
  sourceName: string,
): BindingId | undefined {
  for (const [candidate, id] of facts.jsImportBinders) {
    if (isJsImportDeclaration(candidate) || candidate.node !== spec.node) continue;
    if ((candidate.sourceName ?? candidate.alias ?? candidate.name) === sourceName) return id;
  }
  return undefined;
}

function isJsImportDeclaration(
  value: Extract<Decl, { kind: "JsImportDecl" }> | JsImportSpec,
): value is Extract<Decl, { kind: "JsImportDecl" }> {
  return "kind" in value && value.kind === "JsImportDecl";
}

function lookupStructure(env: BindingEnv, name: string): StructureId | undefined {
  const dot = name.indexOf(".");
  if (dot < 0 && env.values.has(name)) return undefined;
  const base = dot >= 0 ? name.slice(0, dot) : name;
  return env.structures.get(base)?.id;
}

function addPatternBinders(
  pattern: Pattern,
  env: ValueEnv,
  facts: BindingFacts,
  ids: CompilerIdAllocator,
): void {
  for (const binder of binderPatterns(pattern)) {
    let id = facts.binders.get(binder);
    if (id === undefined) {
      id = ids.binding();
      facts.binders.set(binder, id);
      facts.local.add(id);
    }
    env.set(binder.name, id);
  }
}

function binderPatterns(pattern: Pattern): Extract<Pattern, { kind: "PVar" }>[] {
  if (pattern.kind === "PVar") return [pattern];
  if (pattern.kind === "PTuple") return pattern.items.flatMap(binderPatterns);
  if (pattern.kind === "PRecord") {
    return pattern.fields.flatMap((field) => binderPatterns(field.pattern));
  }
  if (pattern.kind === "PCtor") return pattern.args.flatMap(binderPatterns);
  return [];
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind === "ImportDecl" || value.kind === "LetDecl" ||
    value.kind === "JsImportDecl" || value.kind === "TypeDecl" ||
    value.kind === "RecordDecl" || value.kind === "ForeignTypeDecl";
}
