import { fileURLToPath, pathToFileURL } from "node:url";
import { posix } from "node:path";
import type { ImportClause, Module } from "./ast.ts";
import {
  type CompilerFrontendOptions,
  parseCompilerModule,
  parseCompilerModuleRecovered,
} from "./compiler_frontend.ts";
import { diagnosticError, type FrontendDiagnostic } from "./diagnostics.ts";
import { runtime } from "./io.ts";
import { type ModuleId, moduleId } from "./module_id.ts";
import type { AstNode } from "./source.ts";

export type VirtualFileSystem = Map<string, string>;

export type ModuleGraphOptions = CompilerFrontendOptions & {
  sourceOverrides?: Map<string, string>;
  virtualFs?: VirtualFileSystem;
  syntaxRecovery?: boolean;
  /**
   * Called as each module finishes parsing. Imports are followed depth-first,
   * so the final count is not known until the graph closes — this reports how
   * many are done, not a fraction.
   */
  onModuleParsed?: (loaded: number, path: string) => void;
  /** Called when the compiler enters a named stage, for CLI progress output. */
  onStage?: (name: string) => void;
  /** Called as each module clears an analysis phase. */
  onAnalysisProgress?: (done: number, total: number, phase: string) => void;
};

export type ModuleImportEdge = {
  referrer: ModuleId;
  specifier: string;
  specifierNode?: AstNode;
  target: ModuleId;
  /** Compatibility/source-display path; semantic consumers use target. */
  path: string;
  clause: ImportClause;
};

export type ModuleNode = {
  id: ModuleId;
  /** Compatibility/source-display path; semantic consumers use id. */
  path: string;
  source: string;
  module: Module;
  imports: ModuleImportEdge[];
  emitName: string;
  syntaxStatus?: "complete" | "recovered";
  syntaxDiagnostics?: readonly FrontendDiagnostic[];
  syntaxRecoveryBoundaries?: readonly Readonly<{ start: number; end: number }>[];
  importDiagnostics?: readonly FrontendDiagnostic[];
  importRecoveryBoundaries?: readonly Readonly<{ start: number; end: number }>[];
};

export type ModuleGraph = {
  entry: ModuleId;
  order: ModuleId[];
  nodes: Map<ModuleId, ModuleNode>;
};

/** Compatibility lookup for diagnostics and document APIs that still carry source paths. */
export function moduleNodeForPath(graph: ModuleGraph, path: string): ModuleNode | undefined {
  return [...graph.nodes.values()].find((node) => node.path === path);
}

export class ModuleGraphDiagnosticError extends Error {
  path: string;
  source: string;
  originalError: unknown;

  constructor(path: string, source: string, originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = "ModuleGraphDiagnosticError";
    this.path = path;
    this.source = source;
    this.originalError = originalError;
  }
}

type LoadContext = {
  options: ModuleGraphOptions;
  visiting: Set<ModuleId>;
  stack: ModuleId[];
  nodes: Map<ModuleId, ModuleNode>;
  paths: Map<ModuleId, string>;
  order: ModuleId[];
  parsed: number;
};

type ResolvedModule = { id: ModuleId; path: string };

export async function loadModuleGraph(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<ModuleGraph> {
  const entry = await resolveEntryPath(input, options);
  const ctx: LoadContext = {
    options,
    visiting: new Set(),
    stack: [],
    nodes: new Map(),
    paths: new Map([[entry.id, entry.path]]),
    order: [],
    parsed: 0,
  };
  await visitModule(entry.id, ctx);
  ctx.order.forEach((id, index) => {
    ctx.nodes.get(id)!.emitName = `__wm_module_${index}`;
  });
  return { entry: entry.id, order: ctx.order, nodes: ctx.nodes };
}

async function visitModule(id: ModuleId, ctx: LoadContext) {
  if (ctx.nodes.has(id)) return;
  if (ctx.visiting.has(id)) throw new Error(importCycleMessage(ctx.stack, id, ctx));
  ctx.visiting.add(id);
  ctx.stack.push(id);

  const path = ctx.paths.get(id)!;
  const source = await readModuleSource(path, ctx.options);
  const parsed = ctx.options.syntaxRecovery
    ? await parseCompilerModuleRecovered(source, ctx.options, path)
    : {
      module: await parseCompilerModule(source, ctx.options, path),
      syntax: "complete" as const,
      diagnostics: [] as readonly FrontendDiagnostic[],
      recoveryBoundaries: [] as readonly Readonly<{ start: number; end: number }>[],
      importRecoveryBoundaries: [] as readonly Readonly<{ start: number; end: number }>[],
    };
  const module = parsed.module;
  ctx.parsed++;
  ctx.options.onModuleParsed?.(ctx.parsed, path);
  const importDiagnostics: FrontendDiagnostic[] = [];
  const importRecoveryBoundaries: { start: number; end: number }[] = [];
  const failedImports = new Set<Module["decls"][number]>();
  const imports: ModuleImportEdge[] = [];
  for (const decl of module.decls) {
    if (decl.kind !== "ImportDecl") continue;
    if (isJavaScriptModuleSpecifier(decl.path)) {
      const error = diagnosticError(
        new Error(
          `JavaScript and TypeScript modules use js.module(...); try: from js.module("${decl.path}") import ...`,
        ),
        decl.pathNode ?? decl.node,
        "module.javascript-import-syntax",
      );
      if (ctx.options.syntaxRecovery) {
        importDiagnostics.push(error.diagnostic);
        addImportRecoveryBoundary(importRecoveryBoundaries, decl);
        failedImports.add(decl);
        continue;
      }
      throw new ModuleGraphDiagnosticError(
        path,
        source,
        error,
      );
    }
    let child: ResolvedModule;
    try {
      child = await resolveImportPath(path, decl.path, ctx.options);
    } catch {
      const error = diagnosticError(
        new Error(`cannot resolve import ${decl.path}`),
        decl.pathNode ?? decl.node,
        "module.resolve-import",
      );
      if (ctx.options.syntaxRecovery) {
        importDiagnostics.push(error.diagnostic);
        addImportRecoveryBoundary(importRecoveryBoundaries, decl);
        failedImports.add(decl);
        continue;
      }
      throw new ModuleGraphDiagnosticError(
        path,
        source,
        error,
      );
    }
    ctx.paths.set(child.id, child.path);
    if (ctx.visiting.has(child.id)) {
      const error = diagnosticError(
        new Error(importCycleMessage(ctx.stack, child.id, ctx)),
        decl.pathNode ?? decl.node,
        "module.import-cycle",
      );
      if (ctx.options.syntaxRecovery) {
        importDiagnostics.push(error.diagnostic);
        addImportRecoveryBoundary(importRecoveryBoundaries, decl);
        failedImports.add(decl);
        continue;
      }
      throw new ModuleGraphDiagnosticError(
        path,
        source,
        error,
      );
    }
    imports.push({
      referrer: id,
      specifier: decl.path,
      specifierNode: decl.pathNode ?? decl.node,
      target: child.id,
      path: child.path,
      clause: decl.clause,
    });
    await visitModule(child.id, ctx);
  }

  ctx.stack.pop();
  ctx.visiting.delete(id);
  ctx.nodes.set(id, {
    id,
    path,
    source,
    module: failedImports.size === 0
      ? module
      : { ...module, decls: module.decls.filter((decl) => !failedImports.has(decl)) },
    imports,
    emitName: "",
    syntaxStatus: parsed.syntax,
    syntaxDiagnostics: parsed.diagnostics,
    syntaxRecoveryBoundaries: parsed.recoveryBoundaries,
    importDiagnostics: Object.freeze(importDiagnostics),
    importRecoveryBoundaries: Object.freeze([
      ...parsed.importRecoveryBoundaries,
      ...importRecoveryBoundaries,
    ]),
  });
  ctx.order.push(id);
}

function addImportRecoveryBoundary(
  output: { start: number; end: number }[],
  declaration: Extract<Module["decls"][number], { kind: "ImportDecl" }>,
): void {
  if (!declaration.node) return;
  output.push({
    start: declaration.node.span.start,
    end: declaration.node.span.end,
  });
}

function importCycleMessage(stack: ModuleId[], repeated: ModuleId, ctx: LoadContext): string {
  const start = stack.indexOf(repeated);
  const cycle = [...stack.slice(start < 0 ? 0 : start), repeated];
  return `import cycle: ${cycle.map((id) => ctx.paths.get(id) ?? "<module>").join(" -> ")}`;
}

async function readModuleSource(path: string, options: ModuleGraphOptions): Promise<string> {
  return getVirtualSource(path, options) ??
    await runtime.readTextFile(path);
}

function normalizeInputPath(input: string): string {
  if (runtime.platform !== "win32") return input;
  const raw = /^\/[A-Za-z]:\//.test(input) ? input.slice(1) : input;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function resolveEntryPath(input: string, options: ModuleGraphOptions): Promise<ResolvedModule> {
  const normalized = normalizeInputPath(input);
  const virtualPath = findVirtualPath(input, options);
  if (virtualPath) return { id: moduleId(virtualPath), path: virtualPath };
  try {
    const path = await runtime.realPath(normalized);
    return { id: moduleId(path), path };
  } catch (error) {
    throw error;
  }
}

function resolveImport(fromPath: string, specifier: string): string {
  if (isPosixVirtualPath(fromPath)) {
    return posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  }
  return fileURLToPath(new URL(specifier, pathToFileURL(fromPath)));
}

function isJavaScriptModuleSpecifier(specifier: string): boolean {
  return /\.[cm]?[jt]sx?(?:[?#].*)?$/i.test(specifier);
}

async function resolveImportPath(
  fromPath: string,
  specifier: string,
  options: ModuleGraphOptions,
): Promise<ResolvedModule> {
  const resolved = resolveImport(fromPath, specifier);
  const normalized = normalizeInputPath(resolved);
  const virtualPath = findVirtualPath(resolved, options);
  if (virtualPath) return { id: moduleId(virtualPath), path: virtualPath };
  try {
    const path = await runtime.realPath(resolved);
    return { id: moduleId(path), path };
  } catch {
    throw new Error(`cannot resolve import ${specifier}`);
  }
}

/** Resolve one Workman module specifier without loading or parsing its graph. */
export async function resolveModuleImportPath(
  fromPath: string,
  specifier: string,
  options: ModuleGraphOptions = {},
): Promise<string> {
  return (await resolveImportPath(fromPath, specifier, options)).path;
}

function getVirtualSource(path: string, options: ModuleGraphOptions): string | undefined {
  for (const candidate of pathCandidates(path)) {
    const override = options.sourceOverrides?.get(candidate);
    if (override !== undefined) return override;
    const virtual = options.virtualFs?.get(candidate);
    if (virtual !== undefined) return virtual;
  }
}

function findVirtualPath(path: string, options: ModuleGraphOptions): string | undefined {
  for (const candidate of pathCandidates(path)) {
    if (options.sourceOverrides?.has(candidate) || options.virtualFs?.has(candidate)) {
      return candidate;
    }
  }
}

function pathCandidates(input: string): string[] {
  const candidates = [input, normalizeInputPath(input)];
  if (runtime.platform === "win32") {
    const withoutDrive = input.match(/^\/[A-Za-z]:(\/.*)$/)?.[1] ??
      input.match(/^[A-Za-z]:(\/.*)$/)?.[1];
    if (withoutDrive) candidates.push(withoutDrive);
  }
  return [...new Set(candidates)];
}

function isPosixVirtualPath(path: string): boolean {
  return path.startsWith("/") && !/^\/[A-Za-z]:\//.test(path);
}
