import { assertEquals } from "@std/assert";
import { completionAt } from "../src/lsp/completion.ts";
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

Deno.test("ordinary completion uses nominal receiver identity for record fields", async () => {
  const path = "/test/main.wm";
  const source = "record Point = { x: Number, y: String }; " +
    "let point = Point(1, \"a\"); let read = point.x;";
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
  assertEquals(items.find(({ label }) => label === "print")?.detail, "('a) => Void");
});

function positionAt(source: string, offset: number): { line: number; character: number } {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}
