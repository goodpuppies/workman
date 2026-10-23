// Module-level directives: comment lines at the very top of a module, before any other text.

/** The leading directive lines of a module, without their `--` or `//` marker. */
function leadingDirectives(source: string): string[] {
  const directives: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = /^(?:--|\/\/)\s*(@\S.*)$/.exec(trimmed);
    if (!match) break;
    directives.push(match[1].trim());
  }
  return directives;
}

/** `-- @no-prelude` as the first line selects the kernel basis profile. */
export function hasNoPreludeDirective(source: string): boolean {
  return leadingDirectives(source)[0] === "@no-prelude";
}

/**
 * `// @basis-type Result` declares that this module's `type Result` is the compiler's built-in
 * type of that name rather than a new one. Inference checks the declaration against the built-in.
 */
export function basisTypeDirectives(source: string): string[] {
  return leadingDirectives(source).flatMap((directive) => {
    const match = /^@basis-type\s+([A-Z][A-Za-z0-9_]*)$/.exec(directive);
    return match ? [match[1]] : [];
  });
}
