export function normalizeFrontendSemanticAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFrontendSemanticAst);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) =>
          key !== "node" &&
          key !== "pathNode" &&
          key !== "implicitTerminatorSpan" &&
          item !== null &&
          item !== undefined
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeFrontendSemanticAst(item)]),
    );
  }
  return value;
}

export function normalizeFrontendSemanticAstWithSpans(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFrontendSemanticAstWithSpans);
  if (value && typeof value === "object") {
    if (isParseNodeMetadata(value)) {
      return {
        span: normalizeFrontendSemanticAstWithSpans(
          (value as { span: unknown }).span,
        ),
      };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeFrontendSemanticAstWithSpans(item)]),
    );
  }
  return value;
}

function isParseNodeMetadata(value: object): boolean {
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  return typeof candidate.id === "number" &&
    typeof candidate.span === "object" &&
    candidate.span !== null &&
    keys.every((key) => key === "id" || key === "span");
}
