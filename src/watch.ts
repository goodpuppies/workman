import { dirname, resolve } from "node:path";
import { loadModuleGraph } from "./module_graph.ts";
import { runFile, type RunOptions } from "./run.ts";

export type WatchOptions = Omit<RunOptions, "signal"> & {
  signal?: AbortSignal;
  onError?: (error: unknown) => void;
};

const WATCH_REFRESH_DIVIDER =
  "-------------------------------- wm watch refresh --------------------------------\n";

/** Compile and run an entrypoint again whenever a module in its reachable graph changes. */
export async function watchFile(input: string, options: WatchOptions = {}): Promise<void> {
  const inputPath = resolve(input);
  let watchedPaths = new Set([inputPath]);

  while (!options.signal?.aborted) {
    try {
      // Graph discovery is editor-like: a malformed top-level phrase is masked at its
      // semicolon boundary so the watcher retains every dependency it can still resolve.
      // Execution remains strict below and reports the actual parse error.
      const graph = await loadModuleGraph(inputPath, { ...options, syntaxRecovery: true });
      watchedPaths = new Set([...graph.nodes.values()].map((node) => resolve(node.path)));
    } catch (error) {
      reportWatchError(error, options);
      await waitForModuleChange(watchedPaths, options.signal);
      if (!options.signal?.aborted) refreshWatchTerminal();
      continue;
    }

    const watchController = new AbortController();
    const stopWatching = () => watchController.abort();
    options.signal?.addEventListener("abort", stopWatching, { once: true });
    const changed = waitForModuleChange(watchedPaths, watchController.signal);
    const runController = new AbortController();
    const stopRun = () => runController.abort();
    options.signal?.addEventListener("abort", stopRun, { once: true });

    try {
      const running = runFile(inputPath, { ...options, signal: runController.signal });
      const first = await Promise.race([
        running.then(() => "run" as const),
        changed.then(() => "change" as const),
      ]);
      if (first === "change") {
        runController.abort();
        await running.catch((error) => {
          if (!options.signal?.aborted) reportWatchError(error, options);
        });
      } else {
        await changed;
      }
    } catch (error) {
      if (!options.signal?.aborted) {
        reportWatchError(error, options);
        await changed;
      }
    } finally {
      runController.abort();
      watchController.abort();
      options.signal?.removeEventListener("abort", stopWatching);
      options.signal?.removeEventListener("abort", stopRun);
    }
    if (!options.signal?.aborted) refreshWatchTerminal();
  }
}

/** Wait for one coalesced editor-save burst touching a known module path. */
export async function waitForModuleChange(
  paths: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const normalizedPaths = new Set([...paths].map((path) => resolve(path)));
  const directories = [...new Set([...normalizedPaths].map(dirname))];
  const watcher = Deno.watchFs(directories, { recursive: false });
  const events = watcher[Symbol.asyncIterator]();
  let nextEvent = events.next();
  const abort = () => watcher.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!signal?.aborted) {
      const next = await nextEvent;
      if (next.done) return;
      nextEvent = events.next();
      if (!next.value.paths.some((path) => normalizedPaths.has(resolve(path)))) continue;

      // Editors often emit create/write/rename as one save. Let that burst settle.
      while (true) {
        const settled = await Promise.race([
          nextEvent.then((result) => ({ result })),
          new Promise<undefined>((resolveDelay) => setTimeout(() => resolveDelay(undefined), 75)),
        ]);
        if (settled === undefined) return;
        if (settled.result.done) return;
        nextEvent = events.next();
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!signal?.aborted) watcher.close();
  }
}

function reportWatchError(error: unknown, options: WatchOptions): void {
  if (options.onError) options.onError(error);
  else console.error(error instanceof Error ? error.message : String(error));
}

function refreshWatchTerminal(): void {
  const clear = Deno.stdout.isTerminal() ? "\x1b[2J\x1b[H" : "";
  Deno.stdout.writeSync(new TextEncoder().encode(clear + WATCH_REFRESH_DIVIDER));
}
