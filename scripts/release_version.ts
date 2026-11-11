import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, "deno.json");
const config = JSON.parse(await Deno.readTextFile(configPath));
const requested = Deno.args[0];
if (Deno.args.length > 1 || requested && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested)) {
  throw new Error("Usage: release_version.ts [version]");
}
const version = requested ?? config.version;
const files = [
  "deno.json",
  "package.json",
  "editors/vscode/package.json",
  "editors/vscode/package-lock.json",
];
for (const file of files) {
  const path = join(root, file);
  const data = JSON.parse(await Deno.readTextFile(path));
  data.version = version;
  if (file.endsWith("package-lock.json")) data.packages[""].version = version;
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n");
}
console.log(`Synchronized ${version}; deno.json is the release version source`);
