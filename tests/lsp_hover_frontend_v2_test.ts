import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { hoverAt } from "../src/lsp/hover.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;

Deno.test("lsp hover v2 mode returns top-level simple-let types", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = "let count = 1;\nlet flag = true;";
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(
    pathToFileUri(main),
    positionOf(source, "count"),
    new Map(),
    { frontend: "v2", frontendV2ModuleUrl },
  );

  assertEquals(hover?.contents.value, "```wm\ncount: Number\n```");
});

Deno.test("lsp hover v2 mode returns simple call callee types", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = "let logged = print(1);";
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(
    pathToFileUri(main),
    positionOf(source, "print"),
    new Map(),
    { frontend: "v2", frontendV2ModuleUrl },
  );

  assertEquals(
    hover?.contents.value,
    "```wm\nprint\ntype: (Number) => Void\ngeneral: ('a) => Void\n```",
  );
});

Deno.test("lsp hover v2 mode returns variable-use types", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = "let value = 1;\nlet copy = value;";
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(
    pathToFileUri(main),
    positionOf(source, "value;"),
    new Map(),
    { frontend: "v2", frontendV2ModuleUrl },
  );

  assertEquals(hover?.contents.value, "```wm\nvalue: Number\n```");
});

function positionOf(source: string, needle: string): { line: number; character: number } {
  const offset = source.indexOf(needle);
  if (offset < 0) throw new Error(`missing ${needle}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

async function buildFrontendV2(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
