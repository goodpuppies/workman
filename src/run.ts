import { compileFile, type CompileOptions } from "./compiler.ts";

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
  const dir = await Deno.makeTempDir({ prefix: "wm-mini-" });
  const output = `${dir}/main.mjs`;
  try {
    await Deno.writeTextFile(output, await compileFile(input, options));
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
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
