import { dirname, join } from "node:path";

const configNames = ["deno.json", "deno.jsonc"];

/**
 * Arguments that give a `deno run` of emitted code the configuration of the project at `directory`.
 *
 * Deno looks for `deno.json` from the script's own directory, and emitted code lives in the OS
 * temporary directory, so the project's import map, npm settings and lockfile only apply when the
 * child is told where the configuration is. With none above `directory`, the child runs without one,
 * as it would have beside the source.
 */
export function denoConfigArgs(directory: string): string[] {
  for (let current = directory;; current = dirname(current)) {
    for (const name of configNames) {
      const path = join(current, name);
      try {
        if (Deno.statSync(path).isFile) return ["--config", path];
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    if (dirname(current) === current) return [];
  }
}

type TerminationSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

/** Exit codes a shell reports for a process ended by each signal: 128 plus the signal number. */
export const terminationExitCode: Record<TerminationSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

const children = new Set<Deno.ChildProcess>();
const handlers: ((signal: TerminationSignal) => void)[] = [];
let pending: TerminationSignal | undefined;
let installed = false;

/**
 * Deno never gives a signal its default action back once a listener has been added, so wm adds one
 * listener per signal, once, and decides here what each signal does. A handler registered with
 * `handleTerminationSignals` takes it. Otherwise, while a relayed child runs, the signal goes to the
 * child, and the command ends once the child has and its caller has cleaned up: by returning the
 * child's exit code, or by calling `exitIfTerminated`. Otherwise this process exits as the signal's
 * default action would.
 */
function installTerminationDispatch(): void {
  if (installed) return;
  installed = true;
  const signals: TerminationSignal[] = Deno.build.os === "windows"
    ? ["SIGINT"]
    : ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) {
    Deno.addSignalListener(signal, () => {
      const handler = handlers.at(-1);
      if (handler) return handler(signal);
      if (children.size === 0) Deno.exit(terminationExitCode[signal]);
      pending ??= signal;
      // Ctrl-C already reaches the child from the terminal.
      if (signal === "SIGINT") return;
      for (const child of children) {
        try {
          child.kill(signal);
        } catch (error) {
          // The child may already have exited.
          if (!(error instanceof Deno.errors.NotFound) && !(error instanceof TypeError)) {
            throw error;
          }
        }
      }
    });
  }
}

/**
 * While `child` runs, a signal that would end this process reaches the child instead, so this
 * process waits for the child and can remove what it wrote. Returns a function to call once the
 * child has exited.
 */
export function relayTerminationSignals(child: Deno.ChildProcess): () => void {
  installTerminationDispatch();
  children.add(child);
  return () => children.delete(child);
}

/** Ends this process if a signal arrived while a relayed child ran. */
export function exitIfTerminated(): void {
  if (pending && children.size === 0) Deno.exit(terminationExitCode[pending]);
}

/**
 * Gives every termination signal to `handler` until the returned function is called, for a command
 * that ends itself, such as the REPL or `wm watch`. The latest registered handler wins.
 */
export function handleTerminationSignals(handler: (signal: TerminationSignal) => void): () => void {
  installTerminationDispatch();
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}
