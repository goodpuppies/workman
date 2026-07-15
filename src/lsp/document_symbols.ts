import type { Decl, Pattern } from "../ast.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { loadModuleGraph } from "../module_graph.ts";
import type { SourceSpan } from "../source.ts";
import { type LspRange, spanRange } from "./range.ts";
import { fileUriToPath } from "./uri.ts";

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
  try {
    const graph = await loadModuleGraph(fileUriToPath(uri), { ...options, sourceOverrides });
    const node = graph.nodes.get(graph.entry);
    return node ? node.module.decls.flatMap((decl) => symbolForDecl(node.source, decl)) : [];
  } catch {
    return [];
  }
}

function symbolForDecl(source: string, decl: Decl): LspDocumentSymbol[] {
  if (!decl.node) return [];
  const range = spanRange(source, decl.node.span);
  if (decl.kind === "LetDecl") {
    return decl.bindings.flatMap((binding) =>
      binderPatterns(binding.pattern).filter((pattern) => pattern.node).map((pattern) => ({
        name: pattern.name,
        kind: binding.value.kind === "Lambda" ? 12 : 13,
        range,
        selectionRange: spanRange(source, pattern.node!.span),
      }))
    );
  }
  if (decl.kind === "TypeDecl" || decl.kind === "RecordDecl" || decl.kind === "ForeignTypeDecl") {
    const span = nameSpan(source, decl, decl.name) ?? decl.node.span;
    const children = decl.kind === "TypeDecl"
      ? decl.ctors.flatMap((ctor) => {
        const ctorSpan = nameSpan(source, ctor, ctor.name);
        return ctorSpan
          ? [{
            name: ctor.name,
            kind: 22,
            range: spanRange(source, ctor.node!.span),
            selectionRange: spanRange(source, ctorSpan),
          }]
          : [];
      })
      : undefined;
    return [{
      name: decl.name,
      kind: decl.kind === "RecordDecl" ? 23 : decl.kind === "TypeDecl" ? 10 : 5,
      range,
      selectionRange: spanRange(source, span),
      ...(children?.length ? { children } : {}),
    }];
  }
  return [];
}

function binderPatterns(pattern: Pattern): Extract<Pattern, { kind: "PVar" }>[] {
  if (pattern.kind === "PVar") return [pattern];
  if (pattern.kind === "PTuple") return pattern.items.flatMap(binderPatterns);
  if (pattern.kind === "PRecord") {
    return pattern.fields.flatMap((field) => binderPatterns(field.pattern));
  }
  return [];
}

function nameSpan(
  source: string,
  value: { node?: { span: SourceSpan } },
  name: string,
): SourceSpan | undefined {
  if (!value.node) return undefined;
  const relative = source.slice(value.node.span.start, value.node.span.end).indexOf(name);
  return relative < 0 ? undefined : {
    ...value.node.span,
    start: value.node.span.start + relative,
    end: value.node.span.start + relative + name.length,
  };
}
