import { fileURLToPath, pathToFileURL } from "node:url";
import type { Module } from "./ast.ts";
import { emitBundle, emitModule } from "./emit.ts";
import { inferModule, type InferResult } from "./infer.ts";
import { parse } from "./parser.ts";

export type CompileOptions = { check?: boolean };

export async function compile(source: string, options: CompileOptions = {}): Promise<string> {
  const ast = await parse(source);
  if (options.check ?? true) inferModule(ast);
  return emitModule(ast);
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

async function analyzeFile(input: string): Promise<{
  entryPath: string;
  graph: Map<string, Module>;
  names: Map<string, string>;
  results: Map<string, InferResult>;
}> {
  const entryPath = await Deno.realPath(input);
  const graph = new Map<string, Module>();
  const names = new Map<string, string>();
  await loadModule(entryPath, graph, names, new Set());
  const results = new Map<string, InferResult>();
  for (const [path, module] of graph) {
    const imports = new Map<string, InferResult>();
    for (const decl of module.decls) {
      if (decl.kind === "ImportDecl") {
        imports.set(decl.alias, results.get(await resolveImportPath(path, decl.path))!);
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
      names.set(child, names.get(child) ?? decl.alias);
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
