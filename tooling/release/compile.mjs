import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
const run = promisify(execFile);
const { resolveBinary } = createRequire(import.meta.url)("../../bin/resolve.cjs");

export async function compileWorkman(path, options = {}) {
  try {
    const { stdout } = await run(options.compilerPath ?? resolveBinary(), [
      "compile-library-json",
      path,
    ], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Workman compilation failed for ${path}\n${error.stderr || error.message}`, {
      cause: error,
    });
  }
}
