import { fileURLToPath, pathToFileURL } from "node:url";
import type { ImportClause, Module } from "./ast.ts";
import { diagnosticError } from "./diagnostics.ts";
import { parse, type Surface } from "./parser.ts";

export type VirtualFileSystem = Map<string, string>;

export type ModuleGraphOptions = {
  surface?: Surface;
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
  const module = await parse(source, ctx.options.surface, path);
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
  const normalized = normalizeInputPath(path);
  return options.sourceOverrides?.get(path) ??
    options.sourceOverrides?.get(normalized) ??
    options.virtualFs?.get(path) ??
    options.virtualFs?.get(normalized) ??
    await Deno.readTextFile(path);
}

function importEmitName(path: string, clause: ImportClause): string {
  return clause.kind === "Namespace" ? clause.alias : fallbackModuleName(path);
}

function normalizeInputPath(input: string): string {
  if (Deno.build.os !== "windows") return input;
  const raw = /^\/[A-Za-z]:\//.test(input) ? input.slice(1) : input;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function resolveEntryPath(input: string, options: ModuleGraphOptions): Promise<string> {
  const normalized = normalizeInputPath(input);
  try {
    return await Deno.realPath(normalized);
  } catch (error) {
    if (options.sourceOverrides?.has(normalized) || options.virtualFs?.has(normalized)) {
      return normalized;
    }
    throw error;
  }
}

function resolveImport(fromPath: string, specifier: string): string {
  return fileURLToPath(new URL(specifier, pathToFileURL(fromPath)));
}

async function resolveImportPath(fromPath: string, specifier: string, options: ModuleGraphOptions): Promise<string> {
  const resolved = resolveImport(fromPath, specifier);
  const normalized = normalizeInputPath(resolved);
  try {
    return await Deno.realPath(resolved);
  } catch {
    // Check if it exists in virtual FS or sourceOverrides
    if (options.sourceOverrides?.has(normalized) || options.virtualFs?.has(normalized)) {
      return normalized;
    }
    throw new Error(`cannot resolve import ${specifier}`);
  }
}

function fallbackModuleName(path: string): string {
  const stem = path.split(/[\\/]/).at(-1)?.replace(/\.wm$/, "") || "Module";
  const name = stem.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `Module_${name}`;
}
