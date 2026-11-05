import { assertEquals, assertStringIncludes } from "@std/assert";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri } from "../src/lsp/validation.ts";

async function entryDiagnostics(files: Record<string, string>) {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  for (const [name, source] of Object.entries(files)) {
    await Deno.writeTextFile(`${dir}/${name}`, source);
  }
  const uri = pathToFileUri(`${dir}/main.wm`);
  const results = await validateUri(uri, new Map());
  await Deno.remove(dir, { recursive: true });
  return results.find((result) => result.uri === uri)?.diagnostics ?? [];
}

const main = `from "./lib.wm" import * as Lib;\nlet main = () => { Lib.value };`;

Deno.test("an import of a module with a type error is marked", async () => {
  const [diagnostic, ...rest] = await entryDiagnostics({
    "main.wm": main,
    "lib.wm": `let value: String = 1;`,
  });
  assertEquals(rest, []);
  assertEquals(diagnostic.code, "import.failed");
  assertEquals(diagnostic.severity, 1);
  assertEquals(diagnostic.range.start.line, 0);
  assertStringIncludes(diagnostic.relatedInformation![0].location.uri, "lib.wm");
});

Deno.test("an import of a module with a parse error is marked", async () => {
  const diagnostics = await entryDiagnostics({ "main.wm": main, "lib.wm": `let value = ;` });
  assertEquals(diagnostics.map((diagnostic) => diagnostic.code), ["import.failed"]);
});

Deno.test("a failure further along the import chain marks the direct import", async () => {
  const diagnostics = await entryDiagnostics({
    "main.wm": `from "./fine.wm" import *;\nfrom "./mid.wm" import * as Mid;\nlet a = Mid.value;`,
    "fine.wm": `let other = 1;`,
    "mid.wm": `export from "./lib.wm" import *;`,
    "lib.wm": `let value: String = 1;`,
  });
  assertEquals(diagnostics.filter((d) => d.code === "import.failed").map((d) => d.range.start.line), [1]);
});

Deno.test("healthy imports aren't marked", async () => {
  const diagnostics = await entryDiagnostics({ "main.wm": main, "lib.wm": `let value = 1;` });
  assertEquals(diagnostics, []);
});
