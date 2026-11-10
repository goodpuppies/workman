import { assertEquals } from "@std/assert";
import {
  BASIC_STYLES,
  highlightReplOutput,
  highlightSpans,
  paintRange,
  terminalHighlightStyles,
  WORKMAN_STYLES,
} from "../src/repl_highlight.ts";
import { editorPrompts, renderFrame } from "../src/repl_editor.ts";

/** The highlighted pieces of `text`, as `kind:piece`. */
function pieces(text: string): string[] {
  return highlightSpans(text).map(({ start, end, kind }) => `${kind}:${text.slice(start, end)}`);
}

Deno.test("keywords, constants, and numbers are recognized as whole words", () => {
  assertEquals(pieces("let rec x = if true { 1.5 } else { 0xFF };"), [
    "keyword:let",
    "keyword:rec",
    "keyword:if",
    "constant:true",
    "number:1.5",
    "keyword:else",
    "number:0xFF",
  ]);
  assertEquals(pieces("letter iffy void' x2"), []);
});

Deno.test("capitalized names are types and a name before a parenthesis is a function", () => {
  assertEquals(pieces("Some(x)"), ["type:Some"]);
  assertEquals(pieces("print (x); y"), ["function:print"]);
  assertEquals(pieces("List.map(f)"), ["type:List", "function:map"]);
});

Deno.test("strings and comments hide what they contain", () => {
  assertEquals(pieces('"let x" + 1'), ['string:"let x"', "number:1"]);
  assertEquals(pieces('"a\\"let"'), ['string:"a\\"let"']);
  assertEquals(pieces("`let ${x}`"), ["string:`let ${x}`"]);
  assertEquals(pieces("1 // let\nlet"), ["number:1", "comment:// let", "keyword:let"]);
  assertEquals(pieces("1 -- let"), ["number:1", "comment:-- let"]);
  assertEquals(pieces("/* let /* nested */ let */ let"), [
    "comment:/* let /* nested */ let */",
    "keyword:let",
  ]);
});

Deno.test("input still being typed colors to its end", () => {
  assertEquals(pieces('"open\nlet'), ['string:"open\nlet']);
  assertEquals(pieces("/* open\nlet"), ["comment:/* open\nlet"]);
  assertEquals(pieces("/"), []);
});

Deno.test("an apostrophe opens a character or continues a name", () => {
  assertEquals(pieces("'a' 'x'"), ["string:'a'", "string:'x'"]);
  assertEquals(pieces("'\\n'"), ["string:'\\n'"]);
  assertEquals(pieces("'open"), []);
  assertEquals(pieces("x' y'"), []);
  assertEquals(pieces("'"), []);
});

Deno.test("a command name is colored, and only an expression argument is code", () => {
  assertEquals(pieces(":t let"), ["command::t", "keyword:let"]);
  assertEquals(pieces(":help type"), ["command::help"]);
  assertEquals(pieces("// note\n:t 1;"), ["comment:// note", "command::t", "number:1"]);
  assertEquals(pieces("  :h"), ["command::h"]);
});

Deno.test("painting a range keeps its text and color across a row boundary", () => {
  const text = '"abcdef" x';
  const spans = highlightSpans(text);
  assertEquals(paintRange(text, 0, 4, spans, BASIC_STYLES), '\x1b[32m"abc\x1b[39m');
  assertEquals(paintRange(text, 4, 10, spans, BASIC_STYLES), '\x1b[32mdef"\x1b[39m x');
  assertEquals(paintRange("plain", 0, 5, [], BASIC_STYLES), "plain");
  assertEquals(paintRange(text, 8, 10, spans, BASIC_STYLES), " x");
});

Deno.test("spans are ordered and don't overlap, for any input", () => {
  for (
    const text of [
      "let f = (x: 'a) => { print(`a${x}`); /* c */ 'b' };",
      '// a\n:t "b" + 1;',
      "'''' \"\\",
      "-- \n/* */ 1e5 0x",
    ]
  ) {
    let last = 0;
    for (const span of highlightSpans(text)) {
      assertEquals(span.start >= last && span.end > span.start, true, text);
      last = span.end;
    }
    assertEquals(last <= text.length, true);
  }
});

Deno.test("the frame colors text but measures the cursor without the color", () => {
  const prompts = editorPrompts();
  const plain = renderFrame("let x", 5, { columns: 40, rows: 24 }, prompts);
  const colored = renderFrame(
    "let x",
    5,
    { columns: 40, rows: 24 },
    prompts,
    undefined,
    highlightSpans,
    BASIC_STYLES,
  );
  assertEquals(plain.lines, ["- let x"]);
  assertEquals(colored.lines, ["- \x1b[35mlet\x1b[39m x"]);
  assertEquals(colored.cursorColumn, plain.cursorColumn);
});

Deno.test("a frame colors a string split across a soft wrap on both rows", () => {
  const frame = renderFrame(
    '"abcdefgh"',
    0,
    { columns: 8, rows: 24 },
    editorPrompts(),
    undefined,
    highlightSpans,
    BASIC_STYLES,
  );
  assertEquals(frame.lines, ['- \x1b[32m"abcd\x1b[39m', '  \x1b[32mefgh"\x1b[39m']);
});

Deno.test("the Workman colors need truecolor, and other terminals keep the 16-color palette", () => {
  const previous = Deno.env.get("COLORTERM");
  const previousSession = Deno.env.get("WT_SESSION");
  const restore = () => {
    if (previous === undefined) Deno.env.delete("COLORTERM");
    else Deno.env.set("COLORTERM", previous);
    if (previousSession === undefined) Deno.env.delete("WT_SESSION");
    else Deno.env.set("WT_SESSION", previousSession);
  };
  try {
    Deno.env.delete("WT_SESSION");
    for (const value of ["truecolor", "24bit"]) {
      Deno.env.set("COLORTERM", value);
      assertEquals(terminalHighlightStyles(), WORKMAN_STYLES);
    }
    Deno.env.set("COLORTERM", "yes");
    assertEquals(terminalHighlightStyles(), BASIC_STYLES);
    Deno.env.delete("COLORTERM");
    assertEquals(terminalHighlightStyles(), BASIC_STYLES);
    Deno.env.set("WT_SESSION", "test-windows-terminal-session");
    assertEquals(terminalHighlightStyles(), WORKMAN_STYLES);
    Deno.env.set("WT_SESSION", "");
    assertEquals(terminalHighlightStyles(), BASIC_STYLES);
  } finally {
    restore();
  }
});

Deno.test("the Workman keyword color is the loading bar's orange", () => {
  const text = "let x";
  assertEquals(
    paintRange(text, 0, 5, highlightSpans(text), WORKMAN_STYLES),
    "\x1b[38;2;255;106;21mlet\x1b[39m x",
  );
});

Deno.test("REPL declarations keep keyword and type colors without coloring fields", () => {
  const text = "record User = { name: String }";
  assertEquals(
    highlightReplOutput(text).map(({ start, end, kind }) => `${kind}:${text.slice(start, end)}`),
    [
      "keyword:record",
      "type:User",
      "type:String",
    ],
  );
});

Deno.test("REPL bindings and function values stay plain with one color for the whole type", () => {
  for (
    const text of [
      "printName = <function> : 'a -> Void! where 'a.name: 'b",
      "it = <function> : User -> String",
      "it = void : Void!",
    ]
  ) {
    const start = text.indexOf(" : ") + 3;
    assertEquals(highlightReplOutput(text), [{ start, end: text.length, kind: "type" }]);
    assertEquals(
      paintRange(text, 0, text.length, highlightReplOutput(text), WORKMAN_STYLES),
      text.slice(0, start) + WORKMAN_STYLES.type + text.slice(start) + "\x1b[39m",
    );
  }
  const type = "'a -> Void! where 'a.name: 'b";
  assertEquals(highlightReplOutput(type), [{ start: 0, end: type.length, kind: "type" }]);
});

Deno.test("result type detection skips colons inside record values and strings", () => {
  for (
    const text of [
      'user = { name = "Ellie: User" } : User',
      'it = Some("type: String") : Option<String>',
      "it = ':' : Char",
    ]
  ) {
    const spans = highlightReplOutput(text);
    const start = text.lastIndexOf(" : ") + 3;
    assertEquals(spans.at(-1), { start, end: text.length, kind: "type" });
    const painted = paintRange(text, 0, text.length, spans, WORKMAN_STYLES);
    assertEquals(painted.replace(/\x1b\[[0-9;]*m/g, ""), text);
  }
});
