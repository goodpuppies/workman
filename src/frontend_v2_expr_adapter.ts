import type { Expr, Param, Pattern, TypeExpr } from "./ast.ts";
import type { AstNode } from "./source.ts";
import type { StructuralItem, SurfaceNode } from "./frontend_v2_loader.ts";

export type ExprAdapterHelpers = {
  node(start: number, end: number): AstNode | undefined;
  pattern(text: string, start: number): Pattern | undefined;
  type(text: string): TypeExpr | undefined | false;
};

export function projectExpr(
  text: string,
  baseOffset: number,
  helpers: ExprAdapterHelpers,
): Expr | undefined {
  const parser = new ExprParser(text, baseOffset, helpers);
  const expr = parser.parseExpr();
  return expr && parser.done() ? expr : undefined;
}

export function projectSurfaceExpr(
  item: StructuralItem,
  source: string,
  helpers: ExprAdapterHelpers,
): Expr | undefined {
  if (item.expressionRootId < 0) return undefined;
  const nodes = new Map(item.expressionNodes.map((node) => [node.id, node]));
  const node = nodes.get(item.expressionRootId);
  return node ? projectNode(node, nodes, source, helpers) : undefined;
}

function projectNode(
  node: SurfaceNode,
  nodes: Map<number, SurfaceNode>,
  source: string,
  helpers: ExprAdapterHelpers,
): Expr | undefined {
  const located = withSurfaceNode(node, helpers);
  if (node.kind === "literal") return projectLiteral(source.slice(node.start, node.end), located);
  if (node.kind === "void") return { kind: "Void", ...located };
  if (node.kind === "name") {
    return node.nameParts.length > 0
      ? { kind: "Var", name: node.nameParts.join("."), ...located }
      : undefined;
  }
  if (node.kind === "apply") {
    const callee = childExpr(node, 0, nodes, source, helpers);
    const argument = childExpr(node, 1, nodes, source, helpers);
    return callee && argument ? { kind: "Call", callee, args: [argument], ...located } : undefined;
  }
  if (node.kind === "tuple") {
    const items = node.children.map((id) => nodes.get(id)).map((child) =>
      child ? projectNode(child, nodes, source, helpers) : undefined
    );
    return items.every((item): item is Expr => !!item)
      ? { kind: "Tuple", items, ...located }
      : undefined;
  }
  if (node.kind === "paren") return childExpr(node, 0, nodes, source, helpers);
  if (node.kind === "lambda") {
    const parameterNode = nodes.get(node.children[0]);
    const body = childExpr(node, 1, nodes, source, helpers);
    const parameters = parameterNode
      ? projectSurfaceParams(parameterNode, nodes, source, helpers)
      : undefined;
    return parameters && body
      ? { kind: "Lambda", params: parameters, directives: [], body, ...located }
      : undefined;
  }
  if (node.kind === "block") {
    if (node.children.length === 0) return undefined;
    const expressions = node.children.map((id) => nodes.get(id)).map((child) =>
      child ? projectNode(child, nodes, source, helpers) : undefined
    );
    if (!expressions.every((expr): expr is Expr => !!expr)) return undefined;
    return {
      kind: "Block",
      items: expressions.slice(0, -1),
      result: expressions.at(-1)!,
      ...located,
    };
  }
  return undefined;
}

function projectSurfaceParams(
  node: SurfaceNode,
  nodes: Map<number, SurfaceNode>,
  source: string,
  helpers: ExprAdapterHelpers,
): Param[] | undefined {
  if (node.kind === "pattern.void") return [];
  if (node.kind === "pattern.typed") {
    const patternNode = nodes.get(node.children[0]);
    const typeNode = nodes.get(node.children[1]);
    const pattern = patternNode
      ? projectSurfacePattern(patternNode, nodes, source, helpers)
      : undefined;
    const annotation = typeNode ? projectSurfaceType(typeNode) : undefined;
    return pattern && annotation
      ? [{ pattern, annotation, ...withSurfaceNode(node, helpers) }]
      : undefined;
  }
  const pattern = projectSurfacePattern(node, nodes, source, helpers);
  return pattern ? [{ pattern, ...withSurfaceNode(node, helpers) }] : undefined;
}

function projectSurfacePattern(
  node: SurfaceNode,
  nodes: Map<number, SurfaceNode>,
  source: string,
  helpers: ExprAdapterHelpers,
): Pattern | undefined {
  const located = withSurfaceNode(node, helpers);
  if (node.kind === "pattern.name") {
    const name = node.nameParts[0];
    if (!name) return undefined;
    return /^[A-Z]/.test(name)
      ? { kind: "PCtor", name, args: [], ...located }
      : { kind: "PVar", name, ...located };
  }
  if (node.kind === "pattern.wildcard") return { kind: "PWildcard", ...located };
  if (node.kind === "pattern.void") return { kind: "PVoid", ...located };
  if (node.kind === "pattern.tuple") {
    const items = node.children.map((id) => nodes.get(id)).map((child) =>
      child ? projectSurfacePattern(child, nodes, source, helpers) : undefined
    );
    return items.every((item): item is Pattern => !!item)
      ? { kind: "PTuple", items, ...located }
      : undefined;
  }
  if (node.kind === "pattern.typed") {
    const inner = nodes.get(node.children[0]);
    return inner ? projectSurfacePattern(inner, nodes, source, helpers) : undefined;
  }
  return undefined;
}

function projectSurfaceType(node: SurfaceNode): TypeExpr | undefined {
  return node.kind === "type.name" && node.nameParts.length > 0
    ? { kind: "TName", name: node.nameParts.join("."), args: [] }
    : undefined;
}

function childExpr(
  node: SurfaceNode,
  index: number,
  nodes: Map<number, SurfaceNode>,
  source: string,
  helpers: ExprAdapterHelpers,
): Expr | undefined {
  const child = nodes.get(node.children[index]);
  return child ? projectNode(child, nodes, source, helpers) : undefined;
}

function projectLiteral(
  text: string,
  located: { node?: AstNode },
): Expr | undefined {
  if (text === "true") return { kind: "Bool", value: true, ...located };
  if (text === "false") return { kind: "Bool", value: false, ...located };
  if (text === "void") return { kind: "Void", ...located };
  if (/^-?[0-9]+$/.test(text)) return { kind: "Int", value: Number(text), ...located };
  if (/^-?[0-9]+\.[0-9]+$/.test(text)) return { kind: "Float", value: Number(text), ...located };
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return { kind: "String", value: JSON.parse(text) as string, ...located };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function withSurfaceNode(
  node: SurfaceNode,
  helpers: ExprAdapterHelpers,
): { node?: AstNode } {
  const located = helpers.node(node.start, node.end);
  return located ? { node: located } : {};
}

class ExprParser {
  private cursor = 0;

  constructor(
    private readonly source: string,
    private readonly baseOffset: number,
    private readonly helpers: ExprAdapterHelpers,
  ) {}

  done(): boolean {
    this.skipSpace();
    return this.cursor === this.source.length;
  }

  parseExpr(): Expr | undefined {
    this.skipSpace();
    const start = this.cursor;
    const lambda = this.parseLambda(start);
    if (lambda) return lambda;
    this.cursor = start;
    return this.parseAdditive();
  }

  private parseAdditive(): Expr | undefined {
    return this.parseBinary(() => this.parseMultiplicative(), ["++", "+", "-"]);
  }

  private parseMultiplicative(): Expr | undefined {
    return this.parseBinary(() => this.parseUnary(), ["*", "/", "%"]);
  }

  private parseUnary(): Expr | undefined {
    this.skipSpace();
    const start = this.cursor;
    const op = this.consumeOperator(["-", "!"]);
    if (!op) return this.parseApplication();
    const value = this.parseUnary();
    return value ? { kind: "Unary", op, value, ...this.withNode(start, this.cursor) } : undefined;
  }

  private parseBinary(
    parseOperand: () => Expr | undefined,
    operators: string[],
  ): Expr | undefined {
    const start = this.cursor;
    let left = parseOperand();
    if (!left) return undefined;
    while (true) {
      const beforeOperator = this.cursor;
      const op = this.consumeOperator(operators);
      if (!op) {
        this.cursor = beforeOperator;
        return left;
      }
      const right = parseOperand();
      if (!right) return undefined;
      left = { kind: "Binary", op, left, right, ...this.withNode(start, this.cursor) };
    }
  }

  private parseLambda(start: number): Expr | undefined {
    if (!this.consumeRaw("(")) return undefined;
    const params = this.parseParams();
    if (!params || !this.consumeRaw("=>")) return undefined;
    const body = this.parseBlock();
    if (!body) return undefined;
    return {
      kind: "Lambda",
      params,
      directives: [],
      body,
      ...this.withNode(start, this.cursor),
    };
  }

  private parseParams(): Param[] | undefined {
    const params: Param[] = [];
    this.skipSpace();
    if (this.consumeRaw(")")) return params;
    while (true) {
      const start = this.cursor;
      const patternText = this.parseIdentifier();
      if (!patternText) return undefined;
      const pattern = this.helpers.pattern(patternText, this.baseOffset + start);
      if (!pattern) return undefined;
      this.skipSpace();
      let annotation: TypeExpr | undefined;
      if (this.consumeRaw(":")) {
        const typeStart = this.cursor;
        const typeText = this.scanParameterType();
        const projected = this.helpers.type(typeText);
        if (!projected) return undefined;
        annotation = projected;
        if (typeText.trim() === "") return undefined;
        this.cursor = typeStart + typeText.length;
      }
      params.push({
        pattern,
        ...(annotation ? { annotation } : {}),
        ...this.withNode(start, this.cursor),
      });
      this.skipSpace();
      if (this.consumeRaw(")")) return params;
      if (!this.consumeRaw(",")) return undefined;
      this.skipSpace();
    }
  }

  private scanParameterType(): string {
    let angleDepth = 0;
    let parenDepth = 0;
    let index = this.cursor;
    for (; index < this.source.length; index += 1) {
      const char = this.source[index];
      if (char === "<") angleDepth += 1;
      else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
      else if (char === "(") parenDepth += 1;
      else if (char === ")") {
        if (parenDepth === 0 && angleDepth === 0) break;
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === "," && angleDepth === 0 && parenDepth === 0) break;
    }
    return this.source.slice(this.cursor, index).trimEnd();
  }

  private parseBlock(): Expr | undefined {
    this.skipSpace();
    const start = this.cursor;
    if (!this.consumeRaw("{")) return undefined;
    const result = this.parseExpr();
    if (!result || !this.consumeRaw("}")) return undefined;
    return {
      kind: "Block",
      items: [],
      result,
      ...this.withNode(start, this.cursor),
    };
  }

  private parseApplication(): Expr | undefined {
    const start = this.cursor;
    let expr = this.parseAtomExpr();
    if (!expr) return undefined;
    while (true) {
      const beforeSpace = this.cursor;
      const hadSpace = this.skipSpace();
      if (this.consumeRaw("(")) {
        const args = this.parseArgs();
        if (!args) return undefined;
        expr = { kind: "Call", callee: expr, args, ...this.withNode(start, this.cursor) };
        continue;
      }
      if (hadSpace && this.startsAtom()) {
        const arg = this.parseAtomExpr();
        if (!arg) return undefined;
        expr = { kind: "Call", callee: expr, args: [arg], ...this.withNode(start, this.cursor) };
        continue;
      }
      this.cursor = beforeSpace;
      return expr;
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
    if (this.consumeRaw("(")) return this.parseParenthesized(start);
    const string = this.parseStringLiteral();
    if (string !== undefined) {
      return { kind: "String", value: string, ...this.withNode(start, this.cursor) };
    }
    const number = this.parseNumberLiteral();
    if (number) return number;
    const name = this.parseQualifiedIdentifier();
    if (!name) return undefined;
    const node = this.withNode(start, this.cursor);
    if (name === "true") return { kind: "Bool", value: true, ...node };
    if (name === "false") return { kind: "Bool", value: false, ...node };
    if (name === "void") return { kind: "Void", ...node };
    return { kind: "Var", name, ...node };
  }

  private parseParenthesized(start: number): Expr | undefined {
    const first = this.parseExpr();
    if (!first) return undefined;
    this.skipSpace();
    if (!this.consumeRaw(",")) return this.consumeRaw(")") ? first : undefined;
    const items = [first];
    while (true) {
      const item = this.parseExpr();
      if (!item) return undefined;
      items.push(item);
      this.skipSpace();
      if (this.consumeRaw(")")) {
        return { kind: "Tuple", items, ...this.withNode(start, this.cursor) };
      }
      if (!this.consumeRaw(",")) return undefined;
    }
  }

  private startsAtom(): boolean {
    const char = this.source[this.cursor] ?? "";
    return char === '"' || char === "(" || char === "_" || /[A-Za-z0-9-]/.test(char);
  }

  private parseIdentifier(): string | undefined {
    const match = /^[_A-Za-z][_A-Za-z0-9]*/.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    return match[0];
  }

  private parseQualifiedIdentifier(): string | undefined {
    const first = this.parseIdentifier();
    if (!first) return undefined;
    const parts = [first];
    while (this.consumeRaw(".")) {
      const part = this.parseIdentifier();
      if (!part) return undefined;
      parts.push(part);
    }
    return parts.join(".");
  }

  private parseNumberLiteral(): Expr | undefined {
    const start = this.cursor;
    const match = /^-?[0-9]+(?:\.[0-9]+)?/.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    const node = this.withNode(start, this.cursor);
    return match[0].includes(".")
      ? { kind: "Float", value: Number(match[0]), ...node }
      : { kind: "Int", value: Number(match[0]), ...node };
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
    const start = this.cursor;
    this.skipSpace();
    if (!this.source.startsWith(text, this.cursor)) {
      this.cursor = start;
      return false;
    }
    this.cursor += text.length;
    return true;
  }

  private consumeOperator(operators: string[]): string | undefined {
    const start = this.cursor;
    this.skipSpace();
    for (const operator of operators) {
      if (this.source.startsWith(operator, this.cursor)) {
        this.cursor += operator.length;
        return operator;
      }
    }
    this.cursor = start;
    return undefined;
  }

  private skipSpace(): boolean {
    const start = this.cursor;
    while (/\s/.test(this.source[this.cursor] ?? "")) this.cursor += 1;
    return this.cursor > start;
  }

  private withNode(start: number, end: number): { node?: AstNode } {
    const node = this.helpers.node(this.baseOffset + start, this.baseOffset + end);
    return node ? { node } : {};
  }
}
