export type SourceSpan = {
  line: number;
  col: number;
  start: number;
  end: number;
};

export type Span = SourceSpan;
export type NodeId = number;

export type AstNode = {
  id: NodeId;
  span: SourceSpan;
};

export type LineCol = {
  line: number;
  col: number;
};

export const unknownSpan: SourceSpan = { line: 1, col: 0, start: 0, end: 0 };

export function makeSpan(line: number, col: number, start: number, end: number): SourceSpan {
  return { line, col, start, end };
}

const lineStartsCacheLimit = 32;
const lineStartsCache = new Map<string, number[]>();

function cachedLineStarts(source: string): number[] {
  const cached = lineStartsCache.get(source);
  if (cached) return cached;
  const starts = lineStarts(source);
  if (lineStartsCache.size >= lineStartsCacheLimit) {
    const oldest = lineStartsCache.keys().next();
    if (!oldest.done) lineStartsCache.delete(oldest.value);
  }
  lineStartsCache.set(source, starts);
  return starts;
}

export function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  // The scanning implementation this replaced stopped at the end of the
  // source, so out-of-range offsets clamp rather than run past the last line.
  const limit = Math.min(Math.max(0, offset), source.length);
  return offsetToLineColFromStarts(limit, cachedLineStarts(source));
}

export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

export function offsetToLineColFromStarts(offset: number, starts: number[]): LineCol {
  const target = Math.max(0, offset);
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = starts[mid];
    const next = starts[mid + 1] ?? Number.MAX_SAFE_INTEGER;
    if (target < start) high = mid - 1;
    else if (target >= next) low = mid + 1;
    else return { line: mid + 1, col: target - start };
  }
  const last = starts.at(-1) ?? 0;
  return { line: starts.length, col: target - last };
}

export function lineColToOffset(line: number, col: number, starts: number[]): number {
  const lineIndex = Math.max(0, Math.min(line - 1, starts.length - 1));
  return starts[lineIndex] + Math.max(0, col);
}

export function sliceSource(source: string, span: SourceSpan): string {
  return source.slice(span.start, span.end);
}
