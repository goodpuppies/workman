// Publishes the npm packages from the release-artifacts workflow's downloaded artifacts:
// `node scripts/npm_publish.mjs <artifacts directory>`, where each `workman-<target>` folder holds
// what scripts/release_pack.mjs wrote on that target's runner. The six platform packages go first,
// each from its native build, then the main package that depends on them. A version npm already
// has is skipped, so a rerun after a partial failure finishes the rest.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const targets = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
  "win32-arm64",
];
const artifacts = resolve(process.argv[2] ?? "artifacts");
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (tag !== undefined && tag !== version) {
  throw new Error(`Tag ${tag} does not match package.json version ${version}`);
}

async function verified(target, file) {
  const directory = join(artifacts, `workman-${target}`);
  const sums = await readFile(join(directory, "SHA256SUMS"), "utf8");
  const expected = sums.split("\n").find((line) => line.endsWith(`  ${file}`))?.split("  ")[0];
  const path = join(directory, file);
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (expected !== actual) throw new Error(`Checksum mismatch: workman-${target}/${file}`);
  return path;
}

function published(name) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() === version;
}

function publish(name, tarball) {
  if (published(name)) {
    console.log(`${name}@${version} is already on npm`);
    return;
  }
  const result = spawnSync("npm", ["publish", "--access", "public", tarball], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`npm publish failed for ${name}`);
}

const packages = [];
for (const target of targets) {
  const file = `goodpuppies-workman-${target}-${version}.tgz`;
  packages.push([`@goodpuppies/workman-${target}`, await verified(target, file)]);
}
// Packed on Linux, the main package keeps the launcher's executable bit, which Windows packing drops.
packages.push([
  "@goodpuppies/workman",
  await verified("linux-x64", `goodpuppies-workman-${version}.tgz`),
]);

for (const [name, tarball] of packages) publish(name, tarball);
