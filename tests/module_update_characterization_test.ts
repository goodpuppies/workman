import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { moduleId } from "../src/module_id.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("[module update T102] normalized specifiers share one graph node and nominal identity", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Box<T> = | Box<T>; let make = (x) => { Box(x) };"],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Direct; ' +
      'from "./dir/../lib.wm" import * as Normalized; ' +
      "let value: Direct.Box<Number> = Normalized.make(1);",
    ],
  ]);

  const graph = await loadModuleGraph("/test/main.wm", { virtualFs });
  const main = graph.nodes.get(moduleId("/test/main.wm"));
  assertEquals(graph.order, [moduleId("/test/lib.wm"), moduleId("/test/main.wm")]);
  assertEquals(main?.imports.map((edge) => edge.path), ["/test/lib.wm", "/test/lib.wm"]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("[module update T105] virtual module identity is stable within one project snapshot", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let result = Lib.value;'],
  ]);
  const options = { virtualFs };

  const first = await loadModuleGraph("/test/main.wm", options);
  const second = await loadModuleGraph("/test/main.wm", options);

  assertEquals(first.entry, second.entry);
  assertEquals(first.order, second.order);
  assertEquals(
    first.nodes.get(first.entry)?.imports[0].target,
    second.nodes.get(second.entry)?.imports[0].target,
  );
});

Deno.test("[module update T104] identical datatype text in distinct modules remains nominally distinct", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "type Box = | Box; let make = () => { Box };"],
    ["/test/b.wm", "type Box = | Box; let make = () => { Box };"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as A; ' +
      'from "./b.wm" import * as B; ' +
      "let invalid: A.Box = B.make();",
    ],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});

Deno.test("[module update T108/T116] one named import preserves same-spelled type and constructor components", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "type Box<T> = | Box<T>;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import { Box }; ' +
      'let text: Box<String> = Box("ok");',
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const main = results.get("/test/main.wm");
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "text", { type: "Box<String>", vars: 0 });
});

Deno.test("[module update T109] every import form preserves all public namespace components", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "type Flag = | Flag; " +
      "record Box = { value: Number }; " +
      "let id = (value) => { value };",
    ],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Namespace; ' +
      "let namespaceFlag: Namespace.Flag = Namespace.Flag; " +
      "let namespaceBox: Namespace.Box = Namespace.Box(1); " +
      'from "./lib.wm" import *; ' +
      "let openFlag: Flag = Flag; " +
      "let openBox: Box = Box(2); " +
      'from "./lib.wm" import { Flag, Box, id as namedId }; ' +
      "let namedFlag: Flag = Flag; " +
      "let namedBox: Box = Box(3); " +
      "let main = () => { " +
      "match((namespaceFlag, openFlag, namedFlag)) { " +
      "(Namespace.Flag, Flag, Flag) => { " +
      "print(namespaceBox.value + openBox.value + namedBox.value + namedId(0)) " +
      "} } };",
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const main = results.get("/test/main.wm");
  const lib = results.get("/test/lib.wm");
  if (!main || !lib) throw new Error("missing module result");
  const namespace = main.structure.strEnv.get("Namespace");
  if (!namespace) throw new Error("missing namespace structure");
  for (const name of ["Flag", "Box"]) {
    assertStrictEquals(namespace.tyEnv.get(name), lib.exportedStructure.tyEnv.get(name));
    assertStrictEquals(main.structure.tyEnv.get(name), lib.exportedStructure.tyEnv.get(name));
  }
  assertStrictEquals(main.structure.tyEnv.get("Flag"), lib.exportedStructure.tyEnv.get("Flag"));
  assertStrictEquals(main.structure.tyEnv.get("Box"), lib.exportedStructure.tyEnv.get("Box"));
  for (
    const [environment, name] of [
      [namespace.valEnv, "Flag"],
      [main.structure.valEnv, "Flag"],
      [main.structure.valEnv, "Flag"],
    ] as const
  ) {
    assertEquals(environment.get(name)?.status, "constructor");
  }

  assertEquals(await runVirtual("/test/main.wm", virtualFs), ["6"]);
});

Deno.test("[module update T110] every import form preserves independent polymorphic use", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/namespace.wm", "let id = (value) => { value };"],
    ["/test/named.wm", "let id = (value) => { value };"],
    ["/test/open.wm", "let id = (value) => { value };"],
    [
      "/test/main.wm",
      'from "./namespace.wm" import * as Namespace; ' +
      'from "./named.wm" import { id as namedId }; ' +
      'from "./open.wm" import *; ' +
      'let n1 = Namespace.id(1); let s1 = Namespace.id("n"); ' +
      'let n2 = namedId(2); let s2 = namedId("m"); ' +
      'let n3 = id(3); let s3 = id("o");',
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const main = results.get("/test/main.wm");
  const namespace = results.get("/test/namespace.wm");
  if (!main) throw new Error("missing main result");
  if (!namespace) throw new Error("missing namespace result");
  const importedId = main.structure.strEnv.get("Namespace")?.valEnv.get("id");
  const exportedId = namespace.exportedStructure.valEnv.get("id");
  if (!importedId || !exportedId) throw new Error("missing namespace id binding");
  assertStrictEquals(importedId.type, exportedId.type);
  assertEquals(importedId.vars, exportedId.vars);
  assertEquals(main.exportedStructure.strEnv.has("Namespace"), false);
  for (const name of ["n1", "n2", "n3"]) {
    expectBinding(main.env, name, { type: "Number", vars: 0 });
  }
  for (const name of ["s1", "s2", "s3"]) {
    expectBinding(main.env, name, { type: "String", vars: 0 });
  }
});

Deno.test("[module update T118] imported bindings are working scope but not public environment", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/base.wm", "let imported = 1;"],
    [
      "/test/mid.wm",
      'from "./base.wm" import { imported }; let local = imported + 1;',
    ],
    [
      "/test/main.wm",
      'from "./mid.wm" import { local }; let value = local;',
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const mid = results.get("/test/mid.wm");
  if (!mid) throw new Error("missing mid result");
  assertEquals(mid.exportedStructure.valEnv.has("local"), true);
  assertEquals(mid.exportedStructure.valEnv.has("imported"), false);

  virtualFs.set(
    "/test/main.wm",
    'from "./mid.wm" import { imported }; let value = imported;',
  );
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown import imported",
  );
});

Deno.test("[module update T111/T119] import visibility begins at its declaration position", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let imported = 1;"],
    [
      "/test/main.wm",
      'let before = imported; from "./lib.wm" import { imported }; let after = imported;',
    ],
  ]);

  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown name imported",
  );
});

async function runVirtual(
  entry: string,
  virtualFs: Map<string, string>,
): Promise<string[]> {
  const javaScript = await compileVirtual(entry, virtualFs);
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(javaScript)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  return output;
}
