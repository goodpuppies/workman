import { compileFile, type CompileOptions } from "./compiler.ts";
import { dirname, resolve } from "node:path";

export type RunOptions = CompileOptions & {
  args?: string[];
  stdout?: "inherit" | "piped";
  stderr?: "inherit" | "piped";
};

export type RunResult = {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

export async function runFile(input: string, options: RunOptions = {}): Promise<RunResult> {
  const inputPath = await Deno.realPath(resolve(input));
  const dir = await Deno.makeTempDir({ dir: dirname(inputPath), prefix: ".wm-mini-" });
  const output = `${dir}/main.mjs`;
  try {
    const js = await compileFile(inputPath, options);
    await Deno.writeTextFile(output, js);
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        ...runtimeFlags(js),
        output,
        ...(options.args ?? []),
      ],
      stdout: options.stdout ?? "inherit",
      stderr: options.stderr ?? "inherit",
    });
    return await command.output();
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

function runtimeFlags(js: string): string[] {
  return js.includes("Deno.UnsafeWindowSurface") ? ["--unstable-webgpu"] : [];
}
