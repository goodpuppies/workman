import { normalize, resolve } from "node:path";
import {
  analyzeDetachedFile,
  analyzeFile,
  analyzeRecoveredFile,
  analyzeStrictDetachedFile,
} from "../compiler.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { resolveCompilerFrontend } from "../frontend_mode.ts";
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
        try {
          return (await analyzeFile(head, { ...options, sourceOverrides })).projectSnapshot;
        } catch (error) {
          recovered = true;
          const snapshot = await analyzeRecoveredFile(head, { ...options, sourceOverrides });
          this.#strictFailures.set(snapshot, error);
          return snapshot;
        }
      },
      async (document) => {
        try {
          return (await analyzeStrictDetachedFile(document, {
            ...options,
            sourceOverrides,
          })).projectSnapshot;
        } catch (error) {
          recovered = true;
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

  #serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
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
  return normalize(resolve(path));
}
