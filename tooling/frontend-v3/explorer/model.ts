export type Variant<T = unknown> = { name: string; args: T[] };
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
    : [item.affectedSpan.start.args[0], item.affectedSpan.end.args[0]];
}

export function label(value: unknown): string {
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (value !== null && typeof value === "object" && "name" in value && "args" in value) {
    const variant = value as Variant;
    return variant.args.length ? `${variant.name}(${variant.args.map(label).join(", ")})` : variant.name;
  }
  return String(value);
}
