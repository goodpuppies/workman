import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  isReplCommand,
  type ParsedReplCommand,
  parseReplCommand,
  type ReplCommandDescription,
  replCommandNeedsSemicolon,
  replHelpText,
} from "../src/repl_commands.ts";

const describe = (name: string): ReplCommandDescription => ({
  name,
  usage: `:${name}`,
  summary: `${name} summary`,
  detail: `${name} detail`,
});

Deno.test("only a colon followed by a letter is a command", () => {
  for (const text of [":t x", ":help", "  :t x", ":t", ":t;", "// note\n:t x", " -- a\n\n:h"]) {
    assertEquals(isReplCommand(text), true);
  }
  for (
    const text of [
      "x",
      "let x : Number = 1;",
      ":: x",
      ":> f",
      ": x",
      ":5",
      "x\n:t y",
      "",
      "// :t x",
    ]
  ) {
    assertEquals(isReplCommand(text), false);
  }
});

Deno.test("only a command taking an expression needs a semicolon", () => {
  for (const text of [":t x", ":type", ":ty x"]) {
    assertEquals(replCommandNeedsSemicolon(text), true);
  }
  for (const text of [":help", ":h type", ":nope"]) {
    assertEquals(replCommandNeedsSemicolon(text), false);
  }
});

Deno.test("a command resolves by full name or unique prefix", () => {
  const type: ParsedReplCommand = { kind: "command", name: "type", argument: "x + 1" };
  assertEquals(parseReplCommand(":type x + 1"), type);
  assertEquals(parseReplCommand(":t x + 1"), type);
  assertEquals(parseReplCommand(":ty x + 1"), type);
  assertEquals(parseReplCommand(":h"), { kind: "command", name: "help", argument: "" });
  assertEquals(parseReplCommand(":t;"), { kind: "command", name: "type", argument: "" });
  assertEquals(parseReplCommand("// note\n:t x;"), {
    kind: "command",
    name: "type",
    argument: "x",
  });
});

Deno.test("a command argument keeps its lines and drops a habitual semicolon", () => {
  assertEquals(parseReplCommand(":t x;  "), { kind: "command", name: "type", argument: "x" });
  assertEquals(parseReplCommand(":t {\n  x\n}"), {
    kind: "command",
    name: "type",
    argument: "{\n  x\n}",
  });
});

Deno.test("an unknown command points at the help", () => {
  assertEquals(parseReplCommand(":nope"), {
    kind: "error",
    message: "unknown command :nope; try :help",
  });
  assertEquals(parseReplCommand(":typed x").kind, "error");
});

Deno.test("an ambiguous prefix names its candidates, and a full name always wins", () => {
  const commands = [describe("reset"), describe("reload"), describe("re")];
  assertEquals(parseReplCommand(":r", commands), {
    kind: "error",
    message: "ambiguous command :r: could be :reset, :reload, :re",
  });
  assertEquals(parseReplCommand(":re", commands), { kind: "command", name: "re", argument: "" });
  assertEquals(parseReplCommand(":res", commands), {
    kind: "command",
    name: "reset",
    argument: "",
  });
});

Deno.test("help lists every command, and takes one with or without its colon", () => {
  const help = replHelpText();
  assertStringIncludes(help, ":help [command]");
  assertStringIncludes(help, ":type <expression>");
  assertStringIncludes(help, "quit()");
  assertEquals(replHelpText("type"), replHelpText(":t"));
  assertStringIncludes(replHelpText("t"), "Nothing runs");
  assertEquals(replHelpText("nope"), "unknown command :nope; try :help");
});
