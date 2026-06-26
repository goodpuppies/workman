import type { Expr, ImportClause, ImportSpec, Module, Pattern, TypeExpr } from "./ast.ts";
import type { SemanticDeclProjection, SemanticProjectionResult } from "./frontend_v2_loader.ts";
import { type AstNode, offsetToLineCol } from "./source.ts";

export type FrontendV2SemanticAdapterDiagnostic = {
  code: "frontend-v2.unsupported-decl" | "frontend-v2.recovered-decl";
  structuralId: number;
  message: string;
};

export type FrontendV2ModuleProjection = {
  module: Module;
  diagnostics: FrontendV2SemanticAdapterDiagnostic[];
};

type ProjectionContext = {
  source?: string;
  nextNodeId: number;
};

export function semanticProjectionToModule(
  projection: SemanticProjectionResult,
  options: { source?: string } = {},
): FrontendV2ModuleProjection {
  const diagnostics: FrontendV2SemanticAdapterDiagnostic[] = [];
  const decls: Module["decls"] = [];
  const context: ProjectionContext = { source: options.source, nextNodeId: 0 };

  for (const decl of projection.decls) {
    if (decl.status !== "complete") {
      diagnostics.push({
        code: "frontend-v2.recovered-decl",
        structuralId: decl.structuralId,
        message: `cannot project ${decl.structuralKind} declaration with ${decl.status} status`,
      });
      continue;
    }
    const projected = projectCompleteDecl(decl, context);
    if (projected) {
      decls.push(projected);
    } else {
      diagnostics.push({
        code: "frontend-v2.unsupported-decl",
        structuralId: decl.structuralId,
        message: `frontend-v2 semantic adapter does not yet project ${decl.structuralKind}`,
      });
    }
  }

  return { module: { kind: "Module", decls }, diagnostics };
}

function sourceIndexOf(context: ProjectionContext, text: string, from: number): number {
  if (!context.source || text === "") return from;
  const index = context.source.indexOf(text, from);
  return index >= 0 ? index : from;
}

function nodeFor(
  context: ProjectionContext,
  start: number,
  end: number,
): AstNode | undefined {
  if (!context.source) return undefined;
  const boundedStart = Math.max(0, Math.min(start, context.source.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, context.source.length));
  const position = offsetToLineCol(context.source, boundedStart);
  return {
    id: context.nextNodeId++,
    span: { ...position, start: boundedStart, end: boundedEnd },
  };
}

function withNode(node: AstNode | undefined): { node?: AstNode } {
  return node ? { node } : {};
}

function projectCompleteDecl(
  decl: SemanticDeclProjection,
  context: ProjectionContext,
): Module["decls"][number] | undefined {
  if (decl.semanticKind === "ImportDecl") return projectImportDecl(decl, context);

  const annotation = projectTypeAnnotation(decl.annotationText);
  const patternStart = sourceIndexOf(context, decl.patternText, decl.start);
  const pattern = projectPattern(decl.patternText, context, patternStart);
  const expressionStart = expressionStartFor(decl, context, patternStart);
  const expression = projectExpr(decl.expressionText, context, expressionStart);
  if (
    decl.semanticKind === "LetDecl" &&
    decl.patternKind === "name" &&
    decl.expressionKind === "atom" &&
    decl.groupTailText.trim() === "" &&
    pattern &&
    expression &&
    annotation !== false
  ) {
    return {
      kind: "LetDecl",
      exported: true,
      recursive: decl.recursive,
      bindings: [{
        pattern,
        ...(annotation ? { annotation } : {}),
        value: expression,
        ...withNode(nodeFor(context, patternStart, expressionStart + decl.expressionText.length)),
      }],
      ...withNode(nodeFor(context, decl.start, decl.end)),
    };
  }
  return undefined;
}

function expressionStartFor(
  decl: SemanticDeclProjection,
  context: ProjectionContext,
  patternStart: number,
): number {
  if (!context.source || decl.expressionText === "") return decl.start;
  const afterPatternAndAnnotation = patternStart + decl.patternText.length +
    decl.annotationText.length;
  const equals = context.source.indexOf("=", afterPatternAndAnnotation);
  return sourceIndexOf(context, decl.expressionText, equals >= 0 ? equals + 1 : decl.start);
}

function projectImportDecl(
  decl: SemanticDeclProjection,
  context: ProjectionContext,
): Module["decls"][number] | undefined {
  const source = context.source;
  if (!source) return undefined;
  const text = source.slice(decl.start, decl.end).trim();
  const match = /^from\s+"([^"]+)"\s+import\s+(.+?);?$/.exec(text);
  if (!match) return undefined;
  const clause = projectImportClause(match[2].trim());
  if (!clause) return undefined;
  return {
    kind: "ImportDecl",
    path: match[1],
    clause,
    ...withNode(nodeFor(context, decl.start, decl.end)),
  };
}

function projectImportClause(text: string): ImportClause | undefined {
  if (text === "*") return { kind: "All" };
  const namespace = /^\*\s+as\s+([_A-Za-z][_A-Za-z0-9]*)$/.exec(text);
  if (namespace) return { kind: "Namespace", alias: namespace[1] };
  const named = /^\{([\s\S]*)\}$/.exec(text);
  if (!named) return undefined;
  const specs: ImportSpec[] = [];
  for (const spec of named[1].split(",").map((item) => item.trim()).filter(Boolean)) {
    const aliased = /^([_A-Za-z][_A-Za-z0-9]*)(?:\s+as\s+([_A-Za-z][_A-Za-z0-9]*))?$/.exec(spec);
    if (!aliased) return undefined;
    specs.push({ name: aliased[1], ...(aliased[2] ? { alias: aliased[2] } : {}) });
  }
  return { kind: "Named", specs };
}

function projectPattern(
  text: string,
  context: ProjectionContext,
  start: number,
): Pattern | undefined {
  const node = nodeFor(context, start, start + text.length);
  if (text === "_") return { kind: "PWildcard", ...withNode(node) };
  if (text === "true") return { kind: "PBool", value: true, ...withNode(node) };
  if (text === "false") return { kind: "PBool", value: false, ...withNode(node) };
  if (text === "void") return { kind: "PVoid", ...withNode(node) };
  if (/^-?[0-9]+$/.test(text)) return { kind: "PInt", value: Number(text), ...withNode(node) };
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return { kind: "PString", value: JSON.parse(text) as string, ...withNode(node) };
    } catch {
      return undefined;
    }
  }
  if (!isIdentifier(text)) return undefined;
  if (/^[A-Z]/.test(text)) return { kind: "PCtor", name: text, args: [], ...withNode(node) };
  return { kind: "PVar", name: text, ...withNode(node) };
}

function isIdentifier(text: string): boolean {
  return /^[_A-Za-z][_A-Za-z0-9]*$/.test(text);
}

function projectTypeAnnotation(text: string): TypeExpr | undefined | false {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const parser = new TypeAnnotationParser(trimmed);
  const type = parser.parseType();
  return type && parser.done() ? type : false;
}

class TypeAnnotationParser {
  private cursor = 0;

  constructor(private readonly source: string) {}

  done(): boolean {
    this.skipSpace();
    return this.cursor === this.source.length;
  }

  parseType(): TypeExpr | undefined {
    this.skipSpace();
    if (this.peek("(")) return this.parseParenType();
    return this.parseNameOrVariable();
  }

  private parseNameOrVariable(): TypeExpr | undefined {
    const variable = this.parseVariable();
    if (variable) return { kind: "TVar", name: variable };
    const name = this.parseQualifiedConstructor();
    if (!name) return undefined;
    const args = this.consume("<") ? this.parseArgs() : [];
    if (!args) return undefined;
    return { kind: "TName", name, args };
  }

  private parseArgs(): TypeExpr[] | undefined {
    const args: TypeExpr[] = [];
    this.skipSpace();
    if (this.consume(">")) return args;
    while (true) {
      const arg = this.parseType();
      if (!arg) return undefined;
      args.push(arg);
      this.skipSpace();
      if (this.consume(">")) return args;
      if (!this.consume(",")) return undefined;
      this.skipSpace();
      if (this.consume(">")) return args;
    }
  }

  private parseParenType(): TypeExpr | undefined {
    if (!this.consume("(")) return undefined;
    this.skipSpace();
    if (this.consume(")")) return this.parseFnType([]);
    const first = this.parseType();
    if (!first) return undefined;
    const items = [first];
    let tuple = false;
    while (this.consume(",")) {
      tuple = true;
      this.skipSpace();
      if (this.peek(")")) break;
      const item = this.parseType();
      if (!item) return undefined;
      items.push(item);
    }
    if (!this.consume(")")) return undefined;
    const fn = this.parseFnType(items);
    if (fn) return fn;
    return tuple ? { kind: "TTuple", items } : first;
  }

  private parseFnType(params: TypeExpr[]): TypeExpr | undefined {
    if (!this.consume("=>")) return undefined;
    const result = this.parseType();
    return result ? { kind: "TFn", params, result } : undefined;
  }

  private parseQualifiedConstructor(): string | undefined {
    const parts = [this.parseConstructor()];
    if (!parts[0]) return undefined;
    while (this.consume(".")) {
      const part = this.parseConstructor();
      if (!part) return undefined;
      parts.push(part);
    }
    return parts.join(".");
  }

  private parseConstructor(): string | undefined {
    const match = /^[A-Z][_A-Za-z0-9]*/.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    return match[0];
  }

  private parseVariable(): string | undefined {
    const match = /^[a-z][_A-Za-z0-9]*/.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    return match[0];
  }

  private consume(text: string): boolean {
    this.skipSpace();
    if (!this.source.startsWith(text, this.cursor)) return false;
    this.cursor += text.length;
    return true;
  }

  private peek(text: string): boolean {
    this.skipSpace();
    return this.source.startsWith(text, this.cursor);
  }

  private skipSpace(): void {
    while (/\s/.test(this.source[this.cursor] ?? "")) this.cursor += 1;
  }
}

function projectExpr(
  text: string,
  context: ProjectionContext,
  baseOffset: number,
): Expr | undefined {
  const parser = new ExprParser(text, context, baseOffset);
  const expr = parser.parseExpr();
  return expr && parser.done() ? expr : undefined;
}

class ExprParser {
  private cursor = 0;

  constructor(
    private readonly source: string,
    private readonly context: ProjectionContext,
    private readonly baseOffset: number,
  ) {}

  done(): boolean {
    this.skipSpace();
    return this.cursor === this.source.length;
  }

  parseExpr(): Expr | undefined {
    const start = this.cursor;
    let expr = this.parseAtomExpr();
    if (!expr) return undefined;
    while (true) {
      this.skipSpace();
      if (!this.consumeRaw("(")) return expr;
      const args = this.parseArgs();
      if (!args) return undefined;
      expr = {
        kind: "Call",
        callee: expr,
        args,
        ...withNode(this.node(start, this.cursor)),
      };
    }
  }

  private parseArgs(): Expr[] | undefined {
    const args: Expr[] = [];
    this.skipSpace();
    if (this.consumeRaw(")")) return args;
    while (true) {
      const arg = this.parseExpr();
      if (!arg) return undefined;
      args.push(arg);
      this.skipSpace();
      if (this.consumeRaw(")")) return args;
      if (!this.consumeRaw(",")) return undefined;
    }
  }

  private parseAtomExpr(): Expr | undefined {
    this.skipSpace();
    const start = this.cursor;
    if (this.consumeRaw("(")) {
      const inner = this.parseExpr();
      if (!inner || !this.consumeRaw(")")) return undefined;
      return inner;
    }
    const string = this.parseStringLiteral();
    if (string !== undefined) {
      return { kind: "String", value: string, ...withNode(this.node(start, this.cursor)) };
    }
    const number = this.parseNumberLiteral();
    if (number) return number;
    const name = this.parseIdentifier();
    if (!name) return undefined;
    const node = this.node(start, this.cursor);
    if (name === "true") return { kind: "Bool", value: true, ...withNode(node) };
    if (name === "false") return { kind: "Bool", value: false, ...withNode(node) };
    if (name === "void") return { kind: "Void", ...withNode(node) };
    return { kind: "Var", name, ...withNode(node) };
  }

  private parseIdentifier(): string | undefined {
    const match = /^[_A-Za-z][_A-Za-z0-9]*/.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    return match[0];
  }

  private parseNumberLiteral(): Expr | undefined {
    const start = this.cursor;
    const match = /^-?[0-9]+(?:\.[0-9]+)?/.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    const node = this.node(start, this.cursor);
    return match[0].includes(".")
      ? { kind: "Float", value: Number(match[0]), ...withNode(node) }
      : { kind: "Int", value: Number(match[0]), ...withNode(node) };
  }

  private parseStringLiteral(): string | undefined {
    if (!this.source.startsWith('"', this.cursor)) return undefined;
    for (let index = this.cursor + 1; index < this.source.length; index += 1) {
      if (this.source[index] === "\\" && index + 1 < this.source.length) {
        index += 1;
        continue;
      }
      if (this.source[index] === '"') {
        const raw = this.source.slice(this.cursor, index + 1);
        this.cursor = index + 1;
        try {
          return JSON.parse(raw) as string;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  private consumeRaw(text: string): boolean {
    this.skipSpace();
    if (!this.source.startsWith(text, this.cursor)) return false;
    this.cursor += text.length;
    return true;
  }

  private skipSpace(): void {
    while (/\s/.test(this.source[this.cursor] ?? "")) this.cursor += 1;
  }

  private node(start: number, end: number): AstNode | undefined {
    return nodeFor(this.context, this.baseOffset + start, this.baseOffset + end);
  }
}
