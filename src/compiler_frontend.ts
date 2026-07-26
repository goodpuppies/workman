import type { Module } from "./ast.ts";
import { genericDiagnostic, type FrontendDiagnostic } from "./diagnostics.ts";
import { compareSupportedFrontendSemantics } from "./frontend_v2_compare.ts";
import { loadFrontendV2 } from "./frontend_v2_loader.ts";
import { semanticProjectionToModule } from "./frontend_v2_semantic.ts";
import type { FrontendMode } from "./frontend_mode.ts";
import { parse, ParseError, type Surface } from "./parser.ts";
import { offsetToLineCol } from "./source.ts";
import { maskSourceRange, topLevelPhraseRanges } from "./top_level_phrases.ts";

export type CompilerFrontendOptions = {
  surface?: Surface;
  frontend?: FrontendMode;
  frontendV2ModuleUrl?: string | URL;
};

export type RecoveredCompilerModule = Readonly<{
  module: Module;
  syntax: "complete" | "recovered";
  diagnostics: readonly FrontendDiagnostic[];
  recoveryBoundaries: readonly Readonly<{ start: number; end: number }>[];
  importRecoveryBoundaries: readonly Readonly<{ start: number; end: number }>[];
}>;

const defaultFrontendV2ModuleUrl = new URL(
  "../tooling/frontend-v2/frontend-v2.generated.mjs",
  import.meta.url,
);

export async function parseCompilerModule(
  source: string,
  options: CompilerFrontendOptions = {},
  filePath?: string,
): Promise<Module> {
  const mode = options.frontend ?? "v1";
  if (mode === "v1") return parse(source, options.surface, filePath);

  if (mode === "compare") {
    const frontend = await loadFrontendV2(
      options.frontendV2ModuleUrl ?? defaultFrontendV2ModuleUrl,
    );
    const comparison = await compareSupportedFrontendSemantics(source, frontend, {
      surface: options.surface,
    });
    if (!comparison.equivalent) {
      throw new Error(
        `frontend compare mode found differences: ${comparison.diagnostics.join("; ")}`,
      );
    }
    return parse(source, options.surface, filePath);
  }

  if (mode === "v2") {
    const frontend = await loadFrontendV2(
      options.frontendV2ModuleUrl ?? defaultFrontendV2ModuleUrl,
    );
    const projected = semanticProjectionToModule(frontend.projectSemantic(source), {
      source,
      structural: frontend.parseStructural(source),
    });
    if (projected.diagnostics.length) {
      throw new Error(
        `frontend v2 cannot project source: ${
          projected.diagnostics.map((diagnostic) => diagnostic.message).join("; ")
        }`,
      );
    }
    return projected.module;
  }

  throw new Error(`unknown frontend mode ${String(mode)}`);
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
  } catch {
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
}

function parseRecoveryDiagnostic(
  error: unknown,
  source: string,
  fallbackOffset: number,
): FrontendDiagnostic {
  const span = error instanceof ParseError
    ? error.span
    : {
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
