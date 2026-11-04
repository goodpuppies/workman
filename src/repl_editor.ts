import { topLevelPhraseEnd } from "./top_level_phrases.ts";

/** A decoded keypress. `name` is a named key or a lowercase letter; `text` is literal input. */
export type EditorKey =
  | { kind: "text"; text: string }
  | { kind: "paste"; text: string }
  | { kind: "key"; name: string; shift?: boolean; alt?: boolean; ctrl?: boolean };

const ESC = "\x1b";
const PASTE_END = `${ESC}[201~`;
const CSI = /^\x1b\[([0-9;:<=>?]*)[ -/]*([@-~])/;
const INCOMPLETE_CSI = /^\x1b\[[0-9;:<=>?]*[ -/]*$/;
const CURSOR_FINALS: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
};
const TILDE_KEYS: Record<string, string> = {
  1: "home",
  7: "home",
  3: "delete",
  4: "end",
  8: "end",
  5: "pageup",
  6: "pagedown",
};
const KEYPAD_ENTER = 57414;

/**
 * Turns terminal input into keys. A read can end inside an escape sequence, so
 * an incomplete sequence is held back until the next chunk arrives. That includes
 * a lone ESC: it can only be told apart from an Alt prefix by what follows it.
 */
export class KeyDecoder {
  #held = "";

  decode(chunk: string): EditorKey[] {
    const source = this.#held + chunk;
    const keys: EditorKey[] = [];
    let index = 0;
    while (index < source.length) {
      const rest = source.slice(index);
      const consumed = rest[0] === ESC ? decodeEscape(rest, keys) : decodePlain(rest, keys);
      if (consumed === 0) break;
      index += consumed;
    }
    this.#held = source.slice(index);
    return keys;
  }
}

function decodePlain(rest: string, keys: EditorKey[]): number {
  const char = rest[0];
  const named = controlKey(char);
  if (named) {
    keys.push(named);
    return 1;
  }
  const run = /^[^\x00-\x1f\x7f]+/.exec(rest);
  if (!run) return 1; // An unbound control byte.
  keys.push({ kind: "text", text: run[0] });
  return run[0].length;
}

function controlKey(char: string): EditorKey | undefined {
  const code = char.charCodeAt(0);
  if (char === "\r") return { kind: "key", name: "enter" };
  if (char === "\t") return { kind: "key", name: "tab" };
  if (code === 0x7f || code === 0x08) return { kind: "key", name: "backspace" };
  if (code >= 1 && code <= 26) {
    return { kind: "key", name: String.fromCharCode(code + 96), ctrl: true };
  }
  return undefined;
}

/** Returns how much of `rest` was consumed, or 0 if the sequence is still incomplete. */
function decodeEscape(rest: string, keys: EditorKey[]): number {
  if (rest.length === 1) return 0;
  const next = rest[1];
  if (next === "[") {
    if (rest.startsWith(`${ESC}[200~`)) {
      const end = rest.indexOf(PASTE_END);
      if (end < 0) return 0;
      keys.push({ kind: "paste", text: rest.slice(6, end) });
      return end + PASTE_END.length;
    }
    const match = CSI.exec(rest);
    if (!match) return INCOMPLETE_CSI.test(rest) ? 0 : 2;
    const key = csiKey(match[1], match[2]);
    if (key) keys.push(key);
    return match[0].length;
  }
  if (next === "O") {
    if (rest.length < 3) return 0;
    const name = CURSOR_FINALS[rest[2]];
    if (name) keys.push({ kind: "key", name });
    return 3;
  }
  if (next === ESC) {
    keys.push({ kind: "key", name: "escape" });
    return 1;
  }
  // ESC followed by a key is how terminals report Alt without a richer protocol.
  const control = controlKey(next);
  if (control?.kind === "key") keys.push({ ...control, alt: true });
  else if (!control) keys.push({ kind: "key", name: next.toLowerCase(), alt: true });
  return 2;
}

function csiKey(rawParameters: string, final: string): EditorKey | undefined {
  const parameters = rawParameters.split(";").map((field) => field.split(":")[0]);
  const modifiers = (field: string | undefined) => {
    const bits = Math.max(Number(field ?? 1) - 1, 0);
    return { shift: (bits & 1) !== 0, alt: (bits & 2) !== 0, ctrl: (bits & 4) !== 0 };
  };
  if (final === "Z") return { kind: "key", name: "tab", shift: true };
  // The kitty protocol reports `code;mods u`, xterm's modifyOtherKeys `27;mods;code ~`.
  if (final === "u") return codepointKey(Number(parameters[0]), modifiers(parameters[1]));
  if (final === "~" && parameters[0] === "27" && parameters[2]) {
    return codepointKey(Number(parameters[2]), modifiers(parameters[1]));
  }
  const name = final === "~" ? TILDE_KEYS[parameters[0]] : CURSOR_FINALS[final];
  return name ? { kind: "key", name, ...modifiers(parameters[1]) } : undefined;
}

function codepointKey(
  code: number,
  mods: { shift: boolean; alt: boolean; ctrl: boolean },
): EditorKey | undefined {
  const specials: Record<number, string> = {
    13: "enter",
    [KEYPAD_ENTER]: "enter",
    9: "tab",
    127: "backspace",
    8: "backspace",
    27: "escape",
  };
  if (specials[code]) return { kind: "key", name: specials[code], ...mods };
  // The kitty protocol maps keys without a character into a Unicode private use area.
  if (!Number.isInteger(code) || code < 32 || (code >= 0xe000 && code <= 0xf8ff)) return undefined;
  const char = String.fromCodePoint(code);
  if (!mods.ctrl && !mods.alt) {
    return { kind: "text", text: mods.shift ? char.toUpperCase() : char };
  }
  return { kind: "key", name: char.toLowerCase(), ...mods };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{20000}-\u{3fffd}]/u;
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
const ZERO_WIDTH = /^[\p{M}\p{Cf}]+$/u;

export function graphemeWidth(grapheme: string): number {
  if (ZERO_WIDTH.test(grapheme)) return 0;
  return EMOJI.test(grapheme) || WIDE.test(grapheme) ? 2 : 1;
}

function displayWidth(text: string): number {
  return graphemes(text).reduce((sum, part) => sum + graphemeWidth(part), 0);
}

/** One screen row of the buffer: `text.slice(start, end)`, soft-wrapped from a logical line. */
export type EditorRow = { start: number; end: number; lineStart: boolean; lineEnd: boolean };

export function layoutRows(text: string, width: number): EditorRow[] {
  const rows: EditorRow[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    let start = offset;
    let lineStart = true;
    let column = 0;
    for (const part of graphemes(line)) {
      const partWidth = graphemeWidth(part);
      if (column > 0 && column + partWidth > width) {
        rows.push({ start, end: offset, lineStart, lineEnd: false });
        start = offset;
        lineStart = false;
        column = 0;
      }
      column += partWidth;
      offset += part.length;
    }
    rows.push({ start, end: offset, lineStart, lineEnd: true });
    offset += 1; // The newline.
  }
  return rows;
}

function rowContaining(rows: EditorRow[], offset: number): number {
  const index = rows.findIndex((row) =>
    offset >= row.start && (offset < row.end || (row.lineEnd && offset === row.end))
  );
  return index < 0 ? rows.length - 1 : index;
}

function offsetAtColumn(text: string, row: EditorRow, column: number): number {
  let offset = row.start;
  let current = 0;
  for (const part of graphemes(text.slice(row.start, row.end))) {
    const partWidth = graphemeWidth(part);
    if (current + partWidth > column) break;
    current += partWidth;
    offset += part.length;
  }
  return offset;
}

export type EditorAction = "none" | "submit" | "cancel" | "eof" | "interrupt" | "clear";

const WORD = /[\p{L}\p{N}_']/u;

/**
 * The input box as a value: text, cursor, and history position, with no terminal
 * attached. Enter submits only when the buffer ends a phrase and the cursor is on
 * its last line, so any earlier line can still be split while revising input.
 */
export class EditorState {
  text = "";
  cursor = 0;
  #history: string[];
  #historyIndex = -1;
  /** Edits to the draft (-1) and to recalled entries, kept while moving through history. */
  #edits = new Map<number, string>();
  /** An unedited recalled entry: Up/Down keep walking history instead of its lines. */
  #browsing = false;
  #goalColumn: number | undefined;

  /** `history` is ordered most recent first. */
  constructor(history: string[] = []) {
    this.#history = history;
  }

  reset(): void {
    this.text = "";
    this.cursor = 0;
    this.#historyIndex = -1;
    this.#edits.clear();
    this.#browsing = false;
    this.#goalColumn = undefined;
  }

  remember(entry: string): void {
    if (this.#history[0] !== entry) this.#history.unshift(entry);
  }

  /** `width` is the text area in columns, used to move between soft-wrapped rows. */
  apply(key: EditorKey, width: number): EditorAction {
    if (key.kind === "text") {
      this.#settle();
      this.#insert(key.text);
      return "none";
    }
    if (key.kind === "paste") {
      this.#settle();
      this.#insert(sanitizePaste(key.text));
      return "none";
    }
    if (!key.ctrl && !key.alt && (key.name === "up" || key.name === "down")) {
      this.#moveVertically(key.name === "up" ? -1 : 1, width);
      return "none";
    }
    if (key.ctrl && (key.name === "p" || key.name === "n")) {
      this.#moveVertically(key.name === "p" ? -1 : 1, width);
      return "none";
    }
    this.#settle();
    return this.#applyKey(key);
  }

  #settle(): void {
    this.#browsing = false;
    this.#goalColumn = undefined;
  }

  #applyKey(key: Extract<EditorKey, { kind: "key" }>): EditorAction {
    const { name, ctrl, alt, shift } = key;
    if (name === "enter") {
      if (ctrl) this.#insertNewline();
      else if (shift || alt) return this.#terminateAndEnter();
      else return this.#enter();
      return "none";
    }
    if (ctrl) return this.#applyControl(name);
    if (alt) {
      if (name === "b" || name === "left") this.cursor = this.#previousWord();
      else if (name === "f" || name === "right") this.cursor = this.#nextWord();
      else if (name === "d" || name === "delete") this.#remove(this.cursor, this.#nextWord());
      else if (name === "backspace") this.#remove(this.#previousWord(), this.cursor);
      return "none";
    }
    switch (name) {
      case "left":
        this.cursor = this.#previousGrapheme();
        break;
      case "right":
        this.cursor = this.#nextGrapheme();
        break;
      case "home":
        this.cursor = this.#lineStart();
        break;
      case "end":
        this.cursor = this.#lineEnd();
        break;
      case "pageup":
        this.cursor = 0;
        break;
      case "pagedown":
        this.cursor = this.text.length;
        break;
      case "backspace":
        this.#remove(this.#previousGrapheme(), this.cursor);
        break;
      case "delete":
        this.#remove(this.cursor, this.#nextGrapheme());
        break;
      case "tab":
        if (!shift) this.#insert("  ");
        break;
    }
    return "none";
  }

  #applyControl(name: string): EditorAction {
    switch (name) {
      case "c":
        return this.text ? "cancel" : "interrupt";
      case "d":
        if (!this.text) return "eof";
        this.#remove(this.cursor, this.#nextGrapheme());
        break;
      case "l":
        return "clear";
      case "j":
        this.#insertNewline();
        break;
      case "a":
        this.cursor = this.#lineStart();
        break;
      case "e":
        this.cursor = this.#lineEnd();
        break;
      case "b":
        this.cursor = this.#previousGrapheme();
        break;
      case "f":
        this.cursor = this.#nextGrapheme();
        break;
      case "left":
        this.cursor = this.#previousWord();
        break;
      case "right":
        this.cursor = this.#nextWord();
        break;
      case "home":
        this.cursor = 0;
        break;
      case "end":
        this.cursor = this.text.length;
        break;
      case "h":
        this.#remove(this.#previousGrapheme(), this.cursor);
        break;
      case "u":
        this.#remove(this.#lineStart(), this.cursor);
        break;
      case "k":
        // At the end of a line this joins the next one, as Emacs and readline do.
        this.#remove(
          this.cursor,
          this.cursor === this.#lineEnd() ? this.#nextGrapheme() : this.#lineEnd(),
        );
        break;
      case "w":
      case "backspace":
        this.#remove(this.#previousWord(), this.cursor);
        break;
      case "delete":
        this.#remove(this.cursor, this.#nextWord());
        break;
    }
    return "none";
  }

  #enter(): EditorAction {
    if (!this.text.trim()) return "none";
    const onLastLine = !this.text.slice(this.#lineEnd()).trim();
    if (onLastLine && topLevelPhraseEnd(this.text) !== undefined) return "submit";
    this.#insertNewline();
    return "none";
  }

  /** Shift+Enter: jump to the end of the buffer, insert `;`, and press Enter. */
  #terminateAndEnter(): EditorAction {
    if (!this.text.trim()) return "none";
    // A phrase that already ends needs no second `;`.
    if (topLevelPhraseEnd(this.text) === undefined) this.text = `${this.text.trimEnd()};`;
    this.cursor = this.text.length;
    return this.#enter();
  }

  #insertNewline(): void {
    const indent = /^[ \t]*/.exec(this.text.slice(this.#lineStart(), this.cursor))![0];
    this.#insert(`\n${indent}`);
  }

  #insert(text: string): void {
    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.cursor += text.length;
  }

  #remove(start: number, end: number): void {
    this.text = this.text.slice(0, start) + this.text.slice(end);
    this.cursor = start;
  }

  #moveVertically(direction: -1 | 1, width: number): void {
    const rows = layoutRows(this.text, width);
    const current = rowContaining(rows, this.cursor);
    const target = current + direction;
    if (this.#browsing || target < 0 || target >= rows.length) {
      this.#walkHistory(direction);
      return;
    }
    const row = rows[current];
    this.#goalColumn ??= displayWidth(this.text.slice(row.start, this.cursor));
    this.cursor = offsetAtColumn(this.text, rows[target], this.#goalColumn);
  }

  #walkHistory(direction: -1 | 1): void {
    const index = this.#historyIndex - direction; // Up (-1) moves to an older, higher index.
    if (index < -1 || index >= this.#history.length) return;
    if (this.text !== (this.#history[this.#historyIndex] ?? "")) {
      this.#edits.set(this.#historyIndex, this.text);
    }
    this.#historyIndex = index;
    this.text = this.#edits.get(index) ?? this.#history[index] ?? "";
    this.cursor = this.text.length;
    this.#browsing = index >= 0 && !this.#edits.has(index);
    this.#goalColumn = undefined;
  }

  #lineStart(): number {
    return this.cursor === 0 ? 0 : this.text.lastIndexOf("\n", this.cursor - 1) + 1;
  }

  #lineEnd(): number {
    const end = this.text.indexOf("\n", this.cursor);
    return end < 0 ? this.text.length : end;
  }

  #previousGrapheme(): number {
    const start = this.#lineStart();
    if (this.cursor === start) return Math.max(start - 1, 0);
    return this.cursor - graphemes(this.text.slice(start, this.cursor)).at(-1)!.length;
  }

  #nextGrapheme(): number {
    const end = this.#lineEnd();
    if (this.cursor === end) return Math.min(end + 1, this.text.length);
    return this.cursor + graphemes(this.text.slice(this.cursor, end))[0].length;
  }

  #previousWord(): number {
    const chars = [...this.text.slice(0, this.cursor)];
    while (chars.length && !WORD.test(chars.at(-1)!)) chars.pop();
    while (chars.length && WORD.test(chars.at(-1)!)) chars.pop();
    return chars.join("").length;
  }

  #nextWord(): number {
    const chars = [...this.text.slice(this.cursor)];
    let index = 0;
    while (index < chars.length && !WORD.test(chars[index])) index++;
    while (index < chars.length && WORD.test(chars[index])) index++;
    return this.cursor + chars.slice(0, index).join("").length;
  }
}

function sanitizePaste(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(
    /[\x00-\x09\x0b-\x1f\x7f]/g,
    "",
  );
}

export const PROMPT_WIDTH = 2;

export type EditorFrame = { lines: string[]; cursorRow: number; cursorColumn: number };

/** The text area leaves the last column free, so the cursor never hits a pending wrap. */
export function textWidth(columns: number): number {
  return Math.max(columns - PROMPT_WIDTH - 1, 1);
}

/** Lays out the buffer for the screen, scrolling so a buffer taller than it keeps the cursor. */
export function renderFrame(
  text: string,
  cursor: number,
  size: { columns: number; rows: number },
  stylePrompt: (prompt: string) => string = (prompt) => prompt,
): EditorFrame {
  const rows = layoutRows(text, textWidth(size.columns));
  const cursorIndex = rowContaining(rows, cursor);
  const height = Math.max(size.rows - 1, 1);
  const top = Math.max(cursorIndex - height + 1, 0);
  const lines = rows.slice(top, top + height).map((row) => {
    const prompt = !row.lineStart ? "  " : row.start === 0 ? "- " : "= ";
    return stylePrompt(prompt) + text.slice(row.start, row.end);
  });
  const row = rows[cursorIndex];
  return {
    lines,
    cursorRow: cursorIndex - top,
    cursorColumn: PROMPT_WIDTH + displayWidth(text.slice(row.start, cursor)),
  };
}

export type EditorResult =
  | { kind: "submit"; text: string }
  | { kind: "eof" }
  | { kind: "interrupt" };

const ENTER_MODES = "\x1b[?2004h\x1b[>1u"; // Bracketed paste; kitty keyboard disambiguation.
const LEAVE_MODES = "\x1b[<u\x1b[?2004l";

/**
 * Draws the editor inline below existing output and reads keys in raw mode. After
 * a read the terminal stays quiet until `release`: keys typed during evaluation are
 * not echoed and wait for the next read, while Ctrl-C still raises a signal.
 */
export class TerminalEditor {
  #state: EditorState;
  #decoder = new KeyDecoder();
  #queue: EditorKey[] = [];
  #cursorRow = 0;
  #encoder = new TextEncoder();

  constructor(history: string[]) {
    this.#state = new EditorState(history);
  }

  remember(entry: string): void {
    this.#state.remember(entry);
  }

  async read(): Promise<EditorResult> {
    const stdinDecoder = new TextDecoder();
    const buffer = new Uint8Array(4096);
    const redraw = () => this.#draw();
    Deno.stdin.setRaw(true);
    this.#write(ENTER_MODES);
    let resizeListening = false;
    try {
      // Not every platform has SIGWINCH; there the next keypress redraws instead.
      Deno.addSignalListener("SIGWINCH", redraw);
      resizeListening = true;
    } catch { /* Unsupported on this platform. */ }
    try {
      this.#cursorRow = 0;
      this.#state.reset();
      this.#draw();
      for (;;) {
        const result = this.#drainQueue();
        if (result) return result;
        const count = await Deno.stdin.read(buffer);
        if (count === null) return this.#finish({ kind: "eof" });
        this.#queue.push(
          ...this.#decoder.decode(stdinDecoder.decode(buffer.subarray(0, count), { stream: true })),
        );
      }
    } finally {
      if (resizeListening) Deno.removeSignalListener("SIGWINCH", redraw);
      this.#write(LEAVE_MODES);
      Deno.stdin.setRaw(true, { cbreak: true });
    }
  }

  /** Restores normal terminal behavior, for writing output or exiting. */
  release(): void {
    Deno.stdin.setRaw(false);
  }

  /** Applies queued keys, leaving any after a submit as type-ahead for the next read. */
  #drainQueue(): EditorResult | undefined {
    let dirty = false;
    while (this.#queue.length) {
      const action = this.#state.apply(this.#queue.shift()!, textWidth(this.#size().columns));
      dirty = true;
      switch (action) {
        case "submit":
          return this.#finish({ kind: "submit", text: this.#state.text });
        case "eof":
          return this.#finish({ kind: "eof" });
        case "interrupt":
          return this.#finish({ kind: "interrupt" });
        case "cancel":
          this.#commitFrame();
          this.#state.reset();
          break;
        case "clear":
          this.#write("\x1b[2J\x1b[H");
          this.#cursorRow = 0;
          break;
      }
    }
    if (dirty) this.#draw();
    return undefined;
  }

  #finish(result: EditorResult): EditorResult {
    this.#commitFrame();
    return result;
  }

  /** Leaves the buffer in the scrollback and moves below it. */
  #commitFrame(): void {
    this.#state.cursor = this.#state.text.length;
    this.#draw();
    this.#write("\r\n");
    this.#cursorRow = 0;
  }

  #draw(): void {
    const frame = renderFrame(this.#state.text, this.#state.cursor, this.#size(), stylePrompt);
    const up = (count: number) => count > 0 ? `\x1b[${count}A` : "";
    const right = frame.cursorColumn > 0 ? `\x1b[${frame.cursorColumn}C` : "";
    this.#write(
      "\x1b[?25l" + up(this.#cursorRow) + "\r\x1b[J" + frame.lines.join("\r\n") +
        up(frame.lines.length - 1 - frame.cursorRow) + "\r" + right + "\x1b[?25h",
    );
    this.#cursorRow = frame.cursorRow;
  }

  #size(): { columns: number; rows: number } {
    return Deno.consoleSize();
  }

  #write(text: string): void {
    const bytes = this.#encoder.encode(text);
    let written = 0;
    while (written < bytes.length) written += Deno.stdout.writeSync(bytes.subarray(written));
  }
}

function stylePrompt(prompt: string): string {
  return Deno.noColor || !prompt.trim() ? prompt : `\x1b[2m${prompt}\x1b[22m`;
}
