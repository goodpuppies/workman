import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { DocumentStore } from "../src/lsp/documents.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri, type ValidationResult } from "../src/lsp/validation.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;

Deno.test("lsp validation v2 mode typechecks after a recovered semicolon", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(main, "let x = 1;");
  const uri = pathToFileUri(main);
  const docs = new DocumentStore();

  docs.open(uri, "let x = 1\nlet ok = true;", 1);
  const results = await validateUri(uri, docs.sourceOverrides(), {
    frontend: "v2",
    frontendV2ModuleUrl,
  });
  const diagnostics = await diagnosticsForPath(results, main);

  assertEquals(diagnostics?.map((diagnostic) => [diagnostic.code, diagnostic.severity]), [
    ["parse.let.missing-semicolon", 2],
  ]);
});

Deno.test("lsp validation v2 mode publishes multiple structural diagnostics", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(main, "let x = 1;");
  const uri = pathToFileUri(main);
  const docs = new DocumentStore();

  docs.open(uri, 'let x = 1\nlet ok = true\nlet label = "ready";', 1);
  const results = await validateUri(uri, docs.sourceOverrides(), {
    frontend: "v2",
    frontendV2ModuleUrl,
  });
  const diagnostics = await diagnosticsForPath(results, main);

  assertEquals(diagnostics?.map((diagnostic) => [diagnostic.code, diagnostic.severity]), [
    ["parse.let.missing-semicolon", 2],
    ["parse.let.missing-semicolon", 2],
  ]);
});

Deno.test("lsp validation v2 mode uses unsaved imported source overrides", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1;");
  await Deno.writeTextFile(main, 'from "./lib.wm" import { value };\nlet x: String = value;');
  const docs = new DocumentStore();

  docs.open(pathToFileUri(lib), 'let value = "ok";', 1);
  const results = await validateUri(pathToFileUri(main), docs.sourceOverrides(), {
    frontend: "v2",
    frontendV2ModuleUrl,
  });

  assertEquals(await diagnosticsForPath(results, main), []);
});

Deno.test("lsp validation v2 mode resolves named import aliases", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1;");
  await Deno.writeTextFile(main, 'from "./lib.wm" import { value as alias };\nlet x = alias;');
  const results = await validateUri(pathToFileUri(main), new Map(), {
    frontend: "v2",
    frontendV2ModuleUrl,
  });

  assertEquals(await diagnosticsForPath(results, main), []);
});

Deno.test("lsp validation v2 mode checks namespace tuples after a recovered semicolon", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1;");
  await Deno.writeTextFile(
    main,
    'from "./lib.wm" import * as Lib;\nlet pair = (Lib.value, true)\nlet ok: Bool = true;',
  );
  const results = await validateUri(pathToFileUri(main), new Map(), {
    frontend: "v2",
    frontendV2ModuleUrl,
  });

  assertEquals(
    (await diagnosticsForPath(results, main))?.map((diagnostic) => [
      diagnostic.code,
      diagnostic.severity,
    ]),
    [["parse.let.missing-semicolon", 2]],
  );
});

Deno.test("lsp validation v2 mode checks a lambda after recovering its terminator", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(main, 'let main = () => { print "ok" }');
  const results = await validateUri(pathToFileUri(main), new Map(), {
    frontend: "v2",
    frontendV2ModuleUrl,
  });

  assertEquals(
    (await diagnosticsForPath(results, main))?.map((diagnostic) => [
      diagnostic.code,
      diagnostic.severity,
    ]),
    [["parse.let.missing-semicolon", 2]],
  );
});

async function diagnosticsForPath(results: ValidationResult[], path: string) {
  const realPath = await Deno.realPath(path);
  return results.find((result) => result.uri === pathToFileUri(realPath))?.diagnostics;
}

async function buildFrontendV2(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
