import type { LexicalDocument, Mark, Token, Trivia } from "./model.ts";

type RuntimeList<T> = { name: string; a0?: T; a1?: RuntimeList<T> };
type RuntimeTrivia = Omit<Trivia, "marks" | "text"> & { text: unknown; marks: RuntimeList<Mark> };
type RuntimeToken = Omit<Token, "marks" | "leadingTrivia"> & {
  marks: RuntimeList<Mark>;
  leadingTrivia: RuntimeList<RuntimeTrivia>;
};
export type RuntimeDocument = { tokens: RuntimeList<RuntimeToken>; marks: RuntimeList<Mark> };

// Flatten runtime lists at the transport boundary so large buffers serialize without
// recursing through thousands of Cons cells. Preserve every record field and mark ID.
function list<T>(value: RuntimeList<T>) {
  const out: T[] = [];
  while (value.name === "Cons") {
    out.push(value.a0!);
    value = value.a1!;
  }
  if (value.name !== "Nil") throw new Error(`Expected runtime List, received ${value.name}`);
  return out;
}

export function toDocument(value: RuntimeDocument, source: string): LexicalDocument {
  return {
    tokens: list(value.tokens).map((token) => ({
      ...token,
      marks: list(token.marks),
      leadingTrivia: list(token.leadingTrivia).map((item) => ({
        ...item,
        text: source.slice(item.span.startPos.index, item.span.endPos.index),
        marks: list(item.marks),
      })),
    })),
    marks: list(value.marks),
  };
}
