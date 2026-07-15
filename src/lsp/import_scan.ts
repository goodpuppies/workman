/**
 * Extract top-level Workman module imports without invoking either language
 * frontend. The project index only needs dependency edges, so parsing and
 * type-checking an entire recursive module graph here is unnecessary.
 */
export function directWorkmanImportSpecifiers(source: string): string[] {
  const imports = new Set<string>();
  let braces = 0;
  let brackets = 0;
  let parens = 0;

  for (let i = 0; i < source.length;) {
    const triviaEnd = skipTrivia(source, i);
    if (triviaEnd !== i) {
      i = triviaEnd;
      continue;
    }

    const char = source[i];
    if (char === '"' || char === "`") {
      i = scanString(source, i, char).end;
      continue;
    }
    if (isIdentifierStart(char)) {
      const identifier = scanIdentifier(source, i);
      if (
        identifier.value === "from" && braces === 0 && brackets === 0 && parens === 0
      ) {
        const declaration = scanImportDeclaration(source, identifier.end);
        if (declaration) {
          imports.add(declaration.specifier);
          i = declaration.end;
          continue;
        }
      }
      i = identifier.end;
      continue;
    }

    if (char === "{") braces++;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "[") brackets++;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "(") parens++;
    else if (char === ")") parens = Math.max(0, parens - 1);
    i++;
  }

  return [...imports];
}

function scanImportDeclaration(
  source: string,
  afterFrom: number,
): { specifier: string; end: number } | undefined {
  const stringStart = skipTrivia(source, afterFrom);
  if (source[stringStart] !== '"') return;
  const path = scanString(source, stringStart, '"');
  if (path.value === undefined) return;

  const importStart = skipTrivia(source, path.end);
  if (!isIdentifierStart(source[importStart])) return;
  const keyword = scanIdentifier(source, importStart);
  if (keyword.value !== "import") return;
  return { specifier: path.value, end: keyword.end };
}

function skipTrivia(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    if (
      (source[i] === "-" && source[i + 1] === "-") ||
      (source[i] === "/" && source[i + 1] === "/")
    ) {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
}

function scanString(
  source: string,
  start: number,
  delimiter: '"' | "`",
): { end: number; value?: string } {
  let i = start + 1;
  let value = "";
  while (i < source.length) {
    const char = source[i++];
    if (char === delimiter) return { end: i, value };
    if (char === "\\" && i < source.length) {
      const escaped = source[i++];
      value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
    } else {
      value += char;
    }
  }
  return { end: source.length };
}

function scanIdentifier(source: string, start: number): { value: string; end: number } {
  let end = start + 1;
  while (end < source.length && isIdentifierPart(source[end])) end++;
  return { value: source.slice(start, end), end };
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}
