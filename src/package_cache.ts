import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export function workmanCache(): string {
  const configured = Deno.env.get(Deno.build.os === "windows" ? "LOCALAPPDATA" : "XDG_CACHE_HOME");
  const cache = configured && isAbsolute(configured) ? configured : join(homedir(), ".cache");
  return join(cache, "workman");
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Pakman's compiler subprocesses and .wm resources need a real source tree.
 * Materialize the same immutable JSR package, not a moving Git branch. */
export async function cacheJsrPackage(
  moduleUrl: URL,
  cache = workmanCache(),
  request: typeof fetch = fetch,
): Promise<string> {
  const match = /^\/(@[^/]+\/[^/]+)\/(\d+\.\d+\.\d+(?:-[^/]+)?)\//.exec(moduleUrl.pathname);
  if (moduleUrl.origin !== "https://jsr.io" || !match) {
    throw new Error(`cannot locate installed WM package resources from ${moduleUrl.href}`);
  }
  const [, name, version] = match;
  const base = new URL(`/${name}/${version}/`, moduleUrl);
  const manifestUrl = new URL(`/${name}/${version}_meta.json`, moduleUrl);
  const key = await digest(new TextEncoder().encode(base.href));
  const root = join(cache, "packages", key);
  try {
    if (await Deno.readTextFile(join(root, ".complete")) === base.href) return root;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(dirname(root), { recursive: true });
  const response = await request(manifestUrl);
  if (!response.ok) throw new Error(`fetch ${manifestUrl}: HTTP ${response.status}`);
  const { manifest } = await response.json();
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("JSR package manifest is missing");
  }
  const entries = Object.entries(manifest) as [string, { size: number; checksum: string }][];
  // Validate every path before fetching or writing any files. The manifest is
  // remote input; it must not escape the package tree or alias a completion file.
  for (const [path, entry] of entries) {
    if (
      !path.startsWith("/") || path.includes("\\") || path.includes("%") ||
      path.slice(1).split("/").some((part) => !part || part === "." || part === "..") ||
      path.split("/")[1] === ".complete" || !Number.isSafeInteger(entry?.size) || entry.size < 0 ||
      !/^sha256-[0-9a-f]{64}$/.test(entry.checksum)
    ) {
      throw new Error(`invalid JSR package entry ${path}`);
    }
  }
  const stage = await Deno.makeTempDir({ dir: dirname(root), prefix: ".download-" });
  try {
    // Preserve the package's source layout and deno.json. Literal imports in
    // published TypeScript are already rewritten by JSR; non-TS compiler
    // resources remain available at their original relative paths.
    let cursor = 0;
    let failure: unknown;
    const workers = Array.from({ length: 8 }, async () => {
      while (!failure && cursor < entries.length) {
        const [path, entry] = entries[cursor++];
        try {
          const url = new URL(path.slice(1).split("/").map(encodeURIComponent).join("/"), base);
          const downloaded = await request(url);
          if (!downloaded.ok) throw new Error(`fetch ${url}: HTTP ${downloaded.status}`);
          const bytes = new Uint8Array(await downloaded.arrayBuffer());
          if (bytes.length !== entry.size || `sha256-${await digest(bytes)}` !== entry.checksum) {
            throw new Error(`JSR package checksum mismatch: ${path}`);
          }
          const target = join(stage, path.slice(1));
          await Deno.mkdir(dirname(target), { recursive: true });
          await Deno.writeFile(target, bytes);
        } catch (error) {
          failure = error;
        }
      }
    });
    await Promise.all(workers);
    if (failure) throw failure;
    for (const path of ["deno.json", "src/cli.ts", "tooling/pakman/pakman.wm"]) {
      if (!(await Deno.stat(join(stage, path))).isFile) {
        throw new Error(`missing WM resource ${path}`);
      }
    }
    await Deno.writeTextFile(join(stage, ".complete"), base.href);
    try {
      await Deno.rename(stage, root);
    } catch (error) {
      // Another invocation may have completed the same immutable package.
      if (await Deno.readTextFile(join(root, ".complete")).catch(() => "") !== base.href) {
        throw error;
      }
    }
    return root;
  } finally {
    await Deno.remove(stage, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}
