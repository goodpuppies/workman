// Preloaded V8 parser benchmark. Complete output hashes are outside the hot loop.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const artifact = resolve(Deno.args[0] ?? "src/generated/frontend_v2_parser.js");
const iterations = Number(Deno.args[1] ?? "2");
const corpus = Deno.args[2] === "small"
  ? [
    "examples/factorial.wm",
    "std/list.wm",
    "tooling/frontend-v2/surface_parse_runtime.wm",
  ]
  : [
    "examples/factorial.wm",
    "std/list.wm",
    "tooling/frontend-v2/surface_parse_runtime.wm",
    "tooling/frontend-v2/generated/compiled_probe_dispatch.wm",
    "tooling/wmslang/compiler.wm",
    "tooling/wmslang/slice_emit.wm",
    "tooling/frontend-v3/src/parser/program.wm",
  ];
const sources = await Promise.all(corpus.map((path) => Deno.readTextFile(path)));
const parser = await import(pathToFileURL(artifact).href);
const encoder = new TextEncoder();
const digests: string[] = [];
for (const source of sources) {
  const result = parser.parseSurfaceProgram(source);
  if (result?.ctor !== -2) throw new Error("corpus parse failed");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(result)));
  digests.push(Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join(""));
}
function batch(): number {
  let checked = 0;
  for (let n = 0; n < iterations; n++) {
    for (const source of sources) {
      if (parser.parseSurfaceProgram(source)?.ctor !== -2) throw new Error("hot parse failed");
      checked++;
    }
  }
  return checked;
}
batch();
const start = performance.now();
const checked = batch();
const milliseconds = performance.now() - start;
console.log(JSON.stringify({ corpus, digests, checked }));
console.error(`parser-ms=${milliseconds}`);
