import ts from "typescript-api";
import { dirname, extname, join, normalize } from "node:path";
import { runtime } from "../../io.ts";

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  strictNullChecks: true,
  skipLibCheck: true,
};

const denoTypesFile = "/__wm_deno_types.d.ts";
const denoTypesReference = `/// <reference path="${denoTypesFile}" />\n`;
let denoTypesCache: string | undefined;
const sourceFileCache = new Map<string, ts.SourceFile>();
const denoModuleGraphs = new Map<string, DenoModuleGraph>();
let previousProgram: ts.Program | undefined;
let activeReflectionBasePath: string | undefined;

export type JsReflectionSource = { key: string; source: string };

export function setActiveJsReflectionBasePath(path: string | undefined): string | undefined {
  const previous = activeReflectionBasePath;
  activeReflectionBasePath = path;
  return previous;
}

export function jsGlobalSource(path: string): JsReflectionSource {
  return {
    key: `global:${path}`,
    source: `${denoTypesReference}const __wm_target = ${path};`,
  };
}

export function jsModuleSource(specifier: string): JsReflectionSource {
  const fileName = activeReflectionBasePath
    ? join(
      dirname(activeReflectionBasePath),
      `__wm_js_reflect_${sanitize(`module_${specifier}`)}.ts`,
    )
    : undefined;
  const sourcePrefix = fileName ? `// @wm-reflect-file ${JSON.stringify(fileName)}\n` : "";
  const keySuffix = fileName ? `@${normalize(fileName)}` : "";
  return {
    key: `module:${specifier}${keySuffix}`,
    source:
      `${sourcePrefix}/// <reference path="${nodeTypesReferencePath()}" />\nimport * as __wm_target from ${
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
  const fileName = reflectionFileName(source) ??
    join(runtime.cwd(), `__wm_js_reflect_${sanitize(label)}.ts`);
  const extraFiles = source.includes(denoTypesFile)
    ? new Map([[denoTypesFile, denoTypesSource()]])
    : new Map<string, string>();
  const denoGraphs = denoReflectionGraphs(source);
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (normalize(name) === normalize(fileName)) {
      return cachedSourceFile(name, source, languageVersion);
    }
    const extraSource = extraFiles.get(name);
    if (extraSource !== undefined) return cachedSourceFile(name, extraSource, languageVersion);
    const denoSource = denoSourceForFileName(denoGraphs, name);
    if (denoSource !== undefined) return cachedSourceFile(name, denoSource, languageVersion);
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
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) =>
      denoResolvedModule(denoGraphs, moduleName, containingFile) ??
        ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule
    );
  const program = ts.createProgram([fileName], compilerOptions, host, previousProgram);
  previousProgram = program;
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) throw new Error(`cannot reflect JS target ${label}`);
  return read(program.getTypeChecker(), sourceFile);
}

type DenoInfoModule = {
  specifier: string;
  local?: string;
  mediaType?: string;
};

type DenoInfo = {
  roots?: string[];
  redirects?: Record<string, string>;
  modules?: DenoInfoModule[];
  npmPackages?: Record<string, DenoInfoNpmPackage>;
};

type DenoInfoNpmPackage = {
  name: string;
  localPath: string;
};

type DenoModuleGraph = {
  originalSpecifier: string;
  entrySpecifier?: string;
  redirects: Map<string, string>;
  modules: Map<string, DenoInfoModule>;
};

function denoReflectionGraphs(source: string): DenoModuleGraph[] {
  const specifiers = [...source.matchAll(/\bimport\s+\*\s+as\s+\w+\s+from\s+["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter(needsDenoModuleResolution);
  const unique = [...new Set(specifiers)];
  const reflectedFile = reflectionFileName(source);
  const cwd = activeReflectionBasePath
    ? dirname(activeReflectionBasePath)
    : reflectedFile
    ? dirname(reflectedFile)
    : runtime.cwd();
  return unique.flatMap((specifier) => {
    const graph = denoModuleGraph(specifier, cwd);
    return graph ? [graph] : [];
  });
}

function denoModuleGraph(specifier: string, cwd: string): DenoModuleGraph | undefined {
  const cacheKey = `${cwd}\0${specifier}`;
  const cached = denoModuleGraphs.get(cacheKey);
  if (cached) return cached;
  const output = runtime.runSync(denoCliPath(), ["info", "--json", specifier], { cwd });
  if (!output.success) {
    const message = output.stderr.trim();
    if (!mustResolveWithDeno(specifier)) return undefined;
    throw new Error(
      `cannot resolve JS import ${specifier} for reflection${message ? `: ${message}` : ""}`,
    );
  }
  const parsed = JSON.parse(output.stdout) as DenoInfo;
  const graph = {
    originalSpecifier: specifier,
    entrySpecifier: parsed.roots?.[0],
    redirects: new Map(Object.entries(parsed.redirects ?? {})),
    modules: new Map((parsed.modules ?? []).map((module) => [module.specifier, module])),
  };
  denoModuleGraphs.set(cacheKey, graph);
  return graph;
}

let nodeTypesPath: string | undefined;

function nodeTypesReferencePath(): string {
  if (nodeTypesPath) return nodeTypesPath;
  const output = runtime.runSync(denoCliPath(), [
    "info",
    "--json",
    "npm:@types/node/index.d.ts",
  ]);
  if (!output.success) {
    const message = output.stderr.trim();
    throw new Error(`cannot resolve Node type declarations${message ? `: ${message}` : ""}`);
  }
  const parsed = JSON.parse(output.stdout) as DenoInfo;
  const nodeTypes = Object.values(parsed.npmPackages ?? {}).find((pkg) =>
    pkg.name === "@types/node"
  );
  if (!nodeTypes) throw new Error("cannot locate @types/node in Deno's npm cache");
  nodeTypesPath = join(nodeTypes.localPath, "index.d.ts");
  return nodeTypesPath;
}

function denoSourceForFileName(graphs: DenoModuleGraph[], fileName: string): string | undefined {
  const module = denoModuleForFileName(graphs, fileName);
  if (!module?.local) return undefined;
  try {
    return runtime.readTextFileSync(module.local);
  } catch {
    return undefined;
  }
}

function denoResolvedModule(
  graphs: DenoModuleGraph[],
  moduleName: string,
  containingFile: string,
): ts.ResolvedModuleFull | undefined {
  const specifier = resolveDenoSpecifier(graphs, moduleName, containingFile);
  if (!specifier) return undefined;
  const module = denoModuleForFileName(graphs, specifier);
  // `deno info` represents npm packages as a graph node without a local source
  // file. Let TypeScript's normal resolver handle those so it can follow their
  // package metadata and declaration files in node_modules.
  if (!module?.local) return undefined;
  return {
    resolvedFileName: module.specifier,
    extension: tsExtensionForModule(module),
    isExternalLibraryImport: true,
  };
}

function resolveDenoSpecifier(
  graphs: DenoModuleGraph[],
  moduleName: string,
  containingFile: string,
): string | undefined {
  const raw = isRelativeSpecifier(moduleName) && isUrl(containingFile)
    ? new URL(moduleName, containingFile).href
    : moduleName;
  for (const graph of graphs) {
    const candidate = raw === graph.originalSpecifier
      ? graph.entrySpecifier ?? graph.redirects.get(raw) ?? raw
      : graph.redirects.get(raw) ?? raw;
    const redirected = graph.redirects.get(candidate) ?? candidate;
    if (graph.modules.has(redirected)) return redirected;
  }
  return undefined;
}

function denoModuleForFileName(
  graphs: DenoModuleGraph[],
  fileName: string,
): DenoInfoModule | undefined {
  for (const graph of graphs) {
    const redirected = graph.redirects.get(fileName) ?? fileName;
    const module = graph.modules.get(redirected);
    if (module) return module;
  }
  return undefined;
}

function tsExtensionForModule(module: DenoInfoModule): ts.Extension {
  const extension = extname(new URL(module.specifier).pathname);
  if (extension === ".tsx") return ts.Extension.Tsx;
  if (extension === ".jsx") return ts.Extension.Jsx;
  if (extension === ".js" || module.mediaType === "JavaScript") return ts.Extension.Js;
  if (extension === ".mjs" || module.mediaType === "Mjs") return ts.Extension.Mjs;
  if (extension === ".cjs" || module.mediaType === "Cjs") return ts.Extension.Cjs;
  if (extension === ".d.ts" || module.mediaType === "Dts") return ts.Extension.Dts;
  return ts.Extension.Ts;
}

function needsDenoModuleResolution(specifier: string): boolean {
  return mustResolveWithDeno(specifier) || isBareDenoSpecifier(specifier);
}

function mustResolveWithDeno(specifier: string): boolean {
  return specifier.startsWith("jsr:") || specifier.startsWith("https://jsr.io/");
}

function isBareDenoSpecifier(specifier: string): boolean {
  return !isRelativeSpecifier(specifier) &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("file:") &&
    !specifier.startsWith("npm:") &&
    !specifier.startsWith("node:") &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(specifier);
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function denoTypesSource(): string {
  if (denoTypesCache !== undefined) return denoTypesCache;
  const output = runtime.runSync(denoCliPath(), ["types"]);
  if (!output.success) {
    const message = output.stderr.trim();
    throw new Error(`cannot load Deno type declarations${message ? `: ${message}` : ""}`);
  }
  denoTypesCache = output.stdout;
  return denoTypesCache;
}

function denoCliPath(): string {
  return runtime.env("WORKMAN_DENO_PATH")?.trim() || "deno";
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

function reflectionFileName(source: string): string | undefined {
  const firstLine = source.split(/\r?\n/, 1)[0];
  const match = /^\/\/ @wm-reflect-file (.+)$/.exec(firstLine);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
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
