import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { coreFile, coreSource, coreVirtual } from "../src/compiler.ts";
import { coreFromSurface } from "../src/core/from_surface.ts";
import { showCore } from "../src/core/snapshot.ts";
import { parse } from "../src/parser.ts";

Deno.test("core lowers Workman multi-argument call to one tuple argument", async () => {
  const module = await parse(`
    let add = (a, b) => { a + b };
    let direct = add(1, 2);
    let explicit = add((1, 2));
  `);

  const snapshot = showCore(coreFromSurface(module));

  assertStringIncludes(snapshot, "let add = fn { (a, b) => app(+, (a, b)) }");
  assertStringIncludes(snapshot, "let direct = app(add, (1, 2))");
  assertStringIncludes(snapshot, "let explicit = app(add, (1, 2))");
});

Deno.test("core lowers nullary Workman functions and calls through unit", async () => {
  const module = await parse("let one = () => { 1 }; let value = one();");

  assertEquals(
    showCore(coreFromSurface(module)),
    [
      "let one = fn { void => 1 }",
      "let value = app(one, void)",
    ].join("\n"),
  );
});

Deno.test("core preserves SML application as single argument application", async () => {
  const module = await parse("val value = add (1, 2);", "wmsml");

  assertEquals(showCore(coreFromSurface(module)), "let value = app(add, (1, 2))");
});

Deno.test("core lowers constructor declarations and patterns to unary tuple payloads", async () => {
  const module = await parse(`
    type Pair = | Pair<Number, String> | Empty;
    let get = match(value) => {
      Pair(n, s) => { (n, s) },
      Empty => { (0, "") },
    };
  `);

  assertEquals(
    showCore(coreFromSurface(module)),
    [
      "type Pair = Pair (Number, String) | Empty",
      'let get = fn { value => match value { Pair (n, s) => (n, s) | Empty => (0, "") } }',
    ].join("\n"),
  );
});

Deno.test("coreSource returns checked Core for source strings", async () => {
  const artifact = await coreSource("let id = (x) => { x };");

  assertEquals(showCore(artifact.module), "let id = fn { x => x }");
});

Deno.test("coreSource rejects imports at the source-string boundary", async () => {
  await assertRejects(
    () => coreSource('from "./lib.wm" import * as Lib; let value = Lib.x;'),
    Error,
    "source strings with imports require checkFile",
  );
});

Deno.test("coreFile returns module-ordered Core artifacts", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "export type Option<T> = None | Some<T>; export let wrap = (x) => { Some(x) };"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let value = Lib.wrap(1);'],
  ]);

  const result = await coreVirtual("/test/main.wm", virtualFs);
  const libPath = "/test/lib.wm";
  const mainPath = "/test/main.wm";
  const libArtifact = result.core.modules.get(libPath);
  const mainArtifact = result.core.modules.get(mainPath);

  assertEquals(result.core.entry, mainPath);
  assertEquals(result.core.order, [libPath, mainPath]);
  assertEquals(libArtifact?.dynamicExports.map((item) => item.name), ["None", "Some", "wrap"]);
  assertEquals(libArtifact?.constructors.map((ctor) => [ctor.name, ctor.id]), [
    ["None", 0],
    ["Some", 1],
  ]);
  assertEquals(mainArtifact?.imports.map((edge) => edge.path), [libPath]);
  assertStringIncludes(showCore(libArtifact!.module), "type Option<T> = None#0 | Some#1 T");
  assertStringIncludes(showCore(mainArtifact!.module), "let value = app(Lib.wrap, 1)");
});

Deno.test("coreFile gives same-spelled constructors distinct runtime identities", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "export type A = | Box;"],
    ["/test/b.wm", "export type B = | Box;"],
    ["/test/main.wm", 'from "./a.wm" import * as A; from "./b.wm" import * as B; let a = A.Box; let b = B.Box;'],
  ]);

  const result = await coreVirtual("/test/main.wm", virtualFs);
  const boxes = result.core.constructors.filter((ctor) => ctor.name === "Box");

  assertEquals(boxes.length, 2);
  assertEquals(boxes[0].id === boxes[1].id, false);
  assertEquals(boxes.map((ctor) => ctor.typeName), ["A", "B"]);
  assertStringIncludes(
    showCore(result.core.modules.get("/test/main.wm")!.module),
    "let a = A.Box",
  );
  assertStringIncludes(
    showCore(result.core.modules.get("/test/main.wm")!.module),
    "let b = B.Box",
  );
});

Deno.test("coreFile resolves named imported constructor references", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "export type Option<T> = None | Some<T>;"],
    ["/test/main.wm", "from \"./lib.wm\" import { Some, None }; let value = Some(1); let get = match(value) => { Some(x) => { x }, None => { 0 } };"],
  ]);

  const result = await coreVirtual("/test/main.wm", virtualFs);
  const mainArtifact = result.core.modules.get("/test/main.wm")!;
  const snapshot = showCore(mainArtifact.module);

  assertStringIncludes(snapshot, "let value = app(Some#1, 1)");
  assertStringIncludes(snapshot, "Some#1 x => x");
  assertStringIncludes(snapshot, "None#0 => 0");
});
