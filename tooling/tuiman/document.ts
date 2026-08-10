export type SemanticRole =
  | "plain"
  | "header"
  | "error"
  | "warning"
  | "type"
  | "secondary"
  | "hint";

export type Span = { text: string; role: SemanticRole };
export type Line = { spans: Span[] };
export type Document = { lines: Line[] };

type GeneratedRenderer = (argument: [Document, boolean]) => string;

const generatedRenderer = await import("../../src/generated/tuiman.js")
  .then((module) => module.renderDocument as GeneratedRenderer)
  .catch(() => undefined);

export function span(text: string, role: SemanticRole = "plain"): Span {
  return { text, role };
}

export function line(...spans: Span[]): Line {
  return { spans };
}

export function plainDocument(text: string): Document {
  return {
    lines: text.trimEnd().split("\n").map((text) => line(span(text))),
  };
}

export function plainText(document: Document): string {
  return document.lines.map((line) => line.spans.map((span) => span.text).join("")).join("\n");
}

/** Live terminal columns when available; deterministic editor/test fallback otherwise. */
export function terminalWidth(fallback = 120): number {
  try {
    return Math.max(40, Deno.consoleSize().columns);
  } catch {
    return fallback;
  }
}

/** Render through the last successful Workman artifact, with a dependency-free fallback. */
export function renderDocument(document: Document, colors: boolean): string {
  if (generatedRenderer) {
    try {
      return generatedRenderer([document, colors]);
    } catch {
      // A stale or incompatible stage-0 artifact must never hide the compiler error.
    }
  }
  return plainText(document);
}
