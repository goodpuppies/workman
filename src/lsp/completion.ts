import type { Decl, Expr, Module, Pattern } from "../ast.ts";
import { type CompilerFrontendOptions, parseCompilerModule } from "../compiler_frontend.ts";
import { discoverGpuRegions } from "../directives.ts";
import { runtime } from "../io.ts";
import { lineColToOffset, lineStarts } from "../source.ts";
import { WMSLANG_BUILTIN_OVERLOADS } from "../wmslang/builtin_catalog.generated.ts";
import { fileUriToPath } from "./uri.ts";

export type CompletionPosition = { line: number; character: number };

export type CompletionItem = {
  label: string;
  kind: 3;
  detail: string;
  filterText: string;
  insertText: string;
  sortText: string;
};

/** Catalog-only completion for the contextual Slang namespace owned by a GPU island. */
export async function completionAt(
  uri: string,
  position: CompletionPosition,
  sourceOverrides: ReadonlyMap<string, string> = new Map(),
  frontendOptions: CompilerFrontendOptions = {},
): Promise<CompletionItem[]> {
  const path = fileUriToPath(uri);
  const source = sourceOverrides.get(path) ?? await runtime.readTextFile(path);
  const offset = Math.min(
    source.length,
    lineColToOffset(position.line + 1, position.character, lineStarts(source)),
  );

  let module: Module;
  try {
    module = await parseCompilerModule(source, frontendOptions, path);
  } catch {
    // Workman's parser does not currently expose a recovery tree. Completion remains
    // available for unresolved (but syntactically complete) identifiers.
    return [];
  }

  const region = discoverGpuRegions(module).find(({ lambda }) => contains(lambda, offset));
  if (!region) return [];

  const prefix = identifierPrefix(source, offset);
  const shadowed = visibleValueNames(module, offset);
  const overloadsByName = new Map<string, typeof WMSLANG_BUILTIN_OVERLOADS[number][]>();
  for (const overload of WMSLANG_BUILTIN_OVERLOADS) {
    if (shadowed.has(overload.name) || !overload.name.startsWith(prefix)) continue;
    const family = overloadsByName.get(overload.name) ?? [];
    family.push(overload);
    overloadsByName.set(overload.name, family);
  }

  return [...overloadsByName]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, overloads]) => ({
      label: name,
      kind: 3 as const,
      detail: overloads.map((overload) => `(${overload.params.join(", ")}) => ${overload.result}`)
        .join(" | "),
      filterText: name,
      insertText: name,
      sortText: `1-${name}`,
    }));
}

function identifierPrefix(source: string, offset: number): string {
  const before = source.slice(0, offset);
  return before.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
}

function contains(value: { node?: { span: { start: number; end: number } } }, offset: number) {
  const span = value.node?.span;
  return span !== undefined && span.start <= offset && offset <= span.end;
}

function visibleValueNames(module: Module, offset: number): Set<string> {
  const names = new Set<string>();
  for (const decl of module.decls) {
    if (contains(decl, offset)) {
      if (decl.kind === "LetDecl" && decl.recursive) addDeclBinders(decl, names);
      visitDeclAt(decl, offset, names);
      break;
    }
    if ((decl.node?.span.end ?? Number.MAX_SAFE_INTEGER) <= offset) {
      addDeclBinders(decl, names);
    }
  }
  return names;
}

function visitDeclAt(decl: Decl, offset: number, names: Set<string>): void {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) {
    if (contains(binding.value, offset)) {
      visitExprAt(binding.value, offset, names);
      return;
    }
  }
}

function visitExprAt(expr: Expr, offset: number, names: Set<string>): void {
  if (expr.kind === "Lambda") {
    expr.params.forEach((param) => addPatternBinders(param.pattern, names));
    if (contains(expr.body, offset)) visitExprAt(expr.body, offset, names);
    return;
  }
  if (expr.kind === "Block") {
    for (const item of expr.items) {
      if (contains(item, offset)) {
        if (isDecl(item)) {
          if (item.kind === "LetDecl" && item.recursive) addDeclBinders(item, names);
          visitDeclAt(item, offset, names);
        } else visitExprAt(item, offset, names);
        return;
      }
      if ((item.node?.span.end ?? Number.MAX_SAFE_INTEGER) <= offset && isDecl(item)) {
        addDeclBinders(item, names);
      }
    }
    if (contains(expr.result, offset)) visitExprAt(expr.result, offset, names);
    return;
  }
  if (expr.kind === "Match") {
    if (contains(expr.value, offset)) {
      visitExprAt(expr.value, offset, names);
      return;
    }
    for (const arm of expr.arms) {
      if (!contains(arm.body, offset)) continue;
      addPatternBinders(arm.pattern, names);
      visitExprAt(arm.body, offset, names);
      return;
    }
    return;
  }
  for (const child of childExpressions(expr)) {
    if (contains(child, offset)) {
      visitExprAt(child, offset, names);
      return;
    }
  }
}

function addDeclBinders(decl: Decl, names: Set<string>): void {
  if (decl.kind === "LetDecl") {
    decl.bindings.forEach((binding) => addPatternBinders(binding.pattern, names));
  } else if (decl.kind === "ImportDecl") {
    if (decl.clause.kind === "Named") {
      decl.clause.specs.forEach((spec) => names.add(spec.alias ?? spec.name));
    }
  } else if (decl.kind === "JsImportDecl") {
    if (decl.clause.kind === "Namespace") names.add(decl.clause.alias);
    else decl.clause.specs.forEach((spec) => names.add(spec.alias ?? spec.name));
  }
}

function addPatternBinders(pattern: Pattern, names: Set<string>): void {
  if (pattern.kind === "PVar") names.add(pattern.name);
  else if (pattern.kind === "PTuple") {
    pattern.items.forEach((item) => addPatternBinders(item, names));
  } else if (pattern.kind === "PRecord") {
    pattern.fields.forEach((field) => addPatternBinders(field.pattern, names));
  } else if (pattern.kind === "PCtor") {
    pattern.args.forEach((arg) => addPatternBinders(arg, names));
  }
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function childExpressions(expr: Expr): Expr[] {
  switch (expr.kind) {
    case "Tuple":
    case "JsonArray":
      return expr.items;
    case "Record":
    case "JsonObject":
      return expr.fields.map((field) => field.value);
    case "FfiGet":
      return [expr.receiver];
    case "FfiCall":
      return [expr.receiver, ...expr.args];
    case "FfiBindingCall":
      return expr.args;
    case "Call":
      return [expr.callee, ...expr.args];
    case "If":
      return [expr.cond, expr.thenExpr, expr.elseExpr];
    case "Panic":
      return [expr.message];
    case "Binary":
    case "Pipe":
      return [expr.left, expr.right];
    case "Unary":
      return [expr.value];
    default:
      return [];
  }
}
