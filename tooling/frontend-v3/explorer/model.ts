/** A WM datatype value: payload fields `a0`, `a1`, ...; a tuple payload is spread over them. */
export type Variant<T = unknown> = { name: string; a0?: T; [field: `a${number}`]: unknown };
type Position = { index: number; line: number; col: number };
export type Span = { startPos: Position; endPos: Position };
export type Mark = {
  id: Variant<number>;
  problem: Variant;
  recovery: Variant;
  anchor: Variant<number>;
  affectedSpan: { start: Variant<number>; end: Variant<number> };
  causedBy: Variant;
};
export type Trivia = { kind: Variant; text: string; span: Span; marks: Mark[] };
export type Token = { kind: Variant; span: Span; mateIdx: Variant<number>; marks: Mark[]; leadingTrivia: Trivia[] };
export type LexicalDocument = { tokens: Token[]; marks: Mark[] };
export type LexResponse =
  | { success: true; document: LexicalDocument; elapsed: number }
  | { success: false; error: { kind: "unfinished" | "internal" | "request"; message: string } };

export type Item = Token | Trivia | Mark;

export function spanOf(item: Item): [number, number] {
  return "span" in item
    ? [item.span.startPos.index, item.span.endPos.index]
    : [item.affectedSpan.start.a0 as number, item.affectedSpan.end.a0 as number];
}

export function label(value: unknown): string {
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (value !== null && typeof value === "object" && "name" in value && "ctor" in value) {
    const variant = value as Variant;
    const fields: unknown[] = [];
    for (let index = 0; `a${index}` in variant; index++) fields.push(variant[`a${index}`]);
    return fields.length ? `${variant.name}(${fields.map(label).join(", ")})` : variant.name;
  }
  return String(value);
}
