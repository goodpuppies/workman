import { assertEquals } from "@std/assert";
import { documentSymbols } from "../src/lsp/document_symbols.ts";
import { prepareRenameAt, renameAt } from "../src/lsp/rename.ts";
import {
  definitionAt,
  documentHighlightsAt,
  referencesAt,
  typeDefinitionAt,
} from "../src/lsp/symbols.ts";
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

Deno.test("lsp type definition follows inferred nominal types across modules", async () => {
  const dir = await Deno.makeTempDir();
  const records = `${dir}/records.wm`;
  const main = `${dir}/main.wm`;
  const recordsSource = "record Point = { x: Number, y: Number };";
  const mainSource = 'from "./records.wm" import { Point }; ' +
    "let point = Point(1, 2); let use = point;";
  await Deno.writeTextFile(records, recordsSource);
  await Deno.writeTextFile(main, mainSource);

  const definitions = await typeDefinitionAt(
    pathToFileUri(main),
    positionOf(mainSource, "point;"),
    new Map(),
  );

  assertEquals(definitions, [{
    uri: pathToFileUri(records),
    range: {
      start: { line: 0, character: recordsSource.indexOf("Point") },
      end: { line: 0, character: recordsSource.indexOf("Point") + "Point".length },
    },
  }]);
});

Deno.test("lsp type definition returns each nominal component of a composite type", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "record Left = { value: Number }; record Right = { value: String }; " +
    'let pair = (Left(1), Right("x")); let use = pair;';
  await Deno.writeTextFile(path, source);

  const definitions = await typeDefinitionAt(
    pathToFileUri(path),
    positionOf(source, "pair;"),
    new Map(),
  );

  assertEquals(
    definitions.map(({ range }) => source.slice(range.start.character, range.end.character)),
    ["Left", "Right"],
  );
});

Deno.test("lsp type definition uses certified recovered types and ignores primitives", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let broken = Missing; record Good = { value: Number }; " +
    "let good = Good(1); let use = good; let primitive = 1;";
  await Deno.writeTextFile(path, source);
  const uri = pathToFileUri(path);

  const nominal = await typeDefinitionAt(uri, positionOf(source, "good;"), new Map());
  const primitive = await typeDefinitionAt(uri, positionOf(source, "primitive ="), new Map());

  assertEquals(
    nominal.map(({ range }) => source.slice(range.start.character, range.end.character)),
    ["Good"],
  );
  assertEquals(primitive, []);
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

Deno.test("lsp document highlights classify declarations and reads", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let value = 1; let first = value; let second = value;";
  await Deno.writeTextFile(path, source);

  const highlights = await documentHighlightsAt(
    pathToFileUri(path),
    positionOf(source, "value;"),
    new Map(),
  );

  assertEquals(
    highlights.map(({ range, kind }) => ({
      text: source.slice(range.start.character, range.end.character),
      kind,
    })),
    [
      { text: "value", kind: 3 },
      { text: "value", kind: 2 },
      { text: "value", kind: 2 },
    ],
  );
});

Deno.test("lsp document highlights preserve local import-alias selection", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  const source = 'from "./lib.wm" import { add as plus }; let result = plus(1, 2);';
  await Deno.writeTextFile(lib, "let add = (left, right) => { left + right };");
  await Deno.writeTextFile(main, source);
  const uri = pathToFileUri(main);

  const alias = await documentHighlightsAt(uri, positionOf(source, "plus(1"), new Map());
  const target = await documentHighlightsAt(uri, positionOf(source, "add as"), new Map());

  assertEquals(
    alias.map(({ range, kind }) => ({
      text: source.slice(range.start.character, range.end.character),
      kind,
    })),
    [
      { text: "plus", kind: 3 },
      { text: "plus", kind: 2 },
    ],
  );
  assertEquals(
    target.map(({ range, kind }) => ({
      text: source.slice(range.start.character, range.end.character),
      kind,
    })),
    [
      { text: "add", kind: 2 },
      { text: "plus", kind: 3 },
      { text: "plus", kind: 2 },
    ],
  );
});

Deno.test("lsp document highlights use certified and deterministic field identities", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let broken = Missing; record First = { x: Number }; " +
    "record Second = { x: Number }; let read = (value) => { value.x };";
  await Deno.writeTextFile(path, source);

  const highlights = await documentHighlightsAt(
    pathToFileUri(path),
    positionOf(source, "x };"),
    new Map(),
  );
  const definition = await definitionAt(
    pathToFileUri(path),
    positionOf(source, "x };"),
    new Map(),
  );

  assertEquals(
    highlights.map(({ range, kind }) => ({
      text: source.slice(range.start.character, range.end.character),
      kind,
    })),
    [
      { text: "x", kind: 3 },
      { text: "x", kind: 2 },
    ],
  );
  assertEquals(definition?.range.start.character, source.indexOf("x: Number"));
});

Deno.test("lsp references stay inside the selected project snapshot", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const parallel = `${dir}/parallel.wm`;
  const mainSource = "let value = 1; let local = value;";
  const parallelSource = 'from "./main.wm" import { value }; let external = value;';
  await Deno.writeTextFile(main, mainSource);
  await Deno.writeTextFile(parallel, parallelSource);

  const references = await referencesAt(
    pathToFileUri(main),
    positionOf(mainSource, "value ="),
    true,
    new Map([[parallel, parallelSource]]),
  );

  assertEquals(references.map((item) => item.uri), [
    pathToFileUri(main),
    pathToFileUri(main),
  ]);
});

Deno.test("lsp rename edits one compiler-selected local binding group", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let value = 1; let result = value;";
  await Deno.writeTextFile(path, source);
  const uri = pathToFileUri(path);

  const prepared = await prepareRenameAt(uri, positionOf(source, "value;"), new Map());
  const renamed = await renameAt(uri, positionOf(source, "value;"), "answer", new Map());

  assertEquals(prepared?.placeholder, "value");
  assertEquals(
    renamed?.changes[uri].map((edit) => ({
      text: source.slice(
        edit.range.start.character,
        edit.range.end.character,
      ),
      newText: edit.newText,
    })),
    [
      { text: "value", newText: "answer" },
      { text: "value", newText: "answer" },
    ],
  );
});

Deno.test("lsp rename distinguishes a local named-import alias from its target", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/math.wm`;
  const main = `${dir}/main.wm`;
  const libSource = "let add = (left, right) => { left + right };";
  const mainSource = 'from "./math.wm" import { add as plus }; let result = plus(1, 2);';
  await Deno.writeTextFile(lib, libSource);
  await Deno.writeTextFile(main, mainSource);
  const libUri = pathToFileUri(lib);
  const mainUri = pathToFileUri(main);

  const local = await renameAt(
    mainUri,
    positionOf(mainSource, "plus };"),
    "sum",
    new Map(),
  );
  assertEquals(Object.keys(local?.changes ?? {}), [mainUri]);
  assertEquals(
    local?.changes[mainUri].map((edit) =>
      mainSource.slice(edit.range.start.character, edit.range.end.character)
    ),
    ["plus", "plus"],
  );

  const target = await renameAt(
    mainUri,
    positionOf(mainSource, "add as"),
    "combine",
    new Map(),
  );
  assertEquals(Object.keys(target?.changes ?? {}).sort(), [libUri, mainUri].sort());
  assertEquals(
    target?.changes[libUri].map((edit) =>
      libSource.slice(edit.range.start.character, edit.range.end.character)
    ),
    ["add"],
  );
  assertEquals(
    target?.changes[mainUri].map((edit) =>
      mainSource.slice(edit.range.start.character, edit.range.end.character)
    ),
    ["add"],
  );
});

Deno.test("lsp rename covers namespace aliases and nominal record fields", async () => {
  const dir = await Deno.makeTempDir();
  const records = `${dir}/records.wm`;
  const main = `${dir}/main.wm`;
  const recordsSource = "record Point = { x: Number };";
  const mainSource = 'from "./records.wm" import * as Geometry; ' +
    "let read = (point: Geometry.Point) => { point.x };";
  await Deno.writeTextFile(records, recordsSource);
  await Deno.writeTextFile(main, mainSource);
  const recordsUri = pathToFileUri(records);
  const mainUri = pathToFileUri(main);

  const namespace = await renameAt(
    mainUri,
    positionOf(mainSource, "Geometry;"),
    "Shapes",
    new Map(),
  );
  assertEquals(Object.keys(namespace?.changes ?? {}), [mainUri]);
  assertEquals(namespace?.changes[mainUri].length, 2);

  const field = await renameAt(
    mainUri,
    positionOf(mainSource, "x };"),
    "coordinate",
    new Map(),
  );
  assertEquals(Object.keys(field?.changes ?? {}).sort(), [recordsUri, mainUri].sort());
  assertEquals(field?.changes[recordsUri].length, 1);
  assertEquals(field?.changes[mainUri].length, 1);
});

Deno.test("lsp rename refuses incomplete snapshots and invalid lexical categories", async () => {
  const dir = await Deno.makeTempDir();
  const incompletePath = `${dir}/incomplete.wm`;
  const incompleteSource = "let broken = Missing; let good = 1; let use = good;";
  await Deno.writeTextFile(incompletePath, incompleteSource);
  const incompleteUri = pathToFileUri(incompletePath);

  assertEquals(
    await prepareRenameAt(
      incompleteUri,
      positionOf(incompleteSource, "good;"),
      new Map(),
    ),
    null,
  );

  const validPath = `${dir}/valid.wm`;
  const validSource = "let good = 1; let use = good;";
  await Deno.writeTextFile(validPath, validSource);
  const validUri = pathToFileUri(validPath);
  const validPosition = positionOf(validSource, "good;");
  assertEquals(await renameAt(validUri, validPosition, "let", new Map()), null);
  assertEquals(await renameAt(validUri, validPosition, "Upper", new Map()), null);
});

Deno.test("lsp definitions use compiler-certified facts after a failed phrase", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let broken = Missing; let good = 1; let use = good;";
  await Deno.writeTextFile(path, source);

  const definition = await definitionAt(
    pathToFileUri(path),
    positionOf(source, "good;"),
    new Map(),
  );

  assertEquals(definition?.range, {
    start: { line: 0, character: source.indexOf("good =") },
    end: { line: 0, character: source.indexOf("good =") + "good".length },
  });
});

Deno.test("lsp definitions do not invent a fallback binding for failed phrases", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let broken = Missing; let use = broken;";
  await Deno.writeTextFile(path, source);

  const definition = await definitionAt(
    pathToFileUri(path),
    positionOf(source, "broken;"),
    new Map(),
  );

  assertEquals(definition, null);
});

Deno.test("lsp document symbols include values, types, and constructors", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  await Deno.writeTextFile(path, "type Choice = First | Second; let value = First;");

  const symbols = await documentSymbols(pathToFileUri(path), new Map());

  assertEquals(symbols.map((symbol) => symbol.name), ["Choice", "value"]);
  assertEquals(symbols[0].children?.map((symbol) => symbol.name), ["First", "Second"]);
});

Deno.test("lsp document symbols expose only compiler-certified recovered declarations", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  const source = "let broken = Missing; type Choice = First | Second; let value = First;";
  await Deno.writeTextFile(path, source);

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
