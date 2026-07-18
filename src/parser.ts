import type { Decl, Expr, Module } from "./ast.ts";
import { offsetToLineCol, type SourceSpan } from "./source.ts";

export type Surface = "workman" | "wmsml";

type GeneratedParser = { parse(source: string): unknown };

let workmanParser: Promise<GeneratedParser> | undefined;
let wmsmlParser: Promise<GeneratedParser> | undefined;

export class ParseError extends Error {
  source: string;
  span: SourceSpan;
  filePath?: string;

  constructor(message: string, source: string, span: SourceSpan, filePath?: string) {
    super(message);
    this.name = "ParseError";
    this.source = source;
    this.span = span;
    this.filePath = filePath;
  }
}

export async function parse(
  source: string,
  surface: Surface = "workman",
  filePath?: string,
): Promise<Module> {
  const parser = await loadParser(surface);
  try {
    const module = parser.parse(source) as Module;
    validateDirectives(module, source, filePath);
    if (hasNoPreludeDirective(source)) module.prelude = "none";
    return module;
  } catch (error) {
    if (error && typeof error === "object" && "location" in error && "message" in error) {
      const err = error as {
        location: { start: { line: number; column: number; offset: number } };
        message: string;
      };
      const { line, column } = err.location.start;
      const offset = err.location.start.offset;
      throw new ParseError(err.message, source, {
        line,
        col: column - 1,
        start: offset,
        end: offset + 1,
      }, filePath);
    }
    throw error;
  }
}

function validateDirectives(module: Module, source: string, filePath?: string): void {
  for (const decl of module.decls) visitDeclDirectives(decl, source, filePath);
}

function visitDeclDirectives(decl: Decl, source: string, filePath?: string): void {
  if (decl.kind === "LetDecl") {
    for (const binding of decl.bindings) visitExprDirectives(binding.value, source, filePath);
  }
}

function visitExprDirectives(expr: Expr, source: string, filePath?: string): void {
  if (expr.kind === "Lambda") {
    const seen = new Set<string>();
    for (const directive of expr.directives) {
      if (directive.name !== "gpu") {
        throw directiveError(`unknown directive @${directive.name}`, directive, source, filePath);
      }
      if (seen.has(directive.name)) {
        throw directiveError(`duplicate directive @${directive.name}`, directive, source, filePath);
      }
      seen.add(directive.name);
    }
    visitExprDirectives(expr.body, source, filePath);
    return;
  }
  switch (expr.kind) {
    case "Tuple":
    case "JsonArray":
      expr.items.forEach((item) => visitExprDirectives(item, source, filePath));
      return;
    case "Record":
      expr.fields.forEach((field) => visitExprDirectives(field.value, source, filePath));
      return;
    case "JsonObject":
      expr.fields.forEach((field) => visitExprDirectives(field.value, source, filePath));
      return;
    case "FfiGet":
      visitExprDirectives(expr.receiver, source, filePath);
      return;
    case "FfiCall":
      visitExprDirectives(expr.receiver, source, filePath);
      expr.args.forEach((arg) => visitExprDirectives(arg, source, filePath));
      return;
    case "FfiBindingCall":
      expr.args.forEach((arg) => visitExprDirectives(arg, source, filePath));
      return;
    case "Call":
      visitExprDirectives(expr.callee, source, filePath);
      expr.args.forEach((arg) => visitExprDirectives(arg, source, filePath));
      return;
    case "If":
      visitExprDirectives(expr.cond, source, filePath);
      visitExprDirectives(expr.thenExpr, source, filePath);
      visitExprDirectives(expr.elseExpr, source, filePath);
      return;
    case "Match":
      visitExprDirectives(expr.value, source, filePath);
      expr.arms.forEach((arm) => visitExprDirectives(arm.body, source, filePath));
      return;
    case "Panic":
      visitExprDirectives(expr.message, source, filePath);
      return;
    case "Block":
      expr.items.forEach((item) => {
        if ("kind" in item && item.kind.endsWith("Decl")) {
          visitDeclDirectives(item as Decl, source, filePath);
        } else {
          visitExprDirectives(item as Expr, source, filePath);
        }
      });
      visitExprDirectives(expr.result, source, filePath);
      return;
    case "Binary":
    case "Pipe":
      visitExprDirectives(expr.left, source, filePath);
      visitExprDirectives(expr.right, source, filePath);
      return;
    case "Unary":
      visitExprDirectives(expr.value, source, filePath);
      return;
    default:
      return;
  }
}

function directiveError(
  message: string,
  directive: { node?: { span: SourceSpan } },
  source: string,
  filePath?: string,
): ParseError {
  return new ParseError(
    message,
    source,
    directive.node?.span ?? {
      line: 1,
      col: 0,
      start: 0,
      end: 1,
    },
    filePath,
  );
}

function hasNoPreludeDirective(source: string): boolean {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    return trimmed === "-- @no-prelude" || trimmed === "// @no-prelude";
  }
  return false;
}

async function loadParser(surface: Surface): Promise<GeneratedParser> {
  if (surface === "wmsml") {
    return await (wmsmlParser ??= import("./generated/wmsml_parser.js"));
  }
  return await (workmanParser ??= import("./generated/workman_parser.js"));
}
