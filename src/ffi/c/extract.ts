// C header reflection driver. Bundled Aro reads C headers at runtime; the legacy
// backend stamps the embedded Zig template and invokes zig run.
// Both return the same reflection JSON. The parser supplies target layouts;
// Workman does not compute C struct layout.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import process from "node:process";
import { promisify } from "node:util";

import { bundledCHeaderExtractor } from "./bundled_extractor.ts";

import { cHeaderExtractorSource } from "../../generated/assets.ts";

const execFileAsync = promisify(execFile);

export interface ExtractedTypeDesc {
  kind: string;
  bits?: number;
  signed?: boolean;
  name?: string;
  child?: ExtractedTypeDesc;
  length?: number;
  const?: boolean;
  target?: ExtractedTypeDesc;
}

export interface ExtractedField {
  name: string;
  type: ExtractedTypeDesc;
  offset: number;
}

export interface ExtractedStruct {
  kind: "struct";
  name: string;
  size: number;
  align: number;
  fields: ExtractedField[];
  opaque: boolean;
}

export interface ExtractedEnumTag {
  name: string;
  value: number;
}

export interface ExtractedEnum {
  kind: "enum";
  name: string;
  tags: ExtractedEnumTag[];
  backing: ExtractedTypeDesc;
}

export interface ExtractedAlias {
  kind: "alias";
  name: string;
  target: ExtractedTypeDesc;
}

export type ExtractedType = ExtractedStruct | ExtractedEnum | ExtractedAlias;

export interface ExtractedFn {
  name: string;
  params: ExtractedTypeDesc[];
  return: ExtractedTypeDesc | null;
}

export interface ExtractedValue {
  name: string;
  type: ExtractedTypeDesc;
  value: unknown;
}

export interface ExtractedResult {
  types: ExtractedType[];
  fns: ExtractedFn[];
  values: ExtractedValue[];
}

export class CHeaderExtractError extends Error {
  constructor(
    message: string,
    readonly header: string,
    readonly stderr: string,
    readonly generatedPath?: string,
  ) {
    super(message);
    this.name = "CHeaderExtractError";
  }
}

export interface ExtractOptions {
  /** Header path or bare name, as it appears in the import decl. */
  header: string;
  symbols: string[];
  /** Absolute path of the header when `header` is project-relative. */
  headerDir?: string;
  target?: string;
  includeDirs?: string[];
  defines?: string[];
  cacheDir?: string;
  zigPath?: string;
  /** Standalone Aro extractor; Zig is not invoked when this is supplied. */
  extractorPath?: string | false;
}

// An explicit Linux target uses Zig's bundled libc instead of potentially newer host CRT files.
const DEFAULT_TARGET = process.platform === "linux"
  ? `${
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  }-linux-gnu`
  : "native";
const zigVersions = new Map<string, Promise<string>>();

export async function extractCHeader(
  options: ExtractOptions,
): Promise<ExtractedResult> {
  const extractorPath = options.extractorPath === false
    ? undefined
    : options.extractorPath ?? process.env.WM_C_HEADER_EXTRACTOR;
  if (extractorPath) return extractWithAro(options, extractorPath);
  if (
    options.extractorPath !== false && !options.zigPath && process.env.WM_C_HEADER_BACKEND !== "zig"
  ) {
    let bundled: string | undefined;
    try {
      bundled = await bundledCHeaderExtractor();
    } catch (error) {
      throw new CHeaderExtractError(
        `Cannot prepare bundled C header extractor: ${String(error)}`,
        options.header,
        String(error),
      );
    }
    if (bundled) return extractWithAro(options, bundled);
  }
  const target = options.target ??
    process.env.WM_C_HEADER_TARGET ??
    DEFAULT_TARGET;
  const includeDirs = [
    ...(options.includeDirs ?? []),
    ...readEnvList("WM_C_HEADER_INCLUDE_DIRS"),
  ];
  const defines = [
    ...(options.defines ?? []),
    ...readEnvList("WM_C_HEADER_DEFINES"),
  ];
  const symbols = [...new Set(options.symbols)];
  const zigPath = options.zigPath ?? process.env.WM_ZIG_PATH ?? "zig";
  const zigVersion = await requireZig(zigPath, options.header);

  const cacheDir = options.cacheDir ??
    process.env.WM_C_CACHE_DIR ??
    ".wm_cache/c_headers";
  const extractorSource = cHeaderExtractorSource;
  const key = await cacheKey({
    header: options.header,
    target: target === "native" ? `native:${process.arch}-${process.platform}` : target,
    includeDirs,
    defines,
    symbols,
    extractor: extractorSource,
    zigVersion,
  });
  const cachePath = `${cacheDir}/${key}.json`;
  const cached = await readCache(cachePath);
  if (cached) return cached;

  const dir = await fs.mkdtemp(join(tmpdir(), "wm_c_"));
  const skip = new Set<string>();
  try {
    const sourcePath = `${dir}/c_header_extract.zig`;
    const header = await resolveHeaderPath(options.header);
    let json: string;
    for (let retries = 0;; retries += 1) {
      const source = stampTemplate(extractorSource, header, symbols, skip);
      await fs.writeFile(sourcePath, source);
      try {
        json = await runZig({
          zigPath,
          sourcePath,
          target,
          includeDirs,
          defines,
          header: options.header,
        });
        break;
      } catch (error) {
        // Untranslatable macros surface as @compileError decls; skip them
        // and retry until the namespace is clean.
        const failed = error instanceof CHeaderExtractError ? error.stderr : "";
        const names = [...failed.matchAll(
          /pub const (\w+) = @compileError/g,
        )].map((match) => match[1]);
        const fresh = names.filter((name) => !skip.has(name));
        if (fresh.length === 0 || retries >= 64) throw error;
        for (const name of fresh) skip.add(name);
      }
    }
    const parsed = JSON.parse(json) as ExtractedResult;
    await writeCache(cachePath, parsed);
    return parsed;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const aroVersions = new Map<string, Promise<string>>();

async function extractWithAro(
  options: ExtractOptions,
  executable: string,
): Promise<ExtractedResult> {
  const binary = resolve(executable);
  let pending = aroVersions.get(binary);
  if (!pending) {
    pending = (async () => {
      const version =
        (await execFileAsync(binary, ["--version"], { encoding: "utf8", windowsHide: true })).stdout
          .trim();
      if (!version.startsWith("workman-c-header-extractor/1 ")) {
        throw new Error(`unsupported Aro extractor protocol: ${version}`);
      }
      return `${version}:${createHash("sha256").update(await fs.readFile(binary)).digest("hex")}`;
    })();
    aroVersions.set(binary, pending);
  }
  let version: string;
  try {
    version = await pending;
  } catch (error) {
    aroVersions.delete(binary);
    throw new CHeaderExtractError(
      `Cannot run Aro extractor ${binary}: ${
        String(error)
      }. Build it with deno task c-header:build or correct WM_C_HEADER_EXTRACTOR.`,
      options.header,
      String(error),
    );
  }
  const target = options.target ?? process.env.WM_C_HEADER_TARGET ?? DEFAULT_TARGET;
  const includeDirs = [...(options.includeDirs ?? []), ...readEnvList("WM_C_HEADER_INCLUDE_DIRS")]
    .map((directory) => resolve(directory));
  const defines = [...(options.defines ?? []), ...readEnvList("WM_C_HEADER_DEFINES")];
  const symbols = [...new Set(options.symbols)];
  const header = await resolveHeaderPath(options.header);
  const key = await cacheKey({
    header,
    target: target === "native" ? `native:${process.arch}-${process.platform}` : target,
    includeDirs,
    defines,
    symbols,
    extractor: version,
    zigVersion: "standalone-aro",
  });
  const directory = options.cacheDir ?? process.env.WM_C_CACHE_DIR ?? ".wm_cache/c_headers";
  const path = join(directory, `${key}.aro.json`);
  try {
    const cached = JSON.parse(await fs.readFile(path, "utf8"));
    if (Array.isArray(cached.dependencies) && cached.dependencies.length > 0) {
      const valid = await Promise.all(
        cached.dependencies.map(async (dependency: { path: string; hash: string }) =>
          createHash("sha256").update(await fs.readFile(dependency.path)).digest("hex") ===
            dependency.hash
        ),
      );
      if (valid.every(Boolean)) return cached.result;
    }
  } catch { /* Missing or stale dependency invalidates the reflection cache. */ }
  const args = ["-target", target, "-resource-dir", dirname(binary)];
  for (const dir of includeDirs) args.push(`-I${dir}`);
  for (const define of defines) args.push(define.startsWith("-D") ? define : `-D${define}`);
  for (const symbol of symbols) args.push("--symbol", symbol);
  // Bare system headers need an include directive, rather than a filesystem input.
  let input = header;
  if (!isAbsolute(header)) {
    await fs.mkdir(directory, { recursive: true });
    input = resolve(directory, `${key}.include.c`);
    const source = `#include ${JSON.stringify(header)}\n`;
    if (await fs.readFile(input, "utf8").catch(() => "") !== source) {
      await fs.writeFile(input, source);
    }
  }
  args.push(input);
  try {
    const output = await execFileAsync(binary, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    const { dependencies: paths, ...result } = JSON.parse(output.stdout);
    const dependencies = await Promise.all((paths ?? [header]).map(async (path: string) => ({
      path,
      hash: createHash("sha256").update(await fs.readFile(path)).digest("hex"),
    })));
    await fs.mkdir(directory, { recursive: true }).then(() =>
      fs.writeFile(path, JSON.stringify({ dependencies, result }))
    ).catch(() => {});
    return result;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new CHeaderExtractError(
      `Aro C header reflection failed (header: ${options.header}):\n${
        failure.stderr || failure.message
      }`,
      options.header,
      failure.stderr || failure.message,
    );
  }
}

/** Probe once per executable per process; failed probes can be retried after fixing PATH. */
async function requireZig(zigPath: string, header: string): Promise<string> {
  let pending = zigVersions.get(zigPath);
  if (!pending) {
    pending = (async () => {
      const result = await execFileAsync(zigPath, ["version"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const version = result.stdout.trim();
      if (!/^0\.16\.\d+$/.test(version)) {
        throw new Error(
          `unsupported Zig version ${
            JSON.stringify(version)
          }; expected Zig 0.16.x (tested with 0.16.0)`,
        );
      }
      return version;
    })();
    zigVersions.set(zigPath, pending);
  }
  try {
    return await pending;
  } catch (error) {
    zigVersions.delete(zigPath);
    const detail = (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ? `Zig executable ${JSON.stringify(zigPath)} was not found`
      : error instanceof Error
      ? error.message
      : String(error);
    throw new CHeaderExtractError(
      `${detail}. C header reflection requires a system installation of Zig 0.16.x, including its lib directory. Install Zig on PATH or set WM_ZIG_PATH to its executable (header: ${header}).`,
      header,
      detail,
    );
  }
}

/**
 * @cInclude resolves relative to the generated extractor file's directory (a
 * temp dir), so any header that exists relative to the cwd must be
 * absolutized. Bare names that do not exist locally (stdio.h) stay as-is for
 * the compiler's own include path.
 */
async function resolveHeaderPath(header: string): Promise<string> {
  if (header.includes("/")) {
    return (await fs.realpath(header)).replaceAll("\\", "/");
  }
  try {
    return (await fs.realpath(header)).replaceAll("\\", "/");
  } catch {
    return header;
  }
}

function stampTemplate(
  source: string,
  header: string,
  symbols: string[],
  skip: Set<string>,
): string {
  if (
    !source.includes("{{HEADER}}") || !source.includes("{{SYMBOLS}}") ||
    !source.includes("{{SKIP}}")
  ) {
    throw new CHeaderExtractError(
      "extractor template is missing placeholder slots",
      header,
      "",
    );
  }
  const symbolLines = symbols.map((symbol) =>
    `"${symbol.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}",`
  ).map((line) => `    ${line}`).join("\n");
  const skipLines = [...skip].map((symbol) =>
    `"${symbol.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}",`
  ).map((line) => `    ${line}`).join("\n");
  return source
    .replace("{{HEADER}}", header)
    .replace("{{SYMBOLS}}", symbolLines)
    .replace("{{SKIP}}", skipLines);
}

async function runZig(options: {
  zigPath: string;
  sourcePath: string;
  target: string;
  includeDirs: string[];
  defines: string[];
  header: string;
}): Promise<string> {
  const args = ["run", "-target", options.target, "-lc", "-fstrip"];
  for (const dir of options.includeDirs) args.push(`-I${dir}`);
  for (const define of options.defines) args.push(define.startsWith("-D") ? define : `-D${define}`);
  args.push(options.sourcePath);
  try {
    const result = await execFileAsync(options.zigPath, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string; code?: number | string };
    const stderrText = failure.stderr || failure.message;
    const excerpt = stderrText.split("\n").slice(0, 30).join("\n");
    throw new CHeaderExtractError(
      `zig extractor failed with exit code ${
        failure.code ?? "unknown"
      } (header: ${options.header}, generated: ${options.sourcePath})\n${excerpt}`,
      options.header,
      stderrText,
      options.sourcePath,
    );
  }
}

async function cacheKey(input: {
  header: string;
  target: string;
  includeDirs: string[];
  defines: string[];
  symbols: string[];
  extractor: string;
  zigVersion: string;
}): Promise<string> {
  const payload = [
    input.header,
    input.target,
    input.includeDirs.join(";"),
    input.defines.join(";"),
    input.symbols.join(";"),
    input.extractor,
    input.zigVersion,
  ].join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readCache(path: string): Promise<ExtractedResult | null> {
  try {
    const text = await fs.readFile(path, "utf8");
    return JSON.parse(text) as ExtractedResult;
  } catch {
    return null;
  }
}

async function writeCache(path: string, result: ExtractedResult): Promise<void> {
  try {
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(path, JSON.stringify(result));
  } catch {
    // Cache write failures are non-fatal; extraction still succeeded.
  }
}

function readEnvList(key: string): string[] {
  const value = process.env[key];
  if (!value) return [];
  return value.split(";").filter((part) => part.length > 0);
}
