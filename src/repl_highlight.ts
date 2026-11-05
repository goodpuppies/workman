import { isReplCommand, replCommandNeedsSemicolon } from "./repl_commands.ts";

export type HighlightKind =
  | "keyword"
  | "constant"
  | "number"
  | "string"
  | "comment"
  | "type"
  | "function"
  | "command";

export type HighlightSpan = Readonly<{ start: number; end: number; kind: HighlightKind }>;

export type HighlightStyles = Readonly<Record<HighlightKind, string>>;

/** Workman's colors, built around the orange of the logo and the loading bar. */
export const WORKMAN_STYLES: HighlightStyles = {
  keyword: "\x1b[38;2;255;106;21m",
  constant: "\x1b[38;2;255;167;115m",
  number: "\x1b[38;2;255;167;115m",
  string: "\x1b[38;2;216;199;168m",
  comment: "\x1b[38;2;111;106;102m",
  type: "\x1b[38;2;255;201;163m",
  function: "\x1b[38;2;255;255;255m",
  command: "\x1b[38;2;255;106;21m",
};

/** For a terminal without truecolor: the 16-color palette, which follows its own theme. */
export const BASIC_STYLES: HighlightStyles = {
  keyword: "\x1b[35m",
  constant: "\x1b[33m",
  number: "\x1b[33m",
  string: "\x1b[32m",
  comment: "\x1b[90m",
  type: "\x1b[36m",
  function: "\x1b[34m",
  command: "\x1b[35m",
};

export function terminalHasTruecolor(): boolean {
  const colorTerm = Deno.env.get("COLORTERM");
  return colorTerm === "truecolor" || colorTerm === "24bit";
}

export function terminalHighlightStyles(): HighlightStyles {
  return terminalHasTruecolor() ? WORKMAN_STYLES : BASIC_STYLES;
}

const RESET_COLOR = "\x1b[39m";

const KEYWORDS = new Set([
  "from",
  "import",
  "as",
  "let",
  "rec",
  "and",
  "type",
  "record",
  "unsafe",
  "if",
  "else",
  "match",
]);
const CONSTANTS = new Set(["true", "false", "void"]);

const COMMAND_NAME = /:[a-zA-Z][^\s;]*/y;
const NUMBER = /0x[0-9a-fA-F]+|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_']*/y;
const CHARACTER = /'(?:\\.|[^'\\\n])'/y;
const WORD_PART = /[A-Za-z0-9_']/;

function matchAt(pattern: RegExp, text: string, index: number): string | undefined {
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0];
}

/** Lexical only, so it costs little per keystroke and works on input that doesn't parse yet. */
export function highlightSpans(text: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  let index = 0;
  if (isReplCommand(text)) {
    // A comment may come first, and the argument of other commands isn't code.
    const start = /^(?:\s|(?:\/\/|--)[^\n]*(?:\n|$))*/.exec(text)![0].length;
    if (start > 0) highlightCode(text.slice(0, start), 0, spans);
    const name = matchAt(COMMAND_NAME, text, start)!;
    index = start + name.length;
    spans.push({ start, end: index, kind: "command" });
    if (!replCommandNeedsSemicolon(text)) return spans;
  }
  highlightCode(text, index, spans);
  return spans;
}

function highlightCode(text: string, from: number, spans: HighlightSpan[]): void {
  const add = (start: number, end: number, kind: HighlightKind) => {
    spans.push({ start, end, kind });
    return end;
  };
  let index = from;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if ((char === "/" && next === "/") || (char === "-" && next === "-")) {
      const newline = text.indexOf("\n", index);
      index = add(index, newline < 0 ? text.length : newline, "comment");
    } else if (char === "/" && next === "*") {
      index = add(index, blockCommentEnd(text, index), "comment");
    } else if (char === '"' || char === "`") {
      index = add(index, stringEnd(text, index), "string");
    } else if (char === "'") {
      const previous = text[index - 1] ?? "";
      const character = WORD_PART.test(previous) ? undefined : matchAt(CHARACTER, text, index);
      index = character ? add(index, index + character.length, "string") : index + 1;
    } else if (/[0-9]/.test(char)) {
      index = add(index, index + matchAt(NUMBER, text, index)!.length, "number");
    } else if (/[A-Za-z_]/.test(char)) {
      const word = matchAt(IDENTIFIER, text, index)!;
      const end = index + word.length;
      const kind = wordKind(word, text, end);
      if (kind) add(index, end, kind);
      index = end;
    } else {
      index += 1;
    }
  }
}

function wordKind(word: string, text: string, end: number): HighlightKind | undefined {
  if (KEYWORDS.has(word)) return "keyword";
  // `export` is only a keyword in front of an import; elsewhere it's an ordinary name.
  if (word === "export" && /^\s+from\b/.test(text.slice(end, end + 80))) return "keyword";
  if (CONSTANTS.has(word)) return "constant";
  if (/^[A-Z]/.test(word)) return "type";
  return /^\s*\(/.test(text.slice(end, end + 80)) ? "function" : undefined;
}

/** Runs to the end of the text when still open, as it does while being typed. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === quote) return index + 1;
  }
  return text.length;
}

/** Block comments nest, as in the grammar. */
function blockCommentEnd(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length - 1; index++) {
    const pair = text.slice(index, index + 2);
    if (pair === "/*") {
      depth += 1;
      index += 1;
    } else if (pair === "*/") {
      depth -= 1;
      index += 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

/** `text.slice(start, end)` with color added. `spans` must be in order and not overlap. */
export function paintRange(
  text: string,
  start: number,
  end: number,
  spans: readonly HighlightSpan[],
  styles: HighlightStyles = terminalHighlightStyles(),
): string {
  let painted = "";
  let index = start;
  for (const span of spans) {
    if (span.end <= start) continue;
    if (span.start >= end) break;
    const from = Math.max(span.start, start);
    const to = Math.min(span.end, end);
    painted += text.slice(index, from) + styles[span.kind] + text.slice(from, to) + RESET_COLOR;
    index = to;
  }
  return painted + text.slice(index, end);
}
