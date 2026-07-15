import type { Expr, Param, Pattern, TypeExpr } from "./ast.ts";
import type { AstNode } from "./source.ts";

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
    return this.parseApplication();
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
