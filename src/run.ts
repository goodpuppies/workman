import {
  compileFileArtifactsFromCore,
  type CompileOptions,
  coreFile,
} from "./compiler.ts";
import { dirname, resolve } from "node:path";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import { createProgressReporter } from "./progress.ts";
import { createTemporaryDirectory } from "./temporary_directory.ts";

export type RunOptions = CompileOptions & {
  args?: string[];
  stdout?: "inherit" | "piped";
  stderr?: "inherit" | "piped";
  /** Stop the spawned program when the signal is aborted. */
  signal?: AbortSignal;
  /** Force compile progress on or off; defaults to on when stderr is a TTY. */
  progress?: boolean;
};

export type RunResult = {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

export async function runFile(input: string, options: RunOptions = {}): Promise<RunResult> {
  const inputPath = await Deno.realPath(resolve(input));
  const temporaryDirectory = await createTemporaryDirectory({
    dir: dirname(inputPath),
    prefix: ".wm-mini-",
  });
  const dir = temporaryDirectory.path;
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
    progress.stage("emit javascript");
    const artifacts = await compileFileArtifactsFromCore(compiled, options);
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no executable artifact");
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${dir}/${artifact.path}`, artifact.code);
    }
    progress.finish();
    const child = new Deno.Command(Deno.execPath(), {
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
    }).spawn();
    const stop = () => {
      try {
        child.kill();
      } catch (error) {
        // The child may have exited between the abort and kill calls.
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    let completedCleanly = false;
    try {
      const result = await child.output();
      completedCleanly = result.success;
      return result;
    } finally {
      options.signal?.removeEventListener("abort", stop);
      if (!completedCleanly) restoreParentTerminal();
    }
  } finally {
    progress.finish();
    await temporaryDirectory.cleanup();
  }
}

/** Recover console state when a child TUI terminates before running its own cleanup. */
function restoreParentTerminal(): void {
  if (!Deno.stdin.isTerminal()) return;
  try {
    // Force a console-mode write even when Deno's parent-side bookkeeping still
    // believes the handle is cooked; a child process may have changed the shared
    // Windows console mode behind its back.
    Deno.stdin.setRaw(true);
    Deno.stdin.setRaw(false);
  } catch {
    // The input handle may have closed with the child; there is nothing left to restore.
  }
  if (Deno.stdout.isTerminal()) {
    // Reset attributes/mouse mode/cursor/alternate screen. Repeating these after a
    // child already cleaned up is harmless.
    Deno.stdout.writeSync(
      new TextEncoder().encode("\x1b[0m\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l"),
    );
  }
}
