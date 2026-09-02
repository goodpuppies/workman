import { dirname, resolve } from "node:path";
import { loadModuleGraph } from "./module_graph.ts";
import { runFile, type RunOptions } from "./run.ts";
import { terminalWidth } from "../tooling/tuiman/document.ts";
import { stdin } from "node:process";

export type WatchOptions = Omit<RunOptions, "signal"> & {
  signal?: AbortSignal;
  onError?: (error: unknown) => void;
};

export function watchRefreshDivider(width = terminalWidth(80)): string {
  const label = " wm watch refresh ";
  const columns = Math.max(1, Math.floor(width));
  if (columns <= label.length) return `${label.trim().slice(0, columns)}\n`;
  const rules = columns - label.length;
  const left = Math.floor(rules / 2);
  return `${"-".repeat(left)}${label}${"-".repeat(rules - left)}\n`;
}

/** Compile and run an entrypoint again whenever a module in its reachable graph changes. */
export async function watchFile(input: string, options: WatchOptions = {}): Promise<void> {
  const inputPath = resolve(input);
  let watchedPaths = new Set([inputPath]);
  clearWatchTerminal();

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
        running.then((result) => ({ kind: "run" as const, result })),
        changed.then(() => ({ kind: "change" as const })),
      ]);
      if (first.kind === "change") {
        runController.abort();
        await running.catch((error) => {
          if (!options.signal?.aborted) reportWatchError(error, options);
        });
      } else {
        if (first.result.code === 0) {
          await changed;
        } else if (await waitForChangeOrRawInterrupt(changed, options.signal) === "interrupt") {
          return;
        }
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

/**
 * A crashed child TUI can leave Windows console input in raw mode. In that state
 * Ctrl+C arrives as byte 3 instead of SIGINT, so listen for it only while no child
 * owns stdin and the watcher is waiting after a failed run.
 */
async function waitForChangeOrRawInterrupt(
  changed: Promise<void>,
  signal?: AbortSignal,
): Promise<"change" | "interrupt"> {
  if (!Deno.stdin.isTerminal()) {
    await changed;
    return "change";
  }

  let finishInterrupt: (() => void) | undefined;
  const interrupted = new Promise<"interrupt">((resolveInterrupt) => {
    const onData = (chunk: Uint8Array) => {
      if (chunk.includes(3)) resolveInterrupt("interrupt");
    };
    const onAbort = () => resolveInterrupt("interrupt");
    finishInterrupt = () => {
      stdin.off("data", onData);
      signal?.removeEventListener("abort", onAbort);
      stdin.pause();
    };
    stdin.on("data", onData);
    signal?.addEventListener("abort", onAbort, { once: true });
    stdin.resume();
  });

  try {
    return await Promise.race([changed.then(() => "change" as const), interrupted]);
  } finally {
    finishInterrupt?.();
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
  clearWatchTerminal();
  Deno.stdout.writeSync(new TextEncoder().encode(watchRefreshDivider()));
}

function clearWatchTerminal(): void {
  if (!Deno.stdout.isTerminal()) return;
  Deno.stdout.writeSync(new TextEncoder().encode("\x1b[2J\x1b[H"));
}
