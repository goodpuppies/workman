import { assertEquals } from "@std/assert";
import { documentSymbols } from "../src/lsp/document_symbols.ts";
import { definitionAt, referencesAt } from "../src/lsp/symbols.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("lsp definition resolves a lexically scoped local binding", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let outer = (x) => { let value = x; value };";
  await Deno.writeTextFile(path, source);

  const result = await definitionAt(
    pathToFileUri(path),
    positionOf(source, "value };"),
    new Map(),
  );

  assertEquals(result?.uri, pathToFileUri(path));
  assertEquals(result?.range, {
    start: { line: 0, character: 25 },
    end: { line: 0, character: 30 },
  });
});

Deno.test("lsp definition follows named import aliases into unsaved modules", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  const libSource = "let value = 1;";
  const mainSource = 'from "./lib.wm" import { value as answer }; let result = answer;';
  await Deno.writeTextFile(lib, libSource);
  await Deno.writeTextFile(main, mainSource);
  const overrides = new Map([[lib, "let value = 2;"]]);

  const result = await definitionAt(
    pathToFileUri(main),
    positionOf(mainSource, "answer;"),
    overrides,
  );

  assertEquals(result?.uri, pathToFileUri(lib));
  assertEquals(result?.range, { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
});

Deno.test("lsp definition resolves namespace members and namespace modules", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  const source = 'from "./lib.wm" import * as Lib; let result = Lib.value;';
  await Deno.writeTextFile(lib, "let value = 1;");
  await Deno.writeTextFile(main, source);
  const uri = pathToFileUri(main);

  const member = await definitionAt(uri, positionOf(source, "value;"), new Map());
  const namespace = await definitionAt(uri, positionOf(source, "Lib.value"), new Map());

  assertEquals(member?.uri, pathToFileUri(lib));
  assertEquals(member?.range.start.character, 4);
  assertEquals(namespace?.uri, pathToFileUri(lib));
  assertEquals(namespace?.range.start, { line: 0, character: 0 });
});

Deno.test("lsp definition resolves an imported record constructor to its declaration", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/records.wm`;
  const main = `${dir}/main.wm`;
  const libSource = "record Point = { x: Number, y: Number };";
  const mainSource = 'from "./records.wm" import { Point }; let point = Point(1, 2);';
  await Deno.writeTextFile(lib, libSource);
  await Deno.writeTextFile(main, mainSource);

  const result = await definitionAt(
    pathToFileUri(main),
    positionOf(mainSource, "Point(1"),
    new Map(),
  );

  assertEquals(result?.uri, pathToFileUri(lib));
  assertEquals(result?.range, {
    start: { line: 0, character: 7 },
    end: { line: 0, character: 12 },
  });
});

Deno.test("lsp references respect includeDeclaration", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let id = (x) => { x }; let result = id(id(1));";
  await Deno.writeTextFile(path, source);
  const uri = pathToFileUri(path);

  const uses = await referencesAt(uri, positionOf(source, "id(id"), false, new Map());
  const all = await referencesAt(uri, positionOf(source, "id(id"), true, new Map());

  assertEquals(uses.length, 2);
  assertEquals(all.length, 3);
});

Deno.test("lsp document symbols include values, types, and constructors", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  await Deno.writeTextFile(path, "type Choice = First | Second; let value = First;");

  const symbols = await documentSymbols(pathToFileUri(path), new Map());

  assertEquals(symbols.map((symbol) => symbol.name), ["Choice", "value"]);
  assertEquals(symbols[0].children?.map((symbol) => symbol.name), ["First", "Second"]);
});

function positionOf(source: string, text: string) {
  const offset = source.indexOf(text);
  if (offset < 0) throw new Error(`missing ${text}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}
