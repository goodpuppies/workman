import { assertEquals, assertRejects } from "@std/assert";
import { checkFile, checkVirtual } from "../src/compiler.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("imported type constructors and constructors remain available through namespace", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/option.wm", "type Option<T> = None | Some<T>; let wrap = (x) => { Some(x) };"],
    ["/test/main.wm", "from \"./option.wm\" import * as Opt; let value: Opt.Option<Number> = Opt.wrap(1); let get = match(value) => { Opt.Some(x) => { x }, Opt.None => { 0 } };"],
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
    ["/test/main.wm", "from \"./lib.wm\" import { Option, Some, None }; let value: Option<Number> = Some(1); let get = match(value) => { Some(x) => { x }, None => { 0 } };"],
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

Deno.test("star import without alias rejects collisions", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "let value = 1;"],
    ["/test/b.wm", "let value = 2;"],
    ["/test/main.wm", "from \"./a.wm\" import *; from \"./b.wm\" import *; let x = value;"],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "duplicate value import value");
});

Deno.test("type imports reject collisions with existing local type declarations", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Box<T> = T;"],
    ["/test/main.wm", "type Box = | LocalBox; from \"./lib.wm\" import { Box }; let x = 1;"],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "duplicate type import Box");
});

Deno.test("value imports reject collisions with imported constructors", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "type A = | Ctor;"],
    ["/test/b.wm", "type B = | Ctor;"],
    ["/test/main.wm", "from \"./a.wm\" import { Ctor }; from \"./b.wm\" import { Ctor }; let x = Ctor;"],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "duplicate value import Ctor");
});

Deno.test("module graph exposes ordered nodes and import edges", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/base.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./base.wm" import * as Base; let x = Base.value;'],
  ]);

  const graph = await loadModuleGraph("/test/main.wm", { virtualFs });
  const basePath = "/test/base.wm";
  const mainPath = "/test/main.wm";

  assertEquals(graph.entry, mainPath);
  assertEquals(graph.order, [basePath, mainPath]);
  assertEquals(graph.nodes.get(basePath)?.emitName, "Base");
  assertEquals(graph.nodes.get(basePath)?.source, "let value = 1;");
  assertEquals(graph.nodes.get(mainPath)?.imports.map((edge) => edge.path), [basePath]);
});

Deno.test("file elaboration exports declarations by default", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; type Box<T> = | Box<T>; let shown = Box(hidden);"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.shown;'],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const lib = results.get("/test/lib.wm");
  if (!lib) throw new Error("missing lib result");

  assertEquals(lib.structure.values.has("hidden"), true);
  assertEquals(lib.exportedStructure.values.has("hidden"), true);
  assertEquals(lib.exportedStructure.values.has("shown"), true);
  assertEquals(lib.exportedStructure.types.has("Box"), true);
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

  assertEquals(lib.exportedStructure.values.has("Hidden"), true);
  assertEquals(lib.exportedStructure.values.has("leak"), true);
  assertEquals(lib.exportedStructure.types.has("Hidden"), true);
  assertEquals(lib.exportedStructure.types.has("Alias"), true);
  assertEquals(lib.exportedStructure.types.has("Public"), true);
});

Deno.test("named imports keep aliases transparent inside datatype constructor payloads", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Pair<T> = (T, T); type Box<T> = | Box<Pair<T>>; let make = (x, y) => { Box((x, y)) };"],
    ["/test/main.wm", "from \"./lib.wm\" import { Pair, Box, make }; let pair: Pair<Number> = (1, 2); let value: Box<Number> = make(1, 2); let sum = match(value) { Box(left, right) => { left + right } };"],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const main = results.get("/test/main.wm");
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "sum", { type: "Number", vars: 0 });
});

Deno.test("namespace imports keep aliases transparent for datatype exhaustiveness", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Pair<T> = (T, T); type Box<T> = | Box<Pair<T>>; let make = (x, y) => { Box((x, y)) };"],
    ["/test/main.wm", "from \"./lib.wm\" import * as Lib; let value: Lib.Box<Number> = Lib.make(1, 2); let sum = match(value) { Lib.Box(left, right) => { left + right } };"],
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
    ["/test/main.wm", "from \"./a.wm\" import * as A; from \"./b.wm\" import * as B; let bad: A.Alias = B.make();"],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});
