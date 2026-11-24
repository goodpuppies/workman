import {
  type API,
  type Checker,
  ModuleKind,
  type ModuleResolver,
  ModuleResolutionKind,
  type Program,
  type RawCompilerOptions,
  type ResolutionMode,
  type Signature,
  type Snapshot,
  type StaticModuleResolution,
  type Symbol as TsSymbol,
  SymbolFlags,
  type Type,
} from "tsrs/sync";
import { createFileSystemLayer } from "tsrs/fs";
import type {
  CallExpression,
  Declaration,
  Identifier,
  Node,
  SignatureDeclaration,
  SourceFile,
  VariableDeclaration,
} from "tsrs/ast";
import {
  isBlock,
  isCallExpression,
  isComputedPropertyName,
  isIdentifier,
  isVariableDeclaration,
} from "tsrs/ast/is";
import { getNameOfDeclaration } from "tsrs/ast/utils";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { isBuiltin } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isStandaloneBinary, resolveDenoCliPath } from "../../child_runtime.ts";
import { runtime } from "../../io.ts";
import { createTsrsApi } from "./tsrs_sync_channel.ts";

// ScriptTarget.ES2022 = 9
const compilerOptions: RawCompilerOptions = {
  target: 9,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  strictNullChecks: true,
  skipLibCheck: true,
};

const denoTypesFile = "/__wm_deno_types.d.ts";
const denoTypesReference = `/// <reference path="${denoTypesFile}" />\n`;
const denoCacheVirtualPrefix = "/__wm_deno_cache";
let denoTypesCache: string | undefined;

let reflectionApi: API | undefined;
let defaultModuleResolver: ModuleResolver | undefined;
const activeSnapshots: Snapshot[] = [];
const denoModuleGraphs = new Map<string, DenoModuleGraph>();
// Each reflection pass only builds graphs for its own roots, while later passes
// can reference modules discovered by earlier passes.
const knownDenoModules = new Map<string, DenoInfoModule>();
const denoVirtualToLocal = new Map<string, string>();
const denoVirtualToSpecifier = new Map<string, string>();
const denoSpecifierToVirtual = new Map<string, string>();
const graphedImporters = new Set<string>();

let activeReflectionBasePath: string | undefined;
const preparedReflections = new Map<string, PreparedReflection>();
let reflectionProfileSink: ((event: JsReflectionProfileEvent) => void) | undefined;

export type JsReflectionSource = { key: string; source: string };
export type JsDefinitionLocation = {
  path: string;
  start: number;
  end: number;
  /** Declaration text for compiler-owned virtual files that an editor cannot open directly. */
  source?: string;
};
export type JsReflectionRequest = {
  label: string;
  source: string;
  sharedSource?: string;
};

type PreparedReflection = {
  program: Program;
  checker: Checker;
  root: Node;
  sourceFile: SourceFile;
};

export type JsReflectionProfileEvent =
  | {
    kind: "deno-info";
    specifier: string;
    cwd: string;
    milliseconds: number;
    success: boolean;
  }
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
    diagnosticsMs: number;
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

function getReflectionApi(): API {
  if (!reflectionApi) {
    reflectionApi = createTsrsApi({ cwd: runtime.cwd() });
    defaultModuleResolver = reflectionApi.createModuleResolver(compilerOptions);
  }
  return reflectionApi;
}

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

export function jsModuleMemberDefinition(
  specifier: string,
  memberName: string,
  basePath: string,
): JsDefinitionLocation | undefined {
  return jsMemberDefinition(jsModuleSource, specifier, memberName, basePath);
}

export function jsGlobalMemberDefinition(
  path: string,
  memberName: string,
  basePath: string,
): JsDefinitionLocation | undefined {
  return jsMemberDefinition(jsGlobalSource, path, memberName, basePath);
}

function jsMemberDefinition(
  source: (target: string) => JsReflectionSource,
  targetName: string,
  memberName: string,
  basePath: string,
): JsDefinitionLocation | undefined {
  const previous = setActiveJsReflectionBasePath(basePath);
  try {
    const target = source(targetName);
    return reflectSource(
      `${target.key}.${memberName}:definition`,
      `${target.source}\nconst __wm_member = __wm_target[${JSON.stringify(memberName)}];`,
      (checker, sourceRoot) => {
        const targetExpression = findVariable(sourceRoot, "__wm_target")?.initializer ??
          findDeclaredValue(sourceRoot, "__wm_target");
        let symbol = targetExpression
          ? checker.getTypeAtLocation(targetExpression).getProperty(memberName)
          : undefined;
        if (!symbol) return undefined;
        if (symbol.flags & SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const declaration = resolveSymbolDeclaration(symbol);
        if (!declaration) return undefined;
        const sourceFile = declaration.getSourceFile();
        const path = localDefinitionPath(sourceFile.fileName);
        if (!path) return undefined;
        const declName = getNameOfDeclaration(declaration);
        const selection = declName && !isComputedPropertyName(declName) ? declName : declaration;
        return {
          path,
          start: selection.getStart(sourceFile),
          end: selection.getEnd(),
          ...(sourceFile.fileName === denoTypesFile ? { source: sourceFile.text } : {}),
        };
      },
    );
  } finally {
    setActiveJsReflectionBasePath(previous);
  }
}

export function reflectSource<T>(
  label: string,
  source: string,
  read: (
    checker: Checker,
    sourceRoot: Node,
    program: Program,
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
  const result = read(prepared.checker, prepared.root, prepared.program);
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

  const graphStarted = reflectionProfileSink ? performance.now() : 0;
  const denoGraphs = sources.flatMap(denoReflectionGraphs);
  const graphMs = reflectionProfileSink ? performance.now() - graphStarted : 0;

  const layerEntries: [string, string][] = [];
  for (const [fileName, root] of roots) {
    layerEntries.push([toPosixPath(fileName), root.source]);
  }
  if (sources.some((source) => source.includes(denoTypesFile))) {
    layerEntries.push([denoTypesFile, denoTypesSource()]);
  }
  if (
    isStandaloneBinary &&
    nodeTypesPath &&
    sources.some((source) => source.includes(nodeTypesPath!))
  ) {
    for (const entry of embeddedNodeTypesLayerEntries()) {
      layerEntries.push(entry);
    }
  }
  // Mount any Deno remote/URL modules from the graphs into the virtual filesystem layer
  // at rooted virtual paths with preserved extensions so tsrs can parse and resolve them.
  const addedVirtualPaths = new Set<string>();
  for (const graph of denoGraphs) {
    for (const module of graph.modules.values()) {
      addDenoModuleToLayer(module, layerEntries, addedVirtualPaths);
    }
  }
  for (const module of knownDenoModules.values()) {
    addDenoModuleToLayer(module, layerEntries, addedVirtualPaths);
  }

  const api = getReflectionApi();
  const baseResolver = defaultModuleResolver!;
  const unresolvedSourceImports = new Set<string>();
  const rootDirs = new Set([...roots.keys()].map((file) => toPosixPath(dirname(file))));

  const customResolver = api.createModuleResolver(compilerOptions, {
    resolveModuleName: (moduleName, containingDirectory, resolutionMode, { snapshot }) => {
      const resolveModule = (): StaticModuleResolution | undefined => {
        const deferDiscovery = isPackageDeclarationDirectory(containingDirectory);
        const typescript = (): StaticModuleResolution | undefined =>
          baseResolver.resolveModuleName(
            moduleName,
            containingDirectory,
            resolutionMode,
            { snapshot },
          ).resolvedModule;

        if (isBarePackageSpecifier(moduleName)) {
          const mapped = resolveDenoSpecifier(
            denoGraphs,
            moduleName,
            containingDirectory,
            !deferDiscovery,
          );
          if (!mapped || mapped.startsWith("npm:")) {
            const installed = typescript();
            if (installed?.resolvedFileName) return installed;
          }
        }
        return denoResolvedModule(
          denoGraphs,
          moduleName,
          containingDirectory,
          !deferDiscovery,
          baseResolver,
          resolutionMode,
          snapshot,
        ) ??
          typescript() ??
          (deferDiscovery && !moduleName.startsWith("node:")
            ? denoResolvedModule(
              denoGraphs,
              moduleName,
              containingDirectory,
              true,
              baseResolver,
              resolutionMode,
              snapshot,
            )
            : undefined);
      };

      const resolved = resolveModule();
      if (!resolved && isNpmGraphImport(denoGraphs, moduleName)) {
        throw new Error(
          `cannot resolve npm package "${moduleName}" for JS import from Deno's cache`,
        );
      }
      if (!resolved && !isPackageDeclarationDirectory(containingDirectory) && !isBuiltin(moduleName)) {
        unresolvedSourceImports.add(moduleName);
      }
      return resolved;
    },
  });

  const programStarted = reflectionProfileSink ? performance.now() : 0;
  const rootNames = [...roots.keys()].map(toPosixPath);
  let snapshot: Snapshot;
  try {
    snapshot = api.createSnapshot({
      fileSystem: createFileSystemLayer(layerEntries),
      createPrograms: [{
        rootFiles: rootNames,
        compilerOptions,
        options: { moduleResolver: customResolver },
      }],
    });
  } finally {
    customResolver.dispose();
  }
  const program = snapshot.operation.createdPrograms?.[0];
  if (!program) {
    snapshot.dispose();
    throw new Error("tsrs snapshot did not create a program");
  }
  const project = snapshot.getProject(program.id);
  if (!project) {
    snapshot.dispose();
    throw new Error("tsrs snapshot did not contain created project");
  }
  const programMs = reflectionProfileSink ? performance.now() - programStarted : 0;

  const diagnosticsStarted = reflectionProfileSink ? performance.now() : 0;
  const unresolvedImport = unresolvedSourceImports.size > 0
    ? program.getSemanticDiagnostics().find((diagnostic) => diagnostic.code === 2307)
    : undefined;
  const diagnosticsMs = reflectionProfileSink ? performance.now() - diagnosticsStarted : 0;
  if (unresolvedImport) {
    snapshot.dispose();
    throw new Error(
      `cannot resolve JS import for reflection: ${unresolvedImport.text}`,
    );
  }

  activeSnapshots.push(snapshot);
  const checkerStarted = reflectionProfileSink ? performance.now() : 0;
  const checker = project.checker;
  const checkerMs = reflectionProfileSink ? performance.now() - checkerStarted : 0;
  const programFileNames = reflectionProfileSink ? program.getSourceFileNames() : [];

  const indexStarted = reflectionProfileSink ? performance.now() : 0;
  for (const [fileName, root] of roots) {
    const sourceFile = program.getSourceFile(toPosixPath(fileName));
    if (!sourceFile) throw new Error(`cannot reflect JS target ${root.requests[0].label}`);
    const blocks = sourceFile.statements.filter(isBlock);
    for (const [index, request] of root.requests.entries()) {
      const key = reflectionRequestKey(request.label, request.source);
      const queryRoot: Node | undefined =
        request.sharedSource === undefined || request.sharedSource === request.source
          ? sourceFile
          : blocks[index];
      if (!queryRoot) throw new Error(`cannot locate reflected JS target ${request.label}`);
      preparedReflections.set(key, { checker, root: queryRoot, program, sourceFile });
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
    programFiles: programFileNames.length,
    programSourceBytes: 0,
    largestProgramFiles: [],
    graphMs,
    programMs,
    diagnosticsMs,
    checkerMs,
    indexMs: performance.now() - indexStarted,
    totalMs: performance.now() - totalStarted,
  });
}

function addDenoModuleToLayer(
  module: DenoInfoModule,
  layerEntries: [string, string][],
  added: Set<string>,
): void {
  if (!module.local || !isUrl(module.specifier) || module.specifier.startsWith("file://")) return;
  const virtualPath = virtualPathForDenoModule(module);
  if (added.has(virtualPath)) return;
  added.add(virtualPath);
  denoVirtualToLocal.set(virtualPath, module.local);
  denoVirtualToSpecifier.set(virtualPath, module.specifier);
  denoSpecifierToVirtual.set(module.specifier, virtualPath);
  try {
    const content = runtime.readTextFileSync(module.local);
    layerEntries.push([virtualPath, content]);
  } catch {
    // Unreadable cache entry; skip.
  }
}

function virtualPathForDenoModule(module: DenoInfoModule): string {
  const existing = denoSpecifierToVirtual.get(module.specifier);
  if (existing) return existing;
  const url = new URL(module.specifier);
  let pathname = url.pathname.replace(/^\/+/, "");
  if (!extname(pathname)) {
    pathname += extensionForMediaType(module.mediaType);
  }
  const virtualPath = `${denoCacheVirtualPrefix}/${url.protocol.replace(":", "")}/${url.host}/${pathname}`;
  denoSpecifierToVirtual.set(module.specifier, virtualPath);
  denoVirtualToSpecifier.set(virtualPath, module.specifier);
  if (module.local) denoVirtualToLocal.set(virtualPath, module.local);
  return virtualPath;
}

function extensionForMediaType(mediaType: string | undefined): string {
  switch (mediaType) {
    case "TSX":
      return ".tsx";
    case "JSX":
      return ".jsx";
    case "JavaScript":
      return ".js";
    case "Mjs":
      return ".mjs";
    case "Cjs":
      return ".cjs";
    case "Dts":
      return ".d.ts";
    case "Dmts":
      return ".d.mts";
    case "Dcts":
      return ".d.cts";
    case "Mts":
      return ".mts";
    case "Cts":
      return ".cts";
    default:
      return ".ts";
  }
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
    const fileName = uniqueReflectionFileName(first.source, roots);
    roots.set(fileName, { source, requests: grouped });
  }
  return roots;
}

function reflectionRequestKey(label: string, source: string): string {
  return `${label}\0${source}`;
}

function uniqueReflectionFileName(
  source: string,
  currentRoots: Map<string, ReflectionBatchRoot>,
): string {
  const reflected = reflectionFileName(source);
  const directory = reflected ? dirname(reflected) : runtime.cwd();
  const stem = `__wm_js_reflect_${importsFingerprint(source)}`;
  let fileName = normalize(join(directory, `${stem}.ts`));
  let suffix = 2;
  while (currentRoots.has(fileName)) {
    fileName = normalize(join(directory, `${stem}_${suffix}.ts`));
    suffix += 1;
  }
  return fileName;
}

/** Names what a source pulls in. Two sources with the same answer can share a root naming pattern. */
function importsFingerprint(source: string): string {
  const refs: string[] = [];
  for (const match of source.matchAll(/^\s*\/\/\/\s*<reference\s+(?:path|types|lib)=["']([^"']+)["']/gm)) {
    refs.push(match[1]);
  }
  for (const match of extractImportSpecifiers(source)) {
    refs.push(match);
  }
  const text = refs.join(";");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const re = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?(["'])([^"'\r\n]+)\1/g;
  for (const match of source.matchAll(re)) {
    specifiers.push(match[2]);
  }
  return specifiers;
}

type DenoInfoDependency = {
  specifier: string;
  code?: { specifier?: string; error?: string };
  type?: { specifier?: string; error?: string };
};

type DenoInfoModule = {
  specifier: string;
  local?: string;
  mediaType?: string;
  error?: string;
  dependencies?: DenoInfoDependency[];
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
  npmPackages: Map<string, DenoInfoNpmPackage>;
};

function denoReflectionGraphs(source: string): DenoModuleGraph[] {
  const specifiers = extractImportSpecifiers(source).filter((specifier) =>
    needsDenoModuleResolution(specifier) || isRelativeSpecifier(specifier) || isAbsolute(specifier)
  );
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
  // Without a Deno CLI:
  // - Scheme-based Deno imports (`npm:`, `jsr:`, `https://`) require a Deno CLI.
  // - Bare package specifiers (`"zod"`, `"@scope/pkg"`) and relative/absolute files are
  //   resolved directly from `node_modules` / disk by tsrs.
  const denoCli = resolveDenoCliPath();
  if (!denoCli) {
    if (mustResolveWithDeno(specifier) || specifier.startsWith("npm:")) {
      throw new Error(
        `package imports such as ${specifier} are not supported without a Deno CLI on PATH (or WORKMAN_DENO_PATH)`,
      );
    }
    return undefined;
  }
  const cacheKey = `${cwd}\0${specifier}`;
  const cached = denoModuleGraphs.get(cacheKey);
  if (cached) return cached;
  const started = reflectionProfileSink ? performance.now() : 0;
  const output = runtime.runSync(denoCli, [
    "info",
    "--json",
    "--no-lock",
    "--node-modules-dir=none",
    isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier,
  ], { cwd });
  reflectionProfileSink?.({
    kind: "deno-info",
    specifier,
    cwd,
    milliseconds: performance.now() - started,
    success: output.success,
  });
  if (!output.success) {
    const message = output.stderr.trim();
    if (!mustResolveWithDeno(specifier)) return undefined;
    throw new Error(
      `cannot resolve JS import ${specifier} for reflection${message ? `: ${message}` : ""}`,
    );
  }
  const parsed = JSON.parse(output.stdout) as DenoInfo;
  const failedRoot = (parsed.modules ?? []).find((module) =>
    module.error &&
    (module.specifier === specifier || parsed.roots?.includes(module.specifier))
  );
  if (
    failedRoot?.error &&
    (mustResolveWithDeno(specifier) || specifier.startsWith("npm:"))
  ) {
    throw new Error(`cannot resolve JS import ${specifier} for reflection: ${failedRoot.error}`);
  }
  for (const module of parsed.modules ?? []) {
    knownDenoModules.set(module.specifier, module);
  }
  const graph = {
    originalSpecifier: specifier,
    entrySpecifier: parsed.roots?.[0],
    redirects: new Map(Object.entries(parsed.redirects ?? {})),
    modules: new Map((parsed.modules ?? []).map((module) => [module.specifier, module])),
    npmPackages: new Map(Object.entries(parsed.npmPackages ?? {})),
  };
  denoModuleGraphs.set(cacheKey, graph);
  return graph;
}

function isNpmGraphImport(graphs: DenoModuleGraph[], moduleName: string): boolean {
  return graphs.some((graph) =>
    graph.originalSpecifier === moduleName &&
    graph.npmPackages.size > 0 &&
    (graph.entrySpecifier?.startsWith("npm:") ?? false)
  );
}

let nodeTypesPath: string | undefined;
let embeddedNodeTypesCache: [string, string][] | undefined;

function embeddedNodeTypesLayerEntries(): [string, string][] {
  if (embeddedNodeTypesCache) return embeddedNodeTypesCache;
  const entries: [string, string][] = [];
  const modules = fileURLToPath(new URL("../../../node_modules/", import.meta.url));
  const denoDir = join(modules, ".deno");
  const walk = (dir: string) => {
    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }
    for (const item of items) {
      const full = join(dir, item);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (item.endsWith(".d.ts") || item === "package.json") {
        try {
          entries.push([toPosixPath(full), readFileSync(full, "utf8")]);
        } catch {
          // skip unreadable
        }
      }
    }
  };
  walk(denoDir);
  embeddedNodeTypesCache = entries;
  return entries;
}

/**
 * Node's declarations from node_modules beside the compiler: a source checkout's, or the copy a
 * compiled binary embeds, since its resolver only knows packages the code imports. The binary keeps
 * Deno's layout, `node_modules/.deno/@types+node@<version>/node_modules/@types/node`, without the
 * `node_modules/@types/node` link.
 */
function bundledNodeTypesPath(): string | undefined {
  const modules = fileURLToPath(new URL("../../../node_modules/", import.meta.url));
  const linked = join(modules, "@types/node/index.d.ts");
  if (existsSync(linked)) return linked;
  try {
    for (const entry of readdirSync(join(modules, ".deno"))) {
      if (!entry.startsWith("@types+node@")) continue;
      const path = join(modules, ".deno", entry, "node_modules/@types/node/index.d.ts");
      if (existsSync(path)) return path;
    }
  } catch {
    // No node_modules: an installed source package resolves the declarations through Deno.
  }
  return undefined;
}

function nodeTypesReferencePath(): string {
  if (nodeTypesPath) return nodeTypesPath;
  const bundled = bundledNodeTypesPath();
  if (bundled) return nodeTypesPath = bundled;
  const specifier = import.meta.resolve("@types/node");
  if (specifier.startsWith("file:")) {
    const path = fileURLToPath(specifier);
    nodeTypesPath = path.endsWith(".d.ts") ? path : join(dirname(path), "index.d.ts");
  } else {
    const denoCli = resolveDenoCliPath();
    if (!denoCli) {
      throw new Error(
        "cannot resolve WM's Node declarations without a Deno CLI on PATH (or WORKMAN_DENO_PATH)",
      );
    }
    const output = runtime.runSync(denoCli, [
      "info",
      "--json",
      "--no-config",
      "--no-lock",
      "--node-modules-dir=none",
      specifier,
    ]);
    if (!output.success) {
      throw new Error(`cannot resolve WM's Node declarations: ${output.stderr.trim()}`);
    }
    const info = JSON.parse(output.stdout) as DenoInfo;
    const pkg = Object.values(info.npmPackages ?? {}).find((pkg) => pkg.name === "@types/node");
    if (!pkg?.localPath) {
      throw new Error("Deno did not report a cache path for WM's Node declarations");
    }
    nodeTypesPath = join(pkg.localPath, "index.d.ts");
  }
  return nodeTypesPath;
}

/** `react`, `@scope/pkg/sub`: not relative, absolute, or a scheme such as `npm:` or `node:`. */
function isBarePackageSpecifier(specifier: string): boolean {
  return !/^(?:\.|\/|[A-Za-z][\w+.-]*:)/.test(specifier);
}

function denoResolvedModule(
  graphs: DenoModuleGraph[],
  moduleName: string,
  containingDirectory: string,
  discoverImporter: boolean,
  baseResolver: ModuleResolver,
  resolutionMode: ResolutionMode | undefined,
  snapshot: Snapshot | number | undefined,
): StaticModuleResolution | undefined {
  const specifier = resolveDenoSpecifier(graphs, moduleName, containingDirectory, discoverImporter);
  if (!specifier) return undefined;
  const module = denoModuleForFileName(graphs, specifier);
  if (!module?.local) {
    return npmResolvedModule(
      graphs,
      specifier,
      containingDirectory,
      baseResolver,
      resolutionMode,
      snapshot,
    );
  }
  if (module.specifier.startsWith("file://")) {
    return { resolvedFileName: toPosixPath(module.local) };
  }
  return { resolvedFileName: virtualPathForDenoModule(module) };
}

function npmResolvedModule(
  graphs: DenoModuleGraph[],
  specifier: string,
  containingDirectory: string,
  baseResolver: ModuleResolver,
  resolutionMode: ResolutionMode | undefined,
  snapshot: Snapshot | number | undefined,
): StaticModuleResolution | undefined {
  const parsed = npmPackageSpecifier(specifier);
  if (!parsed) return undefined;
  const resolveIn = (packageName: string, packageGraphs = graphs) => {
    const packagePath = npmPackagePath(packageGraphs, packageName);
    if (!packagePath) return undefined;
    const target = parsed.subpath
      ? npmPackageEntry(packagePath, parsed.subpath) ?? join(packagePath, parsed.subpath)
      : packagePath;
    const resolve = (path: string) =>
      baseResolver.resolveModuleName(
        toPosixPath(path),
        containingDirectory,
        resolutionMode,
        { snapshot: snapshot as Snapshot | undefined },
      ).resolvedModule;
    let resolved = resolve(target);
    if (
      !parsed.subpath &&
      !(resolved?.resolvedFileName && typeof resolved.resolvedFileName === "string" &&
        isDeclarationFile(resolved.resolvedFileName))
    ) {
      const entry = npmPackageEntry(packagePath, "");
      const exported = entry ? resolve(entry) : undefined;
      if (exported) resolved = exported;
    }
    return resolved;
  };
  const own = resolveIn(parsed.name);
  if (
    own?.resolvedFileName && typeof own.resolvedFileName === "string" &&
    isDeclarationFile(own.resolvedFileName)
  ) {
    return own;
  }
  const typesName = parsed.name.startsWith("@")
    ? `@types/${parsed.name.slice(1).replace("/", "__")}`
    : `@types/${parsed.name}`;
  const cwd = containingDirectory.startsWith(denoCacheVirtualPrefix)
    ? runtime.cwd()
    : containingDirectory;
  const typesGraph = npmPackagePath(graphs, typesName)
    ? undefined
    : denoModuleGraph(typesName, cwd);
  return resolveIn(typesName, typesGraph ? [typesGraph] : graphs) ?? own;
}

function npmPackagePath(graphs: DenoModuleGraph[], packageName: string): string | undefined {
  for (const graph of graphs) {
    const pkg = [...graph.npmPackages.values()].find((candidate) => candidate.name === packageName);
    if (pkg) return pkg.localPath;
  }
  return undefined;
}

function npmPackageEntry(packagePath: string, subpath: string): string | undefined {
  let manifest: { exports?: unknown };
  try {
    manifest = JSON.parse(runtime.readTextFileSync(join(packagePath, "package.json")));
  } catch {
    return undefined;
  }
  const entries = manifest.exports;
  if (
    subpath === "" &&
    (typeof entries === "string" ||
      (typeof entries === "object" && entries !== null && !Array.isArray(entries) &&
        !Object.keys(entries).some((key) => key.startsWith("."))))
  ) {
    const target = exportTarget(entries);
    return target === undefined ? undefined : join(packagePath, target);
  }
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) return undefined;
  const key = `.${subpath}`;
  const map = entries as Record<string, unknown>;
  let target = key in map ? exportTarget(map[key]) : undefined;
  if (!(key in map)) {
    for (const [pattern, value] of Object.entries(map)) {
      const star = pattern.indexOf("*");
      if (star < 0) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      target = exportTarget(value)?.replaceAll(
        "*",
        key.slice(prefix.length, key.length - suffix.length),
      );
      break;
    }
  }
  return target === undefined ? undefined : join(packagePath, target);
}

const exportConditions = new Set(["types", "deno", "node", "import", "default"]);

function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = exportTarget(item);
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const [condition, target] of Object.entries(value)) {
    if (!exportConditions.has(condition)) continue;
    const resolved = exportTarget(target);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

function npmPackageSpecifier(specifier: string): { name: string; subpath: string } | undefined {
  if (!specifier.startsWith("npm:")) return undefined;
  const value = specifier.slice("npm:".length).replace(/^\/+/, "");
  const scopeSlash = value.startsWith("@") ? value.indexOf("/") : -1;
  if (value.startsWith("@") && scopeSlash < 0) return undefined;
  const start = scopeSlash + 1;
  const version = value.indexOf("@", start);
  const slash = value.indexOf("/", start);
  const ends = [version, slash].filter((index) => index >= 0);
  const name = ends.length ? value.slice(0, Math.min(...ends)) : value;
  return { name, subpath: slash < 0 ? "" : value.slice(slash) };
}

function resolveDenoSpecifier(
  graphs: DenoModuleGraph[],
  moduleName: string,
  containingDirectory: string,
  discoverImporter: boolean,
): string | undefined {
  const normalizedDir = toPosixPath(containingDirectory);
  for (const graph of graphs) {
    const candidate = moduleName === graph.originalSpecifier
      ? graph.entrySpecifier ?? graph.redirects.get(moduleName) ?? moduleName
      : graph.redirects.get(moduleName) ?? moduleName;
    const redirected = graph.redirects.get(candidate) ?? candidate;
    if (graph.modules.has(redirected)) return redirected;
  }

  // Check dependencies of any known Deno module residing in `containingDirectory`.
  const searchModules = (modules: Iterable<DenoInfoModule>): string | undefined => {
    for (const mod of modules) {
      const modDir = denoModuleDirectory(mod);
      if (modDir !== normalizedDir) continue;
      const target = dependencyTarget(mod, moduleName);
      if (target !== undefined) {
        const direct = graphModuleFor(graphs, target);
        if (direct !== undefined) return direct;
        if (knownDenoModules.has(target)) return target;
      }
    }
    return undefined;
  };
  for (const graph of graphs) {
    const found = searchModules(graph.modules.values());
    if (found !== undefined) return found;
  }
  const knownFound = searchModules(knownDenoModules.values());
  if (knownFound !== undefined) return knownFound;

  if (!discoverImporter || !resolveDenoCliPath()) return undefined;
  if (
    !normalizedDir.startsWith(denoCacheVirtualPrefix) &&
    !graphedImporters.has(`${normalizedDir}\0${moduleName}`)
  ) {
    graphedImporters.add(`${normalizedDir}\0${moduleName}`);
    if (existsSync(containingDirectory)) {
      const graph = denoModuleGraph(moduleName, containingDirectory);
      if (graph) {
        const candidate = graph.entrySpecifier ?? graph.redirects.get(moduleName) ?? moduleName;
        const redirected = graph.redirects.get(candidate) ?? candidate;
        if (graph.modules.has(redirected)) return redirected;
      }
    }
  }
  return undefined;
}

function denoModuleDirectory(module: DenoInfoModule): string | undefined {
  if (module.specifier.startsWith("file://")) {
    const local = module.local ?? pathFromFileUrl(module.specifier);
    return local ? toPosixPath(dirname(local)) : undefined;
  }
  if (isUrl(module.specifier)) {
    const virtual = denoSpecifierToVirtual.get(module.specifier);
    return virtual ? toPosixPath(dirname(virtual)) : undefined;
  }
  return undefined;
}

function isDeclarationFile(fileName: string): boolean {
  return /\.d\.[cm]?ts$/i.test(fileName);
}

/** A directory inside `node_modules`, or in Deno's npm cache. */
function isPackageDeclarationDirectory(dirName: string): boolean {
  const path = toPosixPath(dirName);
  return /(?:^|\/)node_modules(?:\/|$)/.test(path) ||
    /\/npm\/[^/]+\/(?:@[^/]+\/)?[^/]+\/\d/.test(path);
}

function pathFromFileUrl(value: string): string | undefined {
  if (!value.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(value);
  } catch {
    return undefined;
  }
}

function localDefinitionPath(fileName: string): string | undefined {
  const mappedLocal = denoVirtualToLocal.get(fileName);
  if (mappedLocal) return mappedLocal;
  if (fileName.startsWith("file://")) return pathFromFileUrl(fileName);
  if (!isUrl(fileName)) return fileName;
  return denoModuleForFileName([], fileName)?.local;
}

function dependencyTarget(
  module: DenoInfoModule | undefined,
  moduleName: string,
): string | undefined {
  const dependency = module?.dependencies?.find((entry) => entry.specifier === moduleName);
  return dependency?.code?.specifier ?? dependency?.type?.specifier;
}

function graphModuleFor(
  graphs: DenoModuleGraph[],
  specifier: string | undefined,
): string | undefined {
  if (specifier === undefined) return undefined;
  for (const graph of graphs) {
    const redirected = graph.redirects.get(specifier) ?? specifier;
    if (graph.modules.has(redirected)) return redirected;
  }
  return undefined;
}

function denoModuleForFileName(
  graphs: DenoModuleGraph[],
  fileName: string,
): DenoInfoModule | undefined {
  const candidates = isUrl(fileName) ? [fileName] : [fileName, pathAsFileUrl(fileName)];
  for (const graph of graphs) {
    for (const candidate of candidates) {
      if (candidate === undefined) continue;
      const redirected = graph.redirects.get(candidate) ?? candidate;
      const module = graph.modules.get(redirected);
      if (module) return module;
    }
  }
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const module = knownDenoModules.get(candidate);
    if (module) return module;
  }
  return undefined;
}

function pathAsFileUrl(value: string): string | undefined {
  try {
    return pathToFileURL(value).href;
  } catch {
    return undefined;
  }
}

function needsDenoModuleResolution(specifier: string): boolean {
  return mustResolveWithDeno(specifier) || specifier.startsWith("npm:") ||
    isBareDenoSpecifier(specifier);
}

function mustResolveWithDeno(specifier: string): boolean {
  return specifier.startsWith("jsr:") || specifier.startsWith("https://") ||
    specifier.startsWith("http://");
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

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function denoTypesSource(): string {
  if (denoTypesCache !== undefined) return denoTypesCache;
  denoTypesCache = `${generatedDenoTypes() ?? denoCliTypes()}
declare namespace Deno {
  interface UnsafeWindowSurface {
    getContext(contextId: "webgpu", options?: any): GPUCanvasContext | null;
  }
}
`;
  return denoTypesCache;
}

function generatedDenoTypes(): string | undefined {
  const url = new URL("../../generated/deno_types.d.ts.txt", import.meta.url);
  if (url.protocol !== "file:") return undefined;
  const path = fileURLToPath(url);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function denoCliTypes(): string {
  const denoCli = resolveDenoCliPath();
  if (!denoCli) {
    throw new Error(
      "cannot load Deno type declarations without a Deno CLI on PATH (or WORKMAN_DENO_PATH)",
    );
  }
  const output = runtime.runSync(denoCli, ["types"]);
  if (!output.success) {
    const message = output.stderr.trim();
    throw new Error(`cannot load Deno type declarations${message ? `: ${message}` : ""}`);
  }
  return output.stdout;
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

export function findVariable(
  root: Node,
  name: string,
): VariableDeclaration | undefined {
  let found: VariableDeclaration | undefined;
  const visit = (node: Node) => {
    if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    node.forEachChild(visit);
  };
  visit(root);
  return found;
}

export function findDeclaredValue(
  root: Node,
  name: string,
): Identifier | undefined {
  let found: Identifier | undefined;
  const visit = (node: Node) => {
    if (isIdentifier(node) && node.text === name) {
      found = node;
      return;
    }
    node.forEachChild(visit);
  };
  visit(root);
  return found;
}

export function findCallInitializer(
  root: Node,
  name: string,
): CallExpression | undefined {
  const initializer = findVariable(root, name)?.initializer;
  return initializer && isCallExpression(initializer) ? initializer : undefined;
}

export function resolveSymbolDeclaration(symbol: TsSymbol): Declaration | undefined {
  const handle = symbol.valueDeclaration ?? symbol.declarations[0];
  return handle?.resolve();
}

export function resolveSymbolDeclarations(symbol: TsSymbol): Declaration[] {
  const result: Declaration[] = [];
  for (const handle of symbol.declarations) {
    const resolved = handle.resolve();
    if (resolved) result.push(resolved);
  }
  return result;
}

export function resolveSignatureDeclaration(
  signature: Signature,
): SignatureDeclaration | undefined {
  const resolved = signature.declaration?.resolve();
  return resolved && "parameters" in resolved ? (resolved as SignatureDeclaration) : undefined;
}

export function typeOfSymbol(checker: Checker, symbol: TsSymbol): Type | undefined {
  return checker.getTypeOfSymbol(symbol);
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
