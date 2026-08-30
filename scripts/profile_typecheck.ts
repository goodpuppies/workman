import { buildProgramAnalysis } from "../src/program_analysis.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { analyzeModuleGraph } from "../src/staged_analysis.ts";
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
  const stageTotals = new Map<string, number>();
  const results = await analyzeModuleGraph(graph, {
    onTiming: ({ phase, milliseconds }) => {
      stageTotals.set(phase, (stageTotals.get(phase) ?? 0) + milliseconds);
    },
  });
  for (const [name, ms] of stageTotals) phases.push({ name, ms });
  await timed(phases, "build program analysis", () => buildProgramAnalysis(graph, results));

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
