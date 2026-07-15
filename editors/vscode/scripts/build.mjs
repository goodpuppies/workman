import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(extensionRoot, "..", "..");
const nodePaths = [path.join(extensionRoot, "node_modules")];

await Promise.all([
  fs.rm(path.join(extensionRoot, "out"), { recursive: true, force: true }),
  fs.rm(path.join(extensionRoot, "server"), { recursive: true, force: true }),
]);

await Promise.all([
  build({
    entryPoints: [path.join(extensionRoot, "src", "extension.ts")],
    outfile: path.join(extensionRoot, "out", "extension.js"),
    bundle: true,
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: false,
    nodePaths,
  }),
  build({
    entryPoints: [path.join(repositoryRoot, "src", "lsp", "node_entry.ts")],
    outfile: path.join(extensionRoot, "server", "workman-lsp.mjs"),
    bundle: true,
    format: "esm",
    minify: true,
    platform: "node",
    target: "node20",
    banner: {
      js: 'import { createRequire } from "node:module"; import { fileURLToPath } from "node:url"; import { dirname } from "node:path"; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);',
    },
    sourcemap: false,
    nodePaths,
  }),
]);

const typescriptLib = path.join(extensionRoot, "node_modules", "@typescript", "old", "lib");
const serverDirectory = path.join(extensionRoot, "server");
const libraryFiles = (await fs.readdir(typescriptLib)).filter((name) =>
  name.startsWith("lib.") && name.endsWith(".d.ts")
);
await Promise.all(
  libraryFiles.map((name) => fs.copyFile(path.join(typescriptLib, name), path.join(serverDirectory, name))),
);
