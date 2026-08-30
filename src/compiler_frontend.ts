import type { Module } from "./ast.ts";
import { type FrontendDiagnostic, genericDiagnostic } from "./diagnostics.ts";
import { loadFrontendV2Surface } from "./frontend_v2_surface_loader.ts";
import { surfaceProgramToModule } from "./frontend_v2_surface_semantic.ts";
import { type FrontendMode, resolveCompilerFrontend } from "./frontend_mode.ts";
import {
  contextualSyntaxError,
  finalizeParsedModule,
  ParseError,
  parseWmsml,
  type Surface,
} from "./parser.ts";
import { offsetToLineCol } from "./source.ts";
import { maskSourceRange, topLevelPhraseRanges } from "./top_level_phrases.ts";
import type { FrontendV2ParseCache } from "./frontend_v2_parse_cache.ts";

export type CompilerFrontendOptions = {
  surface?: Surface;
  frontend?: FrontendMode;
  frontendV2ModuleUrl?: string | URL;
  frontendV2ParseCache?: FrontendV2ParseCache;
};

export type RecoveredCompilerModule = Readonly<{
  module: Module;
  syntax: "complete" | "recovered";
  diagnostics: readonly FrontendDiagnostic[];
  recoveryBoundaries: readonly Readonly<{ start: number; end: number }>[];
  importRecoveryBoundaries: readonly Readonly<{ start: number; end: number }>[];
}>;

const defaultFrontendV2ModuleUrl = new URL(
  "./generated/frontend_v2_parser.js",
  import.meta.url,
);

export async function parseCompilerModule(
  source: string,
  options: CompilerFrontendOptions = {},
  filePath?: string,
): Promise<Module> {
  if (options.surface === "wmsml") return await parseWmsml(source, filePath);
  const mode = resolveCompilerFrontend(options.frontend, options.surface);

  if (mode === "v2") {
    const frontend = await loadFrontendV2Surface(
      options.frontendV2ModuleUrl ?? defaultFrontendV2ModuleUrl,
    );
    const cacheKey = filePath ?? "<source>";
    const surface = options.frontendV2ParseCache
      ? options.frontendV2ParseCache.surface(cacheKey, source, undefined, frontend)
      : frontend.parseSurfaceProgram(source);
    if (!surface) {
      throw generatedParseError(
        source,
        options.frontendV2ParseCache
          ? options.frontendV2ParseCache.failure(cacheKey, source, undefined, frontend)
          : frontend.parseSurfaceFailure(source),
        filePath,
      );
    }
    const projected = surfaceProgramToModule(surface, source);
    if (projected.diagnostics.length) {
      throw new Error(
        `frontend v2 cannot project source: ${
          projected.diagnostics.map((diagnostic) => diagnostic.message).join("; ")
        }`,
      );
    }
    return finalizeParsedModule(projected.module, source, filePath);
  }

  throw new Error(`unknown frontend mode ${String(mode)}`);
}

function generatedParseError(
  source: string,
  failure: Readonly<{ offset: number; expected: string; rule: string }> | undefined,
  filePath?: string,
): ParseError {
  const offset = Math.max(0, Math.min(source.length, failure?.offset ?? 0));
  const position = offsetToLineCol(source, offset);
  const expected = failure?.expected ?? "valid Workman syntax";
  const rule = failure?.rule && !failure.rule.startsWith("<")
    ? ` while parsing ${failure.rule}`
    : "";
  const message = contextualSyntaxError(
    `Expected ${expected}${rule}.`,
    source,
    offset,
  );
  return new ParseError(
    message,
    source,
    {
      line: position.line,
      col: position.col,
      start: offset,
      end: Math.min(source.length, offset + 1),
    },
    filePath,
  );
}

/**
 * Recover at explicit top-level phrase boundaries while preserving authored source offsets.
 *
 * This deliberately does not guess boundaries inside a malformed phrase. Frontend-v2 may provide
 * finer token recovery; this compiler fallback certifies only later semicolon-delimited phrases.
 */
export async function parseCompilerModuleRecovered(
  source: string,
  options: CompilerFrontendOptions = {},
  filePath?: string,
): Promise<RecoveredCompilerModule> {
  try {
    return Object.freeze({
      module: await parseCompilerModule(source, options, filePath),
      syntax: "complete",
      diagnostics: Object.freeze([]),
      recoveryBoundaries: Object.freeze([]),
      importRecoveryBoundaries: Object.freeze([]),
    });
  } catch (initialError) {
    return await targetedPhraseRecovery(source, options, filePath, initialError) ??
      await prefixPhraseRecovery(source, options, filePath);
  }
}

async function targetedPhraseRecovery(
  source: string,
  options: CompilerFrontendOptions,
  filePath: string | undefined,
  initialError: unknown,
): Promise<RecoveredCompilerModule | undefined> {
  const ranges = topLevelPhraseRanges(source);
  const masked = new Set<number>();
  const diagnostics: FrontendDiagnostic[] = [];
  const recoveryBoundaries: { start: number; end: number }[] = [];
  const importRecoveryBoundaries: { start: number; end: number }[] = [];
  let working = source;
  let error = initialError;
  while (error instanceof ParseError) {
    const parseError = error;
    const index = ranges.findIndex((range, candidate) =>
      !masked.has(candidate) && range.start <= parseError.span.start &&
      (parseError.span.start < range.end ||
        (parseError.span.start === source.length && range.end === source.length))
    );
    if (index < 0) return undefined;
    const range = ranges[index];
    masked.add(index);
    diagnostics.push(parseRecoveryDiagnostic(parseError, source, range.start));
    recoveryBoundaries.push({ start: range.start, end: range.end });
    if (source.slice(range.start, range.end).trimStart().startsWith("from ")) {
      importRecoveryBoundaries.push({ start: range.start, end: range.end });
    }
    working = maskSourceRange(working, range.start, range.end);
    try {
      const module = await parseCompilerModule(working, options, filePath);
      return recoveredCompilerModule(
        module,
        diagnostics,
        recoveryBoundaries,
        importRecoveryBoundaries,
      );
    } catch (nextError) {
      error = nextError;
    }
  }
  return undefined;
}

async function prefixPhraseRecovery(
  source: string,
  options: CompilerFrontendOptions,
  filePath?: string,
): Promise<RecoveredCompilerModule> {
  let working = source;
  const diagnostics: FrontendDiagnostic[] = [];
  const recoveryBoundaries: { start: number; end: number }[] = [];
  const importRecoveryBoundaries: { start: number; end: number }[] = [];
  for (const range of topLevelPhraseRanges(source)) {
    try {
      await parseCompilerModule(working.slice(0, range.end), options, filePath);
    } catch (error) {
      diagnostics.push(parseRecoveryDiagnostic(error, source, range.start));
      recoveryBoundaries.push({ start: range.start, end: range.end });
      if (source.slice(range.start, range.end).trimStart().startsWith("from ")) {
        importRecoveryBoundaries.push({ start: range.start, end: range.end });
      }
      working = maskSourceRange(working, range.start, range.end);
    }
  }
  const module = await parseCompilerModule(working, options, filePath);
  return recoveredCompilerModule(
    module,
    diagnostics,
    recoveryBoundaries,
    importRecoveryBoundaries,
  );
}

function recoveredCompilerModule(
  module: Module,
  diagnostics: FrontendDiagnostic[],
  recoveryBoundaries: { start: number; end: number }[],
  importRecoveryBoundaries: { start: number; end: number }[],
): RecoveredCompilerModule {
  return Object.freeze({
    module,
    syntax: "recovered",
    diagnostics: Object.freeze(diagnostics),
    recoveryBoundaries: Object.freeze(
      recoveryBoundaries.map((boundary) => Object.freeze(boundary)),
    ),
    importRecoveryBoundaries: Object.freeze(
      importRecoveryBoundaries.map((boundary) => Object.freeze(boundary)),
    ),
  });
}

function parseRecoveryDiagnostic(
  error: unknown,
  source: string,
  fallbackOffset: number,
): FrontendDiagnostic {
  const span = error instanceof ParseError ? error.span : {
    ...offsetToLineCol(source, fallbackOffset),
    start: fallbackOffset,
    end: Math.min(source.length, fallbackOffset + 1),
  };
  const message = error instanceof Error ? error.message : String(error);
  return genericDiagnostic("error", "parse.recovered-phrase", message, {
    id: -1,
    span,
  });
}
