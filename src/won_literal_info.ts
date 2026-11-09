import { decodeWonText } from "./won_literal.ts";
import type { SourceSpan } from "./source.ts";
import { offsetToLineCol } from "./source.ts";
import {
  fields,
  list,
  option,
  record,
  variant,
  type WmVariant,
} from "./frontend_v2_surface_loader.ts";

/** Authored WON facts, retained independently of constructor lowering for editor tools. */
export type WonLiteralInfo = Readonly<{
  kind:
    | "literal"
    | "attributes"
    | "tag"
    | "property"
    | "list"
    | "record"
    | "text"
    | "blob"
    | "number"
    | "boolean"
    | "null";
  span: SourceSpan;
  selections: readonly SourceSpan[];
  name?: string;
  parentTag?: string;
  valueKind?: string;
  count?: number;
  properties?: readonly string[];
  payloadKind?: string;
  byteLength?: number;
}>;

/** Read only the generated syntax tree; never scan source for lookalike WON strings. */
export function wonLiteralInfo(root: WmVariant, source: string): WonLiteralInfo[] {
  const output: WonLiteralInfo[] = [];
  const span = (value: unknown): SourceSpan => {
    const raw = record(value, "WON span");
    const start = raw.start as number;
    return { ...offsetToLineCol(source, start), start, end: raw.end as number };
  };
  const nodeSpan = (node: WmVariant) => span(fields(node).at(-1));
  const tokenSpan = (token: unknown) => span(record(token, "WON token").span);
  const text = (token: unknown) => record(token, "WON token").text as string;
  const key = (value: unknown) => text(fields(variant(value, "WonFieldNode"))[0]);
  const kind = (node: WmVariant): string => {
    if (node.name === "WonTagNode") return `tag ${text(fields(node)[0])}`;
    if (node.name === "WonSequenceNode") return text(fields(node)[0]) === "[" ? "list" : "record";
    const spelling = text(fields(node)[0]);
    if (spelling === "null" || spelling === "true" || spelling === "false") {
      return spelling === "null" ? "null" : "boolean";
    }
    return spelling.startsWith('x"') ? "blob" : spelling.startsWith('"') ? "text" : "number";
  };
  const visit = (node: WmVariant, parentTag?: string): void => {
    const location = nodeSpan(node);
    if (node.name === "WonSequenceNode") {
      const [open, values, close] = fields(node);
      const items = list(values);
      const isList = text(open) === "[";
      output.push({
        kind: isList ? "list" : text(open) === "<" ? "attributes" : "record",
        span: location,
        selections: [tokenSpan(open), tokenSpan(close)],
        count: items.length,
        parentTag,
        ...(!isList ? { properties: items.map(key) } : {}),
      });
      items.forEach((item) => visit(variant(item), parentTag));
    } else if (node.name === "WonTagNode") {
      const [name, attrsValue, bodyValue] = fields(node);
      const attrs = option(attrsValue);
      const body = option(bodyValue);
      const tag = text(name);
      output.push({
        kind: "tag",
        span: location,
        selections: [tokenSpan(name)],
        name: tag,
        parentTag,
        properties: attrs ? list(fields(variant(attrs))[1]).map(key) : [],
        payloadKind: body ? kind(variant(body)) : "null (no payload)",
      });
      if (attrs) visit(variant(attrs), tag);
      if (body) visit(variant(body), tag);
    } else if (node.name === "WonFieldNode") {
      const [name, , value] = fields(node);
      output.push({
        kind: "property",
        span: location,
        selections: [tokenSpan(name)],
        name: text(name),
        parentTag,
        valueKind: kind(variant(value)),
      });
      visit(variant(value), parentTag);
    } else {
      const spelling = text(fields(node)[0]);
      const scalarKind = kind(node) as WonLiteralInfo["kind"];
      const decoded = scalarKind === "text" ? decodeWonText(spelling, location) : undefined;
      output.push({
        kind: scalarKind,
        span: location,
        selections: [location],
        parentTag,
        ...(decoded !== undefined ? { byteLength: new TextEncoder().encode(decoded).length } : {}),
        ...(scalarKind === "blob" ? { byteLength: (spelling.length - 3) / 2 } : {}),
      });
    }
  };
  const location = nodeSpan(root);
  const value = variant(fields(root)[1]);
  output.push({
    kind: "literal",
    span: location,
    selections: [{ ...location, end: location.start + 3 }],
    valueKind: kind(value),
    count: list(fields(value)[1]).length,
  });
  visit(value);
  return output;
}
