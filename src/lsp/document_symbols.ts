import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import type { SemanticTopLevelDeclaration } from "../module_interface.ts";
import { type LspRange, spanRange } from "./range.ts";
import { semanticDocumentContext } from "./semantic_context.ts";

export type LspDocumentSymbol = {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
};

export async function documentSymbols(
  uri: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<LspDocumentSymbol[]> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options);
  if (!context) return [];
  return context.moduleInterface.declarations.map((declaration) =>
    documentSymbol(context.source, declaration)
  );
}

function documentSymbol(
  source: string,
  declaration: SemanticTopLevelDeclaration,
): LspDocumentSymbol {
  const children = declaration.constructors?.map((constructor) => ({
    name: constructor.name,
    kind: 22,
    range: spanRange(source, constructor.span),
    selectionRange: spanRange(source, constructor.selectionSpan),
  }));
  return {
    name: declaration.name,
    kind: declaration.kind === "function"
      ? 12
      : declaration.kind === "value"
      ? 13
      : declaration.kind === "datatype"
      ? 10
      : declaration.kind === "record"
      ? 23
      : 5,
    range: spanRange(source, declaration.span),
    selectionRange: spanRange(source, declaration.selectionSpan),
    ...(children?.length ? { children } : {}),
  };
}
