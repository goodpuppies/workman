import type { Expr } from "./ast.ts";
import type { AstNode, SourceSpan } from "./source.ts";
import {
  fields,
  list,
  option,
  record,
  variant,
  type WmVariant,
} from "./frontend_v2_surface_loader.ts";

// Not a legal source identifier: native literals cannot capture an authored binding.
export const WON_LITERAL_NAMESPACE = "$wonLiteral";
export const WON_LITERAL_NIL = "$wonLiteralNil";
export const WON_LITERAL_CONS = "$wonLiteralCons";

export class WonLiteralError extends Error {
  constructor(message: string, readonly span: SourceSpan) {
    super(message);
  }
}

export function decodeWonText(text: string, span: SourceSpan): string {
  let result = "";
  for (let i = 1; i < text.length - 1; i++) {
    if (text[i] !== "\\") {
      result += text[i];
      continue;
    }
    const escape = text[++i];
    if (escape === "x") {
      const byte = Number.parseInt(text.slice(i + 1, i + 3), 16);
      if ((byte > 31 && byte !== 127) || [9, 10, 13].includes(byte)) {
        throw new WonLiteralError("WON: use the canonical spelling for this text character", span);
      }
      result += String.fromCharCode(byte);
      i += 2;
    } else {
      result +=
        ({ '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[escape];
    }
  }
  if (!result.isWellFormed()) {
    throw new WonLiteralError("WON: text must contain valid Unicode scalars", span);
  }
  return result;
}

/** Lower the parsed WON tree to ordinary portable Value constructor applications. */
export function lowerWonLiteral(root: WmVariant, makeNode: (span: SourceSpan) => AstNode): Expr {
  const spanOf = (node: WmVariant): SourceSpan => {
    const values = fields(node);
    const span = record(values[values.length - 1], "WON span");
    return { start: span.start as number, end: span.end as number, line: 1, col: 0 };
  };
  const textOf = (token: unknown): string => record(token, "WON token").text as string;
  const string = (value: string, span: SourceSpan): Expr => ({
    kind: "String",
    value,
    node: makeNode(span),
  });
  const call = (name: string, args: Expr[], span: SourceSpan): Expr => {
    const path = { qualifiers: [WON_LITERAL_NAMESPACE], id: name };
    const callee: Expr = {
      kind: "Var",
      name: `${WON_LITERAL_NAMESPACE}.${name}`,
      path,
    };
    return args.length ? { kind: "Call", callee, args, node: makeNode(span) } : callee;
  };
  const sequence = (items: Expr[], span: SourceSpan): Expr => {
    let tail: Expr = { kind: "Var", name: WON_LITERAL_NIL };
    for (const item of items.toReversed()) {
      tail = {
        kind: "Call",
        callee: { kind: "Var", name: WON_LITERAL_CONS },
        args: [item, tail],
        node: makeNode(span),
      };
    }
    return tail;
  };
  const fail = (message: string, span: SourceSpan): never => {
    throw new WonLiteralError(message, span);
  };
  const bytes = (values: Iterable<number>, span: SourceSpan): Expr =>
    sequence(
      Array.from(
        values,
        (byte): Expr => ({ kind: "Char", value: String.fromCharCode(byte), node: makeNode(span) }),
      ),
      span,
    );
  const fieldList = (items: readonly unknown[], span: SourceSpan): Expr => {
    const seen = new Set<string>();
    return sequence(
      items.map((item): Expr => {
        const field = variant(item, "WonFieldNode");
        const [keyToken, , value] = fields(field);
        const fieldSpan = spanOf(field);
        const spelling = textOf(keyToken);
        const key = spelling.startsWith('"') ? decodeWonText(spelling, fieldSpan) : spelling;
        if (spelling.startsWith('"') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          fail("WON: identifier keys must be bare", fieldSpan);
        }
        if (seen.has(key)) fail(`WON: duplicate key ${JSON.stringify(key)}`, fieldSpan);
        seen.add(key);
        return {
          kind: "Tuple",
          // Portable WON keys use native byte strings, just like its decoder.
          items: [
            string(
              Array.from(new TextEncoder().encode(key), (byte) => String.fromCharCode(byte)).join(
                "",
              ),
              fieldSpan,
            ),
            lower(variant(value)),
          ],
          node: makeNode(fieldSpan),
        };
      }),
      span,
    );
  };
  const lower = (node: WmVariant): Expr => {
    const span = spanOf(node);
    if (node.name === "WonSequenceNode") {
      const [open, items] = fields(node);
      return textOf(open) === "["
        ? call("List", [sequence(list(items).map((item) => lower(variant(item))), span)], span)
        : call("Record", [fieldList(list(items), span)], span);
    }
    if (node.name === "WonTagNode") {
      const [name, attributes, payload] = fields(node);
      const attrs = option(attributes);
      const body = option(payload);
      return call("Tag", [
        string(textOf(name), span),
        attrs ? fieldList(list(fields(variant(attrs))[1]), span) : sequence([], span),
        body ? lower(variant(body)) : call("Null", [], span),
      ], span);
    }
    const [token] = fields(node, "WonScalarNode");
    const text = textOf(token);
    if (text === "null") return call("Null", [], span);
    if (text === "true" || text === "false") {
      return call(
        "Boolean",
        [{ kind: "Bool", value: text === "true", node: makeNode(span) }],
        span,
      );
    }
    if (text.startsWith('x"')) {
      const content = text.slice(2, -1);
      return call("Blob", [
        bytes(content.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [], span),
      ], span);
    }
    if (text.startsWith('"')) {
      return call("Text", [bytes(new TextEncoder().encode(decodeWonText(text, span)), span)], span);
    }
    return call("Number", [string(text, span)], span);
  };
  return lower(root);
}
