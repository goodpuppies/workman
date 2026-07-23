import type { Decl, Expr, ImportClause, Module, Pattern } from "./ast.ts";
import type { BindingId, CompilerIdAllocator } from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";

export type BindingFacts = {
  binders: Map<Pattern, BindingId>;
  recordConstructors: Map<Extract<Decl, { kind: "RecordDecl" }>, BindingId>;
  references: Map<Expr | Pattern, BindingId>;
  local: Set<BindingId>;
  exports: Map<string, BindingId>;
};

type ValueEnv = Map<string, BindingId>;

export function resolveProgramBindingFacts(
  graph: ModuleGraph,
  ids: CompilerIdAllocator,
): Map<string, BindingFacts> {
  const results = new Map<string, BindingFacts>();
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const imported = node.imports.map((edge) => ({
      clause: edge.clause,
      facts: results.get(edge.path)!,
    }));
    results.set(path, resolveModuleBindingFacts(node.module, ids, imported));
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
    local: new Set(),
    exports: new Map(),
  };
  let env: ValueEnv = importedEnv(imports);
  for (const decl of module.decls) env = resolveDecl(decl, env, facts, ids);
  return facts;
}

function importedEnv(imports: { clause: ImportClause; facts: BindingFacts }[]): ValueEnv {
  const env: ValueEnv = new Map();
  for (const { clause, facts } of imports) {
    if (clause.kind === "Namespace") {
      for (const [name, id] of facts.exports) env.set(`${clause.alias}.${name}`, id);
      const carrier = facts.exports.get("carrier");
      if (carrier !== undefined) env.set(clause.alias, carrier);
    } else if (clause.kind === "All") {
      for (const [name, id] of facts.exports) env.set(name, id);
    } else {
      for (const spec of clause.specs) {
        const id = facts.exports.get(spec.name);
        if (id !== undefined) env.set(spec.alias ?? spec.name, id);
      }
    }
  }
  return env;
}

function resolveDecl(
  decl: Decl,
  env: ValueEnv,
  facts: BindingFacts,
  ids: CompilerIdAllocator,
): ValueEnv {
  if (decl.kind === "RecordDecl") {
    const id = ids.binding();
    facts.recordConstructors.set(decl, id);
    facts.local.add(id);
    const next = new Map(env);
    next.set(decl.name, id);
    if (decl.exported) {
      facts.exports.set(decl.name, id);
    }
    return next;
  }
  if (decl.kind !== "LetDecl") return env;
  if (decl.recursive) {
    const recursive = new Map(env);
    for (const binding of decl.bindings) addPatternBinders(binding.pattern, recursive, facts, ids);
    for (const binding of decl.bindings) resolveExpr(binding.value, recursive, facts, ids);
    publishExports(decl, facts);
    return recursive;
  }
  for (const binding of decl.bindings) {
    resolvePatternReferences(binding.pattern, env, facts);
    resolveExpr(binding.value, env, facts, ids);
  }
  const next = new Map(env);
  for (const binding of decl.bindings) addPatternBinders(binding.pattern, next, facts, ids);
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
  env: ValueEnv,
  facts: BindingFacts,
  ids: CompilerIdAllocator,
): void {
  switch (expr.kind) {
    case "Var": {
      const id = env.get(expr.name) ?? env.get(expr.name.split(".", 1)[0]);
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
      const local = new Map(env);
      for (const param of expr.params) resolvePatternReferences(param.pattern, env, facts);
      for (const param of expr.params) addPatternBinders(param.pattern, local, facts, ids);
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
        const local = new Map(env);
        addPatternBinders(arm.pattern, local, facts, ids);
        resolveExpr(arm.body, local, facts, ids);
      }
      return;
    case "Panic":
      resolveExpr(expr.message, env, facts, ids);
      return;
    case "Block": {
      let local = new Map(env);
      for (const item of expr.items) {
        if (isDecl(item)) local = resolveDecl(item, local, facts, ids);
        else resolveExpr(item, local, facts, ids);
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

function resolvePatternReferences(pattern: Pattern, env: ValueEnv, facts: BindingFacts): void {
  if (pattern.kind === "PPinned") {
    const id = env.get(pattern.name);
    if (id !== undefined) facts.references.set(pattern, id);
    return;
  }
  if (pattern.kind === "PTuple") {
    pattern.items.forEach((item) => resolvePatternReferences(item, env, facts));
  } else if (pattern.kind === "PRecord") {
    pattern.fields.forEach((field) => resolvePatternReferences(field.pattern, env, facts));
  } else if (pattern.kind === "PCtor") {
    pattern.args.forEach((arg) => resolvePatternReferences(arg, env, facts));
  }
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
