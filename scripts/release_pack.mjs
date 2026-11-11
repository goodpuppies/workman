import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = resolve(process.argv[2] ?? "_scratch/release");
const metadata = JSON.parse(await readFile(join(output, "release.json"), "utf8"));
const destination = join(output, "artifacts");
await mkdir(destination, { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run release:pack");
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: root });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout;
}
const files = [];
for (const name of ["workman", ...metadata.artifacts.map((item) => `workman-${item.target}`)]) {
  const directory = join(output, "npm", name);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (manifest.version !== metadata.version) {
    throw new Error(`Stale package version: ${manifest.name}`);
  }
  const report = JSON.parse(
    run(process.execPath, [
      npmCli,
      "pack",
      directory,
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      destination,
    ]),
  );
  files.push({
    file: report[0].filename,
    sha256: await digest(join(destination, report[0].filename)),
  });
}
for (const artifact of metadata.artifacts) {
  const source = join(output, artifact.path);
  if (await digest(source) !== artifact.sha256) {
    throw new Error(`Binary checksum mismatch: ${artifact.path}`);
  }
  const directory = dirname(source);
  await copyFile(join(root, "LICENSE"), join(directory, "LICENSE"));
  const name = `workman-${metadata.version}-${artifact.target}.tar.gz`;
  run("tar", [
    "-czf",
    join(destination, name),
    "-C",
    directory,
    artifact.target.startsWith("win32") ? "wm.exe" : "wm",
    "LICENSE",
  ]);
  files.push({ file: name, sha256: await digest(join(destination, name)) });
}
await (await import("node:fs/promises")).writeFile(
  join(destination, "SHA256SUMS"),
  files.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n",
);
await (await import("node:fs/promises")).writeFile(
  join(destination, "release-manifest.json"),
  JSON.stringify({ ...metadata, files }, null, 2) + "\n",
);
console.log(`Packed ${files.length} release files in ${destination}`);
