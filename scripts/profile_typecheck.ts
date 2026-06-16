import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "../src/ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "../src/ffi/elab.ts";
import { inferModule, inferModulePartial, type InferResult } from "../src/infer.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { standardInferOptions } from "../src/standard_library.ts";
import { show } from "../src/types.ts";

type Options = {
  input: string;
  iterations: number;
  warmup: number;
  summaryBinding?: string;
};

type PhaseTiming = {
  name: string;
  ms: number;
};

type IterationTiming = {
  totalMs: number;
  phases: PhaseTiming[];
};

const options = parseArgs(Deno.args);

for (let i = 0; i < options.warmup; i++) {
  await profileTypecheck(options.input, options.summaryBinding);
}

const runs: IterationTiming[] = [];
for (let i = 0; i < options.iterations; i++) {
  runs.push(await profileTypecheck(options.input, options.summaryBinding));
}

printSummary(options, runs);

async function profileTypecheck(
  input: string,
  summaryBinding?: string,
): Promise<IterationTiming> {
  const phases: PhaseTiming[] = [];
  const totalStart = performance.now();

  const graph = await timed(phases, "load module graph", () => loadModuleGraph(input));
  const inferOptions = await timed(phases, "load standard library", () => standardInferOptions());

  const ffi = new Map<string, ReturnType<typeof prepareFfiElaboration>>();
  await timed(phases, "prepare FFI elaboration", () => {
    for (const node of graph.nodes.values()) {
      const prepared = prepareFfiElaboration(node.module);
      ffi.set(node.path, prepared);
      node.module = prepared.module;
    }
  });

  const firstResults = new Map<string, InferResult>();
  await timed(phases, "partial inference", () => {
    for (const path of graph.order) {
      const node = graph.nodes.get(path)!;
      firstResults.set(
        path,
        inferModulePartial(node.module, importsFor(node.imports, firstResults), inferOptions),
      );
    }
  });

  await timed(phases, "contextualize delayed callbacks", () => {
    for (const path of graph.order) {
      const contextual = contextualizeDelayedCallbacks(ffi.get(path)!, firstResults.get(path)!);
      ffi.set(path, contextual);
      graph.nodes.get(path)!.module = contextual.module;
    }
  });

  const contextualResults = new Map<string, InferResult>();
  await timed(phases, "contextual inference", () => {
    for (const path of graph.order) {
      const node = graph.nodes.get(path)!;
      contextualResults.set(
        path,
        inferModulePartial(node.module, importsFor(node.imports, contextualResults), inferOptions),
      );
    }
  });

  const foreignTypeRefs = new Map(
    [...ffi.values()].flatMap((item) =>
      [...item.foreignTypeRefs.values()].map((ref) => [ref.key, ref] as const)
    ),
  );
  await timed(phases, "resolve delayed FFI", () => {
    for (const path of graph.order) {
      const node = graph.nodes.get(path)!;
      const resolved = resolveDelayedFfiElaboration(ffi.get(path)!, contextualResults.get(path)!, {
        foreignTypeRefs,
      });
      node.module = resolved.module;
    }
  });

  const results = new Map<string, InferResult>();
  await timed(phases, "final inference", () => {
    for (const path of graph.order) {
      const node = graph.nodes.get(path)!;
      results.set(path, inferModule(node.module, importsFor(node.imports, results), inferOptions));
    }
  });

  if (summaryBinding) {
    const entry = results.get(graph.entry);
    const scheme = entry?.env.get(summaryBinding);
    if (scheme) {
      console.log(`${summaryBinding}: ${show(scheme.type)}`);
    }
  }

  return {
    totalMs: performance.now() - totalStart,
    phases,
  };
}

function importsFor(
  imports: { specifier: string; path: string }[],
  results: Map<string, InferResult>,
): Map<string, InferResult> {
  const out = new Map<string, InferResult>();
  for (const edge of imports) out.set(edge.specifier, results.get(edge.path)!);
  return out;
}

async function timed<T>(
  phases: PhaseTiming[],
  name: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    phases.push({ name, ms: performance.now() - start });
  }
}

function parseArgs(args: string[]): Options {
  let input = "";
  let iterations = 1;
  let warmup = 0;
  let summaryBinding: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--iterations=")) {
      iterations = positiveInteger(arg.slice("--iterations=".length), "--iterations");
    } else if (arg.startsWith("--warmup=")) {
      warmup = nonNegativeInteger(arg.slice("--warmup=".length), "--warmup");
    } else if (arg.startsWith("--binding=")) {
      summaryBinding = arg.slice("--binding=".length);
    } else if (arg === "--help" || arg === "-h") {
      usage();
      Deno.exit(0);
    } else if (!input) {
      input = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }

  if (!input) input = "examples/webhook.wm";
  return { input, iterations, warmup, summaryBinding };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function printSummary(options: Options, runs: IterationTiming[]) {
  console.log(`typecheck profile: ${options.input}`);
  console.log(`warmup: ${options.warmup}, iterations: ${options.iterations}`);

  const averageTotal = average(runs.map((run) => run.totalMs));
  console.log(`total avg: ${formatMs(averageTotal)}`);
  console.log("");
  console.log("| phase | avg | share |");
  console.log("| --- | ---: | ---: |");

  const phaseNames = runs[0]?.phases.map((phase) => phase.name) ?? [];
  for (const name of phaseNames) {
    const avg = average(
      runs.map((run) => run.phases.find((phase) => phase.name === name)?.ms ?? 0),
    );
    console.log(`| ${name} | ${formatMs(avg)} | ${formatPercent(avg / averageTotal)} |`);
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function usage() {
  console.log(`usage: deno run -A scripts/profile_typecheck.ts [input.wm] [options]

options:
  --iterations=N   measured typecheck iterations, default 1
  --warmup=N       unreported warmup iterations, default 0
  --binding=NAME   print the final inferred type for one binding`);
}
