// C header reflection driver.
//
// Stamps the embedded Zig extractor template
// (`zig/c_header_extract.zig`) with a header and symbol list, runs `zig run`,
// parses the JSON result, and caches it. The extracted JSON is the C FFI's
// reflection artifact — the counterpart of the TS reflection host's answers
// for the JS FFI. Zig's C layout is authoritative; nothing here computes
// struct layout.

import { createTemporaryDirectory } from "../../temporary_directory.ts";

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
}

const DEFAULT_TARGET = "x86_64-linux-gnu";

const EXTRACTOR_URL = new URL("./zig/c_header_extract.zig", import.meta.url);

export async function extractCHeader(
  options: ExtractOptions,
): Promise<ExtractedResult> {
  const target = options.target ??
    Deno.env.get("WM_C_HEADER_TARGET") ??
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

  const cacheDir = options.cacheDir ??
    Deno.env.get("WM_C_CACHE_DIR") ??
    ".wm_cache/c_headers";
  const extractorSource = await (await fetch(EXTRACTOR_URL)).text();
  const key = await cacheKey({
    header: options.header,
    target,
    includeDirs,
    defines,
    symbols,
    extractor: extractorSource,
  });
  const cachePath = `${cacheDir}/${key}.json`;
  const cached = await readCache(cachePath);
  if (cached) return cached;

  const dir = await createTemporaryDirectory({ prefix: "wm_c_" });
  const skip = new Set<string>();
  try {
    const sourcePath = `${dir.path}/c_header_extract.zig`;
    const header = await resolveHeaderPath(options.header);
    let json: string;
    for (let retries = 0;; retries += 1) {
      const source = stampTemplate(extractorSource, header, symbols, skip);
      await Deno.writeTextFile(sourcePath, source);
      try {
        json = await runZig({
          zigPath: options.zigPath ?? Deno.env.get("WM_ZIG_PATH") ?? "zig",
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
    await dir.cleanup();
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
    return (await Deno.realPath(header)).replaceAll("\\", "/");
  }
  try {
    return (await Deno.realPath(header)).replaceAll("\\", "/");
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

function runZig(options: {
  zigPath: string;
  sourcePath: string;
  target: string;
  includeDirs: string[];
  defines: string[];
  header: string;
}): Promise<string> {
  const args = ["run", "-target", options.target, "-lc", "-fstrip"];
  for (const dir of options.includeDirs) args.push(`-I${dir}`);
  for (const define of options.defines) {
    args.push(define.startsWith("-D") ? define : `-D${define}`);
  }
  args.push(options.sourcePath);
  const command = new Deno.Command(options.zigPath, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  return command.output().then(({ stdout, stderr, code }) => {
    const stderrText = new TextDecoder().decode(stderr);
    if (code !== 0) {
      const excerpt = stderrText.split("\n").slice(0, 30).join("\n");
      throw new CHeaderExtractError(
        `zig extractor failed with exit code ${code} (header: ${options.header}, generated: ${options.sourcePath})\n${excerpt}`,
        options.header,
        stderrText,
        options.sourcePath,
      );
    }
    return new TextDecoder().decode(stdout);
  });
}

async function cacheKey(input: {
  header: string;
  target: string;
  includeDirs: string[];
  defines: string[];
  symbols: string[];
  extractor: string;
}): Promise<string> {
  const payload = [
    input.header,
    input.target,
    input.includeDirs.join(";"),
    input.defines.join(";"),
    input.symbols.join(";"),
    input.extractor,
  ].join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readCache(path: string): Promise<ExtractedResult | null> {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as ExtractedResult;
  } catch {
    return null;
  }
}

async function writeCache(path: string, result: ExtractedResult): Promise<void> {
  try {
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(result));
  } catch {
    // Cache write failures are non-fatal; extraction still succeeded.
  }
}

function readEnvList(key: string): string[] {
  const value = Deno.env.get(key);
  if (!value) return [];
  return value.split(";").filter((part) => part.length > 0);
}
