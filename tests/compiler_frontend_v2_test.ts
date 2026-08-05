import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { analyzeFile, checkSource, checkVirtual, compile } from "../src/compiler.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { moduleId } from "../src/module_id.ts";
import { ParseError } from "../src/parser.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("compiler frontend modes execute the v2 simple-let subset", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let x = 1;\nlet ok = true;";
  const defaultResult = await checkSource(source);
  const packagedV2Result = await checkSource(source, { frontend: "v2" });
  const v2Result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(defaultResult.env, "x", { type: "Number", vars: 0 });
  expectBinding(packagedV2Result.env, "x", { type: "Number", vars: 0 });
  expectBinding(v2Result.env, "x", { type: "Number", vars: 0 });
  expectBinding(v2Result.env, "ok", { type: "Bool", vars: 0 });
  assertStringIncludes(await compile(source, { frontend: "v2", frontendV2ModuleUrl }), "const x_");
});

Deno.test("compiler v2 rejection preserves generated failure location and grammar context", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const error = await assertRejects(
    () =>
      checkSource("let Ctor(Var(x)) = value;", {
        frontend: "v2",
        frontendV2ModuleUrl,
      }),
    ParseError,
    "Expected ) while parsing LetPattern.",
  );
  assertEquals(error.span, { line: 1, col: 9, start: 9, end: 10 });
});

Deno.test("compiler v2 mode typechecks simple calls", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let logged = print(1);\nlet printed = print(true);";
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "logged", { type: "Void", vars: 0 });
  expectBinding(result.env, "printed", { type: "Void", vars: 0 });
});

Deno.test("compiler v2 mode projects basic arithmetic with precedence", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = [
    "let sum = 1+1;",
    "let precedence = 1 + 2 * 3;",
    "let grouped = (1 + 2) * 3;",
    "let negative = -(2 + 3);",
  ].join("\n");
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "sum", { type: "Number", vars: 0 });
  expectBinding(result.env, "precedence", { type: "Number", vars: 0 });
  expectBinding(result.env, "grouped", { type: "Number", vars: 0 });
  expectBinding(result.env, "negative", { type: "Number", vars: 0 });
});

Deno.test("compiler v2 supports typed JavaScript-style string interpolation", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = [
    'let name = "Ada";',
    "let greeting = `Hello, ${name}!`;",
    "let escaped = `\\${name}`;",
  ].join("\n");
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "greeting", { type: "String", vars: 0 });
  expectBinding(result.env, "escaped", { type: "String", vars: 0 });
  assertEquals(await formatFrontendV2Source(source), source);
  const javaScript = await compile(source, { frontend: "v2", frontendV2ModuleUrl });
  assertStringIncludes(javaScript, '(("" + "Hello, ") + name_0)');
  assertStringIncludes(javaScript, "name_0");
  assertStringIncludes(javaScript, 'const escaped_2 = "${name}";');
});

Deno.test("compiler v2 supports comma-separated match subjects without a nested tuple", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let selected = match(1, true) { (Var(number), Var(flag)) => { flag } };";
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "selected", { type: "Bool", vars: 0 });
  assertEquals(
    await formatFrontendV2Source(source),
    "let selected = match(1, true) {\n  (Var(number), Var(flag)) => {\n    flag\n  }\n};",
  );
  assertEquals(
    await formatFrontendV2Source(
      "let selected = match((1, true)) { (Var(number), Var(flag)) => { flag } };",
    ),
    "let selected = match(1, true) {\n  (Var(number), Var(flag)) => {\n    flag\n  }\n};",
  );
});

Deno.test("compiler v2 mode typechecks independent bindings after a recovered semicolon", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let x = 1\nlet ok = true;";

  assertEquals(await formatFrontendV2Source(source), source);
  assertEquals(
    await formatFrontendV2Source(source, "<input>", true),
    "let x = 1;\nlet ok = true;",
  );
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

  expectBinding(analysis.results.get(moduleId(await Deno.realPath(main)))!.env, "x", {
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

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "x", { type: "Bool", vars: 0 });
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

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "x", { type: "Number", vars: 0 });
});

Deno.test("compiler v2 checks named import aliases through a custom artifact", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "v2",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      ["/main.wm", 'from "./lib.wm" import { value as alias };\nlet x = alias;'],
      ["/lib.wm", "let value = true;"],
    ]),
  });

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "x", { type: "Bool", vars: 0 });
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

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "pair", {
    type: "(Number, Bool)",
    vars: 0,
  });
});

Deno.test("compiler v2 checks namespace tuples through a custom artifact", async () => {
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

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "pair", {
    type: "(Number, Bool)",
    vars: 0,
  });
});

Deno.test("compiler v2 checks open imports through a custom artifact", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "v2",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      ["/main.wm", 'from "./lib.wm" import *;\nlet pair = (value, true);'],
      ["/lib.wm", "let value = 1;"],
    ]),
  });

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "pair", {
    type: "(Number, Bool)",
    vars: 0,
  });
});

Deno.test("compiler v2 mode projects simple lambdas, blocks, and whitespace application", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = 'let printer = (x) => { print x };\nlet main = () => { printer "ok" }';
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "printer", { type: "'a -> Void", vars: 1 });
  expectBinding(result.env, "main", { type: "Void -> Void", vars: 0 });
});

Deno.test("compiler v2 checks lambda return annotations", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = "let init: Void -> Bool = (): Bool => { true }: Bool;";
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "init", { type: "Void -> Bool", vars: 0 });
});

Deno.test("compiler v2 checks simple lambdas and whitespace application", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const source = 'let printer = (x) => { print x };\nlet main = () => { printer "ok" };';
  const result = await checkSource(source, { frontend: "v2", frontendV2ModuleUrl });

  expectBinding(result.env, "printer", { type: "'a -> Void", vars: 1 });
  expectBinding(result.env, "main", { type: "Void -> Void", vars: 0 });
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

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "main", {
    type: "Void -> Void",
    vars: 0,
  });
});

Deno.test("compiler v2 mode lowers typed lambdas through a structurally missing block mate", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const analysis = await analyzeFile("/main.wm", {
    frontend: "v2",
    frontendV2ModuleUrl,
    sourceOverrides: new Map([
      [
        "/main.wm",
        'from "./lib.wm" import * as Lib\n\nlet main = (x: String) => {\n  Lib.printer x',
      ],
      ["/lib.wm", "let printer = (x) => { print x };"],
    ]),
  });

  expectBinding(analysis.results.get(moduleId("/main.wm"))!.env, "main", {
    type: "String -> Void",
    vars: 0,
  });
});

async function buildFrontendV2(): Promise<URL> {
  return new URL("../src/generated/frontend_v2_parser.js", import.meta.url);
}
