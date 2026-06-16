import { assertRejects, assertStringIncludes } from "@std/assert";
import { pathToFileURL } from "node:url";
import { checkSource, checkVirtual, compileFile, compileVirtual } from "../src/compiler.ts";

Deno.test("compiles file imports as implicit structures", async () => {
  const js = await compileFile(new URL("../examples/use_math.wm", import.meta.url).pathname);
  assertStringIncludes(js, "const Math");
  assertStringIncludes(js, "Math.add");
  assertStringIncludes(js, "Math.Just");
});

Deno.test("source-only frontend rejects imports with clear API boundary", async () => {
  await assertRejects(
    () => checkSource('from "./math.wm" import * as Math; let x = 1;'),
    Error,
    "source strings with imports require checkFile",
  );
});

Deno.test("imports are declaration-ordered and not hoisted", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'let x = Lib.value; from "./lib.wm" import * as Lib;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown name Lib.value",
  );
});

Deno.test("checkFile accepts URL pathname entry paths", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.value;'],
  ]);
  const pathname = pathToFileURL("/test/main.wm").pathname;
  await checkVirtual(pathname, virtualFs);
});

Deno.test("supports long type constructors from imported files", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/box.wm", "type Box<T> = | Box<T>; let make = (x) => { Box(x) };"],
    [
      "/test/main.wm",
      'from "./box.wm" import * as Boxed; let x: Boxed.Box<Number> = Boxed.make(1);',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports long constructor identifiers in match patterns", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/option.wm",
      "type Option<T> = None | Some<T>; let wrap = (x) => { Some(x) };",
    ],
    [
      "/test/main.wm",
      'from "./option.wm" import * as Opt; let value = Opt.wrap(1); let get = match(value) => { Opt.Some(x) => { x }, Opt.None => { 0 } };',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports named imports for values constructors and types", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/option.wm",
      "type Option<T> = None | Some<T>; let make = (x) => { Some(x) };",
    ],
    [
      "/test/main.wm",
      'from "./option.wm" import { Option, Some, None, make as wrap }; let value: Option<Number> = wrap(1); let get = match(value) => { Some(x) => { x }, None => { 0 } };',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("named imports reject missing members", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let present = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { missing }; let x = 1;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown import missing",
  );
});

Deno.test("rejects duplicate imported bindings in the same namespace", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let present = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { present, present as present }; let x = present;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "duplicate value import present",
  );
});

Deno.test("rejects duplicate qualified imports from repeated namespace aliases", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "let value = 1;"],
    ["/test/b.wm", "let value = 2;"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as Lib; from "./b.wm" import * as Lib; let x = Lib.value;',
    ],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "duplicate value import Lib.value",
  );
});

Deno.test("rejects duplicate named imports across import declarations", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "let value = 1;"],
    ["/test/b.wm", "let value = 2;"],
    [
      "/test/main.wm",
      'from "./a.wm" import { value }; from "./b.wm" import { value }; let x = value;',
    ],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "duplicate value import value",
  );
});

Deno.test("local declarations shadow imported bindings", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import { value }; let value = "local"; let ok = value == "local";',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("named imports see plain declarations by default", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; let visible = hidden + 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { hidden }; let x = 1;'],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("namespace imports expose plain declarations by default", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; let visible = hidden + 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.hidden;'],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports transitive file imports", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/base.wm", "let id = (x) => { x };"],
    ["/test/mid.wm", 'from "./base.wm" import * as Base; let keep = (x) => { Base.id(x) };'],
    [
      "/test/main.wm",
      'from "./mid.wm" import * as Mid; let a = Mid.keep(1); let b = Mid.keep("s");',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("compiles virtual file system to JS", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "type Option<T> = None | Some<T>; let wrap = (x) => { Some(x) };",
    ],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let value = Lib.wrap(1);'],
  ]);
  const js = await compileVirtual("/test/main.wm", virtualFs);
  assertStringIncludes(js, "const Lib");
  assertStringIncludes(js, "Lib.wrap");
  assertStringIncludes(js, "Some");
});

Deno.test("rejects import cycles", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", 'from "./b.wm" import * as B; let x = 1;'],
    ["/test/b.wm", 'from "./a.wm" import * as A; let y = 2;'],
  ]);
  await assertRejects(() => checkVirtual("/test/a.wm", virtualFs), Error, "import cycle");
});

Deno.test("same-spelled datatypes from different files are nominally distinct", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "type Box = | Box; let make = () => { Box };"],
    ["/test/b.wm", "type Box = | Box; let make = () => { Box };"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as A; from "./b.wm" import * as B; let bad: A.Box = B.make();',
    ],
  ]);
  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});
