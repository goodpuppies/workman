import type { Expr, Module, TypeExpr } from "../ast.ts";
import { analyzeFile, analyzeStrictDetachedFile } from "../compiler.ts";
import { type CompilerFrontendOptions, parseCompilerModule } from "../compiler_frontend.ts";
import {
  type ProjectSnapshot,
  semanticOccurrencesAt,
  semanticTypedNodeAt,
} from "../module_interface.ts";
import type { AstNode, SourceSpan } from "../source.ts";
import { renderSemanticType } from "./hover_type_display.ts";
import { type SemanticDocumentContext, semanticSourceForPath } from "./semantic_context.ts";

type AnnotationSite = {
  owners: SourceSpan[];
  annotations: SourceSpan[];
};

type ComparisonCache = {
  sites: Promise<AnnotationSite[]>;
  comparisons: Map<string, Promise<SemanticDocumentContext["moduleInterface"] | undefined>>;
};

// Snapshot identity includes source/dependency revisions. Speculation never updates the LSP registry.
const caches = new WeakMap<ProjectSnapshot, Map<string, ComparisonCache>>();

/** Infer again with only the hovered binding/expression's own annotations erased. */
export async function unannotatedHoverType(
  context: SemanticDocumentContext,
  offset: number,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions,
): Promise<string | undefined> {
  if (context.recovered) return undefined;
  const { project, moduleInterface, source } = context;
  const typed = semanticTypedNodeAt(moduleInterface, offset);
  if (typed?.kind === "type-expression") return undefined;
  let documents = caches.get(project);
  if (!documents) caches.set(project, documents = new Map());
  const candidates = [{ document: moduleInterface, source, point: offset }];
  for (const use of semanticOccurrencesAt(moduleInterface, offset)) {
    if (use.target.kind !== "value") continue;
    for (const document of project.interfaces.values()) {
      const declaration = document.occurrences.find((occurrence) =>
        occurrence.role === "declaration" && occurrence.target.kind === "value" &&
        occurrence.target.id === use.target.id
      );
      if (!declaration) continue;
      const declarationSource = document === moduleInterface
        ? source
        : await semanticSourceForPath(document.path, sourceOverrides);
      if (declarationSource !== undefined) {
        candidates.push({ document, source: declarationSource, point: declaration.span.start });
      }
    }
  }
  const matches: {
    site: AnnotationSite;
    width: number;
    source: string;
    path: string;
    cache: ComparisonCache;
  }[] = [];
  for (const candidate of candidates) {
    let cache = documents.get(candidate.document.path);
    if (!cache) {
      cache = {
        sites: candidate.source.includes(":")
          ? parseCompilerModule(candidate.source, options, candidate.document.path)
            .then((module) => annotationSites(module, candidate.source)).catch(() => [])
          : Promise.resolve([]),
        comparisons: new Map(),
      };
      documents.set(candidate.document.path, cache);
    }
    for (const site of await cache.sites) {
      for (const owner of site.owners) {
        if (owner.start <= candidate.point && candidate.point < owner.end) {
          matches.push({
            site,
            width: owner.end - owner.start,
            source: candidate.source,
            path: candidate.document.path,
            cache,
          });
        }
      }
    }
  }
  const match = matches.sort((left, right) => left.width - right.width)[0];
  const site = match?.site;
  if (!match || !site) return undefined;
  const { cache } = match;
  const key = moduleInterface.path + ":" +
    site.annotations.map((span) => `${span.start}:${span.end}`).join(",");
  let comparison = cache.comparisons.get(key);
  if (!comparison) {
    const overrides = new Map(sourceOverrides);
    let erased = match.source;
    for (const span of site.annotations) {
      erased = erased.slice(0, span.start) +
        erased.slice(span.start, span.end).replace(/[^\r\n]/g, " ") + erased.slice(span.end);
    }
    overrides.set(match.path, erased);
    const analyze = project.kind === "detached" ? analyzeStrictDetachedFile : analyzeFile;
    // Speculative source must not replace the live editor's incremental parse-cache entry.
    comparison = analyze(moduleInterface.path, {
      ...options,
      frontendV2ParseCache: undefined,
      sourceOverrides: overrides,
    })
      .then((analysis) =>
        [...analysis.projectSnapshot.interfaces.values()].find((item) =>
          item.path === moduleInterface.path
        )
      ).catch(() => undefined);
    cache.comparisons.set(key, comparison);
  }
  const alternate = await comparison;
  if (!alternate) return undefined; // Erasure may make a valid annotated program ill-typed.
  const alternateNode = semanticTypedNodeAt(alternate, offset);
  const originalType = typed?.generalType ?? typed?.type ??
    semanticOccurrencesAt(moduleInterface, offset).find((item) => item.inferredType)?.inferredType;
  const alternateType = alternateNode?.generalType ?? alternateNode?.type ??
    semanticOccurrencesAt(alternate, offset).find((item) => item.inferredType)?.inferredType;
  if (!originalType || !alternateType) return undefined;
  const original = renderSemanticType(moduleInterface, originalType.id);
  const inferred = renderSemanticType(alternate, alternateType.id);
  return inferred === original ? undefined : inferred;
}

function annotationSites(module: Module, source: string): AnnotationSite[] {
  const sites: AnnotationSite[] = [];
  // Traverse syntax fields only; source nodes and long identifier metadata are leaves.
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const item = value as {
      kind?: string;
      node?: AstNode;
      pattern?: { node?: AstNode };
      value?: Expr;
      annotation?: TypeExpr;
      params?: { annotation?: TypeExpr }[];
      returnAnnotation?: TypeExpr;
      trailingReturnAnnotation?: TypeExpr;
    };
    const own = [item.annotation, item.returnAnnotation, item.trailingReturnAnnotation]
      .filter((annotation): annotation is TypeExpr => annotation !== undefined);
    let initializer = item.value;
    const initializerAnnotations: TypeExpr[] = [];
    if (item.pattern) {
      while (initializer?.kind === "Ascribed") {
        initializerAnnotations.push(initializer.annotation);
        initializer = initializer.value;
      }
    }
    const lambda = initializer?.kind === "Lambda" ? initializer : undefined;
    const annotations = [
      ...own,
      ...initializerAnnotations,
      ...(lambda
        ? [
          ...(lambda.params ?? []).map((param) => param.annotation),
          lambda.returnAnnotation,
          lambda.trailingReturnAnnotation,
        ].filter((type): type is TypeExpr => type !== undefined)
        : []),
    ];
    if (annotations.length && item.node) {
      const spans = annotations.flatMap((annotation) => {
        if (!annotation.node) return [];
        // Include the separator, preserving comments/whitespace and all later offsets.
        const colon = annotationSeparator(
          source,
          item.node!.span.start,
          annotation.node.span.start,
        );
        return colon >= item.node!.span.start ? [{ ...annotation.node.span, start: colon }] : [];
      });
      if (spans.length === annotations.length) {
        sites.push({
          owners: item.pattern?.node
            ? [item.pattern.node.span]
            : item.kind === "Ascribed" && item.value?.node
            ? [item.value.node.span]
            : [item.node.span],
          annotations: spans,
        });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "node" && key !== "path") visit(child);
    }
  };
  visit(module);
  return sites;
}

/** Find an annotation separator outside nested comments, including comments after the colon. */
function annotationSeparator(source: string, start: number, end: number): number {
  let separator = -1;
  let blockDepth = 0;
  let lineComment = false;
  let quote: string | undefined;
  for (let index = start; index < end; index++) {
    const char = source[index];
    const pair = source.slice(index, index + 2);
    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
    } else if (blockDepth) {
      if (pair === "/*") {
        blockDepth++;
        index++;
      } else if (pair === "*/") {
        blockDepth--;
        index++;
      }
    } else if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = undefined;
    } else if (pair === "//" || pair === "--") {
      lineComment = true;
      index++;
    } else if (pair === "/*") {
      blockDepth++;
      index++;
    } else if (
      char === '"' || char === "`" ||
      (char === "'" && !/[A-Za-z0-9_']/.test(source[index - 1] ?? ""))
    ) {
      quote = char;
    } else if (char === ":") separator = index;
  }
  return separator;
}
