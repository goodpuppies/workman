type ProfileNode = {
  id: number;
  hitCount?: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
};

type CpuProfile = {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
};

const path = Deno.args[0];
if (!path) throw new Error("usage: summarize_cpu_profile.ts profile.cpuprofile");
const profile = JSON.parse(await Deno.readTextFile(path)) as CpuProfile;
const totalSamples = profile.nodes.reduce((total, node) => total + (node.hitCount ?? 0), 0);
const durationMs = (profile.endTime - profile.startTime) / 1000;
const sampleMs = durationMs / Math.max(totalSamples, 1);
const groups = Map.groupBy(profile.nodes, (node) => category(node.callFrame.url));

console.log(`CPU subsystem summary: ${path}`);
console.log(`duration: ${durationMs.toFixed(1)}ms, self samples: ${totalSamples}`);
console.log("");
for (const [name, nodes] of [...groups].sort((left, right) => hits(right[1]) - hits(left[1]))) {
  const selfSamples = hits(nodes);
  console.log(
    `${name.padEnd(25)} ${(selfSamples * sampleMs).toFixed(1).padStart(8)}ms ${
      (selfSamples / totalSamples * 100).toFixed(1).padStart(6)
    }%`,
  );
  for (const item of topFunctions(nodes, 5)) {
    const location = shortLocation(item.url, item.line + 1);
    console.log(
      `  ${(item.samples * sampleMs).toFixed(1).padStart(7)}ms  ${item.name} ${location}`,
    );
  }
}

function hits(nodes: ProfileNode[]): number {
  return nodes.reduce((total, node) => total + (node.hitCount ?? 0), 0);
}

function topFunctions(nodes: ProfileNode[], limit: number) {
  const functions = new Map<
    string,
    { name: string; url: string; line: number; samples: number }
  >();
  for (const node of nodes) {
    const frame = node.callFrame;
    const key = `${frame.functionName}\0${frame.url}\0${frame.lineNumber}`;
    const current = functions.get(key) ?? {
      name: frame.functionName || "(anonymous)",
      url: frame.url,
      line: frame.lineNumber,
      samples: 0,
    };
    current.samples += node.hitCount ?? 0;
    functions.set(key, current);
  }
  return [...functions.values()].sort((a, b) => b.samples - a.samples).slice(0, limit);
}

function category(url: string): string {
  if (url.includes("lib/typescript.js")) return "TypeScript internals";
  if (url.includes("generated/workman_parser.js")) return "Workman parser";
  if (url.includes("/src/ffi/reflect/")) return "FFI reflection mapping";
  if (url.includes("/src/ffi/delayed/")) return "FFI delayed resolution";
  if (url.includes("/src/ffi/receiver/") || /\/src\/ffi\/(elab|imports|shared)\.ts/.test(url)) {
    return "FFI initial elaboration";
  }
  if (url.includes("/src/diagnostic_writer.ts") || url.includes("/src/diagnostics.ts")) {
    return "Diagnostic evidence";
  }
  if (
    url.includes("/src/infer/") || url.endsWith("/src/infer.ts") ||
    url.endsWith("/src/types.ts")
  ) {
    return "HM inference";
  }
  if (url.includes("/src/parser.ts") || url.includes("/src/module_graph.ts")) {
    return "Module loading/frontend";
  }
  if (
    /\/src\/(binding|nominal|pattern|recursion)_facts\.ts/.test(url) ||
    url.includes("/src/program_analysis.ts")
  ) {
    return "Program facts/analysis";
  }
  if (url.includes("/src/")) return "Other Workman compiler";
  if (url.includes("/scripts/")) return "Profiling driver";
  return "Runtime/dependencies";
}

function shortLocation(url: string, line: number): string {
  if (!url) return "";
  const source = url.replace(/^file:\/\//, "");
  const marker = source.lastIndexOf("/src/");
  if (marker !== -1) return `${source.slice(marker + 1)}:${line}`;
  const segments = source.split("/");
  return `${segments.slice(-2).join("/")}:${line}`;
}
