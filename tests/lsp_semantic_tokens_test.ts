import { assertEquals } from "@std/assert";
import {
  semanticTokenModifiers,
  semanticTokensFull,
  semanticTokenTypes,
} from "../src/lsp/semantic_tokens.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("semantic tokens classify compiler-owned SML namespaces and symbol roles", async () => {
  const main = "/test/main.wm";
  const lib = "/test/lib.wm";
  const source = [
    'from "./lib.wm" import * as Lib;',
    "type Option<T> = None | Some<T>;",
    "record Box<T> = { value: T };",
    "let map = (fn, item) => { let local = fn(item); Box(local) };",
    "let result = Lib.id(Some(1));",
  ].join("\n");
  const result = await semanticTokensFull(
    pathToFileUri(main),
    new Map([
      [main, source],
      [lib, "let id = (value) => { value };"],
    ]),
  );
  const tokens = decodeTokens(source, result?.data ?? []);

  assertEquals(tokenAt(source, tokens, source.indexOf("Lib;")), {
    text: "Lib",
    type: "namespace",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.indexOf("Option")), {
    text: "Option",
    type: "type",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.indexOf("<T>") + 1), {
    text: "T",
    type: "typeParameter",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.indexOf("Some")), {
    text: "Some",
    type: "enumMember",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.indexOf("value:")), {
    text: "value",
    type: "property",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.indexOf("map =")), {
    text: "map",
    type: "function",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.indexOf("fn,")), {
    text: "fn",
    type: "parameter",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.indexOf("local =")), {
    text: "local",
    type: "variable",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.lastIndexOf("Lib.id")), {
    text: "Lib",
    type: "namespace",
    modifiers: [],
  });
  assertEquals(tokenAt(source, tokens, source.lastIndexOf("id(")), {
    text: "id",
    type: "function",
    modifiers: [],
  });
  assertEquals(tokenAt(source, tokens, source.lastIndexOf("Some")), {
    text: "Some",
    type: "enumMember",
    modifiers: [],
  });
});

Deno.test("semantic tokens expose only compiler-certified recovered occurrences", async () => {
  const path = "/test/main.wm";
  const source = "let before = (parameter) => { parameter }; let broken = ; let after = before(1);";
  const result = await semanticTokensFull(
    pathToFileUri(path),
    new Map([[path, source]]),
  );
  const tokens = decodeTokens(source, result?.data ?? []);

  assertEquals(tokens.some(({ text }) => text === "broken"), false);
  assertEquals(tokenAt(source, tokens, source.indexOf("after")), {
    text: "after",
    type: "variable",
    modifiers: ["declaration"],
  });
  assertEquals(tokenAt(source, tokens, source.lastIndexOf("before")), {
    text: "before",
    type: "function",
    modifiers: [],
  });
});

type DecodedToken = Readonly<{
  start: number;
  text: string;
  type: string;
  modifiers: readonly string[];
}>;

function decodeTokens(source: string, data: readonly number[]): readonly DecodedToken[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  const tokens: DecodedToken[] = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index];
    line += deltaLine;
    character = deltaLine === 0 ? character + data[index + 1] : data[index + 1];
    const length = data[index + 2];
    const start = starts[line] + character;
    const modifierBits = data[index + 4];
    tokens.push({
      start,
      text: source.slice(start, start + length),
      type: semanticTokenTypes[data[index + 3]],
      modifiers: semanticTokenModifiers.filter((_, bit) => (modifierBits & (1 << bit)) !== 0),
    });
  }
  return tokens;
}

function tokenAt(
  source: string,
  tokens: readonly DecodedToken[],
  start: number,
): Omit<DecodedToken, "start"> | undefined {
  const token = tokens.find((candidate) => candidate.start === start);
  if (!token) return;
  return {
    text: source.slice(token.start, token.start + token.text.length),
    type: token.type,
    modifiers: token.modifiers,
  };
}
