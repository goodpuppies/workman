import { assertEquals, assertRejects } from "@std/assert";
import { checkFile } from "../src/compiler.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("imported type constructors and constructors remain available through namespace", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/option.wm`,
    "export type Option<T> = None | Some<T>; export let wrap = (x) => { Some(x) };",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./option.wm" import * as Opt;
      let value: Opt.Option<Number> = Opt.wrap(1);
      let get = match(value) => {
        Opt.Some(x) => { x },
        Opt.None => { 0 },
      };
    `,
  );

  const results = await checkFile(`${dir}/main.wm`);
  const main = results.get(await Deno.realPath(`${dir}/main.wm`));
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "get", { type: "(Option<Number>) => Number", vars: 0 });
});

Deno.test("named import allows a type and constructor to share one local spelling", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/lib.wm`,
    "export type Box<T> = | Box<T>;",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./lib.wm" import { Box }; let x: Box<Number> = Box(1);',
  );

  await checkFile(`${dir}/main.wm`);
});

Deno.test("type imports reject collisions with existing local type declarations", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "export type Box<T> = T;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      type Box = | LocalBox;
      from "./lib.wm" import { Box };
      let x = 1;
    `,
  );

  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "duplicate type import Box");
});

Deno.test("value imports reject collisions with imported constructors", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a.wm`, "export type A = | Ctor;");
  await Deno.writeTextFile(`${dir}/b.wm`, "export type B = | Ctor;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./a.wm" import { Ctor };
      from "./b.wm" import { Ctor };
      let x = Ctor;
    `,
  );

  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "duplicate value import Ctor");
});

Deno.test("module graph exposes ordered nodes and import edges", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/base.wm`, "export let value = 1;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./base.wm" import * as Base; let x = Base.value;',
  );

  const graph = await loadModuleGraph(`${dir}/main.wm`);
  const basePath = await Deno.realPath(`${dir}/base.wm`);
  const mainPath = await Deno.realPath(`${dir}/main.wm`);

  assertEquals(graph.entry, mainPath);
  assertEquals(graph.order, [basePath, mainPath]);
  assertEquals(graph.nodes.get(basePath)?.emitName, "Base");
  assertEquals(graph.nodes.get(basePath)?.source, "export let value = 1;");
  assertEquals(graph.nodes.get(mainPath)?.imports.map((edge) => edge.path), [basePath]);
});

Deno.test("file elaboration exposes SML-like structure environments", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/lib.wm`,
    "let hidden = 1; export type Box<T> = | Box<T>; export let shown = Box(hidden);",
  );
  await Deno.writeTextFile(`${dir}/main.wm`, 'from "./lib.wm" import * as Lib; let x = Lib.shown;');

  const results = await checkFile(`${dir}/main.wm`);
  const lib = results.get(await Deno.realPath(`${dir}/lib.wm`));
  if (!lib) throw new Error("missing lib result");

  assertEquals(lib.structure.values.has("hidden"), true);
  assertEquals(lib.exportedStructure.values.has("hidden"), false);
  assertEquals(lib.exportedStructure.values.has("shown"), true);
  assertEquals(lib.exportedStructure.types.has("Box"), true);
  assertEquals(lib.exportedStructure.adts.size, 1);
});

Deno.test("exported structure rejects values and aliases that expose private types", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/bad_value.wm`,
    "type Hidden = | Hidden; export let leak = Hidden;",
  );
  await Deno.writeTextFile(
    `${dir}/bad_alias.wm`,
    "type Hidden = | Hidden; export type Alias = Hidden;",
  );
  await Deno.writeTextFile(
    `${dir}/bad_datatype.wm`,
    "type Hidden = | Hidden; export type Public = | Public<Hidden>;",
  );

  await assertRejects(
    () => checkFile(`${dir}/bad_value.wm`),
    Error,
    "exported value leak mentions non-exported type",
  );
  await assertRejects(
    () => checkFile(`${dir}/bad_alias.wm`),
    Error,
    "exported type Alias mentions non-exported type",
  );
  await assertRejects(
    () => checkFile(`${dir}/bad_datatype.wm`),
    Error,
    "exported type Public mentions non-exported type",
  );
});

Deno.test("named imports keep aliases transparent inside datatype constructor payloads", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/lib.wm`,
    `
      export type Pair<T> = (T, T);
      export type Box<T> = | Box<Pair<T>>;
      export let make = (x, y) => { Box((x, y)) };
    `,
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./lib.wm" import { Pair, Box, make };
      let pair: Pair<Number> = (1, 2);
      let value: Box<Number> = make(1, 2);
      let sum = match(value) {
        Box(left, right) => { left + right },
      };
    `,
  );

  const results = await checkFile(`${dir}/main.wm`);
  const main = results.get(await Deno.realPath(`${dir}/main.wm`));
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "sum", { type: "Number", vars: 0 });
});

Deno.test("namespace imports keep aliases transparent for datatype exhaustiveness", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/lib.wm`,
    `
      export type Pair<T> = (T, T);
      export type Box<T> = | Box<Pair<T>>;
      export let make = (x, y) => { Box((x, y)) };
    `,
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./lib.wm" import * as Lib;
      let value: Lib.Box<Number> = Lib.make(1, 2);
      let sum = match(value) {
        Lib.Box(left, right) => { left + right },
      };
    `,
  );

  const results = await checkFile(`${dir}/main.wm`);
  const main = results.get(await Deno.realPath(`${dir}/main.wm`));
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "sum", { type: "Number", vars: 0 });
});

Deno.test("namespace imports keep same-spelled type aliases distinct when their results are nominal", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/a.wm`,
    "export type Box = | Box; export type Alias = Box; export let make = () => { Box };",
  );
  await Deno.writeTextFile(
    `${dir}/b.wm`,
    "export type Box = | Box; export type Alias = Box; export let make = () => { Box };",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./a.wm" import * as A;
      from "./b.wm" import * as B;
      let bad: A.Alias = B.make();
    `,
  );

  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "type mismatch");
});
