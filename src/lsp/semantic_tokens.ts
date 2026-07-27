import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { type SemanticTokenFact, semanticTokensForModule } from "../module_interface.ts";
import { offsetToLineCol } from "../source.ts";
import { semanticDocumentContext } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";

export const semanticTokenTypes = Object.freeze(
  [
    "namespace",
    "type",
    "typeParameter",
    "parameter",
    "variable",
    "property",
    "enumMember",
    "function",
  ] as const,
);

export const semanticTokenModifiers = Object.freeze(
  [
    "declaration",
    "readonly",
    "defaultLibrary",
  ] as const,
);

export type LspSemanticTokens = Readonly<{ data: readonly number[] }>;

const tokenTypeIndex: Readonly<Record<SemanticTokenFact["kind"], number>> = Object.freeze({
  namespace: semanticTokenTypes.indexOf("namespace"),
  type: semanticTokenTypes.indexOf("type"),
  "type-parameter": semanticTokenTypes.indexOf("typeParameter"),
  parameter: semanticTokenTypes.indexOf("parameter"),
  variable: semanticTokenTypes.indexOf("variable"),
  property: semanticTokenTypes.indexOf("property"),
  constructor: semanticTokenTypes.indexOf("enumMember"),
  function: semanticTokenTypes.indexOf("function"),
});

const tokenModifierIndex = Object.freeze({
  declaration: semanticTokenModifiers.indexOf("declaration"),
  readonly: semanticTokenModifiers.indexOf("readonly"),
  "default-library": semanticTokenModifiers.indexOf("defaultLibrary"),
});

/** Encode compiler-owned semantic symbol facts using the standard LSP relative token format. */
export async function semanticTokensFull(
  uri: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<LspSemanticTokens | null> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return null;
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const token of semanticTokensForModule(context.moduleInterface)) {
    const start = offsetToLineCol(context.source, token.span.start);
    const line = start.line - 1;
    const character = start.col;
    const deltaLine = line - previousLine;
    const deltaCharacter = deltaLine === 0 ? character - previousCharacter : character;
    const modifierBits = token.modifiers.reduce(
      (bits, modifier) => bits | (1 << tokenModifierIndex[modifier]),
      0,
    );
    data.push(
      deltaLine,
      deltaCharacter,
      token.span.end - token.span.start,
      tokenTypeIndex[token.kind],
      modifierBits,
    );
    previousLine = line;
    previousCharacter = character;
  }
  return Object.freeze({ data: Object.freeze(data) });
}
