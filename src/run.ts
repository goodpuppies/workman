import { compileFileArtifacts, type CompileOptions } from "./compiler.ts";
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
    const artifacts = await compileFileArtifacts(inputPath, options);
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no executable artifact");
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${dir}/${artifact.path}`, artifact.code);
    }
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        ...runtimeFlags(entry.code),
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
