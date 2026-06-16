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
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "../ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "../ffi/elab.ts";
import { inferModulePartial, type InferResult } from "../infer.ts";
import { expandCallArg } from "../infer/shared.ts";
import { loadModuleGraph } from "../module_graph.ts";
import { type AstNode, lineColToOffset, lineStarts } from "../source.ts";
import {
  instantiate,
  instantiateRecordFields,
  prune,
  type Scheme,
  show,
  type Ty,
} from "../types.ts";
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
  for (const target of targetsAt(node.module, node.source, offset)) {
    const hover = hoverForTarget(target, result);
    if (hover) return hover;
  }
  return null;
}

function hoverForTarget(target: Target, result: InferResult): LspHover | null {
  if (target.kind === "expr") {
    const type = result.types.get(target.value);
    if (type) return hoverCode(`${labelExpr(target.value)}: ${show(type)}`);
    if (target.value.kind === "Var") {
      return schemeHover(target.value.name, result.env.get(target.value.name));
    }
  }

  if (target.kind === "pattern" && target.value.kind === "PVar") {
    const expected = target.expectedExpr ? result.types.get(target.expectedExpr) : undefined;
    const localType = expected && target.expectedPattern
      ? patternBinderType(target.expectedPattern, target.value, expected, result)
      : undefined;
    if (localType) return hoverCode(`${target.value.name}: ${show(localType)}`);
    return schemeHover(target.value.name, result.env.get(target.value.name));
  }

  if (
    target.kind === "decl" &&
    (target.value.kind === "TypeDecl" || target.value.kind === "ForeignTypeDecl")
  ) {
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
    return await analyzePartialForHover(entryPath, sourceOverrides);
  }
}

async function analyzePartialForHover(
  entryPath: string,
  sourceOverrides: Map<string, string>,
): Promise<Awaited<ReturnType<typeof analyzeFile>> | null> {
  try {
    const graph = await loadModuleGraph(entryPath, { sourceOverrides });
    const ffi = new Map<string, ReturnType<typeof prepareFfiElaboration>>();
    for (const node of graph.nodes.values()) {
      const prepared = prepareFfiElaboration(node.module);
      ffi.set(node.path, prepared);
      node.module = prepared.module;
      ensurePartialHoverForeignTypes(node.module, node.source);
    }
    const inferAll = () => {
      const out = new Map<string, InferResult>();
      for (const path of graph.order) {
        const node = graph.nodes.get(path)!;
        const imports = new Map<string, InferResult>();
        for (const edge of node.imports) {
          const imported = out.get(edge.path);
          if (imported) imports.set(edge.specifier, imported);
        }
        out.set(path, inferModulePartial(node.module, imports));
      }
      return out;
    };
    let results = inferAll();
    // Best effort: run the later FFI phases for their placeholder-solving side effects so
    // hover shows resolved member types, but keep the pre-rewrite modules and the latest
    // successful inference results when a phase fails.
    try {
      for (const path of graph.order) {
        const contextual = contextualizeDelayedCallbacks(ffi.get(path)!, results.get(path)!);
        ffi.set(path, contextual);
        graph.nodes.get(path)!.module = contextual.module;
      }
      results = inferAll();
      const foreignTypeRefs = new Map(
        [...ffi.values()].flatMap((item) =>
          [...item.foreignTypeRefs.values()].map((ref) => [ref.key, ref] as const)
        ),
      );
      for (const path of graph.order) {
        resolveDelayedFfiElaboration(ffi.get(path)!, results.get(path)!, { foreignTypeRefs });
      }
    } catch {
      // Keep the latest successful results; solved placeholders still show through.
    }
    return { graph, results };
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
  | {
    kind: "pattern";
    value: Pattern;
    node: AstNode;
    expectedExpr?: Expr;
    expectedPattern?: Pattern;
  };

function targetsAt(module: Module, source: string, offset: number): Target[] {
  return collectModule(module)
    .filter((target) => contains(target.node, offset))
    .filter((target) => !isPipeOperatorTarget(target, source, offset))
    .sort(bySize);
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
    case "ForeignTypeDecl":
    case "RecordDecl":
    case "ImportDecl":
    case "JsImportDecl":
      return own;
  }
}

function collectBinding(binding: Binding): Target[] {
  return [
    ...collectPattern(binding.pattern, binding.value, binding.pattern),
    ...collectExpr(binding.value),
  ];
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
    case "FfiGet":
      return [...own, ...collectExpr(expr.receiver)];
    case "FfiCall":
      return [...own, ...collectExpr(expr.receiver), ...expr.args.flatMap(collectExpr)];
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

function collectPattern(
  pattern: Pattern,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[] {
  const own = target("pattern", pattern, expectedExpr, expectedPattern);
  switch (pattern.kind) {
    case "PTuple":
      return [
        ...own,
        ...pattern.items.flatMap((item) => collectPattern(item, expectedExpr, expectedPattern)),
      ];
    case "PRecord":
      return [
        ...own,
        ...pattern.fields.flatMap((field) =>
          collectRecordPatternField(field, expectedExpr, expectedPattern)
        ),
      ];
    case "PCtor":
      return [
        ...own,
        ...pattern.args.flatMap((arg) => collectPattern(arg, expectedExpr, expectedPattern)),
      ];
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

function collectRecordPatternField(
  field: RecordPatternField,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[] {
  return collectPattern(field.pattern, expectedExpr, expectedPattern);
}

function target(kind: "decl", value: Decl): Target[];
function target(kind: "expr", value: Expr): Target[];
function target(
  kind: "pattern",
  value: Pattern,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[];
function target(
  kind: Target["kind"],
  value: Decl | Expr | Pattern,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[] {
  if (!value.node) return [];
  if (kind === "pattern") {
    return [{ kind, value, node: value.node, expectedExpr, expectedPattern } as Target];
  }
  return [{ kind, value, node: value.node } as Target];
}

function isDecl(item: Decl | Expr): item is Decl {
  return item.kind === "ImportDecl" || item.kind === "LetDecl" ||
    item.kind === "JsImportDecl" || item.kind === "RecordDecl" || item.kind === "TypeDecl" ||
    item.kind === "ForeignTypeDecl";
}

function labelExpr(expr: Expr): string {
  return expr.kind === "Var" ? expr.name : expr.kind;
}

function ensurePartialHoverForeignTypes(module: Module, source: string) {
  if (!source.includes("Js.Promise")) return;
  if (
    module.decls.some((decl) =>
      (decl.kind === "ForeignTypeDecl" || decl.kind === "TypeDecl") && decl.name === "Js.Promise"
    )
  ) {
    return;
  }
  module.decls.unshift({
    kind: "TypeDecl",
    exported: false,
    name: "Js.Promise",
    params: ["T"],
    ctors: [],
  });
}

function patternBinderType(
  pattern: Pattern,
  target: Extract<Pattern, { kind: "PVar" }>,
  expected: Ty,
  result: InferResult,
): Ty | undefined {
  if (pattern === target) return expected;
  switch (pattern.kind) {
    case "PTuple": {
      const tupleType = prune(expected);
      if (tupleType.tag !== "tuple") return undefined;
      for (const [index, item] of pattern.items.entries()) {
        const found = patternBinderType(item, target, tupleType.items[index], result);
        if (found) return found;
      }
      return undefined;
    }
    case "PRecord": {
      const recordType = prune(expected);
      if (recordType.tag !== "named") return undefined;
      const info = [...result.typeEnv.values()].find((candidate) => candidate.id === recordType.id);
      if (!info?.recordFields) return undefined;
      const fields = instantiateRecordFields(info, recordType.args);
      for (const field of pattern.fields) {
        const fieldType = fields.find((item) => item.name === field.name)?.type;
        if (!fieldType) continue;
        const found = patternBinderType(field.pattern, target, fieldType, result);
        if (found) return found;
      }
      return undefined;
    }
    case "PCtor": {
      const scheme = result.env.get(pattern.name);
      if (!scheme || scheme.status !== "constructor") return undefined;
      const ctor = prune(instantiate(scheme));
      const args = ctor.tag === "fn"
        ? (ctor.params.length === 1 ? expandCallArg(ctor.params[0]) : ctor.params)
        : [];
      for (const [index, arg] of pattern.args.entries()) {
        const found = patternBinderType(arg, target, args[index], result);
        if (found) return found;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function isPipeOperatorTarget(target: Target, source: string, offset: number): boolean {
  if (target.kind !== "expr") return false;
  if (
    target.value.kind !== "Pipe" && target.value.kind !== "FfiGet" &&
    target.value.kind !== "FfiCall"
  ) {
    return false;
  }
  return pipeOperatorAt(source, target.node, offset);
}

function pipeOperatorAt(source: string, node: AstNode, offset: number): boolean {
  let index = source.indexOf(":>", node.span.start);
  while (index >= 0 && index < node.span.end) {
    if (index <= offset && offset <= index + 2) return true;
    index = source.indexOf(":>", index + 2);
  }
  return false;
}
