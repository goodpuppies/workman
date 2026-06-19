import ts from "typescript";
import { fileURLToPath } from "node:url";

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  strictNullChecks: true,
  skipLibCheck: true,
};

const nodeTypesPath = fileURLToPath(import.meta.resolve("npm:@types/node/index.d.ts"));
const denoTypesFile = "/__wm_deno_types.d.ts";
let denoTypesCache: string | undefined;
const sourceFileCache = new Map<string, ts.SourceFile>();
let previousProgram: ts.Program | undefined;

export type JsReflectionSource = { key: string; source: string };

export function jsGlobalSource(path: string): JsReflectionSource {
  if (path === "Deno" || path.startsWith("Deno.")) {
    return {
      key: `global:${path}`,
      source: `/// <reference path="${denoTypesFile}" />\nconst __wm_target = ${path};`,
    };
  }
  return { key: `global:${path}`, source: `const __wm_target = ${path};` };
}

export function jsModuleSource(specifier: string): JsReflectionSource {
  return {
    key: `module:${specifier}`,
    source: `/// <reference path="${nodeTypesPath}" />\nimport * as __wm_target from ${
      JSON.stringify(specifier)
    };`,
  };
}

export function reflectSource<T>(
  label: string,
  source: string,
  read: (
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
  ) => T,
): T {
  const fileName = `/__wm_js_reflect_${sanitize(label)}.ts`;
  const extraFiles = source.includes(denoTypesFile)
    ? new Map([[denoTypesFile, denoTypesSource()]])
    : new Map<string, string>();
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (name === fileName) return cachedSourceFile(name, source, languageVersion);
    const extraSource = extraFiles.get(name);
    if (extraSource !== undefined) return cachedSourceFile(name, extraSource, languageVersion);
    const cacheKey = sourceFileCacheKey(name, languageVersion);
    if (!shouldCreateNewSourceFile) {
      const cached = sourceFileCache.get(cacheKey);
      if (cached) return cached;
    }
    const loaded = originalGetSourceFile.call(
      host,
      name,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    );
    if (loaded && !shouldCreateNewSourceFile) sourceFileCache.set(cacheKey, loaded);
    return loaded;
  };
  const program = ts.createProgram([fileName], compilerOptions, host, previousProgram);
  previousProgram = program;
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) throw new Error(`cannot reflect JS target ${label}`);
  return read(program.getTypeChecker(), sourceFile);
}

function denoTypesSource(): string {
  if (denoTypesCache !== undefined) return denoTypesCache;
  const output = new Deno.Command(Deno.execPath(), {
    args: ["types"],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!output.success) {
    const message = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`cannot load Deno type declarations${message ? `: ${message}` : ""}`);
  }
  denoTypesCache = new TextDecoder().decode(output.stdout);
  return denoTypesCache;
}

function cachedSourceFile(
  name: string,
  source: string,
  languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions,
): ts.SourceFile {
  const cacheKey = `${sourceFileCacheKey(name, languageVersion)}:${source}`;
  const cached = sourceFileCache.get(cacheKey);
  if (cached) return cached;
  const created = ts.createSourceFile(name, source, languageVersion, true);
  sourceFileCache.set(cacheKey, created);
  return created;
}

function sourceFileCacheKey(
  name: string,
  languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions,
): string {
  const version = typeof languageVersion === "number"
    ? languageVersion
    : languageVersion.languageVersion;
  return `${name}:${version}`;
}

export function findVariable(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function findDeclaredValue(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function findCallInitializer(
  sourceFile: ts.SourceFile,
  name: string,
): ts.CallExpression | undefined {
  const initializer = findVariable(sourceFile, name)?.initializer;
  return initializer && ts.isCallExpression(initializer) ? initializer : undefined;
}

export function typeOfSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | undefined {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : undefined;
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
