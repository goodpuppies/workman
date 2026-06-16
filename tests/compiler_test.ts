import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compile } from "../src/compiler.ts";
import { parse } from "../src/parser.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("parses type and let declarations", async () => {
  const ast = await parse("type Option<T> = None | Some<T>; let x = Some(1);");
  assertEquals(ast.decls.length, 2);
});

Deno.test("parses semicolons at phrase layers", async () => {
  const ast = await parse(`
    from "./std/option.wm" import * as Option;
    from js.global("Math") import { floor };
    record Point = { x: Number, y: Number };
    type Flag = On | Off;
    let f = () => { print("a"); 42 };
    let g = () => { print("a"); };
    let h = () => (print("a"); 42);
    let i = () => (print("a"););
  `);
  assertEquals(ast.decls.length, 8);
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

Deno.test("Panic acts as an escape hatch in any type context", async () => {
  await checkSource(`
    type Option<T> = None | Some<T>;
    let unwrapOrPanic = (opt) => {
      match(opt) {
        Some(x) => { x },
        None => { Panic("Expected a value") },
      }
    };
    let n: Number = unwrapOrPanic(Some(1));
  `);
});

Deno.test("compiled Panic emits runtime Panic failure", async () => {
  const js = await compile('let crash = Panic("boom");');
  assertStringIncludes(js, '__wm_fail("Panic", "boom")');
});

Deno.test("compiled manual root JS imports target global member names", async () => {
  const js = await compile(`
    from js.global import unsafe { isFinite: (Number) => Bool };
    let ok = isFinite(1);
  `);

  assertStringIncludes(js, '__wm_js_member("isFinite")');
});

Deno.test("supports multiline string literals", async () => {
  const source = "let text = `first\nsecond\\nthird \\` quoted`;";
  const result = await checkSource(source);
  const js = await compile(source);

  expectBinding(result.env, "text", { type: "String", vars: 0 });
  assertStringIncludes(js, JSON.stringify("first\nsecond\nthird ` quoted"));
});

Deno.test("quoted string literals reject raw newlines", async () => {
  await assertRejects(
    () => parse('let text = "first\nsecond";'),
    Error,
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

Deno.test("parenthesized expression sequences infer their final result", async () => {
  await checkSource(`
    let seqnum: () => Number = () => (1; 2);
    let sequnit: () => Void = () => (1;);
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
