import { assertRejects, assertStringIncludes } from "@std/assert";
import {
  analyzeFile,
  checkSource,
  checkVirtual,
  compile,
  compileLibraryFile,
} from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;

Deno.test("compiler frontend modes execute the v2 simple-let subset", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let x = 1;\nlet ok = true;";
  const defaultResult = await checkSource(source);
  const v1Result = await checkSource(source, { frontend: "v1" });
  const v2Result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });
  const compareResult = await checkSource(source, { frontend: "compare", frontendV2ModuleUrl });

  expectBinding(defaultResult.env, "x", { type: "Number", vars: 0 });
  expectBinding(v1Result.env, "x", { type: "Number", vars: 0 });
  expectBinding(v2Result.env, "x", { type: "Number", vars: 0 });
  expectBinding(v2Result.env, "ok", { type: "Bool", vars: 0 });
  expectBinding(compareResult.env, "x", { type: "Number", vars: 0 });
  expectBinding(compareResult.env, "ok", { type: "Bool", vars: 0 });
  assertStringIncludes(await compile(source, { frontend: "v2", frontendV2ModuleUrl }), "const x_");
});

Deno.test("compiler v2 mode typechecks simple calls", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let logged = print(1);\nlet printed = print(true);";
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });
  const compareResult = await checkSource(source, { frontend: "compare", frontendV2ModuleUrl });

  expectBinding(result.env, "logged", { type: "Void", vars: 0 });
  expectBinding(result.env, "printed", { type: "Void", vars: 0 });
  expectBinding(compareResult.env, "logged", { type: "Void", vars: 0 });
  expectBinding(compareResult.env, "printed", { type: "Void", vars: 0 });
});

Deno.test("compiler v2 mode typechecks independent bindings after a recovered semicolon", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let x = 1\nlet ok = true;";

  await assertRejects(() => checkSource(source), Error, "Expected");
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "x", { type: "Number", vars: 0 });
  expectBinding(result.env, "ok", { type: "Bool", vars: 0 });
});

Deno.test("compiler v2 mode resolves imports from virtual source overrides", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const results = await checkVirtual(
    "/main.wm",
    new Map([
      ["/main.wm", 'from "./lib.wm" import { value };\nlet x = value;'],
      ["/lib.wm", "let value = 1;"],
    ]),
    { frontend: "v2", frontendV2ModuleUrl },
  );

  expectBinding(results.get("/main.wm")!.env, "x", { type: "Number", vars: 0 });
});

Deno.test("compiler v2 mode resolves imports from disk", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = dir + "/main.wm";
  const lib = dir + "/lib.wm";
  await Deno.writeTextFile(main, 'from "./lib.wm" import { value };\nlet x = value;');
  await Deno.writeTextFile(lib, "let value = 1;");

  const analysis = await analyzeFile(main, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(analysis.results.get(await Deno.realPath(main))!.env, "x", {
    type: "Number",
    vars: 0,
  });
});

Deno.test("compiler v2 mode resolves imports from source overrides", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "v2",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      ["/main.wm", 'from "./lib.wm" import { value };\nlet x = value;'],
      ["/lib.wm", "let value = true;"],
    ]),
  });

  expectBinding(analysis.results.get("/main.wm")!.env, "x", { type: "Bool", vars: 0 });
});

Deno.test("compiler v2 mode resolves named import aliases", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "v2",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      ["/main.wm", 'from "./lib.wm" import { value as alias };\nlet x = alias;'],
      ["/lib.wm", "let value = 1;"],
    ]),
  });

  expectBinding(analysis.results.get("/main.wm")!.env, "x", { type: "Number", vars: 0 });
});

Deno.test("compiler compare mode checks named import aliases", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "compare",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      ["/main.wm", 'from "./lib.wm" import { value as alias };\nlet x = alias;'],
      ["/lib.wm", "let value = true;"],
    ]),
  });

  expectBinding(analysis.results.get("/main.wm")!.env, "x", { type: "Bool", vars: 0 });
});

Deno.test("compiler v2 mode typechecks namespace values and tuple expressions", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "v2",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      [
        "/main.wm",
        'from "./lib.wm" import * as Lib;\nlet pair = (Lib.value, true);',
      ],
      ["/lib.wm", "let value = 1;"],
    ]),
  });

  expectBinding(analysis.results.get("/main.wm")!.env, "pair", {
    type: "(Number, Bool)",
    vars: 0,
  });
});

Deno.test("compiler compare mode agrees on namespace and tuple expressions", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "compare",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      [
        "/main.wm",
        'from "./lib.wm" import * as Lib;\nlet pair = (Lib.value, true);',
      ],
      ["/lib.wm", "let value = 1;"],
    ]),
  });

  expectBinding(analysis.results.get("/main.wm")!.env, "pair", {
    type: "(Number, Bool)",
    vars: 0,
  });
});

Deno.test("compiler compare mode agrees on open imports", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "compare",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      ["/main.wm", 'from "./lib.wm" import *;\nlet pair = (value, true);'],
      ["/lib.wm", "let value = 1;"],
    ]),
  });

  expectBinding(analysis.results.get("/main.wm")!.env, "pair", {
    type: "(Number, Bool)",
    vars: 0,
  });
});

Deno.test("compiler v2 mode projects simple lambdas, blocks, and whitespace application", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = 'let printer = (x) => { print x };\nlet main = () => { printer "ok" }';
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "printer", { type: "('a) => Void", vars: 1 });
  expectBinding(result.env, "main", { type: "(Void) => Void", vars: 0 });
});

Deno.test("compiler compare mode agrees on simple lambdas and whitespace application", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = 'let printer = (x) => { print x };\nlet main = () => { printer "ok" };';
  const result = await checkSource(source, { frontend: "compare", frontendV2ModuleUrl });

  expectBinding(result.env, "printer", { type: "('a) => Void", vars: 1 });
  expectBinding(result.env, "main", { type: "(Void) => Void", vars: 0 });
});

Deno.test("compiler v2 mode calls an imported namespace function after virtual termination", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "v2",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      [
        "/main.wm",
        'from "./lib.wm" import * as Lib;\nlet main = () => { Lib.printer "x" }',
      ],
      ["/lib.wm", "let printer = (x) => { print x };"],
    ]),
  });

  expectBinding(analysis.results.get("/main.wm")!.env, "main", {
    type: "(Void) => Void",
    vars: 0,
  });
});

async function buildFrontendV2(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
