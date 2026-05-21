import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { pathToFileURL } from "node:url";
import { checkFile, checkSource, compile, compileFile } from "../src/compiler.ts";
import { parse } from "../src/parser.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("parses type and let declarations", async () => {
  const ast = await parse("type Option<T> = None | Some<T>; let x = Some(1);");
  assertEquals(ast.decls.length, 2);
});

Deno.test("rejects unsupported SML and advanced Workman syntax", async () => {
  await assertRejects(() => parse("fun id x = x;"));
  await assertRejects(() => parse("structure Math = struct end;"));
  await assertRejects(() => parse("infectious effect type IO<T> = Pure<T>;"));
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
    () => checkSource("let nope = 1 + true;"),
    Error,
    "type mismatch",
  );
});

Deno.test("reports inferred principal type shapes for core bindings", async () => {
  const result = await checkSource(`
    let id = (x) => { x };
    let fst = (x, y) => { x };
    let pair = (x, y) => { (x, y) };
  `);
  expectBinding(result.env, "id", { type: "('a) => 'a", vars: 1 });
  expectBinding(result.env, "fst", { type: "(('a, 'b)) => 'a", vars: 2 });
  expectBinding(result.env, "pair", { type: "(('a, 'b)) => ('a, 'b)", vars: 2 });
});

Deno.test("inferred match function type reflects constructor payload constraints", async () => {
  const result = await checkSource(`
    type Option<T> = None | Some<T>;
    let get = match(opt) => {
      Some(x) => { x },
      None => { 0 },
    };
  `);
  expectBinding(result.env, "get", { type: "(Option<Number>) => Number", vars: 0 });
});

Deno.test("single-item alias declarations are transparent in inferred types", async () => {
  const result = await checkSource(`
    type MyNumber = Number;
    let inc = (x: MyNumber) => { x + 1 };
  `);
  expectBinding(result.env, "inc", { type: "(Number) => Number", vars: 0 });
});

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
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "export let value = 1;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      let x = Lib.value;
      from "./lib.wm" import * as Lib;
    `,
  );
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "unknown name Lib.value");
});

Deno.test("checkFile accepts URL pathname entry paths", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "export let value = 1;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./lib.wm" import * as Lib; let x = Lib.value;',
  );
  const pathname = pathToFileURL(`${dir}/main.wm`).pathname;
  await checkFile(pathname);
});

Deno.test("supports long type constructors from imported files", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/box.wm`,
    "export type Box<T> = | Box<T>; export let make = (x) => { Box(x) };",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./box.wm" import * as Boxed; let x: Boxed.Box<Number> = Boxed.make(1);',
  );
  await checkFile(`${dir}/main.wm`);
});

Deno.test("supports long constructor identifiers in match patterns", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/option.wm`,
    "export type Option<T> = None | Some<T>; export let wrap = (x) => { Some(x) };",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./option.wm" import * as Opt;
      let value = Opt.wrap(1);
      let get = match(value) => {
        Opt.Some(x) => { x },
        Opt.None => { 0 },
      };
    `,
  );
  await checkFile(`${dir}/main.wm`);
});

Deno.test("supports named imports for values constructors and types", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/option.wm`,
    "export type Option<T> = None | Some<T>; export let make = (x) => { Some(x) };",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./option.wm" import { Option, Some, None, make as wrap };
      let value: Option<Number> = wrap(1);
      let get = match(value) => {
        Some(x) => { x },
        None => { 0 },
      };
    `,
  );
  await checkFile(`${dir}/main.wm`);
});

Deno.test("named imports reject missing members", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "export let present = 1;");
  await Deno.writeTextFile(`${dir}/main.wm`, 'from "./lib.wm" import { missing }; let x = 1;');
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "unknown import missing");
});

Deno.test("rejects duplicate imported bindings in the same namespace", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "export let present = 1;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./lib.wm" import { present, present as present }; let x = present;',
  );
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "duplicate value import present");
});

Deno.test("rejects duplicate qualified imports from repeated namespace aliases", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a.wm`, "export let value = 1;");
  await Deno.writeTextFile(`${dir}/b.wm`, "export let value = 2;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./a.wm" import * as Lib;
      from "./b.wm" import * as Lib;
      let x = Lib.value;
    `,
  );
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "duplicate value import Lib.value");
});

Deno.test("rejects duplicate named imports across import declarations", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a.wm`, "export let value = 1;");
  await Deno.writeTextFile(`${dir}/b.wm`, "export let value = 2;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./a.wm" import { value };
      from "./b.wm" import { value };
      let x = value;
    `,
  );
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "duplicate value import value");
});

Deno.test("local declarations shadow imported bindings", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "export let value = 1;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./lib.wm" import { value };
      let value = "local";
      let ok = value == "local";
    `,
  );
  await checkFile(`${dir}/main.wm`);
});

Deno.test("imports only see explicit exports", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "let hidden = 1; export let visible = hidden + 1;");
  await Deno.writeTextFile(`${dir}/main.wm`, 'from "./lib.wm" import { hidden }; let x = 1;');
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "unknown import hidden");
});

Deno.test("namespace imports only expose explicit exports", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "let hidden = 1; export let visible = hidden + 1;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./lib.wm" import * as Lib; let x = Lib.hidden;',
  );
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "unknown name Lib.hidden");
});

Deno.test("supports transitive file imports", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/base.wm`, "export let id = (x) => { x };");
  await Deno.writeTextFile(
    `${dir}/mid.wm`,
    'from "./base.wm" import * as Base; export let keep = (x) => { Base.id(x) };',
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./mid.wm" import * as Mid; let a = Mid.keep(1); let b = Mid.keep("s");',
  );
  await checkFile(`${dir}/main.wm`);
});

Deno.test("rejects import cycles", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a.wm`, 'from "./b.wm" import * as B; let x = 1;');
  await Deno.writeTextFile(`${dir}/b.wm`, 'from "./a.wm" import * as A; let y = 2;');
  await assertRejects(() => checkFile(`${dir}/a.wm`), Error, "import cycle");
});

Deno.test("same-spelled datatypes from different files are nominally distinct", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/a.wm`,
    "export type Box = | Box; export let make = () => { Box };",
  );
  await Deno.writeTextFile(
    `${dir}/b.wm`,
    "export type Box = | Box; export let make = () => { Box };",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./a.wm" import * as A;
      from "./b.wm" import * as B;
      let bad: A.Box = B.make();
    `,
  );
  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "type mismatch");
});

Deno.test("generalizes recursive function bindings after solving", async () => {
  await checkSource('let rec id = (x) => { x }; let a = id(1); let b = id("s");');
});

Deno.test("allows recursive non-function bindings as general recursion", async () => {
  await checkSource("let rec value = 1;");
  await checkSource("let rec x = x;");
});

Deno.test("checks annotations on recursive function bindings", async () => {
  await checkSource(`
    let rec id: (t) => t = (x) => { x };
    let a = id(1);
    let b = id("s");
  `);
  await assertRejects(
    () => checkSource("let rec bad: (Number) => String = (x) => { x };"),
    Error,
    "type mismatch",
  );
});

Deno.test("rejects duplicate pattern binders", async () => {
  await assertRejects(
    () => checkSource("let bad = ((x, x)) => { x };"),
    Error,
    "duplicate pattern binder",
  );
  await assertRejects(
    () => checkSource("let bad = (x, x) => { x };"),
    Error,
    "duplicate pattern binder x",
  );
  await assertRejects(
    () => checkSource("let bad = match(x, x) => { _ => { 0 } };"),
    Error,
    "duplicate pattern binder x",
  );
});

Deno.test("supports Workman tuple destructuring let bindings", async () => {
  await checkSource(`
    let (a, b) = (1, "x");
    let use_a = a + 1;
    let use_b = b == "x";
  `);
});

Deno.test("generalizes destructured let binding components", async () => {
  await checkSource(`
    let (id_a, id_b) = ((x) => { x }, (y) => { y });
    let a = id_a(1);
    let b = id_a("s");
    let c = id_b(true);
    let d = id_b(2);
  `);
});

Deno.test("rejects duplicate tuple let binders in the same declaration", async () => {
  await assertRejects(
    () => checkSource("let (x, x) = (1, 2);"),
    Error,
    "duplicate binding x",
  );
  await assertRejects(
    () =>
      checkSource("type Option<T> = None | Some<T>; let Some(x) = Some(1) and Some(x) = Some(2);"),
    Error,
    "duplicate binding x",
  );
});

Deno.test("rejects duplicate names in a single let-and binding group", async () => {
  await assertRejects(
    () => checkSource("let x = 1 and x = 2;"),
    Error,
    "duplicate binding x",
  );
});

Deno.test("non-rec let-and bindings are simultaneous, not sequential", async () => {
  await assertRejects(
    () => checkSource("let x = 1 and y = x;"),
    Error,
    "unknown name x",
  );
});

Deno.test("rejects recursive destructuring let bindings", async () => {
  await assertRejects(
    () => checkSource("let rec (a, b) = (1, 2);"),
    Error,
    "recursive bindings must bind one name",
  );
});

Deno.test("rejects duplicate type parameters and constructors", async () => {
  await assertRejects(
    () => checkSource("type Bad<T, T> = Bad<T>;"),
    Error,
    "duplicate type parameter T",
  );
  await assertRejects(
    () => checkSource("type Bad = A | A;"),
    Error,
    "duplicate constructor A",
  );
});

Deno.test("rejects duplicate type declarations in the same scope", async () => {
  await assertRejects(
    () => checkSource("type Box = Number; type Box = String;"),
    Error,
    "duplicate type declaration Box",
  );
});

Deno.test("disambiguates alias and variant single-item type bodies", async () => {
  await checkSource("type MyNumber = Number; let x: MyNumber = 1;");
  await assertRejects(
    () => checkSource("type MyNumber = Number; let bad = MyNumber;"),
    Error,
    "unknown name MyNumber",
  );
  await checkSource("type Token = | Token; let x: Token = Token;");
  await checkSource("type Flag = On | Off; let x: Flag = On;");
});

Deno.test("statement-only blocks infer Void", async () => {
  await checkSource(`
    let do_it = () => {
      print("side effect");
    };
    let result: Void = do_it();
  `);
});

Deno.test("empty blocks infer Void", async () => {
  await checkSource("let nothing: Void = {}; ");
});

Deno.test("if branches can be statement-only Void blocks", async () => {
  await checkSource(`
    let branch: Void = if (true) {
      print("then");
    } else {
      print("else");
    };
  `);
});

Deno.test("block-local type names do not leak outward", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let make = () => {
          type Local = | Local;
          let x = Local;
          x
        };
      `),
    Error,
    "local type escapes scope",
  );
  await assertRejects(
    () =>
      checkSource(`
        let use = () => {
          type Local = | Local;
          let x: Local = Local;
          void
        };
        let y: Local = void;
      `),
    Error,
    "unknown type Local",
  );
});

Deno.test("supports typed lambda parameters", async () => {
  await checkSource(`
    let inc = (x: Number) => { x + 1 };
    let ok = inc(41);
  `);
});

Deno.test("typed lambda parameters reject incompatible calls", async () => {
  await assertRejects(
    () => checkSource('let inc = (x: Number) => { x + 1 }; let bad = inc("no");'),
    Error,
    "type mismatch",
  );
});

Deno.test("compiled refutable let pattern failures raise Bind", async () => {
  const source = "type Option<T> = None | Some<T>; let Some(x) = None;";
  const js = await compile(source);
  assertStringIncludes(js, '__wm_fail("Bind", "pattern match failure in let binding")');
});

Deno.test("compiled lambda parameter mismatch raises Match", async () => {
  const source = "let first = (x, _) => { x };";
  const js = await compile(source);
  assertStringIncludes(js, '__wm_fail("Match", "pattern match failure in function")');
});
