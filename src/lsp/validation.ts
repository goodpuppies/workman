import { normalize, resolve } from "node:path";
import { analyzeFile, ModuleAnalysisError } from "../compiler.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import {
  classifyDiagnostic,
  diagnosticNotes,
  errorMessage,
  formatDiagnostic,
  type FrontendDiagnostic,
  FrontendDiagnosticBundleError,
  FrontendDiagnosticError,
  renderDiagnosticSummary,
} from "../diagnostics.ts";
import { structuralDiagnostics } from "../frontend_v2_diagnostics.ts";
import { type FrontendV2, loadFrontendV2 } from "../frontend_v2_loader.ts";
import type { InferResult } from "../infer.ts";
import { ModuleGraphDiagnosticError } from "../module_graph.ts";
import type { FrontendV2ParseCache } from "./frontend_v2_parse_cache.ts";
import { type LspRange, peggyLocationRange, spanRange, startRange } from "./range.ts";
import { fileUriToPath, pathToFileUri } from "./uri.ts";

export type ValidationResult = {
  uri: string;
  diagnostics: LspDiagnostic[];
};

export type LspDiagnostic = {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: "wm-mini";
  message: string;
  relatedInformation?: LspRelatedInformation[];
};

export type LspRelatedInformation = {
  location: {
    uri: string;
    range: LspRange;
  };
  message: string;
};

export type ValidationOptions = {
  frontendV2ParseCache?: FrontendV2ParseCache;
  documentVersion?: (uri: string) => number | undefined;
};

export async function validateUri(
  uri: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  validationOptions: ValidationOptions = {},
): Promise<ValidationResult[]> {
  const entryPath = normalize(resolve(fileUriToPath(uri)));
  try {
    const analysis = await analyzeFile(entryPath, { ...options, sourceOverrides });
    const frontendV2 = options.frontend === "v2"
      ? await loadFrontendV2(options.frontendV2ModuleUrl ?? defaultFrontendV2ModuleUrl)
      : undefined;
    return analysis.graph.order.map((path) => {
      const diagnosticUri = pathToFileUri(path);
      const source = analysis.graph.nodes.get(path)?.source ?? "";
      return {
        uri: diagnosticUri,
        diagnostics: [
          ...structuralDiagnosticsFor(
            frontendV2,
            source,
            diagnosticUri,
            validationOptions,
          ),
          ...diagnosticsFor(
            analysis.results.get(path),
            source,
            diagnosticUri,
          ),
        ],
      };
    });
  } catch (error) {
    if (error instanceof ModuleAnalysisError) {
      const entryUri = pathToFileUri(canonicalPath(entryPath, sourceOverrides));
      const diagnosticUri = pathToFileUri(error.path);
      const result = {
        uri: diagnosticUri,
        diagnostics: [
          ...errorDiagnostics(error.originalError, error.source, diagnosticUri),
          ...error.diagnostics.map((diagnostic) =>
            lspDiagnostic(diagnostic, error.source, diagnosticUri)
          ),
        ],
      };
      return diagnosticUri === entryUri ? [result] : [{ uri: entryUri, diagnostics: [] }, result];
    }
    if (error instanceof ModuleGraphDiagnosticError) {
      const entryUri = pathToFileUri(canonicalPath(entryPath, sourceOverrides));
      const diagnosticUri = pathToFileUri(error.path);
      const result = {
        uri: diagnosticUri,
        diagnostics: [errorDiagnostic(error.originalError, error.source, diagnosticUri)],
      };
      return diagnosticUri === entryUri ? [result] : [{ uri: entryUri, diagnostics: [] }, result];
    }
    const canonical = canonicalPath(entryPath, sourceOverrides);
    return [{
      uri: pathToFileUri(canonical),
      diagnostics: [
        ...errorDiagnostics(
          error,
          await sourceForPath(canonical, sourceOverrides),
          pathToFileUri(canonical),
        ),
      ],
    }];
  }
}

const defaultFrontendV2ModuleUrl = new URL(
  "../../tooling/frontend-v2/frontend-v2.generated.mjs",
  import.meta.url,
);

function structuralDiagnosticsFor(
  frontend: Pick<FrontendV2, "parseStructural"> | undefined,
  source: string,
  uri: string,
  validationOptions: ValidationOptions,
): LspDiagnostic[] {
  if (!frontend) return [];
  const result = validationOptions.frontendV2ParseCache?.structural(
    uri,
    source,
    validationOptions.documentVersion?.(uri),
    frontend,
  ) ?? frontend.parseStructural(source);
  return structuralDiagnostics(result, source)
    .map((diagnostic) => lspDiagnostic(diagnostic, source, uri));
}

function diagnosticsFor(result: InferResult | undefined, source = "", uri = ""): LspDiagnostic[] {
  return result?.diagnostics.map((diagnostic) => lspDiagnostic(diagnostic, source, uri)) ?? [];
}

function errorDiagnostic(error: unknown, source = "", uri = ""): LspDiagnostic {
  return errorDiagnostics(error, source, uri)[0];
}

function errorDiagnostics(error: unknown, source = "", uri = ""): LspDiagnostic[] {
  if (error instanceof FrontendDiagnosticBundleError) {
    return [
      ...errorDiagnostics(error.primary, source, uri),
      ...error.diagnostics.map((diagnostic) => lspDiagnostic(diagnostic, source, uri)),
    ];
  }
  if (error instanceof FrontendDiagnosticError) {
    return [lspDiagnostic(error.diagnostic, source, uri)];
  }
  const message = errorMessage(error);
  const span = errorSpan(error);
  return [{
    range: span && source ? spanRange(source, span) : peggyLocationRange(errorLocation(error)),
    severity: 1,
    code: classifyDiagnostic(message),
    source: "wm-mini",
    message,
  }];
}

function lspDiagnostic(diagnostic: FrontendDiagnostic, source = "", uri = ""): LspDiagnostic {
  const range = diagnostic.primary.kind === "source" && source
    ? spanRange(source, diagnostic.primary.span)
    : startRange;
  const relatedInformation = diagnosticNotes(diagnostic)
    .map((note) => ({
      location: {
        uri,
        range: note.anchor.kind === "source" && source
          ? spanRange(source, note.anchor.span)
          : startRange,
      },
      message: note.message,
    }))
    .filter((related) =>
      related.location.uri.startsWith("file://") && isValidRange(related.location.range)
    );
  return {
    range,
    severity: lspSeverity(diagnostic.severity),
    code: diagnostic.code,
    source: "wm-mini",
    message: formatDiagnostic(diagnostic, uri ? fileUriToPath(uri) : undefined, source).trimEnd(),
    relatedInformation: relatedInformation.length ? relatedInformation : undefined,
  };
}

function lspSeverity(severity: FrontendDiagnostic["severity"]): 1 | 2 | 3 | 4 {
  if (severity === "error") return 1;
  if (severity === "warning") return 2;
  if (severity === "information") return 3;
  return 4;
}

function errorLocation(error: unknown): PeggyLocation | undefined {
  if (!error || typeof error !== "object" || !("location" in error)) return undefined;
  const location = (error as { location?: unknown }).location;
  if (!location || typeof location !== "object") return undefined;
  return location as PeggyLocation;
}

function errorSpan(error: unknown): SourceSpanLike | undefined {
  if (!error || typeof error !== "object" || !("span" in error)) return undefined;
  const span = (error as { span?: unknown }).span;
  if (!span || typeof span !== "object") return undefined;
  const candidate = span as Partial<SourceSpanLike>;
  if (
    typeof candidate.line !== "number" ||
    typeof candidate.col !== "number" ||
    typeof candidate.start !== "number" ||
    typeof candidate.end !== "number"
  ) {
    return undefined;
  }
  return candidate as SourceSpanLike;
}

function isValidRange(range: LspRange): boolean {
  const positions = [range.start, range.end];
  if (
    positions.some((position) =>
      !Number.isInteger(position.line) || !Number.isInteger(position.character)
    )
  ) {
    return false;
  }
  if (positions.some((position) => position.line < 0 || position.character < 0)) {
    return false;
  }
  if (range.end.line < range.start.line) return false;
  if (range.end.line === range.start.line && range.end.character < range.start.character) {
    return false;
  }
  return true;
}

function canonicalPath(path: string, sourceOverrides: Map<string, string>): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return sourceOverrides.has(path) ? path : path;
  }
}

async function sourceForPath(path: string, sourceOverrides: Map<string, string>): Promise<string> {
  const override = sourceOverrides.get(path);
  if (override !== undefined) return override;
  try {
    const real = Deno.realPathSync(path);
    const realOverride = sourceOverrides.get(real);
    if (realOverride !== undefined) return realOverride;
  } catch {
    // Fall through to reading the original path.
  }
  try {
    return await Deno.readTextFile(path);
  } catch {
    return "";
  }
}

type PeggyLocation = Parameters<typeof peggyLocationRange>[0];
type SourceSpanLike = Parameters<typeof spanRange>[1];
