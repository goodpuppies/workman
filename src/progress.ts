/**
 * Single-line compile progress for the CLI, in the style of `zig build`.
 *
 * Only draws when stderr is a terminal, so piped or redirected output stays
 * exactly as it was. Everything is written to stderr, leaving stdout free for
 * the compiled program.
 */

const ESC = "\x1b[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_LINE = `${ESC}2K\r`;
const DIM = `${ESC}2m`;
const RESET = `${ESC}0m`;

export type ProgressEvent =
  | { kind: "stage"; name: string; index: number; total: number }
  | { kind: "step"; current: number; total: number; detail?: string };

export type ProgressReporter = {
  stage(name: string): void;
  step(current: number, total: number, detail?: string): void;
  /** Stop drawing and clear the line. Safe to call more than once. */
  finish(summary?: string): void;
};

const noopReporter: ProgressReporter = {
  stage: () => {},
  step: () => {},
  finish: () => {},
};

/** The stages a full `wm run` walks through, in order. */
export const RUN_STAGES = [
  "load modules",
  "analyze",
  "build core",
  "emit javascript",
] as const;

export function createProgressReporter(
  options: { enabled?: boolean; stages?: readonly string[] } = {},
): ProgressReporter {
  const stderr = Deno.stderr;
  const enabled = options.enabled ?? stderr.isTerminal();
  if (!enabled) return noopReporter;

  const stages = options.stages ?? RUN_STAGES;
  const encoder = new TextEncoder();
  const started = performance.now();
  let stageIndex = 0;
  let stageName = "";
  let stageStarted = started;
  let detail = "";
  let done = false;
  let drawn = false;

  const write = (text: string) => {
    try {
      stderr.writeSync(encoder.encode(text));
    } catch {
      // A closed or broken stderr must never take the compile down.
    }
  };

  const draw = () => {
    if (done) return;
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    const position = stageIndex > 0 ? `[${stageIndex}/${stages.length}] ` : "";
    const suffix = detail ? ` ${DIM}${detail}${RESET}` : "";
    write(`${CLEAR_LINE}${position}${stageName}${suffix} ${DIM}${elapsed}s${RESET}`);
    drawn = true;
  };

  write(HIDE_CURSOR);

  return {
    stage(name: string) {
      if (done) return;
      stageIndex = stages.indexOf(name) + 1 || stageIndex + 1;
      stageName = name;
      stageStarted = performance.now();
      detail = "";
      draw();
    },
    step(current: number, total: number, stepDetail?: string) {
      if (done) return;
      detail = total > 0 ? `${current}/${total}${stepDetail ? ` ${stepDetail}` : ""}` : stepDetail ?? "";
      draw();
    },
    finish(summary?: string) {
      if (done) return;
      done = true;
      // Keep stageStarted referenced so a future per-stage timing readout has
      // the value it needs without reintroducing the bookkeeping.
      void stageStarted;
      write(drawn ? CLEAR_LINE : "");
      if (summary) {
        const elapsed = ((performance.now() - started) / 1000).toFixed(2);
        write(`${DIM}${summary} in ${elapsed}s${RESET}\n`);
      }
      write(SHOW_CURSOR);
    },
  };
}
