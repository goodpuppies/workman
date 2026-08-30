import { normalize, resolve } from "node:path";
import { runtime } from "../io.ts";
import { fileUriToPath } from "./uri.ts";

export type LspFoldingRange = Readonly<{
  startLine: number;
  endLine: number;
  kind?: "region";
}>;

const regionMarker = /^\s*(?:\/\/|--)#(?:(end|END))?(region|REGION)(?:\s+.*)?\s*$/;

/** Find nested editor-folding regions delimited by whole-line Workman comments. */
export function regionFoldingRanges(source: string): LspFoldingRange[] {
  const openings: number[] = [];
  const ranges: LspFoldingRange[] = [];
  for (const [line, text] of source.split("\n").entries()) {
    const marker = regionMarker.exec(text);
    if (!marker) continue;
    if (marker[1] === undefined) {
      openings.push(line);
      continue;
    }
    const startLine = openings.pop();
    if (startLine === undefined || startLine >= line) continue;
    ranges.push({ startLine, endLine: line, kind: "region" });
  }
  return ranges.sort((left, right) =>
    left.startLine - right.startLine || right.endLine - left.endLine
  );
}

type Delimiter = Readonly<{
  character: "{" | "[" | "(";
  line: number;
}>;

/** Find ordinary multiline syntax folds without requiring the file to parse successfully. */
export function syntaxFoldingRanges(source: string): LspFoldingRange[] {
  const delimiters: Delimiter[] = [];
  const ranges: LspFoldingRange[] = [];
  let line = 0;
  let quoted = false;
  let multiline = false;
  let multilineStart = 0;
  let escaped = false;
  let lineComment = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];

    if (character === "\n") {
      line++;
      lineComment = false;
      if (quoted) quoted = false;
      escaped = false;
      continue;
    }
    if (lineComment) continue;

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (multiline) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "`") {
        if (multilineStart < line) ranges.push({ startLine: multilineStart, endLine: line });
        multiline = false;
      }
      continue;
    }

    const next = source[index + 1];
    if ((character === "/" && next === "/") || (character === "-" && next === "-")) {
      lineComment = true;
      index++;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "`") {
      multiline = true;
      multilineStart = line;
      continue;
    }
    if (character === "{" || character === "[" || character === "(") {
      delimiters.push({ character, line });
      continue;
    }

    const opening = character === "}"
      ? "{"
      : character === "]"
      ? "["
      : character === ")"
      ? "("
      : undefined;
    if (opening === undefined) continue;
    let openingIndex = delimiters.length - 1;
    while (openingIndex >= 0 && delimiters[openingIndex].character !== opening) openingIndex--;
    if (openingIndex < 0) continue;
    const [delimiter] = delimiters.splice(openingIndex);
    if (delimiter.line < line) ranges.push({ startLine: delimiter.line, endLine: line });
  }

  return ranges.sort(compareRanges);
}

export function sourceFoldingRanges(source: string): LspFoldingRange[] {
  return [...regionFoldingRanges(source), ...syntaxFoldingRanges(source)].sort(compareRanges);
}

function compareRanges(left: LspFoldingRange, right: LspFoldingRange): number {
  return left.startLine - right.startLine || right.endLine - left.endLine;
}

export async function foldingRanges(
  uri: string,
  sourceOverrides: Map<string, string>,
): Promise<LspFoldingRange[]> {
  const path = normalize(resolve(fileUriToPath(uri)));
  const source = sourceOverrides.get(path) ?? await runtime.readTextFile(path);
  return sourceFoldingRanges(source);
}
