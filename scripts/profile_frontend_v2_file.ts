import { resolve } from "node:path";
import { loadFrontendV2Surface } from "../src/frontend_v2_surface_loader.ts";

const artifact = resolve(Deno.args[0] ?? "src/generated/frontend_v2_parser.js");
const input = resolve(Deno.args[1] ?? "tooling/wmslang/compiler.wm");
const iterations = Number(Deno.args[2] ?? "1");
if (!Number.isInteger(iterations) || iterations < 1) throw new Error("iterations must be positive");

const frontend = await loadFrontendV2Surface(new URL(`file://${artifact}`));
const source = await Deno.readTextFile(input);
const started = performance.now();
for (let iteration = 0; iteration < iterations; iteration++) {
  frontend.parseSurfaceProgram(source);
}
console.log(
  `frontend-v2 file profile bytes=${source.length} iterations=${iterations} ` +
    `elapsed=${(performance.now() - started).toFixed(1)}ms`,
);
