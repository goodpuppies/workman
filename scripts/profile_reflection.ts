import {
  type JsReflectionProfileEvent,
  setJsReflectionProfileSink,
} from "../src/ffi/reflect/host.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { analyzeModuleGraph, StagedAnalysisError } from "../src/staged_analysis.ts";
import { isAbsolute, relative } from "node:path";

const input = Deno.args[0] ?? "../wmthree/src/scripts/play.wm";
const events: JsReflectionProfileEvent[] = [];
const phases = new Map<string, number>();
const phaseDetails: { phase: string; path: string; milliseconds: number }[] = [];
const jsonPath = Deno.args.find((arg) => arg.startsWith("--json="))?.slice("--json=".length);
let failure: unknown;
let graphSummary: { modules: number; sourceCharacters: number; paths: string[] } | undefined;
setJsReflectionProfileSink((event) => events.push(event));

const started = performance.now();
try {
  const graphStarted = performance.now();
  const graph = await loadModuleGraph(input);
  phases.set("load module graph", performance.now() - graphStarted);
  graphSummary = {
    modules: graph.nodes.size,
    sourceCharacters: [...graph.nodes.values()].reduce((sum, node) => sum + node.source.length, 0),
    paths: [...graph.nodes.values()].map((node) => node.path),
  };
  await analyzeModuleGraph(graph, {
    onTiming: ({ phase, node, milliseconds }) => {
      phases.set(phase, (phases.get(phase) ?? 0) + milliseconds);
      phaseDetails.push({ phase, path: node?.path ?? "<standard library>", milliseconds });
    },
  });
} catch (error) {
  failure = error;
} finally {
  setJsReflectionProfileSink(undefined);
}

if (jsonPath) {
  await Deno.writeTextFile(
    jsonPath,
    JSON.stringify(
      {
        input,
        completed: failure === undefined,
        failure: failure === undefined ? undefined : {
          message: failure instanceof Error ? failure.message : String(failure),
          phase: failure instanceof StagedAnalysisError ? failure.phase : undefined,
          path: failure instanceof StagedAnalysisError ? failure.node.path : undefined,
        },
        totalMs: performance.now() - started,
        graph: graphSummary,
        phases: Object.fromEntries(phases),
        phaseDetails,
        events,
      },
      null,
      2,
    ) + "\n",
  );
}
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.stack : String(failure));
  Deno.exitCode = 1;
}

const batches = events.filter((event) => event.kind === "batch");
const reads = events.filter((event) => event.kind === "read");
const coldReads = reads.filter((event) => !event.cacheHit);
const cachedReads = reads.filter((event) => event.cacheHit);
const moduleGraphs = events.filter((event) => event.kind === "deno-info");

console.log(`reflection profile: ${input}`);
console.log(`total: ${ms(performance.now() - started)}`);
console.log("");
console.log("phases:");
for (const [phase, duration] of phases) console.log(`  ${phase}: ${ms(duration)}`);
console.log("");
console.log("slowest module phases:");
for (
  const detail of [...phaseDetails].sort((a, b) => b.milliseconds - a.milliseconds).slice(0, 24)
) {
  console.log(`  ${ms(detail.milliseconds)} ${detail.phase} ${shortPath(detail.path)}`);
}
console.log("");
console.log("workspace batches:");
console.log(`  count: ${batches.length}`);
console.log(`  requests: ${sum(batches, (event) => event.requests)}`);
console.log(`  roots: ${sum(batches, (event) => event.roots)}`);
console.log(`  source: ${sum(batches, (event) => event.sourceBytes)} bytes`);
console.log(`  graph discovery: ${ms(sum(batches, (event) => event.graphMs))}`);
console.log(`  createProgram: ${ms(sum(batches, (event) => event.programMs))}`);
console.log(`  semantic diagnostics: ${ms(sum(batches, (event) => event.diagnosticsMs))}`);
console.log(`  getTypeChecker: ${ms(sum(batches, (event) => event.checkerMs))}`);
console.log(`  index roots: ${ms(sum(batches, (event) => event.indexMs))}`);
console.log(`  total: ${ms(sum(batches, (event) => event.totalMs))}`);
console.log("");
console.log("Deno module-graph subprocesses (included in workspace times):");
console.log(`  count: ${moduleGraphs.length}`);
console.log(`  total: ${ms(sum(moduleGraphs, (event) => event.milliseconds))}`);
for (
  const event of [...moduleGraphs].sort((a, b) => b.milliseconds - a.milliseconds).slice(0, 12)
) {
  console.log(`  ${ms(event.milliseconds)} ${event.success ? "ok" : "failed"} ${event.specifier}`);
}
const initialBatch = batches.find((event) => event.requests > 1);
if (initialBatch) {
  console.log(
    `  initial program: ${initialBatch.programFiles} files, ` +
      `${initialBatch.programSourceBytes} source bytes`,
  );
  console.log("  initial roots:");
  for (const root of initialBatch.rootDetails.sort((a, b) => b.requests - a.requests)) {
    console.log(
      `    ${root.requests} requests, ${root.sourceBytes} bytes ${shortPath(root.fileName)}`,
    );
  }
  console.log("  largest initial program files:");
  for (const file of initialBatch.largestProgramFiles) {
    console.log(`    ${file.sourceBytes} bytes ${shortPath(file.fileName)}`);
  }
}
console.log("");
console.log("checker reads:");
console.log(
  `  count: ${reads.length} (${cachedReads.length} prepared, ${coldReads.length} fallback)`,
);
console.log(`  prepared read time: ${ms(sum(cachedReads, (event) => event.readMs))}`);
console.log(`  fallback preparation: ${ms(sum(coldReads, (event) => event.prepareMs))}`);
console.log(`  fallback read time: ${ms(sum(coldReads, (event) => event.readMs))}`);
console.log("  fallback owners:");
const fallbackOwners = Map.groupBy(coldReads, (event) => reflectionOwner(event.label));
for (
  const [owner, ownerReads] of [...fallbackOwners].sort((left, right) =>
    sum(right[1], totalReadMs) - sum(left[1], totalReadMs)
  )
) {
  console.log(
    `    ${owner}: ${ownerReads.length} queries, ${ms(sum(ownerReads, totalReadMs))} ` +
      `(workspace ${ms(sum(ownerReads, (event) => event.prepareMs))}, ` +
      `read ${ms(sum(ownerReads, (event) => event.readMs))})`,
  );
}

console.log("");
console.log("read categories:");
const categories = Map.groupBy(reads, (event) => reflectionCategory(event.label));
for (
  const [category, categoryReads] of [...categories].sort((left, right) =>
    sum(right[1], (event) => event.readMs) - sum(left[1], (event) => event.readMs)
  )
) {
  console.log(
    `  ${category}: ${categoryReads.length} reads, ${
      ms(sum(categoryReads, (event) => event.readMs))
    }`,
  );
}

console.log("");
console.log("slowest workspace batches:");
for (
  const [index, event] of [...batches].sort((a, b) => b.totalMs - a.totalMs).slice(0, 12).entries()
) {
  console.log(
    `  ${index + 1}. ${event.requests} requests / ${event.roots} roots: ${ms(event.totalMs)} ` +
      `(program ${ms(event.programMs)}, checker ${ms(event.checkerMs)}) ${
        batchLabel(event.labels)
      }`,
  );
}

console.log("");
console.log("slowest checker reads:");
for (
  const [index, event] of [...reads].sort((a, b) => b.readMs - a.readMs).slice(0, 24).entries()
) {
  console.log(
    `  ${index + 1}. ${ms(event.readMs)} ${
      event.cacheHit ? "prepared" : "fallback"
    } ${event.label}`,
  );
}

console.log("");
console.log("slowest fallback queries including workspace preparation:");
for (
  const [index, event] of [...coldReads].sort((a, b) =>
    b.prepareMs + b.readMs - (a.prepareMs + a.readMs)
  ).slice(0, 24).entries()
) {
  console.log(
    `  ${index + 1}. ${ms(event.prepareMs + event.readMs)} ` +
      `(workspace ${ms(event.prepareMs)}, read ${ms(event.readMs)}) ${event.label}`,
  );
}

function reflectionCategory(label: string): string {
  if (label.includes(":deep(")) return "deep literal call";
  if (label.endsWith(":type")) return "type materialization";
  if (label.endsWith(".new")) return "constructor";
  if (label.includes("(")) return "call-specific overload";
  if (label.includes(":namespace")) return "namespace";
  return "member/callable";
}

function reflectionOwner(label: string): string {
  if (label.includes("three/webgpu")) return "Three WebGPU";
  if (label.includes("@dimforge/rapier") || label.includes("rapier_helpers")) return "Rapier";
  if (label.includes("three_helpers")) return "local Three bridge";
  if (label.includes("Deno")) return "Deno globals";
  return "other globals/helpers";
}

function totalReadMs(event: Extract<JsReflectionProfileEvent, { kind: "read" }>): number {
  return event.prepareMs + event.readMs;
}

function sum<T>(items: T[], project: (item: T) => number): number {
  return items.reduce((total, item) => total + project(item), 0);
}

function ms(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function batchLabel(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  return `${labels[0]} + ${labels.length - 1} more`;
}

function shortPath(path: string): string {
  return isAbsolute(path) ? relative(Deno.cwd(), path) : path;
}
