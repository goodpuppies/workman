import { dirname, join } from "node:path";
import { workmanState } from "./user_paths.ts";

export const replHistoryLimit = 1000;

export function replHistoryFile(): string {
  return join(workmanState(), "repl-history.json");
}

/** Readline stores the most recent input first. */
export function readReplHistory(file: string): string[] {
  let source: string;
  try {
    source = Deno.readTextFileSync(file);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  const history: unknown = JSON.parse(source);
  if (!Array.isArray(history) || history.some((line) => typeof line !== "string")) {
    throw new Error("expected an array of input lines");
  }
  return history.filter((line: string) => line.trim()).slice(0, replHistoryLimit);
}

/** Save on submission, so Ctrl-C and runtime failures also retain entered input. */
export function recordReplHistory(file: string, line: string): void {
  if (!line.trim()) return;
  // Read the latest file so another open session's submitted lines survive.
  const history = readReplHistory(file);
  if (history[0] !== line) history.unshift(line);
  history.length = Math.min(history.length, replHistoryLimit);
  Deno.mkdirSync(dirname(file), { recursive: true });
  const temporary = Deno.makeTempFileSync({ dir: dirname(file), prefix: ".repl-history-" });
  try {
    Deno.writeTextFileSync(temporary, JSON.stringify(history) + "\n");
    Deno.renameSync(temporary, file);
  } finally {
    try {
      Deno.removeSync(temporary);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}
