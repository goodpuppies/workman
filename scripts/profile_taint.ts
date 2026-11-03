/** Paired baseline/current measurements. Compiler sources are imported from --root. */
import { pathToFileURL } from "node:url";
import { Session } from "node:inspector";

const args = new Map(Deno.args.map((arg) => {
  const [name, ...value] = arg.replace(/^--/, "").split("=");
  return [name, value.join("=") || "true"];
}));
if (args.has("help")) {
  console.log(`Usage: deno run -A scripts/profile_taint.ts [options]
  --root=PATH     compiler source tree (defaults to the current directory)
  --samples=N     measured samples per workload (default 7)
  --warmup=N      warm-up rounds (default 3)
  --only=NAMES    run selected workloads (comma-separated)
  --profile=PATH  sample CPU after warm-up; requires --allow-sys=inspector

Timings are emitted as JSON. Run baseline and current sequentially in alternating order.`);
  Deno.exit(0);
}
const root = args.get("root") ?? Deno.cwd();
const samples = Number(args.get("samples") ?? 7);
const warmup = Number(args.get("warmup") ?? 3);
if (!Number.isInteger(samples) || samples < 1) {
  throw new Error("samples must be a positive integer");
}
if (!Number.isInteger(warmup) || warmup < 0) {
  throw new Error("warmup must be a non-negative integer");
}
const selected = args.get("only")?.split(",");
const url = (file: string) => pathToFileURL(`${root}/${file}`).href;
const { checkSource } = await import(url("src/compiler.ts"));
const { inferModule, inferModulePartial } = await import(url("src/infer.ts"));
const { parseCompilerModule } = await import(url("src/compiler_frontend.ts"));
const { standardRuntimeGraph } = await import(url("src/standard_library.ts"));
const coldStart = performance.now();
await checkSource("let identity = (x) => { x };");
const coldCheckMs = performance.now() - coldStart;

type Workload = { name: string; run: () => unknown | Promise<unknown> };
const workloads: Workload[] = [];
const sources = [
  {
    name: "scalar-250",
    source: Array.from({ length: 250 }, (_, i) => `let increment${i} = (x) => { x + 1 };`).join(
      "\n",
    ),
  },
  {
    name: "polymorphic-250",
    source: "let identity = (x) => { x };\n" +
      Array.from(
        { length: 250 },
        (_, i) => `let value${i} = (identity(1), identity("text"), identity(true));`,
      ).join("\n"),
  },
  {
    name: "higher-order-100",
    source: `let apply = (f, x) => { f(x) };
      let compose = (f, g) => { (x) => { f(g(x)) } };\n` +
      Array.from({ length: 100 }, (_, i) =>
        `let use${i} = (x) => {
        let f = compose((a) => { a + 1 }, (b) => { b * 2 }); apply(f, x)
      };`).join("\n"),
  },
  {
    name: "nested-data-150",
    source: `type Box<T> = | Box<T>;
      let effect = () => { print("effect"); 1 };\n` +
      Array.from({ length: 150 }, (_, i) =>
        `let use${i} = () => {
        let nested = Box(([1, effect()], (2, 3))); 1
      };`).join("\n"),
  },
  {
    name: "latent-functions-150",
    source: 'let effect = () => { print("effect"); 1 };\n' +
      Array.from({ length: 150 }, (_, i) =>
        `let use${i} = () => {
        let nested = ([() => { effect() }], (2, 3)); 1
      };`).join("\n"),
  },
];
for (const { name, source } of sources) {
  const ast = await parseCompilerModule(source);
  const validation = inferModulePartial(ast);
  if (validation.diagnostics.some((item: { severity: string }) => item.severity === "error")) {
    throw new Error(`invalid benchmark: inference errors in ${name}`);
  }
  workloads.push({ name, run: () => inferModulePartial(ast) });
  if (name === "scalar-250") {
    workloads.push({ name: `${name}-with-snapshots`, run: () => inferModule(ast) });
    workloads.push({ name: `${name}-check-source`, run: () => checkSource(source) });
  }
}
const library = await standardRuntimeGraph();
const libraryWave = (snapshots: boolean) => {
  const results = new Map();
  for (const id of library.graph.order) {
    const node = library.graph.nodes.get(id)!;
    const imports = new Map(
      node.imports.map((
        edge: { specifier: string; target: unknown },
      ) => [edge.specifier, results.get(edge.target) ?? library.results.get(edge.target)]),
    );
    const result = (snapshots ? inferModule : inferModulePartial)(node.module, imports, {});
    if (result.diagnostics.some((item: { severity: string }) => item.severity === "error")) {
      throw new Error(`invalid benchmark: inference errors in ${node.path}`);
    }
    results.set(id, result);
  }
  return results;
};
workloads.push({ name: "stdlib-wave", run: () => libraryWave(false) });
workloads.push({ name: "stdlib-wave-with-snapshots", run: () => libraryWave(true) });

const chosen = workloads.filter((workload) => !selected || selected.includes(workload.name));
if (!chosen.length) throw new Error(`unknown workload ${selected}`);
for (let i = 0; i < warmup; i++) for (const workload of chosen) await workload.run();

// Start sampling after parsing, reflection and warm-up. Profiles are not timing comparisons.
const profilePath = args.get("profile");
let session: Session | undefined;
const post = (method: string, params = {}): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) =>
    session!.post(
      method,
      params,
      (error, result) => error ? reject(error) : resolve(result as Record<string, unknown>),
    )
  );
if (profilePath) {
  session = new Session();
  session.connect();
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 100 });
  await post("Profiler.start");
}
const timings: Record<string, number[]> = Object.fromEntries(chosen.map(({ name }) => [name, []]));
// Rotate order between samples to reduce systematic warm-up and collection bias.
for (let i = 0; i < samples; i++) {
  for (let offset = 0; offset < chosen.length; offset++) {
    const workload = chosen[(i + offset) % chosen.length];
    const start = performance.now();
    await workload.run();
    timings[workload.name].push(performance.now() - start);
  }
}
if (session) {
  const { profile } = await post("Profiler.stop");
  session.disconnect();
  await Deno.writeTextFile(profilePath!, JSON.stringify(profile));
}
console.log(JSON.stringify({
  root,
  runtime: Deno.version,
  coldCheckMs,
  libraryModules: library.graph.order.length,
  samples,
  warmup,
  profiled: !!profilePath,
  timings,
}));
