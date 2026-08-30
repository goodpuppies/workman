import { normalize, posix, resolve } from "node:path";
import {
  analyzeDetachedFile,
  analyzeFile,
  analyzeRecoveredFile,
  analyzeStrictDetachedFile,
  ModuleAnalysisError,
} from "../compiler.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { FrontendDiagnosticError, genericDiagnostic } from "../diagnostics.ts";
import { resolveCompilerFrontend } from "../frontend_mode.ts";
import { runtime } from "../io.ts";
import type { ModuleInterface, ProjectSnapshot } from "../module_interface.ts";
import { ProjectContextRegistry, type ReverseImportDiscoveryIndex } from "../project_context.ts";
import { fileUriToPath } from "./uri.ts";
import { type SemanticDocumentContext, semanticSourceForPath } from "./semantic_context.ts";

export type SemanticServiceInputs = Readonly<{
  sourceOverrides: () => Map<string, string>;
  frontendOptions: () => CompilerFrontendOptions;
}>;

/**
 * LSP-owned lifetime for compiler project snapshots.
 *
 * Project selection is delegated to ProjectContextRegistry. Queries share the selected immutable
 * snapshot until an affected path is explicitly invalidated.
 */
export class SemanticService {
  readonly registry: ProjectContextRegistry;
  #strictFailures = new WeakMap<ProjectSnapshot, unknown>();
  #recoveryHoles = new WeakMap<ProjectSnapshot, readonly SemanticRecoveryHole[]>();
  #recoveryHints = new Map<string, RecoveryHint>();
  #operationTail: Promise<void> = Promise.resolve();

  constructor(
    discovery: ReverseImportDiscoveryIndex,
    readonly inputs: SemanticServiceInputs,
  ) {
    this.registry = new ProjectContextRegistry(discovery);
  }

  async documentContext(
    uri: string,
    rememberDocument = true,
  ): Promise<SemanticDocumentContext | null> {
    return await this.#serialize(() => this.#documentContext(uri, rememberDocument));
  }

  async #documentContext(
    uri: string,
    rememberDocument: boolean,
  ): Promise<SemanticDocumentContext | null> {
    const path = canonicalPath(fileUriToPath(uri));
    const options = this.inputs.frontendOptions();
    const sourceOverrides = this.inputs.sourceOverrides();
    const configuration = configurationKey(options);
    let recovered = false;
    const select = rememberDocument
      ? this.registry.openDocument.bind(this.registry)
      : this.registry.contextForPath.bind(this.registry);
    const selection = await select(
      path,
      configuration,
      async (head) => {
        const speculative = speculativeMatchArmHole(
          head,
          sourceOverrides,
          this.#recoveryHints.get(head),
        );
        if (speculative) {
          try {
            const patchedOverrides = new Map(sourceOverrides);
            patchedOverrides.set(head, speculative.source);
            const snapshot = (await analyzeFile(head, {
              ...options,
              sourceOverrides: patchedOverrides,
            })).projectSnapshot;
            this.#strictFailures.set(snapshot, recoveryHoleError(speculative.hole));
            this.#recoveryHoles.set(snapshot, Object.freeze([speculative.hole]));
            recovered = true;
            return snapshot;
          } catch {
            // The empty arm was not the only blocker; use ordinary strict/recovered analysis.
          }
        }
        try {
          return (await analyzeFile(head, { ...options, sourceOverrides })).projectSnapshot;
        } catch (error) {
          recovered = true;
          const synthetic = syntheticMatchArmHole(head, sourceOverrides, error);
          if (synthetic) {
            const patchedOverrides = new Map(sourceOverrides);
            patchedOverrides.set(head, synthetic.source);
            const snapshot = (await analyzeFile(head, {
              ...options,
              sourceOverrides: patchedOverrides,
            })).projectSnapshot;
            this.#recoveryHints.set(head, synthetic.hint);
            this.#strictFailures.set(snapshot, error);
            this.#recoveryHoles.set(snapshot, Object.freeze([synthetic.hole]));
            return snapshot;
          }
          const snapshot = await analyzeRecoveredFile(head, { ...options, sourceOverrides });
          this.#strictFailures.set(snapshot, error);
          return snapshot;
        }
      },
      async (document) => {
        const speculative = speculativeMatchArmHole(
          document,
          sourceOverrides,
          this.#recoveryHints.get(document),
        );
        if (speculative) {
          try {
            const patchedOverrides = new Map(sourceOverrides);
            patchedOverrides.set(document, speculative.source);
            const snapshot = (await analyzeStrictDetachedFile(document, {
              ...options,
              sourceOverrides: patchedOverrides,
            })).projectSnapshot;
            this.#strictFailures.set(snapshot, recoveryHoleError(speculative.hole));
            this.#recoveryHoles.set(snapshot, Object.freeze([speculative.hole]));
            recovered = true;
            return snapshot;
          } catch {
            // The empty arm was not the only blocker; use ordinary strict/recovered analysis.
          }
        }
        try {
          return (await analyzeStrictDetachedFile(document, {
            ...options,
            sourceOverrides,
          })).projectSnapshot;
        } catch (error) {
          recovered = true;
          const synthetic = syntheticMatchArmHole(document, sourceOverrides, error);
          if (synthetic) {
            const patchedOverrides = new Map(sourceOverrides);
            patchedOverrides.set(document, synthetic.source);
            const snapshot = (await analyzeStrictDetachedFile(document, {
              ...options,
              sourceOverrides: patchedOverrides,
            })).projectSnapshot;
            this.#recoveryHints.set(document, synthetic.hint);
            this.#strictFailures.set(snapshot, error);
            this.#recoveryHoles.set(snapshot, Object.freeze([synthetic.hole]));
            return snapshot;
          }
          const snapshot = await analyzeDetachedFile(document, {
            ...options,
            sourceOverrides,
          });
          this.#strictFailures.set(snapshot, error);
          return snapshot;
        }
      },
    );
    recovered ||= this.#strictFailures.has(selection.snapshot);
    const moduleInterface = interfaceForPath(selection.snapshot, path);
    if (!moduleInterface) {
      if (!rememberDocument) this.registry.releaseUnselectedContexts();
      return null;
    }
    const source = await semanticSourceForPath(moduleInterface.path, sourceOverrides);
    const context = source === undefined ? null : Object.freeze({
      project: selection.snapshot,
      moduleInterface,
      source,
      recovered,
      recoveryHoles: this.recoveryHoles(selection.snapshot),
    });
    if (!rememberDocument) this.registry.releaseUnselectedContexts();
    return context;
  }

  async invalidatePaths(paths: Iterable<string>): Promise<void> {
    const captured = [...paths];
    await this.#serialize(() => {
      this.registry.invalidatePaths(captured);
    });
  }

  async invalidateUris(uris: Iterable<string>): Promise<void> {
    await this.invalidatePaths([...uris].map((uri) => fileUriToPath(uri)));
  }

  async closeDocument(uri: string): Promise<void> {
    await this.#serialize(() => {
      this.registry.forgetDocument(
        fileUriToPath(uri),
        configurationKey(this.inputs.frontendOptions()),
      );
    });
  }

  openSnapshots(): readonly ProjectSnapshot[] {
    return this.registry.openSnapshots();
  }

  strictFailure(project: ProjectSnapshot): unknown | undefined {
    return this.#strictFailures.get(project);
  }

  recoveryHoles(project: ProjectSnapshot): readonly SemanticRecoveryHole[] {
    return this.#recoveryHoles.get(project) ?? [];
  }

  #serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

type SemanticRecoveryHole = Readonly<{
  id: number;
  anchor: number;
  diagnosticCode: string;
}>;

type RecoveryHint = Readonly<{ armPrefix: string }>;

function speculativeMatchArmHole(
  path: string,
  sourceOverrides: Map<string, string>,
  hint: RecoveryHint | undefined,
): { source: string; hole: SemanticRecoveryHole } | undefined {
  if (!hint) return undefined;
  const source = sourceOverrides.get(path);
  if (source === undefined) return undefined;
  const emptyArm = /=>\s*\{(\s+)\}/g;
  const matches = [...source.matchAll(emptyArm)];
  const match = matches.find((candidate) => armPrefix(source, candidate.index!) === hint.armPrefix);
  if (!match) return undefined;
  return syntheticSource(source, match);
}

function syntheticMatchArmHole(
  path: string,
  sourceOverrides: Map<string, string>,
  error: unknown,
): { source: string; hole: SemanticRecoveryHole; hint: RecoveryHint } | undefined {
  const cause = error instanceof ModuleAnalysisError ? error.originalError : error;
  if (
    !(cause instanceof FrontendDiagnosticError) ||
    cause.diagnostic.code !== "type.match-arm-results-disagree" ||
    cause.diagnostic.primary.kind !== "source"
  ) return undefined;
  const source = sourceOverrides.get(path);
  if (source === undefined) return undefined;
  const primary = cause.diagnostic.primary.span;
  const match = [...source.matchAll(/=>\s*\{(\s+)\}/g)].find((candidate) =>
    candidate.index !== undefined && candidate.index < primary.end &&
    candidate.index + candidate[0].length > primary.start
  );
  if (!match || match.index === undefined) return undefined;
  const synthetic = syntheticSource(source, match);
  if (!synthetic) return undefined;
  return { ...synthetic, hint: { armPrefix: armPrefix(source, match.index) } };
}

function syntheticSource(source: string, match: RegExpMatchArray) {
  const close = match.index! + match[0].lastIndexOf("}");
  const anchor = close - 1;
  if (!/\s/.test(source[anchor] ?? "")) return undefined;
  return {
    source: source.slice(0, anchor) + "?" + source.slice(anchor + 1),
    hole: Object.freeze({
      id: anchor,
      anchor,
      diagnosticCode: "type.match-arm-results-disagree",
    }),
  };
}

function armPrefix(source: string, arrow: number): string {
  const lineStart = Math.max(source.lastIndexOf("\n", arrow), source.lastIndexOf(",", arrow)) + 1;
  return source.slice(lineStart, arrow).trim();
}

function recoveryHoleError(hole: SemanticRecoveryHole): FrontendDiagnosticError {
  return new FrontendDiagnosticError(
    genericDiagnostic(
      "error",
      hole.diagnosticCode,
      "Empty match arm conflicts with the other arm results; editor analysis inserted `?`.",
      { id: hole.id, span: { line: 1, col: 0, start: hole.anchor, end: hole.anchor } },
    ),
  );
}

function interfaceForPath(
  project: ProjectSnapshot,
  path: string,
): ModuleInterface | undefined {
  const canonical = canonicalPath(path);
  return [...project.interfaces.values()].find((item) => canonicalPath(item.path) === canonical);
}

function configurationKey(options: CompilerFrontendOptions): string {
  return JSON.stringify({
    frontend: resolveCompilerFrontend(options.frontend, options.surface),
    surface: options.surface ?? "workman",
    frontendV2ModuleUrl: options.frontendV2ModuleUrl?.toString(),
  });
}

function canonicalPath(path: string): string {
  if (runtime.platform === "win32" && path.startsWith("/") && !/^\/[A-Za-z]:\//.test(path)) {
    return posix.normalize(path);
  }
  return normalize(resolve(path));
}
