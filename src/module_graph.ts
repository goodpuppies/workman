import { fileURLToPath, pathToFileURL } from "node:url";
import { posix } from "node:path";
import type { ImportClause, Module } from "./ast.ts";
import { type CompilerFrontendOptions, parseCompilerModule } from "./compiler_frontend.ts";
import { diagnosticError } from "./diagnostics.ts";
import { runtime } from "./io.ts";

export type VirtualFileSystem = Map<string, string>;

export type ModuleGraphOptions = CompilerFrontendOptions & {
  sourceOverrides?: Map<string, string>;
  virtualFs?: VirtualFileSystem;
};

export type ModuleImportEdge = {
  specifier: string;
  path: string;
  clause: ImportClause;
};

export type ModuleNode = {
  path: string;
  source: string;
  module: Module;
  imports: ModuleImportEdge[];
  emitName: string;
};

export type ModuleGraph = {
  entry: string;
  order: string[];
  nodes: Map<string, ModuleNode>;
};

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
  visiting: Set<string>;
  nodes: Map<string, ModuleNode>;
  order: string[];
  names: Map<string, string>;
};

export async function loadModuleGraph(
  input: string,
  options: ModuleGraphOptions = {},
): Promise<ModuleGraph> {
  const entry = await resolveEntryPath(input, options);
  const ctx: LoadContext = {
    options,
    visiting: new Set(),
    nodes: new Map(),
    order: [],
    names: new Map([[entry, fallbackModuleName(entry)]]),
  };
  await visitModule(entry, ctx);
  return { entry, order: ctx.order, nodes: ctx.nodes };
}

async function visitModule(path: string, ctx: LoadContext) {
  if (ctx.nodes.has(path)) return;
  if (ctx.visiting.has(path)) throw new Error(`import cycle involving ${path}`);
  ctx.visiting.add(path);

  const source = await readModuleSource(path, ctx.options);
  const module = await parseCompilerModule(source, ctx.options, path);
  const imports: ModuleImportEdge[] = [];
  for (const decl of module.decls) {
    if (decl.kind !== "ImportDecl") continue;
    let child: string;
    try {
      child = await resolveImportPath(path, decl.path, ctx.options);
    } catch {
      throw new ModuleGraphDiagnosticError(
        path,
        source,
        diagnosticError(
          new Error(`cannot resolve import ${decl.path}`),
          decl.pathNode ?? decl.node,
          "module.resolve-import",
        ),
      );
    }
    if (ctx.visiting.has(child)) {
      throw new ModuleGraphDiagnosticError(
        path,
        source,
        diagnosticError(
          new Error(`import cycle involving ${child}`),
          decl.pathNode ?? decl.node,
          "module.import-cycle",
        ),
      );
    }
    imports.push({ specifier: decl.path, path: child, clause: decl.clause });
    ctx.names.set(child, ctx.names.get(child) ?? importEmitName(child, decl.clause));
    await visitModule(child, ctx);
  }

  ctx.visiting.delete(path);
  ctx.nodes.set(path, {
    path,
    source,
    module,
    imports,
    emitName: ctx.names.get(path) ?? fallbackModuleName(path),
  });
  ctx.order.push(path);
}

async function readModuleSource(path: string, options: ModuleGraphOptions): Promise<string> {
  return getVirtualSource(path, options) ??
    await runtime.readTextFile(path);
}

function importEmitName(path: string, clause: ImportClause): string {
  return clause.kind === "Namespace" ? clause.alias : fallbackModuleName(path);
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

async function resolveEntryPath(input: string, options: ModuleGraphOptions): Promise<string> {
  const normalized = normalizeInputPath(input);
  const virtualPath = findVirtualPath(input, options);
  if (virtualPath) return virtualPath;
  try {
    return await runtime.realPath(normalized);
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

async function resolveImportPath(
  fromPath: string,
  specifier: string,
  options: ModuleGraphOptions,
): Promise<string> {
  const resolved = resolveImport(fromPath, specifier);
  const normalized = normalizeInputPath(resolved);
  const virtualPath = findVirtualPath(resolved, options);
  if (virtualPath) return virtualPath;
  try {
    return await runtime.realPath(resolved);
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
  return await resolveImportPath(fromPath, specifier, options);
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

function fallbackModuleName(path: string): string {
  const stem = path.split(/[\\/]/).at(-1)?.replace(/\.wm$/, "") || "Module";
  const name = stem.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `Module_${name}`;
}
