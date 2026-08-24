import { assertEquals } from "@std/assert";
import { completionAt } from "../src/lsp/completion.ts";
import { ProjectIndex } from "../src/lsp/project_index.ts";
import { SemanticService } from "../src/lsp/semantic_service.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("ordinary completion returns lexical values with semantic type detail", async () => {
  const path = "/test/main.wm";
  const source = "let outer = 1; let use = outer;";
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, source.lastIndexOf("outer") + 2),
    new Map([[path, source]]),
  );

  assertEquals(items.map(({ label, kind, detail }) => ({ label, kind, detail })), [{
    label: "outer",
    kind: 6,
    detail: "Number",
  }]);
});

Deno.test("ordinary completion preserves name-only locals in an uncertified phrase", async () => {
  const path = "/test/main.wm";
  const source = "let outer = 1; let work = (param) => { let local = param; lo };";
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, source.lastIndexOf("lo") + 2),
    new Map([[path, source]]),
  );

  assertEquals(items.map(({ label, kind, detail }) => ({ label, kind, detail })), [{
    label: "local",
    kind: 6,
    detail: "",
  }]);
});

Deno.test("ordinary completion remains useful in a half-written top-level phrase", async () => {
  const path = "/test/main.wm";
  const source = "let outer = 1; let result = ou";
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, source.length),
    new Map([[path, source]]),
  );

  assertEquals(items.map(({ label, kind }) => ({ label, kind })), [{
    label: "outer",
    kind: 6,
  }]);
});

Deno.test("ordinary completion respects lexical shadowing", async () => {
  const path = "/test/main.wm";
  const source = "let outer = 1; let work = (outer) => { outer };";
  const use = source.lastIndexOf("outer");
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, use + 2),
    new Map([[path, source]]),
  );

  assertEquals(items.filter(({ label }) => label === "outer").length, 1);
});

Deno.test("ordinary completion ranks nearer lexical declarations first", async () => {
  const path = "/test/main.wm";
  const source = "let aOuter = 1; let work = () => { let zInner = 2; zInner };";
  const use = source.lastIndexOf("zInner");
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, use),
    new Map([[path, source]]),
  );
  const inner = items.find(({ label }) => label === "zInner")!;
  const outer = items.find(({ label }) => label === "aOuter")!;

  assertEquals(items.indexOf(inner) < items.indexOf(outer), true);
  assertEquals(inner.sortText! < outer.sortText!, true);
});

Deno.test("ordinary completion ranks local, imported, then basis values", async () => {
  const main = "/test/main.wm";
  const lib = "/test/lib.wm";
  const source = 'from "./lib.wm" import { aImported }; let zLocal = 1; let result = zLocal;';
  const use = source.lastIndexOf("zLocal");
  const items = await completionAt(
    pathToFileUri(main),
    positionAt(source, use),
    new Map([
      [main, source],
      [lib, "let aImported = 1;"],
    ]),
  );
  const local = items.find(({ label }) => label === "zLocal")!;
  const imported = items.find(({ label }) => label === "aImported")!;
  const basis = items.find(({ label }) => label === "print")!;

  assertEquals(items.indexOf(local) < items.indexOf(imported), true);
  assertEquals(items.indexOf(imported) < items.indexOf(basis), true);
  assertEquals(local.sortText! < imported.sortText!, true);
  assertEquals(imported.sortText! < basis.sortText!, true);
});

Deno.test("ordinary completion distinguishes type position", async () => {
  const path = "/test/main.wm";
  const source = "record Point = { x: Number }; let read = (point: Point) => { point };";
  const annotation = source.indexOf("Point", source.indexOf("point:"));
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, annotation + 2),
    new Map([[path, source]]),
  );

  assertEquals(items.map(({ label, kind }) => ({ label, kind })), [{
    label: "Point",
    kind: 7,
  }]);
});

Deno.test("ordinary type completion survives a malformed annotation phrase", async () => {
  const path = "/test/main.wm";
  const source = "record Point = { x: Number }; let value: Po";
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, source.length),
    new Map([[path, source]]),
  );

  assertEquals(items.map(({ label, kind }) => ({ label, kind })), [{
    label: "Point",
    kind: 7,
  }]);
});

Deno.test("ordinary completion lists project and basis namespace members", async () => {
  const lib = "/test/lib.wm";
  const main = "/test/main.wm";
  const libSource = "record Box = { value: Number }; let answer = 42;";
  const source = 'from "./lib.wm" import * as Lib; ' +
    "let project = Lib.answer; let gpu = Gpu.fragment;";
  const overrides = new Map([
    [lib, libSource],
    [main, source],
  ]);

  const projectItems = await completionAt(
    pathToFileUri(main),
    positionAt(source, source.indexOf("Lib.answer") + "Lib.".length),
    overrides,
  );
  const gpuItems = await completionAt(
    pathToFileUri(main),
    positionAt(source, source.indexOf("Gpu.fragment") + "Gpu.".length),
    overrides,
  );

  assertEquals(
    projectItems.filter(({ label }) => label === "Box").map(({ kind }) => kind).sort(),
    [6, 7],
  );
  assertEquals(
    projectItems.find(({ label }) => label === "answer")?.detail,
    "Number",
  );
  assertEquals(gpuItems.some(({ label }) => label === "fragment"), true);
});

Deno.test("namespace completion falls back when a broken head drops the imported document", async () => {
  const dir = await Deno.makeTempDir();
  const token = `${dir}/token.wm`;
  const lexer = `${dir}/lexer.wm`;
  const main = `${dir}/main.wm`;
  const tokenSource = "type TokenKind = | First | Second;";
  const lexerSource = 'from "./token.wm" import * as Token; let lex = () => { Token. };';
  const mainSource = 'from "./lexer.wm" import { lex }; let main = () => { lex() };';
  await Promise.all([
    Deno.writeTextFile(token, tokenSource),
    Deno.writeTextFile(lexer, lexerSource),
    Deno.writeTextFile(main, mainSource),
  ]);
  const overrides = new Map([
    [token, tokenSource],
    [lexer, lexerSource],
    [main, mainSource],
  ]);
  const index = new ProjectIndex();
  index.rememberWorkspaceRoots({
    workspaceFolders: [{ uri: pathToFileUri(dir), name: "test" }],
  });
  await index.initialize(overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });
  const offset = lexerSource.indexOf("Token.") + "Token.".length;

  const items = await completionAt(
    pathToFileUri(lexer),
    positionAt(lexerSource, offset),
    overrides,
    {},
    service,
  );

  assertEquals(items.map(({ label }) => label), ["First", "Second", "TokenKind"]);
});

Deno.test("ordinary completion uses nominal receiver identity for record fields", async () => {
  const path = "/test/main.wm";
  const source = "record Point = { x: Number, y: String }; " +
    'let point = Point(1, "a"); let read = point.x;';
  const fieldStart = source.indexOf("point.x") + "point.".length;
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, fieldStart),
    new Map([[path, source]]),
  );

  assertEquals(items.map(({ label, kind, detail }) => ({ label, kind, detail })), [
    { label: "x", kind: 10, detail: "Number" },
    { label: "y", kind: 10, detail: "String" },
  ]);
});

Deno.test("ordinary completion exposes standard keyword items", async () => {
  const path = "/test/main.wm";
  const source = "let value = 1;";
  const items = await completionAt(
    pathToFileUri(path),
    { line: 0, character: 0 },
    new Map([[path, source]]),
  );

  assertEquals(items.find(({ label }) => label === "let")?.kind, 14);
  assertEquals(items.find(({ label }) => label === "record")?.kind, 14);
  assertEquals(items.find(({ label }) => label === "print")?.detail, "'a -> Void");
});

Deno.test("ordinary completion ranks annotation-compatible values first", async () => {
  const path = "/test/main.wm";
  const source = 'let betaString = "ok"; let alphaNumber = 1; let result: String = betaString;';
  const value = source.lastIndexOf("betaString");
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, value),
    new Map([[path, source]]),
  );

  assertEquals(
    items.findIndex(({ label }) => label === "betaString") <
      items.findIndex(({ label }) => label === "alphaNumber"),
    true,
  );
  assertEquals(
    items.find(({ label }) => label === "betaString")!.sortText! <
      items.find(({ label }) => label === "alphaNumber")!.sortText!,
    true,
  );
});

Deno.test("ordinary completion ranks call-argument-compatible values first", async () => {
  const path = "/test/main.wm";
  const source = 'let betaString = "ok"; let alphaNumber = 1; ' +
    "let take = (value: String) => { value }; let result = take(betaString);";
  const value = source.lastIndexOf("betaString");
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, value),
    new Map([[path, source]]),
  );

  assertEquals(
    items.findIndex(({ label }) => label === "betaString") <
      items.findIndex(({ label }) => label === "alphaNumber"),
    true,
  );
  assertEquals(
    items.find(({ label }) => label === "betaString")!.sortText! <
      items.find(({ label }) => label === "alphaNumber")!.sortText!,
    true,
  );
});

Deno.test("ordinary completion uses operator operand expectations", async () => {
  const path = "/test/main.wm";
  const source =
    'let betaNumber = 1; let alphaString = "no"; let result = betaNumber + betaNumber;';
  const value = source.lastIndexOf("betaNumber");
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, value),
    new Map([[path, source]]),
  );

  assertEquals(
    items.findIndex(({ label }) => label === "betaNumber") <
      items.findIndex(({ label }) => label === "alphaString"),
    true,
  );
});

Deno.test("ordinary completion uses lambda return expectations", async () => {
  const path = "/test/main.wm";
  const source = 'let betaString = "ok"; let alphaNumber = 1; ' +
    "let make = (): String => { betaString };";
  const value = source.lastIndexOf("betaString");
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, value),
    new Map([[path, source]]),
  );

  assertEquals(
    items.findIndex(({ label }) => label === "betaString") <
      items.findIndex(({ label }) => label === "alphaNumber"),
    true,
  );
});

Deno.test("ordinary completion uses shared match-arm result expectations", async () => {
  const path = "/test/main.wm";
  const source = 'let betaString = "ok"; let alphaNumber = 1; let flag = true; ' +
    "let result = match(flag) { true => { betaString }, false => { betaString } };";
  const value = source.lastIndexOf("betaString");
  const items = await completionAt(
    pathToFileUri(path),
    positionAt(source, value),
    new Map([[path, source]]),
  );

  assertEquals(
    items.findIndex(({ label }) => label === "betaString") <
      items.findIndex(({ label }) => label === "alphaNumber"),
    true,
  );
});

Deno.test("import completion discovers exported namespaces in an unfinished clause", async () => {
  const main = "/test/main.wm";
  const lib = "/test/lib.wm";
  const source = 'from "./lib.wm" import { Bo';
  const items = await completionAt(
    pathToFileUri(main),
    positionAt(source, source.length),
    new Map([
      [main, source],
      [lib, "record Box = { value: Number }; let bonus = 1;"],
    ]),
  );

  assertEquals(items.map(({ label, kind }) => ({ label, kind })), [
    { label: "Box", kind: 7 },
    { label: "Box", kind: 6 },
  ]);
});

Deno.test("import completion excludes names already selected in the clause", async () => {
  const main = "/test/main.wm";
  const lib = "/test/lib.wm";
  const source = 'from "./lib.wm" import { first, s';
  const items = await completionAt(
    pathToFileUri(main),
    positionAt(source, source.length),
    new Map([
      [main, source],
      [lib, "let first = 1; let second = 2;"],
    ]),
  );

  assertEquals(items.map(({ label, detail }) => ({ label, detail })), [{
    label: "second",
    detail: "Number",
  }]);
});

Deno.test("import path completion lists nearby Workman files and virtual directories", async () => {
  const main = "/test/main.wm";
  const source = 'from "./l';
  const overrides = new Map([
    [main, source],
    ["/test/lib.wm", "let value = 1;"],
    ["/test/list.wm", "let value = 2;"],
    ["/test/sub/item.wm", "let value = 3;"],
  ]);
  const files = await completionAt(
    pathToFileUri(main),
    positionAt(source, source.length),
    overrides,
  );
  const directorySource = 'from "./s';
  overrides.set(main, directorySource);
  const directories = await completionAt(
    pathToFileUri(main),
    positionAt(directorySource, directorySource.length),
    overrides,
  );

  assertEquals(files.map(({ label, kind }) => ({ label, kind })), [
    { label: "lib.wm", kind: 17 },
    { label: "list.wm", kind: 17 },
  ]);
  assertEquals(directories.map(({ label, kind }) => ({ label, kind })), [{
    label: "sub/",
    kind: 19,
  }]);
});

function positionAt(source: string, offset: number): { line: number; character: number } {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}
