import { normalize, resolve } from "node:path";
import { analyzeFile, elaborateProjectGpuSemantics, ModuleAnalysisError } from "../compiler.ts";
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
import { type FrontendV2Surface, loadFrontendV2Surface } from "../frontend_v2_surface_loader.ts";
import type { ProjectSnapshot } from "../module_interface.ts";
import { runtime } from "../io.ts";
import { ModuleGraphDiagnosticError } from "../module_graph.ts";
import { WmslangNumericDiagnosticError } from "../wmslang/v2_loader.ts";
import type { FrontendV2ParseCache } from "./frontend_v2_parse_cache.ts";
import { type LspRange, peggyLocationRange, spanRange, startRange } from "./range.ts";
import { semanticSourceForPath } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";
import { surfaceRecoveryDiagnostics } from "./surface_recovery.ts";
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
  semanticService?: SemanticService;
  gpuTypeElaborator?: (
    project: ProjectSnapshot,
  ) => Promise<unknown>;
};

export async function validateUri(
  uri: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  validationOptions: ValidationOptions = {},
): Promise<ValidationResult[]> {
  const entryPath = normalize(resolve(fileUriToPath(uri)));
  const serviceContext = validationOptions.semanticService
    ? await validationOptions.semanticService.documentContext(uri, false)
    : null;
  if (serviceContext) {
    const strictFailure = validationOptions.semanticService?.strictFailure(
      serviceContext.project,
    );
    if (strictFailure !== undefined) {
      return await validationResultsForFailure(
        strictFailure,
        entryPath,
        sourceOverrides,
      );
    }
    return await validationResultsForProject(
      serviceContext.project,
      sourceOverrides,
      options,
      validationOptions,
    );
  }
  try {
    const analysis = await analyzeFile(entryPath, { ...options, sourceOverrides });
    return await validationResultsForProject(
      analysis.projectSnapshot,
      sourceOverrides,
      options,
      validationOptions,
    );
  } catch (error) {
    return await validationResultsForFailure(error, entryPath, sourceOverrides);
  }
}

async function validationResultsForFailure(
  error: unknown,
  entryPath: string,
  sourceOverrides: Map<string, string>,
): Promise<ValidationResult[]> {
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

async function validationResultsForProject(
  project: ProjectSnapshot,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions,
  validationOptions: ValidationOptions,
): Promise<ValidationResult[]> {
  const frontendV2 = options.surface === "wmsml" ? undefined : await loadFrontendV2Surface(
    options.frontendV2ModuleUrl ?? defaultFrontendV2ModuleUrl,
  );
  const gpuWarning = await unresolvedGpuTypeWarning(
    project,
    validationOptions.gpuTypeElaborator ?? elaborateProjectGpuSemantics,
    sourceOverrides,
  );
  return await Promise.all([...project.interfaces.values()].map(async (moduleInterface) => {
    const diagnosticUri = pathToFileUri(moduleInterface.path);
    const source = await semanticSourceForPath(moduleInterface.path, sourceOverrides) ?? "";
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
          moduleInterface.diagnostics,
          source,
          diagnosticUri,
        ),
        ...(gpuWarning && gpuWarning.path === moduleInterface.path ? [gpuWarning.diagnostic] : []),
      ],
    };
  }));
}

async function unresolvedGpuTypeWarning(
  project: ProjectSnapshot,
  elaborate: (project: ProjectSnapshot) => Promise<unknown>,
  sourceOverrides: Map<string, string>,
): Promise<{ path: string; diagnostic: LspDiagnostic } | undefined> {
  const interfaceInput = [...project.interfaces.values()]
    .flatMap((moduleInterface) => moduleInterface.gpuFacts.slices)
    .at(0)?.input;
  if (!interfaceInput || interfaceInput.root.functionId === -1) return undefined;
  const sources = new Map(
    await Promise.all([...project.interfaces.values()].map(async (moduleInterface) =>
      [
        moduleInterface.path,
        await semanticSourceForPath(moduleInterface.path, sourceOverrides) ?? "",
      ] as const
    )),
  );
  const headPath = project.interfaces.get(project.head)?.path ?? "<module>";
  try {
    await elaborate(project);
    return undefined;
  } catch (error) {
    if (error instanceof WmslangNumericDiagnosticError) {
      const gpuInput = error.languageServiceInput ?? interfaceInput;
      const diagnostic = error.diagnostic;
      const span = gpuInput.spans.find((candidate) => candidate.id === diagnostic.spanId);
      const path = span?.path ?? headPath;
      const source = sources.get(path) ?? "";
      const relatedInformation = diagnostic.related.flatMap((related) => {
        const relatedSpan = gpuInput.spans.find((candidate) => candidate.id === related.spanId);
        if (!relatedSpan) return [];
        const relatedSource = sources.get(relatedSpan.path) ?? "";
        return [{
          location: {
            uri: pathToFileUri(relatedSpan.path),
            range: relatedSource ? spanRange(relatedSource, relatedSpan) : startRange,
          },
          message: related.label,
        }];
      });
      return {
        path,
        diagnostic: {
          range: span && source ? spanRange(source, span) : startRange,
          severity: 1,
          code: diagnostic.code,
          source: "wm-mini",
          message: diagnostic.message,
          relatedInformation: relatedInformation.length ? relatedInformation : undefined,
        },
      };
    }
    const span = interfaceInput.spans.find((candidate) =>
      candidate.id === interfaceInput.root.selectorSpanId
    );
    const path = span?.path ?? headPath;
    const source = sources.get(path) ?? "";
    return {
      path,
      diagnostic: {
        range: span && source ? spanRange(source, span) : startRange,
        severity: 2,
        code: "gpu.type.unresolved",
        source: "wm-mini",
        message: `GPU type elaboration is unresolved: ${errorMessage(error)}. ` +
          'Hover inside this shader will show "unresolved GPU type".',
      },
    };
  }
}

const defaultFrontendV2ModuleUrl = new URL(
  "../generated/frontend_v2_parser.js",
  import.meta.url,
);

function structuralDiagnosticsFor(
  frontend: Pick<FrontendV2Surface, "parseSurfaceProgram"> | undefined,
  source: string,
  uri: string,
  validationOptions: ValidationOptions,
): LspDiagnostic[] {
  if (!frontend) return [];
  const version = validationOptions.documentVersion?.(uri);
  const surface = validationOptions.frontendV2ParseCache
    ? validationOptions.frontendV2ParseCache.surface(uri, source, version, frontend)
    : frontend.parseSurfaceProgram(source);
  return surfaceRecoveryDiagnostics(source, surface);
}

function diagnosticsFor(
  diagnostics: readonly FrontendDiagnostic[],
  source = "",
  uri = "",
): LspDiagnostic[] {
  return diagnostics.map((diagnostic) => lspDiagnostic(diagnostic, source, uri));
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
    code: compilerErrorCode(error) ?? classifyDiagnostic(message),
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
  if (!error || typeof error !== "object") return undefined;
  const direct = "span" in error ? (error as { span?: unknown }).span : undefined;
  const subject = "subject" in error ? (error as { subject?: unknown }).subject : undefined;
  const span = direct ?? subjectSpan(subject);
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

function subjectSpan(subject: unknown): unknown {
  if (!subject || typeof subject !== "object" || !("node" in subject)) return undefined;
  const node = (subject as { node?: unknown }).node;
  if (!node || typeof node !== "object" || !("span" in node)) return undefined;
  return (node as { span?: unknown }).span;
}

function compilerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
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
    return runtime.realPathSync(path);
  } catch {
    return sourceOverrides.has(path) ? path : path;
  }
}

async function sourceForPath(path: string, sourceOverrides: Map<string, string>): Promise<string> {
  const override = sourceOverrides.get(path);
  if (override !== undefined) return override;
  try {
    const real = runtime.realPathSync(path);
    const realOverride = sourceOverrides.get(real);
    if (realOverride !== undefined) return realOverride;
  } catch {
    // Fall through to reading the original path.
  }
  try {
    return await runtime.readTextFile(path);
  } catch {
    return "";
  }
}

type PeggyLocation = Parameters<typeof peggyLocationRange>[0];
type SourceSpanLike = Parameters<typeof spanRange>[1];
