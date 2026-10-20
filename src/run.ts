import { compileFileArtifactsFromCore, type CompileOptions, coreFile } from "./compiler.ts";
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
  const compileOptions: CompileOptions = {
    ...options,
    onStage: (name) => progress.stage(name),
    onModuleParsed: (loaded) => progress.step(loaded, 0, `${loaded} modules`),
    onAnalysisProgress: (done, total, phase) => progress.step(done, total, phase),
  };
  try {
    const compiled = await coreFile(inputPath, compileOptions);
    const artifacts = await compileFileArtifactsFromCore(compiled, compileOptions);
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
      // Keep recent diagnostics so leaving a TUI's alternate screen cannot erase them.
      stderr: "piped",
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
    let terminalCleanupDone = false;
    const inheritedStderr = options.stderr !== "piped";
    const errorOutput = collectChildStderr(child.stderr, inheritedStderr);
    try {
      const [status, stdout, stderr] = await Promise.all([
        child.status,
        options.stdout === "piped"
          ? new Response(child.stdout).arrayBuffer().then((buffer) => new Uint8Array(buffer))
          : Promise.resolve(new Uint8Array()),
        errorOutput,
      ]);
      const result = { ...status, stdout, stderr: inheritedStderr ? new Uint8Array() : stderr };
      completedCleanly = result.success;
      if (!completedCleanly) {
        const restored = restoreParentTerminal();
        terminalCleanupDone = true;
        if (inheritedStderr && !options.signal?.aborted) {
          if (restored && Deno.stderr.isTerminal() && stderr.length) Deno.stderr.writeSync(stderr);
          if (!stderr.length) {
            console.error(
              `error[runtime.exit]: program exited with status ${status.code} without an error message`,
            );
          }
        }
      }
      return result;
    } finally {
      options.signal?.removeEventListener("abort", stop);
      if (!completedCleanly && !terminalCleanupDone) restoreParentTerminal();
    }
  } finally {
    progress.finish();
    await temporaryDirectory.cleanup();
  }
}

/** Recover console state when a child TUI terminates before running its own cleanup. */
function restoreParentTerminal(): boolean {
  if (Deno.stdin.isTerminal()) {
    try {
      // Force a console-mode write even when Deno's parent-side bookkeeping still
      // believes the handle is cooked; a child process may have changed the shared
      // Windows console mode behind its back.
      Deno.stdin.setRaw(true);
      Deno.stdin.setRaw(false);
    } catch {
      // The input handle may have closed with the child; there is nothing left to restore.
    }
  }
  if (Deno.stdout.isTerminal()) {
    // Reset attributes/mouse mode/cursor/alternate screen. Repeating these after a
    // child already cleaned up is harmless.
    Deno.stdout.writeSync(
      new TextEncoder().encode("\x1b[?2026l\x1b[0m\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l"),
    );
    return true;
  }
  return false;
}

async function collectChildStderr(
  stream: ReadableStream<Uint8Array>,
  inherit: boolean,
): Promise<Uint8Array> {
  const limit = 256 * 1024;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    if (inherit) Deno.stderr.writeSync(chunk);
    chunks.push(chunk);
    size += chunk.length;
    // Captured output remains complete for API callers. Interactive replay only needs a tail.
    if (inherit) {
      while (size > limit && chunks.length) {
        const excess = size - limit;
        const first = chunks[0];
        if (first.length <= excess) {
          chunks.shift();
          size -= first.length;
        } else {
          chunks[0] = first.subarray(excess);
          size = limit;
        }
      }
    }
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
