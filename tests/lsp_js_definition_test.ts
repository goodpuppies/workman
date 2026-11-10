import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import { definitionAt, type LspLocation } from "../src/lsp/symbols.ts";
import { fileUriToPath, pathToFileUri } from "../src/lsp/uri.ts";

function position(source: string, needle: string, occurrence = "last") {
  const offset = occurrence === "first" ? source.indexOf(needle) : source.lastIndexOf(needle);
  assert(offset >= 0, needle);
  const before = source.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before.at(-1)!.length };
}

async function selected(location: LspLocation) {
  const source = await Deno.readTextFile(fileUriToPath(location.uri));
  const lines = source.split(/\r?\n/);
  assertEquals(location.range.start.line, location.range.end.line);
  return {
    source,
    text: lines[location.range.start.line].slice(
      location.range.start.character,
      location.range.end.character,
    ),
  };
}

async function withProject(run: (directory: string) => Promise<void>) {
  const directory = await Deno.makeTempDir({ prefix: "wm-js-definition-" });
  const key = Deno.build.os === "windows" ? "LOCALAPPDATA" : "XDG_CACHE_HOME";
  const previous = Deno.env.get(key);
  Deno.env.set(key, join(directory, "cache"));
  try {
    await run(directory);
  } finally {
    if (previous === undefined) Deno.env.delete(key);
    else Deno.env.set(key, previous);
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("F12 on Deno globals opens the reflected declaration from imports and calls", async () => {
  await withProject(async (directory) => {
    const path = join(directory, "main.wm");
    const source =
      'from js.global("Deno") import unsafe { serve };\nlet start = () => { serve((request, _) => { Panic("stub") }) };';
    await Deno.writeTextFile(path, source);
    const uri = pathToFileUri(path);
    const imported = await definitionAt(uri, position(source, "serve", "first"), new Map());
    const called = await definitionAt(uri, position(source, "serve("), new Map());
    assert(imported && called);
    assertEquals(imported, called);
    assertStringIncludes(fileUriToPath(called.uri), join("cache", "workman", "typescript"));
    assertEquals((await selected(called)).text, "serve");
    assertStringIncludes((await selected(called)).source, "declare namespace Deno");
    assert(!called.uri.includes("__wm_deno_types"));
    // A later query reuses the stable file and exact declaration range.
    assertEquals(await definitionAt(uri, position(source, "serve("), new Map()), called);
  });
});

Deno.test("F12 follows renamed Deno globals but respects local shadowing", async () => {
  await withProject(async (directory) => {
    const path = join(directory, "main.wm");
    const source =
      'from js.global("Deno") import { readTextFile as read };\nlet load = () => { read("file.txt") };\nlet local = (read) => { read };';
    await Deno.writeTextFile(path, source);
    const uri = pathToFileUri(path);
    const remote = await definitionAt(uri, position(source, "read(", "first"), new Map());
    assert(remote);
    assertEquals((await selected(remote)).text, "readTextFile");
    const local = await definitionAt(uri, position(source, "read };"), new Map());
    assert(local);
    assertEquals(local.uri, uri);
    assertEquals(local.range.start, position(source, "read)"));
  });
});

Deno.test("F12 on namespace-imported Deno members reaches their declaration", async () => {
  await withProject(async (directory) => {
    const path = join(directory, "main.wm");
    const source =
      'from js.global("Deno") import * as Runtime;\nlet read = () => { Runtime.readTextFile("file.txt") };';
    await Deno.writeTextFile(path, source);
    const result = await definitionAt(
      pathToFileUri(path),
      position(source, "readTextFile"),
      new Map(),
    );
    assert(result);
    assertEquals((await selected(result)).text, "readTextFile");
  });
});

Deno.test("F12 on global-root and DOM members opens readable TypeScript declarations", async () => {
  await withProject(async (directory) => {
    const path = join(directory, "main.wm");
    const source =
      'from js.global import unsafe { encodeURIComponent };\nfrom js.global("document") import { getElementById };\nlet make = encodeURIComponent("text");\nlet find = getElementById("root");';
    await Deno.writeTextFile(path, source);
    for (const name of ["encodeURIComponent", "getElementById"]) {
      const result = await definitionAt(
        pathToFileUri(path),
        position(source, `${name}(`),
        new Map(),
      );
      assert(result, name);
      assertEquals((await selected(result)).text, name);
      assert(result.uri !== pathToFileUri(path));
    }
  });
});

Deno.test("F12 on JS module aliases still follows re-exported declarations", async () => {
  await withProject(async (directory) => {
    const implementation = join(directory, "impl.ts");
    await Deno.writeTextFile(
      implementation,
      "export function original(port: number): string { return String(port); }",
    );
    await Deno.writeTextFile(
      join(directory, "api.ts"),
      'export { original as serve } from "./impl.ts";',
    );
    const path = join(directory, "main.wm");
    await Deno.writeTextFile(
      join(directory, "deno.json"),
      JSON.stringify({ imports: { api: "./api.ts" } }),
    );
    const source = 'from js.module("api") import { serve as listen };\nlet start = listen;';
    await Deno.writeTextFile(path, source);
    const result = await definitionAt(pathToFileUri(path), position(source, "listen;"), new Map());
    assert(result);
    assertEquals(result.uri, pathToFileUri(implementation));
    assertEquals((await selected(result)).text, "original");
  });
});
