import { existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isStandaloneBinary } from "./child_runtime.ts";
import { runtime } from "./io.ts";

const nodeBuiltins = [
  "node:*",
  ...builtinModules.filter((name) => !name.startsWith("node:")),
];

export type BundleOptions = {
  /** Directory from which `node_modules` and package manifests are resolved. */
  projectDirectory: string;
};

/**
 * Resolves the native `esbuild` executable path when overridden or shipped beside a standalone
 * `wm` binary. Returns `undefined` to let the `esbuild` npm package resolve its own binary.
 */
export function resolveEsbuildBinaryPath(): string | undefined {
  const envPath = runtime.env("WM_ESBUILD_PATH")?.trim() ||
    runtime.env("ESBUILD_BINARY_PATH")?.trim();
  if (envPath && existsSync(envPath)) return envPath;
  if (isStandaloneBinary && typeof Deno !== "undefined") {
    const exeName = Deno.build.os === "windows" ? "esbuild.exe" : "esbuild";
    const sibling = join(dirname(Deno.execPath()), exeName);
    if (existsSync(sibling)) return sibling;
  }
  return undefined;
}

function nearestNodeModules(directory: string): string[] {
  const paths: string[] = [];
  for (let current = directory;; current = dirname(current)) {
    const candidate = join(current, "node_modules");
    if (existsSync(candidate)) paths.push(candidate);
    if (dirname(current) === current) break;
  }
  return paths;
}

/**
 * Bundles an emitted JavaScript entry module and its `node_modules` / local `.ts`/`.js` imports
 * into a single self-contained ESM file runnable by Deno (including a `deno compile`d binary).
 */
export async function bundleJavaScriptEntry(
  entryPath: string,
  outputPath: string,
  options: BundleOptions,
): Promise<void> {
  const binary = resolveEsbuildBinaryPath();
  if (binary && typeof Deno !== "undefined") {
    Deno.env.set("ESBUILD_BINARY_PATH", binary);
  }
  const esbuild = await import("esbuild");
  try {
    await esbuild.build({
      entryPoints: [entryPath],
      outfile: outputPath,
      bundle: true,
      format: "esm",
      platform: "node",
      packages: "bundle",
      external: nodeBuiltins,
      absWorkingDir: options.projectDirectory,
      nodePaths: nearestNodeModules(options.projectDirectory),
      plugins: [
        {
          name: "wm-file-url",
          setup(build) {
            build.onResolve({ filter: /^file:\/\// }, (args) => ({
              path: fileURLToPath(args.path),
            }));
          },
        },
      ],
      banner: {
        js:
          'import { createRequire as __wmCreateRequire } from "node:module"; const require = __wmCreateRequire(import.meta.url);',
      },
      logLevel: "silent",
    });
  } finally {
    await esbuild.stop();
  }
}
