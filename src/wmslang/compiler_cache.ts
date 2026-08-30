import { loadWmslangSliceCompiler, type WmslangSliceCompiler } from "./v2_loader.ts";

const WMSLANG_COMPILER_CACHE_NAME = "goodpuppies-workman-wmslang-compiler";
const WMSLANG_COMPILER_CACHE_SCHEMA = 1;
const CACHE_ORIGIN = "https://wmslang-compiler-cache.workman.invalid";

export type WmslangCompilerCacheOptions = {
  identity: string;
  build(): Promise<string>;
  cacheName?: string;
};

export async function loadCachedWmslangCompiler(
  options: WmslangCompilerCacheOptions,
): Promise<WmslangSliceCompiler> {
  const cacheName = options.cacheName ?? WMSLANG_COMPILER_CACHE_NAME;
  const key = cacheKey(options.identity);
  let cache: Cache | undefined;
  try {
    cache = await caches.open(cacheName);
    const cached = await cache.match(key);
    if (cached) {
      const source = await cached.text();
      try {
        return await loadCompilerSource(source, options.identity);
      } catch {
        await cache.delete(key);
      }
    }
  } catch {
    // CacheStorage is an optimization. Restricted hosts retain the source bootstrap.
  }

  const source = await options.build();
  const compiler = await loadCompilerSource(source, options.identity);
  if (cache) {
    try {
      await cache.put(
        key,
        new Response(source, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        }),
      );
    } catch {
      // A valid compiler is already loaded; failure to persist it is non-fatal.
    }
  }
  return compiler;
}

export async function defaultWmslangCompilerIdentity(): Promise<string> {
  const root = new URL("../../", import.meta.url);
  const files = [
    ...await sourceFiles(new URL("src/", root), [".ts"]),
    ...await sourceFiles(new URL("std/", root), [".wm"]),
    ...await sourceFiles(new URL("tooling/wmslang/", root), [".wm"]),
    new URL("deno.json", root),
  ].sort((left, right) => left.href.localeCompare(right.href));
  const parts: string[] = [`schema:${WMSLANG_COMPILER_CACHE_SCHEMA}\0`];
  for (const file of files) {
    parts.push(file.href.slice(root.href.length), "\0", await Deno.readTextFile(file), "\0");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("")),
  );
  return hex(new Uint8Array(digest));
}

function cacheKey(identity: string): string {
  return `${CACHE_ORIGIN}/v${WMSLANG_COMPILER_CACHE_SCHEMA}/${identity}.mjs`;
}

function loadCompilerSource(source: string, identity: string): Promise<WmslangSliceCompiler> {
  return loadWmslangSliceCompiler(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}#${identity}`,
  );
}

async function sourceFiles(directory: URL, extensions: string[]): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) {
      files.push(...await sourceFiles(url, extensions));
    } else if (entry.isFile && extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(url);
    }
  }
  return files;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
