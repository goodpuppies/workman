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
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import { createProgressReporter } from "./progress.ts";

export type RunOptions = CompileOptions & {
  args?: string[];
  stdout?: "inherit" | "piped";
  stderr?: "inherit" | "piped";
  /** Force compile progress on or off; defaults to on when stderr is a TTY. */
  progress?: boolean;
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
  // Progress is drawn only while compiling; it is cleared before the program
  // takes over the terminal, so a TUI never inherits a partial line.
  const progress = createProgressReporter({ enabled: options.progress });
  try {
    const compiled = await coreFile(inputPath, {
      ...options,
      onStage: (name) => progress.stage(name),
      onModuleParsed: (loaded) => progress.step(loaded, 0, `${loaded} modules`),
      onAnalysisProgress: (done, total, phase) => progress.step(done, total, phase),
    });
    assertEntrypoint(compiled);
    progress.stage("emit javascript");
    const artifacts = await compileFileArtifactsFromCore(compiled, options);
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no executable artifact");
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${dir}/${artifact.path}`, artifact.code);
    }
    progress.finish();
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        ...runtimeFlagsForJavaScript(entry.code),
        output,
        ...(options.args ?? []),
      ],
      stdin: "inherit",
      stdout: options.stdout ?? "inherit",
      stderr: options.stderr ?? "inherit",
    });
    return await command.output();
  } finally {
    progress.finish();
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

function assertEntrypoint(compiled: CoreFileResult): void {
  const entry = compiled.core.modules.get(compiled.core.entry)!;
  const diagnostic = runEntrypointDiagnostic(compiled);
  if (!diagnostic) return;
  throw new RunEntrypointError(diagnostic, entry.path, entry.source);
}
