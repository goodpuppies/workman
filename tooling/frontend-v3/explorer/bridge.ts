import type { LexicalDocument, Mark, Token, Trivia, Variant } from "./model.ts";

type RuntimeList<T> = Variant<[T, RuntimeList<T>]>;
type RuntimeTrivia = Omit<Trivia, "marks"> & { marks: RuntimeList<Mark> };
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
    const [head, tail] = value.args[0];
    out.push(head);
    value = tail;
  }
  if (value.name !== "Nil") throw new Error(`Expected runtime List, received ${value.name}`);
  return out;
}

export function toDocument(value: RuntimeDocument): LexicalDocument {
  return {
    tokens: list(value.tokens).map((token) => ({
      ...token,
      marks: list(token.marks),
      leadingTrivia: list(token.leadingTrivia).map((item) => ({ ...item, marks: list(item.marks) })),
    })),
    marks: list(value.marks),
  };
}
