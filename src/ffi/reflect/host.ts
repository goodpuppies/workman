import ts from "typescript-api";
import { dirname, extname, join, normalize } from "node:path";
import { isBuiltin } from "node:module";
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
const fileExistsCache = new Map<string, boolean>();
const readFileCache = new Map<string, string | undefined>();
const directoryExistsCache = new Map<string, boolean>();
const directoriesCache = new Map<string, string[]>();
const realPathCache = new Map<string, string>();
const moduleResolutionCaches = new Map<string, ts.ModuleResolutionCache>();
let previousProgram: ts.Program | undefined;
let activeReflectionBasePath: string | undefined;
const preparedReflections = new Map<string, PreparedReflection>();
let reflectionProfileSink: ((event: JsReflectionProfileEvent) => void) | undefined;

export type JsReflectionSource = { key: string; source: string };
export type JsReflectionRequest = {
  label: string;
  source: string;
  sharedSource?: string;
};

type PreparedReflection = {
  checker: ts.TypeChecker;
  root: ts.Node;
};

export type JsReflectionProfileEvent =
  | {
    kind: "batch";
    labels: string[];
    rootDetails: { fileName: string; requests: number; sourceBytes: number }[];
    requests: number;
    roots: number;
    sourceBytes: number;
    programFiles: number;
    programSourceBytes: number;
    largestProgramFiles: { fileName: string; sourceBytes: number }[];
    graphMs: number;
    programMs: number;
    checkerMs: number;
    indexMs: number;
    totalMs: number;
  }
  | {
    kind: "read";
    label: string;
    cacheHit: boolean;
    prepareMs: number;
    readMs: number;
  };

export function setJsReflectionProfileSink(
  sink: ((event: JsReflectionProfileEvent) => void) | undefined,
): void {
  reflectionProfileSink = sink;
}

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
  const nodeTypesReference = isBuiltin(specifier)
    ? `/// <reference path="${nodeTypesReferencePath()}" />\n`
    : "";
  return {
    key: `module:${specifier}${keySuffix}`,
    source: `${sourcePrefix}${nodeTypesReference}import * as __wm_target from ${
      JSON.stringify(specifier)
    };`,
  };
}

export function reflectSource<T>(
  label: string,
  source: string,
  read: (
    checker: ts.TypeChecker,
    sourceRoot: ts.Node,
  ) => T,
): T {
  const key = reflectionRequestKey(label, source);
  const cacheHit = preparedReflections.has(key);
  const prepareStarted = reflectionProfileSink ? performance.now() : 0;
  prepareReflectionSources([{ label, source }]);
  const prepareMs = reflectionProfileSink ? performance.now() - prepareStarted : 0;
  const prepared = preparedReflections.get(key);
  if (!prepared) throw new Error(`cannot reflect JS target ${label}`);
  const readStarted = reflectionProfileSink ? performance.now() : 0;
  const result = read(prepared.checker, prepared.root);
  reflectionProfileSink?.({
    kind: "read",
    label,
    cacheHit,
    prepareMs,
    readMs: performance.now() - readStarted,
  });
  return result;
}

export function prepareReflectionSources(requests: JsReflectionRequest[]): void {
  const missing = requests.filter(({ label, source }) =>
    !preparedReflections.has(reflectionRequestKey(label, source))
  );
  if (missing.length === 0) return;

  const totalStarted = reflectionProfileSink ? performance.now() : 0;
  const roots = reflectionBatchRoots(missing);
  const sources = [...roots.values()].map((root) => root.source);
  const extraFiles = sources.some((source) => source.includes(denoTypesFile))
    ? new Map([[denoTypesFile, denoTypesSource()]])
    : new Map<string, string>();
  const graphStarted = reflectionProfileSink ? performance.now() : 0;
  const denoGraphs = sources.flatMap(denoReflectionGraphs);
  const graphMs = reflectionProfileSink ? performance.now() - graphStarted : 0;
  const host = ts.createCompilerHost(compilerOptions);
  cacheHostFileSystem(host);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const virtualSource = roots.get(normalize(name)) ?? roots.get(name);
    if (virtualSource !== undefined) {
      return cachedSourceFile(name, virtualSource.source, languageVersion);
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
        ts.resolveModuleName(
          moduleName,
          containingFile,
          compilerOptions,
          host,
          moduleResolutionCache(),
        ).resolvedModule
    );
  const programStarted = reflectionProfileSink ? performance.now() : 0;
  const program = ts.createProgram(
    [...roots.keys()],
    compilerOptions,
    host,
    previousProgram,
  );
  const programMs = reflectionProfileSink ? performance.now() - programStarted : 0;
  previousProgram = program;
  const checkerStarted = reflectionProfileSink ? performance.now() : 0;
  const checker = program.getTypeChecker();
  const checkerMs = reflectionProfileSink ? performance.now() - checkerStarted : 0;
  const programSources = reflectionProfileSink ? program.getSourceFiles() : [];
  const indexStarted = reflectionProfileSink ? performance.now() : 0;
  for (const [fileName, root] of roots) {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) throw new Error(`cannot reflect JS target ${root.requests[0].label}`);
    const blocks = sourceFile.statements.filter(ts.isBlock);
    for (const [index, request] of root.requests.entries()) {
      const key = reflectionRequestKey(request.label, request.source);
      const queryRoot =
        request.sharedSource === undefined || request.sharedSource === request.source
          ? sourceFile
          : blocks[index];
      if (!queryRoot) throw new Error(`cannot locate reflected JS target ${request.label}`);
      preparedReflections.set(key, { checker, root: queryRoot });
    }
  }
  reflectionProfileSink?.({
    kind: "batch",
    labels: missing.map((request) => request.label),
    rootDetails: [...roots].map(([fileName, root]) => ({
      fileName,
      requests: root.requests.length,
      sourceBytes: root.source.length,
    })),
    requests: missing.length,
    roots: roots.size,
    sourceBytes: sources.reduce((total, source) => total + source.length, 0),
    programFiles: programSources.length,
    programSourceBytes: programSources.reduce((total, source) => total + source.text.length, 0),
    largestProgramFiles: programSources
      .map((source) => ({ fileName: source.fileName, sourceBytes: source.text.length }))
      .sort((left, right) => right.sourceBytes - left.sourceBytes)
      .slice(0, 20),
    graphMs,
    programMs,
    checkerMs,
    indexMs: performance.now() - indexStarted,
    totalMs: performance.now() - totalStarted,
  });
}

type ReflectionBatchRoot = {
  source: string;
  requests: JsReflectionRequest[];
};

function reflectionBatchRoots(requests: JsReflectionRequest[]): Map<string, ReflectionBatchRoot> {
  const groups = new Map<string, JsReflectionRequest[]>();
  for (const request of requests) {
    const group = request.sharedSource === undefined
      ? reflectionRequestKey(request.label, request.source)
      : request.sharedSource;
    const grouped = groups.get(group) ?? [];
    grouped.push(request);
    groups.set(group, grouped);
  }

  const roots = new Map<string, ReflectionBatchRoot>();
  for (const grouped of groups.values()) {
    const first = grouped[0];
    const sharedSource = first.sharedSource;
    if (
      sharedSource !== undefined &&
      grouped.some((request) => !request.source.startsWith(sharedSource))
    ) {
      throw new Error(`invalid shared JS reflection source for ${first.label}`);
    }
    // A block gives each probe its usual private declaration names while all
    // probes in the group share one module import/global target and checker.
    const source = sharedSource === undefined
      ? `${first.source}\nexport {};\n`
      : `${sharedSource}\n${
        grouped.map((request) => {
          const suffix = request.source.slice(sharedSource.length);
          return request.source === sharedSource ? "{}" : `{${suffix}\n}`;
        }).join("\n")
      }\nexport {};\n`;
    const fileName = uniqueReflectionFileName(first.label, first.source, roots);
    roots.set(fileName, { source, requests: grouped });
  }
  return roots;
}

function reflectionRequestKey(label: string, source: string): string {
  return `${label}\0${source}`;
}

function uniqueReflectionFileName(
  label: string,
  source: string,
  currentRoots: Map<string, ReflectionBatchRoot>,
): string {
  const reflected = reflectionFileName(source);
  const directory = reflected ? dirname(reflected) : runtime.cwd();
  const stem = sanitize(label).slice(0, 120) || "target";
  let fileName = normalize(reflected ?? join(directory, `__wm_js_reflect_${stem}.ts`));
  let suffix = 2;
  while (currentRoots.has(fileName)) {
    fileName = normalize(join(directory, `__wm_js_reflect_${stem}_${suffix}.ts`));
    suffix += 1;
  }
  return fileName;
}

function cacheHostFileSystem(host: ts.CompilerHost): void {
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (path) => memo(fileExistsCache, normalize(path), () => fileExists(path));

  const readFile = host.readFile.bind(host);
  host.readFile = (path) => memo(readFileCache, normalize(path), () => readFile(path));

  if (host.directoryExists) {
    const directoryExists = host.directoryExists.bind(host);
    host.directoryExists = (path) =>
      memo(directoryExistsCache, normalize(path), () => directoryExists(path));
  }

  if (host.getDirectories) {
    const getDirectories = host.getDirectories.bind(host);
    host.getDirectories = (path) =>
      memo(directoriesCache, normalize(path), () => getDirectories(path));
  }

  if (host.realpath) {
    const realpath = host.realpath.bind(host);
    host.realpath = (path) => memo(realPathCache, normalize(path), () => realpath(path));
  }
}

function memo<K, V>(cache: Map<K, V>, key: K, load: () => V): V {
  if (cache.has(key)) return cache.get(key)!;
  const value = load();
  cache.set(key, value);
  return value;
}

function moduleResolutionCache(): ts.ModuleResolutionCache {
  const currentDirectory = runtime.cwd();
  let cache = moduleResolutionCaches.get(currentDirectory);
  if (!cache) {
    cache = ts.createModuleResolutionCache(
      currentDirectory,
      ts.sys.useCaseSensitiveFileNames
        ? (fileName) => fileName
        : (fileName) => fileName.toLowerCase(),
      compilerOptions,
    );
    moduleResolutionCaches.set(currentDirectory, cache);
  }
  return cache;
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
  denoTypesCache = `${output.stdout}
declare namespace Deno {
  interface UnsafeWindowSurface {
    getContext(contextId: "webgpu", options?: any): GPUCanvasContext | null;
  }
}
`;
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
  root: ts.Node,
  name: string,
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

export function findDeclaredValue(
  root: ts.Node,
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
  visit(root);
  return found;
}

export function findCallInitializer(
  root: ts.Node,
  name: string,
): ts.CallExpression | undefined {
  const initializer = findVariable(root, name)?.initializer;
  return initializer && ts.isCallExpression(initializer) ? initializer : undefined;
}

export function typeOfSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | undefined {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : undefined;
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
