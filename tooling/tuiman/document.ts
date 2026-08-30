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
    const columns = Deno.consoleSize().columns;
    if (Number.isFinite(columns) && columns > 0) return Math.max(20, columns);
  } catch {
    // Some terminals (notably Android/Termux combinations) expose COLUMNS but
    // do not support the ioctl used by consoleSize.
  }
  try {
    const columns = Number(Deno.env.get("COLUMNS"));
    if (Number.isFinite(columns) && columns > 0) return Math.max(20, Math.floor(columns));
  } catch {
    // Environment access is optional for library/editor consumers.
  }
  return fallback;
}

/** A word, or a run of whitespace, carrying every role its text was split across. */
type WrapUnit = { pieces: Span[]; width: number; space: boolean };

/** Split one line into wrappable units. Words survive span boundaries so roles never split them. */
function wrapUnits(sourceLine: Line): WrapUnit[] {
  const units: WrapUnit[] = [];
  for (const sourceSpan of sourceLine.spans) {
    for (const text of sourceSpan.text.split(/(\s+)/)) {
      if (text.length === 0) continue;
      const space = /^\s/.test(text);
      const previous = units.at(-1);
      if (previous && !space && !previous.space) {
        previous.pieces.push(span(text, sourceSpan.role));
        previous.width += text.length;
        continue;
      }
      units.push({ pieces: [span(text, sourceSpan.role)], width: text.length, space });
    }
  }
  return units;
}

/**
 * Flow semantic lines to a width while retaining the role of every piece of text. Breaks land on
 * whitespace so words stay intact; only a word wider than the terminal is split mid-way.
 */
export function wrapDocument(document: Document, width: number): Document {
  const columns = Math.max(1, Math.floor(width));
  const lines: Line[] = [];
  for (const sourceLine of document.lines) {
    let current: Span[] = [];
    let used = 0;
    let wrapped = false;
    const flush = () => {
      lines.push(line(...current));
      current = [];
      used = 0;
    };
    // Whitespace already placed before a break would otherwise dangle off the end of the line.
    const breakLine = () => {
      while (current.length > 0 && current.at(-1)!.text.trimEnd().length === 0) current.pop();
      const last = current.at(-1);
      if (last) current[current.length - 1] = span(last.text.trimEnd(), last.role);
      flush();
      wrapped = true;
    };
    const push = (piece: Span) => {
      current.push(piece);
      used += piece.text.length;
    };
    for (const unit of wrapUnits(sourceLine)) {
      if (unit.space) {
        // Leading whitespace is indentation and is kept; whitespace at a break point is the break
        // itself and is dropped rather than pushed onto the next line.
        if (used === 0) {
          if (!wrapped) unit.pieces.forEach(push);
          continue;
        }
        if (used + unit.width > columns) {
          breakLine();
          continue;
        }
        unit.pieces.forEach(push);
        continue;
      }
      if (used > 0 && used + unit.width > columns) breakLine();
      for (const piece of unit.pieces) {
        let text = piece.text;
        while (text.length > 0) {
          if (used === columns) breakLine();
          const take = Math.min(columns - used, text.length);
          push(span(text.slice(0, take), piece.role));
          text = text.slice(take);
        }
      }
    }
    flush();
  }
  return { lines };
}

/** Render through the last successful Workman artifact, with a dependency-free fallback. */
export function renderDocument(document: Document, colors: boolean): string {
  document = wrapDocument(document, terminalWidth());
  if (generatedRenderer) {
    try {
      return generatedRenderer([document, colors]);
    } catch {
      // A stale or incompatible stage-0 artifact must never hide the compiler error.
    }
  }
  return plainText(document);
}
