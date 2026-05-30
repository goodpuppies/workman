import type {
  Binding,
  Decl,
  Expr,
  MatchArm,
  Module,
  Param,
  Pattern,
  RecordExprField,
  RecordPatternField,
} from "../ast.ts";
import { analyzeFile } from "../compiler.ts";
import { type AstNode, lineColToOffset, lineStarts } from "../source.ts";
import { instantiate, type Scheme, show } from "../types.ts";
import { fileUriToPath } from "./uri.ts";

export type LspHover = {
  contents: { kind: "markdown"; value: string };
};

export async function hoverAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
): Promise<LspHover | null> {
  const entryPath = fileUriToPath(uri);
  const analysis = await analyzeForHover(entryPath, sourceOverrides);
  if (!analysis) return null;
  const node = analysis.graph.nodes.get(analysis.graph.entry);
  const result = analysis.results.get(analysis.graph.entry);
  if (!node || !result) return null;

  const offset = lineColToOffset(position.line + 1, position.character, lineStarts(node.source));
  const target = findSmallestAt(node.module, offset);
  if (!target) return null;

  if (target.kind === "expr") {
    const type = result.types.get(target.value);
    if (type) return hoverCode(`${labelExpr(target.value)}: ${show(type)}`);
    if (target.value.kind === "Var") {
      return schemeHover(target.value.name, result.env.get(target.value.name));
    }
  }

  if (target.kind === "pattern" && target.value.kind === "PVar") {
    return schemeHover(target.value.name, result.env.get(target.value.name));
  }

  if (target.kind === "decl" && target.value.kind === "TypeDecl") {
    return hoverCode(`type ${target.value.name}`);
  }

  return null;
}

async function analyzeForHover(
  entryPath: string,
  sourceOverrides: Map<string, string>,
): Promise<Awaited<ReturnType<typeof analyzeFile>> | null> {
  try {
    return await analyzeFile(entryPath, { sourceOverrides });
  } catch {
    return null;
  }
}

function schemeHover(name: string, scheme: Scheme | undefined): LspHover | null {
  return scheme ? hoverCode(`${name}: ${show(instantiate(scheme))}`) : null;
}

function hoverCode(value: string): LspHover {
  return { contents: { kind: "markdown", value: `\`\`\`wm\n${value}\n\`\`\`` } };
}

type Target =
  | { kind: "decl"; value: Decl; node: AstNode }
  | { kind: "expr"; value: Expr; node: AstNode }
  | { kind: "pattern"; value: Pattern; node: AstNode };

function findSmallestAt(module: Module, offset: number): Target | undefined {
  return collectModule(module).filter((target) => contains(target.node, offset)).sort(bySize)[0];
}

function contains(node: AstNode, offset: number): boolean {
  return node.span.start <= offset && offset < Math.max(node.span.start + 1, node.span.end);
}

function bySize(left: Target, right: Target): number {
  return width(left.node) - width(right.node);
}

function width(node: AstNode): number {
  return node.span.end - node.span.start;
}

function collectModule(module: Module): Target[] {
  return module.decls.flatMap(collectDecl);
}

function collectDecl(decl: Decl): Target[] {
  const own = target("decl", decl);
  switch (decl.kind) {
    case "LetDecl":
      return [...own, ...decl.bindings.flatMap(collectBinding)];
    case "TypeDecl":
    case "RecordDecl":
    case "ImportDecl":
    case "JsImportDecl":
      return own;
  }
}

function collectBinding(binding: Binding): Target[] {
  return [...collectPattern(binding.pattern), ...collectExpr(binding.value)];
}

function collectExpr(expr: Expr): Target[] {
  const own = target("expr", expr);
  switch (expr.kind) {
    case "Tuple":
      return [...own, ...expr.items.flatMap(collectExpr)];
    case "Record":
      return [...own, ...expr.fields.flatMap(collectRecordExprField)];
    case "JsonObject":
      return [...own, ...expr.fields.flatMap(collectJsonObjectField)];
    case "JsonArray":
      return [...own, ...expr.items.flatMap(collectExpr)];
    case "Lambda":
      return [...own, ...expr.params.flatMap(collectParam), ...collectExpr(expr.body)];
    case "Call":
      return [...own, ...collectExpr(expr.callee), ...expr.args.flatMap(collectExpr)];
    case "If":
      return [
        ...own,
        ...collectExpr(expr.cond),
        ...collectExpr(expr.thenExpr),
        ...collectExpr(expr.elseExpr),
      ];
    case "Match":
      return [...own, ...collectExpr(expr.value), ...expr.arms.flatMap(collectArm)];
    case "Panic":
      return [...own, ...collectExpr(expr.message)];
    case "Block":
      return [
        ...own,
        ...expr.items.flatMap((item) => isDecl(item) ? collectDecl(item) : collectExpr(item)),
        ...collectExpr(expr.result),
      ];
    case "Binary":
      return [...own, ...collectExpr(expr.left), ...collectExpr(expr.right)];
    case "Unary":
      return [...own, ...collectExpr(expr.value)];
    case "Pipe":
      return [...own, ...collectExpr(expr.left), ...collectExpr(expr.right)];
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
      return own;
  }
}

function collectRecordExprField(field: RecordExprField): Target[] {
  return collectExpr(field.value);
}

function collectJsonObjectField(field: { value: Expr }): Target[] {
  return collectExpr(field.value);
}

function collectParam(param: Param): Target[] {
  return collectPattern(param.pattern);
}

function collectArm(arm: MatchArm): Target[] {
  return [...collectPattern(arm.pattern), ...collectExpr(arm.body)];
}

function collectPattern(pattern: Pattern): Target[] {
  const own = target("pattern", pattern);
  switch (pattern.kind) {
    case "PTuple":
      return [...own, ...pattern.items.flatMap(collectPattern)];
    case "PRecord":
      return [...own, ...pattern.fields.flatMap(collectRecordPatternField)];
    case "PCtor":
      return [...own, ...pattern.args.flatMap(collectPattern)];
    case "PWildcard":
    case "PVar":
    case "PInt":
    case "PString":
    case "PBool":
    case "PVoid":
    case "PPinned":
      return own;
  }
}

function collectRecordPatternField(field: RecordPatternField): Target[] {
  return collectPattern(field.pattern);
}

function target(kind: "decl", value: Decl): Target[];
function target(kind: "expr", value: Expr): Target[];
function target(kind: "pattern", value: Pattern): Target[];
function target(kind: Target["kind"], value: Decl | Expr | Pattern): Target[] {
  return value.node ? [{ kind, value, node: value.node } as Target] : [];
}

function isDecl(item: Decl | Expr): item is Decl {
  return item.kind === "ImportDecl" || item.kind === "LetDecl" ||
    item.kind === "JsImportDecl" || item.kind === "RecordDecl" || item.kind === "TypeDecl";
}

function labelExpr(expr: Expr): string {
  return expr.kind === "Var" ? expr.name : expr.kind;
}
