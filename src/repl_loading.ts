import { terminalHasTruecolor } from "./repl_highlight.ts";
import type { LibraryLoadObserver } from "./standard_library.ts";

const BAR_WIDTH = 28;
const FRAME_MS = 33;
/** The logo's orange (editors/vscode/workman.svg) with a white glint swept along the bar. */
const GRADIENT: readonly (readonly [number, number, number])[] = [
  [255, 106, 21],
  [255, 106, 21],
  [255, 167, 115],
  [255, 255, 255],
  [255, 167, 115],
  [255, 106, 21],
  [255, 106, 21],
];
const SWEEP_MS = 1400;
const ICON = "🗿 ";
const ICON_WIDTH = 3;

/*
 * Each phase's share of the bar, measured on a cold start: parsing the library takes about 70% of
 * the time, analyzing it 20%, and compiling the empty session the rest. The analysis reports this
 * many steps per module; if that drifts the bar only moves less evenly, since it clamps and ends at 100%.
 */
const PARSE_SHARE = 0.7;
const ANALYSIS_SHARE = 0.2;
const ANALYSIS_STEPS_PER_MODULE = 11;
const STAGE_POSITIONS: Readonly<Record<string, number>> = {
  "build core": 0.93,
  "emit javascript": 0.97,
};

export type LoadingBarStyle = { color: "truecolor" | "none" };

function gradientAt(position: number): string {
  const scaled = (position - Math.floor(position)) * (GRADIENT.length - 1);
  const index = Math.floor(scaled);
  const from = GRADIENT[index];
  const to = GRADIENT[Math.min(index + 1, GRADIENT.length - 1)];
  const channel = (i: number) => Math.round(from[i] + (to[i] - from[i]) * (scaled - index));
  return `\x1b[38;2;${channel(0)};${channel(1)};${channel(2)}m`;
}

/** One frame of the bar, fitted to `columns`: the label goes first, then the percentage. */
export function renderLoadingBar(
  ratio: number,
  label: string,
  elapsedMs: number,
  columns: number,
  style: LoadingBarStyle,
): string {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const width = Math.max(Math.min(BAR_WIDTH, columns - ICON_WIDTH - 1), 1);
  const filled = Math.round(width * clamped);
  const percent = ` ${String(Math.round(clamped * 100)).padStart(3)}%`;
  const caption = `  ${label}`;
  const room = columns - ICON_WIDTH - width - 1;
  const tail = (room >= percent.length ? percent : "") +
    (room >= percent.length + caption.length ? caption : "");
  if (style.color === "none") {
    return `${ICON}${"█".repeat(filled)}${"░".repeat(width - filled)}${tail}`;
  }
  const sweep = elapsedMs / SWEEP_MS;
  let bar = "";
  for (let cell = 0; cell < filled; cell++) bar += `${gradientAt(cell / width - sweep)}█`;
  return `${ICON}${bar}\x1b[0m\x1b[2m${"░".repeat(width - filled)}${tail}\x1b[0m`;
}

export function loadingBarStyle(): LoadingBarStyle {
  return { color: terminalHasTruecolor() && !Deno.noColor ? "truecolor" : "none" };
}

/** Maps compiler events to a position on the bar, which only ever moves forward. */
export class LoadingProgress {
  ratio = 0;
  label = "Parsing standard library";
  #modules = 0;
  #analysisSteps = 0;

  parsed(done: number, total: number): void {
    this.#modules = total;
    this.#advance(PARSE_SHARE * done / total);
  }

  analyzed(): void {
    if (this.#modules === 0) return;
    this.label = "Checking standard library";
    this.#analysisSteps++;
    const share = this.#analysisSteps / (this.#modules * ANALYSIS_STEPS_PER_MODULE);
    this.#advance(PARSE_SHARE + ANALYSIS_SHARE * Math.min(share, 1));
  }

  stage(name: string): void {
    const position = STAGE_POSITIONS[name];
    if (position === undefined) return;
    this.label = "Preparing session";
    this.#advance(position);
  }

  #advance(ratio: number): void {
    this.ratio = Math.max(this.ratio, ratio);
  }
}

export type LoadingBar = {
  observer: LibraryLoadObserver;
  stage(name: string): void;
  /** Clears the bar and restores the cursor. Safe to call more than once. */
  finish(): void;
};

/** Draws the bar on stdout, leaving the line clear for whatever is printed next. */
export function createLoadingBar(): LoadingBar {
  const encoder = new TextEncoder();
  const write = (text: string) => {
    const bytes = encoder.encode(text);
    let written = 0;
    while (written < bytes.length) written += Deno.stdout.writeSync(bytes.subarray(written));
  };
  const progress = new LoadingProgress();
  const style = loadingBarStyle();
  const started = performance.now();
  let shown = 0;
  let lastYield = started;
  let done = false;
  const draw = () => {
    shown += (progress.ratio - shown) * 0.25; // Glide between the compiler's uneven steps.
    const frame = renderLoadingBar(
      shown,
      progress.label,
      performance.now() - started,
      Deno.consoleSize().columns,
      style,
    );
    write(`\r\x1b[2K${frame}`);
  };
  write("\x1b[?25l");
  draw();
  const timer = setInterval(draw, FRAME_MS);
  return {
    observer: {
      onParsed: (parsed, total) => progress.parsed(parsed, total),
      onTiming: () => progress.analyzed(),
      // A timer turn per step would nearly double the load, so only yield once per frame.
      afterStep: () => {
        const now = performance.now();
        if (now - lastYield < FRAME_MS) return;
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            lastYield = performance.now();
            resolve();
          }, 0)
        );
      },
    },
    stage: (name) => progress.stage(name),
    finish() {
      if (done) return;
      done = true;
      clearInterval(timer);
      write("\r\x1b[2K\x1b[?25h");
    },
  };
}
