import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFrontendV2Surface } from "../src/frontend_v2_surface_loader.ts";

type Mode = "surface" | "failure" | "format";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = resolve(root, Deno.args[2] ?? "src/generated/frontend_v2_parser.js");
const mode = modeFrom(Deno.args[0]);
const iterations = positiveInteger(Deno.args[1] ?? "1");
const files = await corpusFiles([
  resolve(root, "std"),
  resolve(root, "examples"),
  resolve(root, "tooling"),
]);

const artifactUrl = new URL("file:///" + artifact.replaceAll("\\", "/"));
const raw = await import(artifactUrl.href) as {
  formatSurfaceSource(source: string): unknown;
};
const frontend = await loadFrontendV2Surface(artifactUrl);
const samples: Array<{ path: string; milliseconds: number; length: number }> = [];
let totalBytes = 0;
const started = performance.now();

for (let iteration = 0; iteration < iterations; iteration += 1) {
  for (const path of files) {
    const source = await Deno.readTextFile(path);
    const before = performance.now();
    if (mode === "surface") frontend.parseSurfaceProgram(source);
    else if (mode === "failure") frontend.parseSurfaceFailure(source);
    else raw.formatSurfaceSource(source);
    samples.push({ path, milliseconds: performance.now() - before, length: source.length });
    totalBytes += source.length;
  }
}

const elapsed = performance.now() - started;
samples.sort((left, right) => right.milliseconds - left.milliseconds);
console.log(`frontend-v2 profile mode=${mode} iterations=${iterations}`);
console.log(`artifact=${artifact.slice(root.length + 1)}`);
console.log(
  `files=${files.length * iterations} bytes=${totalBytes} elapsed=${elapsed.toFixed(1)}ms`,
);
console.log("slowest files:");
for (const sample of samples.slice(0, 12)) {
  console.log(
    `${sample.milliseconds.toFixed(1)}ms\t${sample.length}\t${sample.path.slice(root.length + 1)}`,
  );
}

function modeFrom(value = "surface"): Mode {
  if (value === "surface" || value === "failure" || value === "format") return value;
  throw new Error(`mode must be surface, failure, or format; got ${value}`);
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`invalid iteration count ${value}`);
  return parsed;
}

async function corpusFiles(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const directory of roots) await collectWmFiles(directory, files);
  return files.sort();
}

async function collectWmFiles(directory: string, output: string[]): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory) await collectWmFiles(path, output);
    else if (entry.isFile && entry.name.endsWith(".wm")) output.push(path);
  }
}
