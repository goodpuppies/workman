import type { WonLiteralInfo } from "../won_literal_info.ts";
import type { LspHover } from "./hover.ts";
import { spanRange } from "./range.ts";

/** Undefined means ordinary WM; null means unselected trivia inside a WON literal. */
export function wonHoverAt(
  source: string,
  offset: number,
  facts: readonly WonLiteralInfo[] = [],
): LspHover | null | undefined {
  const inside = (span: { start: number; end: number }) =>
    span.start <= offset && offset < span.end;
  if (!facts.some((fact) => fact.kind === "literal" && inside(fact.span))) return undefined;
  const fact = facts.find((fact) => fact.selections.some(inside));
  if (!fact) return null;
  const selection = fact.selections.find(inside)!;
  const code = (text: string) => {
    const fence = "`".repeat(
      Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)),
    );
    return `${fence}won\n${text}\n${fence}`;
  };
  const inline = (text: string) => {
    const fence = "`".repeat(
      Math.max(1, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)),
    );
    return `${fence} ${text.replace(/[\r\n]/g, " ")} ${fence}`;
  };
  const quantity = (count: number, noun: string) =>
    `${count} ${count === 1 ? noun : noun === "property" ? "properties" : noun + "s"}`;
  const preview = source.slice(fact.span.start, fact.span.end);
  const lines = [code(preview.length > 180 ? preview.slice(0, 177) + "…" : preview)];
  if (fact.kind === "literal") {
    lines.push(
      `**WON ${fact.valueKind} literal** · ${
        quantity(fact.count ?? 0, fact.valueKind === "list" ? "item" : "property")
      }`,
    );
  } else if (fact.kind === "tag") {
    lines.push(`**WON tag** ${inline(fact.name!)}`);
    lines.push(
      `Properties: ${fact.properties?.length ? fact.properties.map(inline).join(", ") : "none"}`,
    );
    lines.push(`Payload: ${fact.payloadKind}`);
    lines.push("Tag and property names are interpreted by the consumer.");
  } else if (fact.kind === "property") {
    lines.push(`**WON property** ${inline(fact.name!)}`);
    lines.push(`Value: ${fact.valueKind}`);
  } else if (fact.kind === "list" || fact.kind === "record" || fact.kind === "attributes") {
    lines.push(
      `**WON ${fact.kind}** · ${
        quantity(fact.count ?? 0, fact.kind === "list" ? "item" : "property")
      }`,
    );
    if (fact.properties?.length) {
      lines.push(`Properties: ${fact.properties.map(inline).join(", ")}`);
    }
  } else {
    lines.push(`**WON ${fact.kind}**`);
    if (fact.byteLength !== undefined) {
      lines.push(
        `Stored as ${quantity(fact.byteLength, "byte")}${
          fact.kind === "text" ? " of UTF-8 text" : ""
        }.`,
      );
    }
    if (fact.kind === "number") lines.push("The exact number spelling is preserved.");
  }
  if (fact.parentTag) lines.push(`Containing tag: ${inline(fact.parentTag)}`);
  lines.push(
    fact.kind === "attributes"
      ? `Stored as ${inline("List<(String, Value)>")} on the tag.`
      : `Value type: ${inline("basis/won_value.wm.Value")}`,
  );
  return {
    contents: { kind: "markdown", value: lines.join("\n\n") },
    range: spanRange(source, selection),
  };
}
