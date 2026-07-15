import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, "package.json"), "utf8"));
const outputDirectory = path.join(extensionRoot, "dist");
const output = path.join(
  outputDirectory,
  `${manifest.publisher}.${manifest.name}-${manifest.version}.vsix`,
);

await fs.mkdir(outputDirectory, { recursive: true });
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  command,
  ["--yes", "@vscode/vsce", "package", "--no-dependencies", "--out", output],
  {
    cwd: extensionRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
