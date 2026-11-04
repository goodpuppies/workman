import { assertEquals } from "@std/assert";
import {
  type EditorAction,
  type EditorKey,
  editorPrompts,
  EditorState,
  KeyDecoder,
  layoutRows,
  renderFrame,
} from "../src/repl_editor.ts";

const WIDTH = 40;

function press(state: EditorState, input: string, width = WIDTH): EditorAction[] {
  return new KeyDecoder().decode(input).map((key) => state.apply(key, width));
}

function stateWith(text: string, cursor = text.length, history: string[] = []): EditorState {
  const state = new EditorState(history);
  state.text = text;
  state.cursor = cursor;
  return state;
}

const ENTER = "\r";
const SHIFT_ENTER = "\x1b[13;2u";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";

Deno.test("decoder reads plain, cursor, kitty, modifyOtherKeys, and Alt keys", () => {
  const decode = (input: string) => new KeyDecoder().decode(input);
  assertEquals(decode("ab"), [{ kind: "text", text: "ab" }]);
  assertEquals(decode("\r"), [{ kind: "key", name: "enter" }]);
  assertEquals(decode("\x1b[A"), [{
    kind: "key",
    name: "up",
    shift: false,
    alt: false,
    ctrl: false,
  }]);
  assertEquals(decode("\x1b[1;5C"), [{
    kind: "key",
    name: "right",
    shift: false,
    alt: false,
    ctrl: true,
  }]);
  const shiftEnter: EditorKey = {
    kind: "key",
    name: "enter",
    shift: true,
    alt: false,
    ctrl: false,
  };
  assertEquals(decode("\x1b[13;2u"), [shiftEnter]);
  assertEquals(decode("\x1b[27;2;13~"), [shiftEnter]);
  // The kitty protocol reports Ctrl-C as a key, not as the 0x03 byte.
  assertEquals(decode("\x1b[99;5u"), [{
    kind: "key",
    name: "c",
    shift: false,
    alt: false,
    ctrl: true,
  }]);
  assertEquals(decode("\x03"), [{ kind: "key", name: "c", ctrl: true }]);
  assertEquals(decode("\x1b\r"), [{ kind: "key", name: "enter", alt: true }]);
  assertEquals(decode("\x1bb"), [{ kind: "key", name: "b", alt: true }]);
});

Deno.test("decoder holds sequences split across reads", () => {
  const decoder = new KeyDecoder();
  assertEquals(decoder.decode("a\x1b"), [{ kind: "text", text: "a" }]);
  assertEquals(decoder.decode("[1"), []);
  assertEquals(decoder.decode("3;2u"), [{
    kind: "key",
    name: "enter",
    shift: true,
    alt: false,
    ctrl: false,
  }]);
  assertEquals(decoder.decode("\x1b[200~one\n"), []);
  assertEquals(decoder.decode("two\x1b[201~z"), [
    { kind: "paste", text: "one\ntwo" },
    { kind: "text", text: "z" },
  ] as EditorKey[]);
});

Deno.test("Enter adds a line until the phrase ends, then submits", () => {
  const state = new EditorState();
  assertEquals(press(state, `let x = 1${ENTER}`), ["none", "none"]);
  assertEquals(state.text, "let x = 1\n");
  assertEquals(press(state, `+ 2;${ENTER}`), ["none", "submit"]);
  assertEquals(state.text, "let x = 1\n+ 2;");
});

Deno.test("Enter on a blank buffer does nothing", () => {
  const state = new EditorState();
  assertEquals(press(state, ENTER), ["none"]);
  assertEquals(state.text, "");
});

Deno.test("Enter ignores semicolons nested in braces and strings", () => {
  for (const text of ["{ let a = 1;", '"a;']) {
    const state = stateWith(text);
    assertEquals(press(state, ENTER), ["none"]);
    assertEquals(state.text, `${text}\n`);
  }
});

Deno.test("Enter anywhere on the last line submits; on an earlier line it splits", () => {
  assertEquals(press(stateWith("let x = 1;", 4), ENTER), ["submit"]);
  const state = stateWith("let x =\n1;", 3);
  assertEquals(press(state, ENTER), ["none"]);
  assertEquals(state.text, "let\n x =\n1;");
});

Deno.test("Shift+Enter jumps to the end, adds the semicolon, and submits", () => {
  const state = stateWith("let x =\n  1  \n", 2);
  assertEquals(press(state, SHIFT_ENTER), ["submit"]);
  assertEquals(state.text, "let x =\n  1;");
  assertEquals(state.cursor, state.text.length);
});

Deno.test("Shift+Enter does not double a semicolon or terminate a blank buffer", () => {
  const finished = stateWith("1;", 0);
  assertEquals(press(finished, SHIFT_ENTER), ["submit"]);
  assertEquals(finished.text, "1;");
  const blank = stateWith("  ");
  assertEquals(press(blank, SHIFT_ENTER), ["none"]);
  assertEquals(blank.text, "  ");
});

Deno.test("Shift+Enter inside an open block presses Enter after the semicolon", () => {
  const state = stateWith("{ let a = 1");
  assertEquals(press(state, SHIFT_ENTER), ["none"]);
  assertEquals(state.text, "{ let a = 1;\n");
});

Deno.test("Enter runs a command with no expression at once", () => {
  assertEquals(press(stateWith(":help"), ENTER), ["submit"]);
  assertEquals(press(stateWith(":help", 2), ENTER), ["submit"]);
  assertEquals(press(stateWith(":help type"), ENTER), ["submit"]);
  assertEquals(press(stateWith(":nope"), ENTER), ["submit"]);
});

Deno.test("a command taking an expression continues until its semicolon", () => {
  for (const text of [":t x", ':t print "nope"', ":t", ":type x +"]) {
    const state = stateWith(text);
    assertEquals(press(state, ENTER), ["none"]);
    assertEquals(state.text, `${text}\n`);
  }
  assertEquals(press(stateWith(":t x;"), ENTER), ["submit"]);
  assertEquals(press(stateWith(":t x +\n1;"), ENTER), ["submit"]);
  assertEquals(press(stateWith(":t { a; "), ENTER), ["none"]);
  const pair = stateWith(":t {};", 4);
  assertEquals(press(pair, ENTER), ["none"]);
  assertEquals(withCursor(pair), ":t {\n  |\n};");
});

Deno.test("Shift+Enter ends an expression command but adds nothing to the others", () => {
  const type = stateWith(":t {}", 4);
  assertEquals(press(type, SHIFT_ENTER), ["submit"]);
  assertEquals(type.text, ":t {};");
  const help = stateWith(":help", 2);
  assertEquals(press(help, SHIFT_ENTER), ["submit"]);
  assertEquals(help.text, ":help");
});

Deno.test("a colon later in the input is not a command", () => {
  const state = stateWith("x\n:t y");
  assertEquals(press(state, ENTER), ["none"]);
  assertEquals(state.text, "x\n:t y\n");
});

Deno.test("a new line keeps the current indent", () => {
  const state = stateWith("{\n  let a = 1;");
  press(state, "\n");
  assertEquals(state.text, "{\n  let a = 1;\n  ");
});

Deno.test("Up and Down move between lines, keeping the column", () => {
  const state = stateWith("abcdef\nab\nabcdef");
  press(state, UP);
  assertEquals(state.cursor, "abcdef\nab".length);
  press(state, UP);
  assertEquals(state.cursor, "abcdef".length);
  press(state, DOWN);
  press(state, DOWN);
  assertEquals(state.cursor, state.text.length);
});

Deno.test("Up and Down move between soft-wrapped rows of one line", () => {
  const state = stateWith("abcdefghij", 7);
  press(state, UP, 5);
  assertEquals(state.cursor, 2);
  press(state, DOWN, 5);
  assertEquals(state.cursor, 7);
});

Deno.test("Up past the first line recalls history and Down restores the draft", () => {
  const state = stateWith("draft", 5, ["newer;", "older;"]);
  press(state, UP);
  assertEquals(state.text, "newer;");
  press(state, UP);
  assertEquals(state.text, "older;");
  press(state, UP);
  assertEquals(state.text, "older;");
  press(state, DOWN);
  press(state, DOWN);
  assertEquals(state.text, "draft");
  press(state, DOWN);
  assertEquals(state.text, "draft");
});

Deno.test("an unedited multi-line entry is one history step until the cursor is moved", () => {
  const state = stateWith("", 0, ["a\nb;", "older;"]);
  press(state, UP);
  assertEquals(state.text, "a\nb;");
  press(state, UP);
  assertEquals(state.text, "older;");
  press(state, DOWN);
  assertEquals(state.text, "a\nb;");
  press(state, LEFT);
  press(state, UP);
  assertEquals(state.text, "a\nb;");
  assertEquals(state.cursor, 1);
});

Deno.test("edits to a recalled entry survive moving through history", () => {
  const state = stateWith("", 0, ["first;", "second;"]);
  press(state, UP);
  press(state, "x");
  press(state, UP);
  assertEquals(state.text, "second;");
  press(state, DOWN);
  assertEquals(state.text, "first;x");
});

Deno.test("Ctrl-C cancels a non-empty buffer and interrupts an empty one", () => {
  assertEquals(press(stateWith("1"), "\x03"), ["cancel"]);
  assertEquals(press(stateWith(""), "\x03"), ["interrupt"]);
});

Deno.test("Ctrl-D ends an empty session and otherwise deletes forward", () => {
  assertEquals(press(stateWith(""), "\x04"), ["eof"]);
  const state = stateWith("ab", 0);
  assertEquals(press(state, "\x04"), ["none"]);
  assertEquals(state.text, "b");
});

Deno.test("deletion and movement stop at whole graphemes", () => {
  const family = "👨‍👩‍👧";
  const state = stateWith(`a${family}`);
  press(state, LEFT);
  assertEquals(state.cursor, 1);
  press(state, "\x1b[C\x7f");
  assertEquals(state.text, "a");
});

Deno.test("word and line editing commands", () => {
  const word = stateWith("let foo_bar = 1");
  press(word, "\x17");
  assertEquals(word.text, "let foo_bar = ");
  press(word, "\x17");
  assertEquals(word.text, "let ");
  const backward = stateWith("one two", 7);
  press(backward, "\x1b[1;5D");
  assertEquals(backward.cursor, 4);
  press(backward, "\x1b[1;5C");
  assertEquals(backward.cursor, 7);
  const line = stateWith("ab\ncd\nef", 4);
  press(line, "\x0b");
  assertEquals(line.text, "ab\nc\nef");
  press(line, "\x0b");
  assertEquals(line.text, "ab\ncef");
  const start = stateWith("ab\ncd", 5);
  press(start, "\x15");
  assertEquals(start.text, "ab\n");
});

function typed(input: string, start = "", cursor = start.length): EditorState {
  const state = stateWith(start, cursor);
  press(state, input);
  return state;
}

function withCursor(state: EditorState): string {
  return `${state.text.slice(0, state.cursor)}|${state.text.slice(state.cursor)}`;
}

Deno.test("an opening bracket or quote closes itself around the cursor", () => {
  assertEquals(withCursor(typed("(")), "(|)");
  assertEquals(withCursor(typed("[")), "[|]");
  assertEquals(withCursor(typed("{")), "{|}");
  assertEquals(withCursor(typed('"')), '"|"');
  assertEquals(withCursor(typed("`")), "`|`");
  assertEquals(withCursor(typed("([{")), "([{|}])");
});

Deno.test("typing a closer steps over the one already there", () => {
  assertEquals(withCursor(typed("()")), "()|");
  assertEquals(withCursor(typed('print("hi");')), 'print("hi");|');
  assertEquals(withCursor(typed("match { (a, b) => [a, b] }")), "match { (a, b) => [a, b] }|");
  assertEquals(withCursor(typed(")", "ab")), "ab)|");
});

Deno.test("nothing is paired in front of a word, inside a string, or in a comment", () => {
  assertEquals(withCursor(typed("(", "foo", 0)), "(|foo");
  assertEquals(withCursor(typed('"', "foo", 0)), '"|foo');
  assertEquals(withCursor(typed("(", '"a"', 2)), '"a(|"');
  assertEquals(withCursor(typed(")", '"a)"', 2)), '"a)|)"');
  assertEquals(withCursor(typed("(", "// a")), "// a(|");
  assertEquals(withCursor(typed('"', "// a ")), '// a "|');
  assertEquals(withCursor(typed('"', "word")), 'word"|');
});

Deno.test("a quote closes a string but an escaped quote stays inside it", () => {
  assertEquals(withCursor(typed('"', '"a"', 2)), '"a"|');
  assertEquals(withCursor(typed('"', '"a\\"', 3)), '"a\\"|"');
});

Deno.test("an apostrophe pairs as a character literal but continues a name", () => {
  assertEquals(withCursor(typed("'")), "'|'");
  assertEquals(withCursor(typed("'a'")), "'a'|");
  assertEquals(withCursor(typed("'\\n'")), "'\\n'|");
  assertEquals(withCursor(typed("let c = 'a';")), "let c = 'a';|");
  assertEquals(withCursor(typed("x'")), "x'|");
  assertEquals(withCursor(typed("let x' = x'';")), "let x' = x'';|");
  assertEquals(withCursor(typed("'\x7f")), "|");
  assertEquals(withCursor(typed("'", '"don', 4)), "\"don'|");
});

Deno.test("Backspace removes an empty pair and otherwise one character", () => {
  assertEquals(withCursor(typed("(\x7f")), "|");
  assertEquals(withCursor(typed('"\x7f')), "|");
  assertEquals(withCursor(typed("\x7f", "(a)", 2)), "(|)");
  assertEquals(withCursor(typed("\x7f", "()", 2)), "(|");
});

Deno.test("Enter opens an empty bracket pair onto its own lines, even in a finished phrase", () => {
  assertEquals(withCursor(typed("{\r")), "{\n  |\n}");
  assertEquals(withCursor(typed("\r", "  f({});", 5)), "  f({\n    |\n  });");
  const state = stateWith("f();", 2);
  assertEquals(press(state, ENTER), ["none"]);
  assertEquals(withCursor(state), "f(\n  |\n);");
});

Deno.test("Enter still submits a finished phrase from outside a pair", () => {
  assertEquals(press(stateWith("f();"), ENTER), ["submit"]);
});

Deno.test("Shift+Enter leaves the pair and terminates the phrase after it", () => {
  const state = typed('print("hi');
  assertEquals(withCursor(state), 'print("hi|")');
  assertEquals(press(state, SHIFT_ENTER), ["submit"]);
  assertEquals(state.text, 'print("hi");');
});

Deno.test("a paste is inserted exactly, with no pairing", () => {
  const state = new EditorState();
  press(state, '\x1b[200~f("a", (b\x1b[201~');
  assertEquals(withCursor(state), 'f("a", (b|');
});

Deno.test("a paste keeps its newlines and never submits", () => {
  const state = new EditorState();
  const actions = press(state, "\x1b[200~let a = 1;\r\nlet b\t= 2;\r\x1b[201~");
  assertEquals(actions, ["none"]);
  assertEquals(state.text, "let a = 1;\nlet b  = 2;\n");
});

Deno.test("rows wrap by display width and never split a wide character", () => {
  const rows = layoutRows("ab漢字\ncd", 4);
  assertEquals(rows.map(({ start, end }) => [start, end]), [[0, 3], [3, 4], [5, 7]]);
});

Deno.test("frame prompts lines, indents wrapped rows, and places the cursor", () => {
  const frame = renderFrame("abcdefgh\nij", 4, { columns: 8, rows: 24 });
  assertEquals(frame.lines, ["- abcde", "  fgh", "= ij"]);
  assertEquals(frame.cursorRow, 0);
  assertEquals(frame.cursorColumn, 6);
  // A cursor at a wrap boundary sits at the start of the next row.
  const boundary = renderFrame("abcdefgh", 5, { columns: 8, rows: 24 });
  assertEquals([boundary.cursorRow, boundary.cursorColumn], [1, 2]);
});

Deno.test("prompts default to the SML pair", () => {
  assertEquals(editorPrompts(), { first: "- ", continuation: "= ", wrap: "  ", width: 2 });
});

Deno.test("a name goes in front of the prompt and the continuation aligns under it", () => {
  const prompts = editorPrompts({ name: "wm", prompt: "> ", continuation: "| " });
  assertEquals(prompts, { first: "wm> ", continuation: "  | ", wrap: "    ", width: 4 });
  const frame = renderFrame("abcdefgh\nij", 11, { columns: 10, rows: 24 }, prompts);
  assertEquals(frame.lines, ["wm> abcde", "    fgh", "  | ij"]);
  assertEquals([frame.cursorRow, frame.cursorColumn], [2, 6]);
});

Deno.test("prompts are used as written and a longer continuation pads the first prompt", () => {
  const speakeasy = editorPrompts({ prompt: ":_", continuation: "" });
  assertEquals(speakeasy, { first: ":_", continuation: "  ", wrap: "  ", width: 2 });
  assertEquals(renderFrame("x", 1, { columns: 20, rows: 24 }, speakeasy).lines, [":_x"]);
  const long = editorPrompts({ prompt: "> ", continuation: "... " });
  assertEquals([long.first, long.continuation, long.width], ["  > ", "... ", 4]);
});

Deno.test("a wide character in a prompt counts for its display width", () => {
  const prompts = editorPrompts({ prompt: "🗿 " });
  assertEquals(prompts.width, 3);
  assertEquals(prompts.continuation, " = ");
  assertEquals(renderFrame("a", 1, { columns: 20, rows: 24 }, prompts).cursorColumn, 4);
});

Deno.test("a buffer taller than the screen scrolls to keep the cursor visible", () => {
  const text = ["1", "2", "3", "4", "5"].join("\n");
  const frame = renderFrame(text, text.length, { columns: 20, rows: 4 });
  assertEquals(frame.lines, ["= 3", "= 4", "= 5"]);
  assertEquals(frame.cursorRow, 2);
  const top = renderFrame(text, 0, { columns: 20, rows: 4 });
  assertEquals(top.lines, ["- 1", "= 2", "= 3"]);
  assertEquals(top.cursorRow, 0);
});
