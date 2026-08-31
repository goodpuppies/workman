export type TopLevelPhraseRange = Readonly<{ start: number; end: number }>;

/** Compiler-owned top-level recovery boundaries; nested and quoted semicolons are ignored. */
export function topLevelPhraseRanges(source: string): TopLevelPhraseRange[] {
  const ranges: TopLevelPhraseRange[] = [];
  const stack: string[] = [];
  let stringEnd: '"' | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }
    if (stringEnd) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === stringEnd) stringEnd = undefined;
      continue;
    }
    if ((char === "/" && next === "/") || (char === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "`") {
      stringEnd = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") stack.push(char);
    else if (char === ")" || char === "]" || char === "}") stack.pop();
    else if (char === ";" && stack.length === 0) {
      const start = ranges.at(-1)?.end ?? 0;
      ranges.push(Object.freeze({ start, end: index + 1 }));
    }
  }
  const trailingStart = ranges.at(-1)?.end ?? 0;
  if (source.slice(trailingStart).trim()) {
    ranges.push(Object.freeze({ start: trailingStart, end: source.length }));
  }
  return ranges;
}

/**
 * Index just past the last top-level `;` whose remainder is only whitespace or
 * comments, or undefined while a phrase is still open. Mirrors the scanner in
 * {@code topLevelPhraseRanges}: nested and quoted semicolons are ignored. An
 * unterminated line comment at the end of input still counts as a terminator.
 */
export function topLevelPhraseEnd(source: string): number | undefined {
  const stack: string[] = [];
  let lastSemicolon: number | undefined;
  let lineComment = false;
  let stringEnd: '"' | "`" | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }
    if (stringEnd) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === stringEnd) stringEnd = undefined;
      continue;
    }
    if ((char === "/" && next === "/") || (char === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "`") {
      stringEnd = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push(char);
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      stack.pop();
      continue;
    }
    if (char === ";" && stack.length === 0) lastSemicolon = index + 1;
  }
  if (lastSemicolon === undefined) return undefined;
  const remainder = source.slice(lastSemicolon);
  return remainderIsBlank(remainder) ? lastSemicolon : undefined;
}

function remainderIsBlank(source: string): boolean {
  let lineComment = false;
  let stringEnd: '"' | "`" | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }
    if (stringEnd) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === stringEnd) stringEnd = undefined;
      else return false;
      continue;
    }
    if ((char === "/" && next === "/") || (char === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "`") {
      stringEnd = char;
      continue;
    }
    if (!/\s/.test(char)) return false;
  }
  return !stringEnd;
}
/** Preserve length and line structure so every surviving AST node keeps its authored offsets. */
export function maskSourceRange(source: string, start: number, end: number): string {
  const masked = source.slice(start, end).replace(/[^\r\n]/g, " ");
  return source.slice(0, start) + masked + source.slice(end);
}
