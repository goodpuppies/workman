import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const config = fileURLToPath(new URL("../../deno.json", import.meta.url));
const compiler = fileURLToPath(new URL("./compile.ts", import.meta.url));

export async function compileWorkman(path, options = {}) {
  try {
    const { stdout } = await run(options.denoPath ?? "deno", [
      "run",
      "-A",
      "--config",
      config,
      compiler,
      path,
    ], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Workman compilation failed for ${path}\n${error.stderr || error.message}`, {
      cause: error,
    });
  }
}
