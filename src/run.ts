import {
  compileFileArtifactsFromCore,
  type CompileOptions,
  coreFile,
  type CoreFileResult,
} from "./compiler.ts";
import {
  type FrontendDiagnostic,
  FrontendDiagnosticError,
  missingEntrypointDiagnostic,
} from "./diagnostics.ts";
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

export class RunEntrypointError extends FrontendDiagnosticError {
  constructor(
    diagnostic: FrontendDiagnostic,
    readonly path: string,
    readonly source: string,
  ) {
    super(diagnostic);
    this.name = "RunEntrypointError";
  }
}

export function runEntrypointDiagnostic(compiled: CoreFileResult): FrontendDiagnostic | undefined {
  const entry = compiled.core.modules.get(compiled.core.entry)!;
  return entry.dynamicExports.some((item) => item.name === "main")
    ? undefined
    : missingEntrypointDiagnostic();
}

export async function runFile(input: string, options: RunOptions = {}): Promise<RunResult> {
  const inputPath = await Deno.realPath(resolve(input));
  const dir = await Deno.makeTempDir({ dir: dirname(inputPath), prefix: ".wm-mini-" });
  const output = `${dir}/main.mjs`;
  try {
    const compiled = await coreFile(inputPath, options);
    assertEntrypoint(compiled);
    const artifacts = await compileFileArtifactsFromCore(compiled, options);
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

function assertEntrypoint(compiled: CoreFileResult): void {
  const entry = compiled.core.modules.get(compiled.core.entry)!;
  const diagnostic = runEntrypointDiagnostic(compiled);
  if (!diagnostic) return;
  throw new RunEntrypointError(diagnostic, entry.path, entry.source);
}

function runtimeFlags(js: string): string[] {
  return js.includes("Deno.UnsafeWindowSurface") ? ["--unstable-webgpu"] : [];
}
