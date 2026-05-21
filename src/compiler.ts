import { fileURLToPath, pathToFileURL } from "node:url";
import type { Module } from "./ast.ts";
import { emitBundle, emitModule } from "./emit.ts";
import { inferModule, inferModuleWithSteps, type InferResult, type InferStep } from "./infer.ts";
import { parse, type Surface } from "./parser.ts";

export type CompileOptions = { check?: boolean; surface?: Surface };

export async function compile(source: string, options: CompileOptions = {}): Promise<string> {
  const ast = await parse(source, options.surface);
  if (options.check ?? true) checkModuleWithoutImports(ast);
  return emitModule(ast);
}

export type CheckSourceOptions = { surface?: Surface };

export async function checkSource(
  source: string,
  options: CheckSourceOptions = {},
): Promise<InferResult> {
  return checkModuleWithoutImports(await parse(source, options.surface));
}

export async function checkSourceSteps(
  source: string,
  options: CheckSourceOptions = {},
): Promise<InferStep[]> {
  const module = await parse(source, options.surface);
  if (module.decls.some((decl) => decl.kind === "ImportDecl")) {
    throw new Error("source strings with imports require checkFile");
  }
  return inferModuleWithSteps(module).steps;
}

export async function compileFile(input: string, options: CompileOptions = {}): Promise<string> {
  const { entryPath, graph, names } = await analyzeFile(input);
  const entry = graph.get(entryPath)!;
  if (!(options.check ?? true)) return emitModule(entry);
  const importedUnits = [...graph.entries()]
    .filter(([path]) => path !== entryPath)
    .map(([path, module]) => ({
      name: names.get(path) ?? `Module_${Math.abs(hash(path))}`,
      module,
    }));
  return emitBundle(importedUnits, entry);
}

export async function checkFile(input: string): Promise<Map<string, InferResult>> {
  return (await analyzeFile(input)).results;
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

function checkModuleWithoutImports(module: Module): InferResult {
  if (module.decls.some((decl) => decl.kind === "ImportDecl")) {
    throw new Error("source strings with imports require checkFile");
  }
  return inferModule(module);
}

async function analyzeFile(input: string): Promise<{
  entryPath: string;
  graph: Map<string, Module>;
  names: Map<string, string>;
  results: Map<string, InferResult>;
}> {
  const entryPath = await Deno.realPath(normalizeInputPath(input));
  const graph = new Map<string, Module>();
  const names = new Map<string, string>();
  await loadModule(entryPath, graph, names, new Set());
  const results = new Map<string, InferResult>();
  for (const [path, module] of graph) {
    const imports = new Map<string, InferResult>();
    for (const decl of module.decls) {
      if (decl.kind === "ImportDecl") {
        imports.set(decl.path, results.get(await resolveImportPath(path, decl.path))!);
      }
    }
    results.set(path, inferModule(module, imports));
  }
  return { entryPath, graph, names, results };
}

async function loadModule(
  path: string,
  graph: Map<string, Module>,
  names: Map<string, string>,
  visiting: Set<string>,
) {
  if (graph.has(path)) return;
  if (visiting.has(path)) throw new Error(`import cycle involving ${path}`);
  visiting.add(path);
  const module = await parse(await Deno.readTextFile(path));
  for (const decl of module.decls) {
    if (decl.kind === "ImportDecl") {
      const child = await resolveImportPath(path, decl.path);
      const alias = decl.clause.kind === "Namespace"
        ? decl.clause.alias
        : fallbackModuleName(child);
      names.set(child, names.get(child) ?? alias);
      await loadModule(child, graph, names, visiting);
    }
  }
  visiting.delete(path);
  graph.set(path, module);
}

function resolveImport(fromPath: string, specifier: string): string {
  return fileURLToPath(new URL(specifier, pathToFileURL(fromPath)));
}

async function resolveImportPath(fromPath: string, specifier: string): Promise<string> {
  return await Deno.realPath(resolveImport(fromPath, specifier));
}

function hash(text: string): number {
  let n = 0;
  for (const c of text) n = (n * 31 + c.charCodeAt(0)) | 0;
  return n;
}

function fallbackModuleName(path: string): string {
  const stem = path.split("/").at(-1)?.replace(/\.wm$/, "") || "Module";
  const name = stem.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `Module_${name}`;
}
