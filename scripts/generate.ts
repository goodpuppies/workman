const ROOT = new URL("../", import.meta.url).pathname;
const FRONTEND_V2_ARTIFACT = new URL(
  "../src/generated/frontend_v2_parser.js",
  import.meta.url,
);
const MAX_FRONTEND_V2_STAGES = 8;

await runTask("generate-assets");
await runTask("frontend-v2:generate-recognizer");
await convergeFrontendV2();
await runTask("wmslang:builtins");
await runTask("tuiman:build"); // has to be in order
await runTask("problems:build");
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
