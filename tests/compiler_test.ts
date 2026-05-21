import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkFile, compile, compileFile } from "../src/compiler.ts";
import { parse } from "../src/parser.ts";

Deno.test("parses type and let declarations", async () => {
  const ast = await parse("type Option<T> = None | Some<T>; let x = Some(1);");
  assertEquals(ast.decls.length, 2);
});

Deno.test("compiles factorial and ADT match", async () => {
  const source = await Deno.readTextFile(new URL("../examples/factorial.wm", import.meta.url));
  const js = await compile(source);
  assertStringIncludes(js, "const Some");
  assertStringIncludes(js, "let factorial");
  assertStringIncludes(js, "non-exhaustive match");
});

Deno.test("rejects type errors", async () => {
  await assertRejects(
    () => compile("let nope = 1 + true;"),
    Error,
    "type mismatch",
  );
});

Deno.test("compiles file imports as implicit structures", async () => {
  const js = await compileFile(new URL("../examples/use_math.wm", import.meta.url).pathname);
  assertStringIncludes(js, "const Math");
  assertStringIncludes(js, "Math.add");
  assertStringIncludes(js, "Math.Just");
});

Deno.test("supports long type constructors from imported files", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/box.wm`, "type Box<T> = Box<T>; let make = (x) => { Box(x) };");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./box.wm" import * as Boxed; let x: Boxed.Box<Number> = Boxed.make(1);',
  );
  await checkFile(`${dir}/main.wm`);
});

Deno.test("rejects import cycles", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a.wm`, 'from "./b.wm" import * as B; let x = 1;');
  await Deno.writeTextFile(`${dir}/b.wm`, 'from "./a.wm" import * as A; let y = 2;');
  await assertRejects(() => checkFile(`${dir}/a.wm`), Error, "import cycle");
});

Deno.test("generalizes recursive function bindings after solving", async () => {
  await compile('let rec id = (x) => { x }; let a = id(1); let b = id("s");');
});

Deno.test("rejects duplicate pattern binders", async () => {
  await assertRejects(
    () => compile("let bad = ((x, x)) => { x };"),
    Error,
    "duplicate pattern binder",
  );
});

Deno.test("supports Workman tuple destructuring let bindings", async () => {
  await compile(`
    let (a, b) = (1, "x");
    let use_a = a + 1;
    let use_b = b == "x";
  `);
});

Deno.test("generalizes destructured let binding components", async () => {
  await compile(`
    let (id_a, id_b) = ((x) => { x }, (y) => { y });
    let a = id_a(1);
    let b = id_a("s");
    let c = id_b(true);
    let d = id_b(2);
  `);
});

Deno.test("rejects duplicate tuple let binders in the same declaration", async () => {
  await assertRejects(
    () => compile("let (x, x) = (1, 2);"),
    Error,
    "duplicate binding x",
  );
});

Deno.test("rejects recursive destructuring let bindings", async () => {
  await assertRejects(
    () => compile("let rec (a, b) = (1, 2);"),
    Error,
    "recursive bindings must bind one name",
  );
});

Deno.test("constructor fields bind while bare tuple identifiers pin", async () => {
  await compile(`
    type Option<T> = None | Some<T>;
    let x = 1;
    let from_ctor = match(opt) => {
      Some(x) => { x },
      None => { 0 },
    };
    let tuple_pin = match(pair) => {
      (x, Var(y)) => { y },
      _ => { 0 },
    };
  `);
});

Deno.test("bare match identifiers must already be in scope", async () => {
  await assertRejects(
    () => compile("let bad = match(x) => { y => { 1 }, _ => { 0 } };"),
    Error,
    "unknown pinned pattern y",
  );
});

Deno.test("requires exhaustive matches for closed sums", async () => {
  await assertRejects(
    () => compile("type Option<T> = None | Some<T>; let bad = match(opt) => { None => { 0 } };"),
    Error,
    "missing Some",
  );
});

Deno.test("requires wildcard for non-sum matches", async () => {
  await assertRejects(
    () => compile("let bad = match(n) => { 0 => { 1 } };"),
    Error,
    "non-sum matches require _",
  );
});
