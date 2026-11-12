const ROOT = new URL("../", import.meta.url);
const FRONTEND_V2_ARTIFACT = new URL(
  "../src/generated/frontend_v2_parser.js",
  import.meta.url,
);
const SOURCE_MODULE_ARTIFACTS = new URL("../src/generated/wm/", import.meta.url);
const MAX_FRONTEND_V2_STAGES = 8;

await runTask("c-header:build");
await runTask("byte-type:build");
await runTask("generate-assets");
await runTask("frontend-v2:generate-recognizer");
await convergeFrontendV2();
await convergeSourceModules();
await runTask("wmslang:builtins");
await runTask("frontend-v2:build-library");
await runTask("wmslang:build");
await runTask("frontend-v2:update-semantic-golden");

console.log("generation complete");

async function convergeFrontendV2(): Promise<void> {
  for (let stage = 1; stage <= MAX_FRONTEND_V2_STAGES; stage += 1) {
    const before = await Deno.readTextFile(FRONTEND_V2_ARTIFACT);
    await runTask("frontend-v2:build");
    const after = await Deno.readTextFile(FRONTEND_V2_ARTIFACT);
    if (before === after) {
      console.log(`frontend-v2 reached a fixed point after ${stage} stage(s)`);
      return;
    }
  }

  throw new Error(
    `frontend-v2 did not reach a fixed point after ${MAX_FRONTEND_V2_STAGES} stages`,
  );
}

// The compiler imports its own Workman modules (src/**/*.wm) through their artifacts, so each
// build can change the compiler that performs the next one.
async function convergeSourceModules(): Promise<void> {
  for (let stage = 1; stage <= MAX_FRONTEND_V2_STAGES; stage += 1) {
    const before = await snapshot(SOURCE_MODULE_ARTIFACTS);
    await runTask("src-wm:build");
    const after = await snapshot(SOURCE_MODULE_ARTIFACTS);
    if (before === after) {
      console.log(`src/**/*.wm reached a fixed point after ${stage} stage(s)`);
      return;
    }
  }

  throw new Error(
    `src/**/*.wm did not reach a fixed point after ${MAX_FRONTEND_V2_STAGES} stages`,
  );
}

// Every artifact's path and text, in a stable order.
async function snapshot(directory: URL): Promise<string> {
  const files: string[] = [];
  const visit = async (url: URL) => {
    const entries = await Array.fromAsync(Deno.readDir(url)).catch((error) => {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    });
    for (const entry of entries) {
      const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), url);
      if (entry.isDirectory) await visit(child);
      else files.push(`${child.pathname}\n${await Deno.readTextFile(child)}`);
    }
  };
  await visit(directory);
  return files.sort().join("\n");
}

async function runTask(task: string): Promise<void> {
  console.log(`\n> deno task ${task}`);
  const status = await new Deno.Command(Deno.execPath(), {
    args: ["task", task],
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new Error(`deno task ${task} failed with exit code ${status.code}`);
  }
}
