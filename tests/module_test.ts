import { assertEquals, assertMatch, assertRejects, assertThrows } from "@std/assert";
import { checkFile, checkVirtual, compileVirtual } from "../src/compiler.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { moduleId } from "../src/module_id.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("imported type constructors and constructors remain available through namespace", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/option.wm", "type Option<T> = None | Some<T>; let wrap = (x) => { Some(x) };"],
    [
      "/test/main.wm",
      'from "./option.wm" import * as Opt; let value: Opt.Option<Number> = Opt.wrap(1); let get = match(value) => { Opt.Some(x) => { x }, Opt.None => { 0 } };',
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const main = results.get("/test/main.wm");
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "get", { type: "(Option<Number>) => Number", vars: 0 });
});

Deno.test("named import allows a type and constructor to share one local spelling", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Box<T> = | Box<T>;"],
    ["/test/main.wm", 'from "./lib.wm" import { Box }; let x: Box<Number> = Box(1);'],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("named imports can replace basis option type and constructors together", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Option<T> = None | Some<T>;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import { Option, Some, None }; let value: Option<Number> = Some(1); let get = match(value) => { Some(x) => { x }, None => { 0 } };',
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("star import without alias opens module members", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Box<T> = | Box<T>; let make = (x) => { Box(x) };"],
    ["/test/main.wm", 'from "./lib.wm" import *; let x: Box<Number> = make(1); let y = Box(2);'],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("later star import shadows earlier values in its namespace", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "let value = 1;"],
    ["/test/b.wm", 'let value = "later";'],
    ["/test/main.wm", 'from "./a.wm" import *; from "./b.wm" import *; let x = value;'],
  ]);

  const main = (await checkVirtual("/test/main.wm", virtualFs)).get("/test/main.wm")!;
  expectBinding(main.env, "x", { type: "String", vars: 0 });
});

Deno.test("later type imports shadow existing local type declarations", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Box<T> = T;"],
    [
      "/test/main.wm",
      'type Box = | LocalBox; from "./lib.wm" import { Box }; let x: Box<Number> = 1;',
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("later constructor imports shadow earlier constructor values", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "type A = | Ctor;"],
    ["/test/b.wm", "type B = | Ctor;"],
    [
      "/test/main.wm",
      'from "./a.wm" import { Ctor }; from "./b.wm" import { B, Ctor }; let x: B = Ctor;',
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("module graph exposes ordered nodes and import edges", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/base.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./base.wm" import * as Base; let x = Base.value;'],
  ]);

  const graph = await loadModuleGraph("/test/main.wm", { virtualFs });
  const basePath = moduleId("/test/base.wm");
  const mainPath = moduleId("/test/main.wm");

  assertEquals(graph.entry, mainPath);
  assertEquals(graph.order, [basePath, mainPath]);
  assertEquals(graph.nodes.get(basePath)?.id, basePath);
  assertEquals(graph.nodes.get(basePath)?.emitName, "__wm_module_0");
  assertEquals(graph.nodes.get(basePath)?.source, "let value = 1;");
  assertEquals(graph.nodes.get(mainPath)?.imports.map((edge) => edge.referrer), [mainPath]);
  assertEquals(graph.nodes.get(mainPath)?.imports.map((edge) => edge.target), [basePath]);
  assertEquals(graph.nodes.get(mainPath)?.imports.map((edge) => edge.path), ["/test/base.wm"]);
  assertEquals(graph.nodes.get(mainPath)?.imports[0].specifierNode !== undefined, true);
  assertEquals(typeof graph.entry, "object");
  assertEquals(Object.keys(graph.entry), []);
  assertThrows(() => String(graph.entry), TypeError);
});

Deno.test("import cycles report the complete ordered cycle", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", 'from "./b.wm" import *;'],
    ["/test/b.wm", 'from "./c.wm" import *;'],
    ["/test/c.wm", 'from "./a.wm" import *;'],
  ]);

  await assertRejects(
    () => loadModuleGraph("/test/a.wm", { virtualFs }),
    Error,
    "import cycle: /test/a.wm -> /test/b.wm -> /test/c.wm -> /test/a.wm",
  );
});

Deno.test("Workman namespace in value position resolves its explicit carrier export", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "record Carrier<A> = { apply: (A) => A }; " +
      "let carrier = .{ apply = (value) => { value } };",
    ],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Lib; ' +
      "let selected = Lib; " +
      'let main = () => { print(selected.apply("ok")) };',
    ],
  ]);

  const javaScript = await compileVirtual("/test/main.wm", virtualFs);
  // The backend alias carries a compiler-owned identity (R502), so the emitted
  // spelling is not `Lib`. The semantic fact is that the bare namespace selects
  // the `carrier` member of the module alias.
  assertMatch(javaScript, /const selected_\d+ = \w+\.carrier;/);

  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["ok"]);
});

Deno.test("only a bare namespace value resolves to its carrier export", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "record Carrier<A> = { apply: (A) => A }; " +
      "let carrier = .{ apply = (value) => { value } }; " +
      "let toBool = match(value) => { true => { true }, false => { false } };",
    ],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Lib; ' +
      "let selected = Lib; " +
      "let qualified = true :> Lib.toBool; " +
      "let main = () => { print(qualified) };",
    ],
  ]);

  const javaScript = await compileVirtual("/test/main.wm", virtualFs);
  // Bare `Lib` desugars to `Lib.carrier`; a qualified `Lib.toBool` resolves the
  // member directly and is never routed through the carrier. Backend aliases
  // carry compiler-owned identities, so match the shape rather than a spelling.
  assertMatch(javaScript, /const selected_\d+ = \w+\.carrier;/);
  assertMatch(javaScript, /const qualified_\d+ = \w+\.toBool\(true\);/);
  assertEquals(/\.carrier\.toBool/.test(javaScript), false);

  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["true"]);
});

Deno.test("missing qualified members do not fall back through a namespace carrier", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "record Carrier<A> = { apply: (A) => A }; " +
      "let carrier = .{ apply = (value) => { value } };",
    ],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Lib; let missing = Lib.toBool;',
    ],
  ]);

  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown name Lib.toBool",
  );
});

Deno.test("[module update T121] bare namespace fallback reports a missing qualified carrier", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let selected = Lib;'],
  ]);

  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown name Lib.carrier",
  );
});

Deno.test("local value and Workman namespace alias occupy separate namespaces", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as lib; let lib = 2; let x = lib + lib.value;'],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("file elaboration exports declarations by default", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; type Box<T> = | Box<T>; let shown = Box(hidden);"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.shown;'],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const lib = results.get("/test/lib.wm");
  if (!lib) throw new Error("missing lib result");

  assertEquals(lib.structure.valEnv.has("hidden"), true);
  assertEquals(lib.exportedStructure.valEnv.has("hidden"), true);
  assertEquals(lib.exportedStructure.valEnv.has("shown"), true);
  assertEquals(lib.exportedStructure.tyEnv.has("Box"), true);
  assertEquals(lib.exportedStructure.adts.size, 1);
});

Deno.test("default-exported values and aliases may mention local types", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "type Hidden = | Hidden; let leak = Hidden; type Alias = Hidden; type Public = | Public<Hidden>;",
    ],
  ]);

  const results = await checkVirtual("/test/lib.wm", virtualFs);
  const lib = results.get("/test/lib.wm");
  if (!lib) throw new Error("missing lib result");

  assertEquals(lib.exportedStructure.valEnv.has("Hidden"), true);
  assertEquals(lib.exportedStructure.valEnv.has("leak"), true);
  assertEquals(lib.exportedStructure.tyEnv.has("Hidden"), true);
  assertEquals(lib.exportedStructure.tyEnv.has("Alias"), true);
  assertEquals(lib.exportedStructure.tyEnv.has("Public"), true);
});

Deno.test("named imports keep aliases transparent inside datatype constructor payloads", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "type Pair<T> = (T, T); type Box<T> = | Box<Pair<T>>; let make = (x, y) => { Box((x, y)) };",
    ],
    [
      "/test/main.wm",
      'from "./lib.wm" import { Pair, Box, make }; let pair: Pair<Number> = (1, 2); let value: Box<Number> = make(1, 2); let sum = match(value) { Box(left, right) => { left + right } };',
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const main = results.get("/test/main.wm");
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "sum", { type: "Number", vars: 0 });
});

Deno.test("namespace imports keep aliases transparent for datatype exhaustiveness", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "type Pair<T> = (T, T); type Box<T> = | Box<Pair<T>>; let make = (x, y) => { Box((x, y)) };",
    ],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Lib; let value: Lib.Box<Number> = Lib.make(1, 2); let sum = match(value) { Lib.Box(left, right) => { left + right } };',
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const main = results.get("/test/main.wm");
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "sum", { type: "Number", vars: 0 });
});

Deno.test("namespace imports keep same-spelled type aliases distinct when their results are nominal", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "type Box = | Box; type Alias = Box; let make = () => { Box };"],
    ["/test/b.wm", "type Box = | Box; type Alias = Box; let make = () => { Box };"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as A; from "./b.wm" import * as B; let bad: A.Alias = B.make();',
    ],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});
