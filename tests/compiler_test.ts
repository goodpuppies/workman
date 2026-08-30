import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compile, compileLibraryVirtual } from "../src/compiler.ts";
import { parseCompilerModule as parse } from "../src/compiler_frontend.ts";
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

Deno.test("supports lightweight chained curried lambdas", async () => {
  const source = "let add3 = (a) => (b) => (c) => { a + b + c };";
  const ast = await parse(source);
  const declaration = ast.decls[0];
  const outer = declaration.kind === "LetDecl" ? declaration.bindings[0].value : undefined;
  assertEquals(outer?.kind, "Lambda");
  assertEquals(outer?.kind === "Lambda" ? outer.body.kind : undefined, "Lambda");
  const middle = outer?.kind === "Lambda" && outer.body.kind === "Lambda" ? outer.body : undefined;
  assertEquals(middle?.body.kind, "Lambda");
  await checkSource(source);
});

Deno.test("rejects unsupported SML and advanced Workman syntax", async () => {
  await assertRejects(() => parse("fun id x = x;"));
  await assertRejects(() => parse("structure Math = struct end;"));
  await assertRejects(() => parse("infectious effect IO<T> = Pure<T>;"));
  await assertRejects(() => parse("effect IO<T> = Pure<T>;"));
});

Deno.test("compiles factorial and ADT match", async () => {
  const source = await Deno.readTextFile(new URL("../examples/factorial.wm", import.meta.url));
  const js = await compile(source);
  assertStringIncludes(js, "const Some");
  assertStringIncludes(js, "let factorial");
  assertStringIncludes(js, "non-exhaustive match");
});

Deno.test("emits standard-library values from Workman modules", async () => {
  const js = await compile(`
    let viaResult = Monad.via Result (number) => {
      Ok(number + 1)
    };
    let value = Ok(1) :> viaResult;
  `);

  assertStringIncludes(js, "let __wm_std_Monad");
  assertStringIncludes(js, "let __wm_std_Result");
  assertStringIncludes(js, "let __wm_std_Traverse");
  assertStringIncludes(js, "const Text = {");
  assertStringIncludes(js, '"map": __wm_std_Result["map"]');
  assertEquals(js.includes("...__wm_basis_Result"), false);
  assertEquals(js.includes("...__wm_std_Result"), false);
  assertEquals(js.includes("__wm_legacy_"), false);
});

Deno.test("compiles direct self tail calls as iteration", async () => {
  const js = await compile(`
    let rec count = (n, acc) => {
      if (n == 0) { acc } else { count(n - 1, acc + 1) }
    };
  `);

  assertStringIncludes(js, ": while (true)");
  assertStringIncludes(js, "continue __wm_tail_");
});

Deno.test("arity raises local recursive tuple functions", async () => {
  const js = await compile(`
    let run = (limit) => {
      let rec loop = (index, acc) => {
        if (index >= limit) { acc } else { loop(index + 1, acc + index) }
      };
      loop(0, 0)
    };
  `);

  assertStringIncludes(js, "const loop_");
  assertStringIncludes(js, "__wm_d2 = (index_");
  assertStringIncludes(js, "continue __wm_tail_");
  assertEquals(js.includes("__arg = __wm_tuple"), false);
});

Deno.test("matches payload-free constructors by singleton identity", async () => {
  const js = await compile(`
    type Mode = Default | Ident;
    let active = match(mode) => {
      Default => { false },
      Ident => { true },
    };
  `);

  assertStringIncludes(js, "=== Default_ctor_");
  assertStringIncludes(js, "=== Ident_ctor_");
});

Deno.test("emits qualified pinned patterns through their namespace binding", async () => {
  const js = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([
      ["/test/character.wm", "let classSpace = 1;"],
      [
        "/test/main.wm",
        'from "./character.wm" import * as Char; ' +
        "let isSpace = (value) => { match(value) { Char.classSpace => { true }, _ => { false } } }; " +
        "let yes = isSpace(1); let no = isSpace(2);",
      ],
    ]),
  );
  const module = await import(`data:text/javascript;base64,${btoa(js)}`);

  assertEquals(module.yes, true);
  assertEquals(module.no, false);
  assertEquals(js.includes("Char.classSpace_"), false);
});

Deno.test("compiles a final semicolon-discarded Void self call as iteration", async () => {
  const js = await compile(`
    let rec loop = (n) => {
      if (n == 0) { void } else { loop(n - 1) };
    };
  `);

  assertStringIncludes(js, ": while (true)");
  assertStringIncludes(js, "continue __wm_tail_");
});

Deno.test("does not tail-compile a discarded self call followed by work", async () => {
  const js = await compile(`
    let rec loop = (n) => {
      if (n == 0) { void } else { loop(n - 1) };
      print(n);
    };
  `);

  const loop = js.slice(js.indexOf("let loop_"));
  assertEquals(loop.includes(": while (true)"), false);
});

Deno.test("does not mistake a shadowed call for direct self recursion", async () => {
  const js = await compile(`
    let rec outer = (n) => {
      let outer = (x) => { x };
      outer(n)
    };
  `);

  const outer = js.slice(js.indexOf("let outer_"));
  assertEquals(outer.includes(": while (true)"), false);
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
    from js.global import unsafe { isFinite: Number -> Bool };
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

Deno.test("interpolated strings convert Workman values to text", async () => {
  const source = `
    type TokenKind = End | Var<String>;
    let text = \`number=\${42}, bool=\${true}, text=\${"ok"}, end=\${End}, var=\${Var("x")}\`;
  `;
  const result = await checkSource(source);
  const js = await compileLibraryVirtual(
    "/test/library.wm",
    new Map([["/test/library.wm", source]]),
  );
  const module = await import(`data:text/javascript;base64,${btoa(js)}`);

  expectBinding(result.env, "text", { type: "String", vars: 0 });
  assertEquals(module.text, "number=42, bool=true, text=ok, end=End, var=Var(x)");
});

Deno.test("interpolated value conversion is available without the default prelude", async () => {
  const source = "-- @no-prelude\nlet text = `number=${42}, bool=${false}`;";
  const result = await checkSource(source);
  const js = await compileLibraryVirtual(
    "/test/library.wm",
    new Map([["/test/library.wm", source]]),
  );
  const module = await import(`data:text/javascript;base64,${btoa(js)}`);

  expectBinding(result.env, "text", { type: "String", vars: 0 });
  assertEquals(module.text, "number=42, bool=false");
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
  expectBinding(result.env, "id", { type: "'a -> 'a", vars: 1 });
  expectBinding(result.env, "fst", { type: "('a, 'b) -> 'a", vars: 2 });
  expectBinding(result.env, "pair", { type: "('a, 'b) -> ('a, 'b)", vars: 2 });
});

Deno.test("inferred match function type reflects constructor payload constraints", async () => {
  const result = await checkSource(`
    type Option<T> = None | Some<T>;
    let get = match(opt) => {
      Some(x) => { x },
      None => { 0 },
    };
  `);
  expectBinding(result.env, "get", { type: "Option<Number> -> Number", vars: 0 });
});

Deno.test("single-item alias declarations are transparent in inferred types", async () => {
  const result = await checkSource(`
    type MyNumber = Number;
    let inc = (x: MyNumber) => { x + 1 };
  `);
  expectBinding(result.env, "inc", { type: "Number -> Number", vars: 0 });
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

Deno.test("emits Workman tuples as packed array literals", async () => {
  const js = await compile(`let pair = (1, 2);`);

  assertStringIncludes(js, "const pair_");
  assertStringIncludes(js, "[1, 2]");
  assertEquals(js.includes("__wm_tuple"), false);
});

Deno.test("lowers known primitive operator applications without argument tuples", async () => {
  const js = await compile(`
    let sum = 1 + 2;
    let ordered = sum >= 2;
    let equal = sum == 3;
    let eager = true && false;
  `);

  assertStringIncludes(js, "(1 + 2)");
  assertStringIncludes(js, " >= 2)");
  assertStringIncludes(js, "__wm_eq(");
  assertStringIncludes(js, "__wm_op_and_d2(true, false)");
  assertEquals(js.includes("__wm_op_add([1, 2])"), false);
  assertEquals(js.includes("__wm_op_gte(["), false);
});

Deno.test("scalar replaces tuple literals consumed immediately by matches", async () => {
  const js = await compile(`
    let total = match((1, 2)) {
      (Var(left), Var(right)) => { left + right }
    };
  `);

  assertStringIncludes(js, "__wm_scalar_");
  assertEquals(js.includes(")([1, 2])"), false);
  assertEquals(js.includes("[1, 2]"), false);
});

Deno.test("supports Workman tuple destructuring let bindings", async () => {
  await checkSource(`
    let (a, b) = (1, "x");
    let use_a = a + 1;
    let use_b = b == "x";
  `);
});

Deno.test("primitive parameter annotations discharge deferred equality checks", async () => {
  const result = await checkSource(`
    let sameText = (left: String, right: String) => {
      left == right
    };
    let equal = sameText("surface", "surface");
  `);

  expectBinding(result.env, "sameText", {
    type: "(String, String) -> Bool",
    vars: 0,
  });
});

Deno.test("equality requirements generalize and are checked at each use", async () => {
  const result = await checkSource(`
    let same = (left, right) => { left == right };
    let sameNumber = same(1, 1);
    let sameString = same("left", "right");
  `);

  expectBinding(result.env, "same", {
    type: "('a, 'a) -> Bool",
    vars: 1,
  });
  expectBinding(result.env, "sameNumber", { type: "Bool", vars: 0 });
  expectBinding(result.env, "sameString", { type: "Bool", vars: 0 });

  await assertRejects(
    () =>
      checkSource(`
        let same = (left, right) => { left == right };
        let bad = same((x) => { x }, (x) => { x });
      `),
    Error,
    "does not admit equality",
  );
});

Deno.test("supports underscore-prefixed binders in let tuple patterns", async () => {
  await checkSource(`
    let (_a, __b) = (1, 2);
    let sum = _a + __b;
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

Deno.test("[module update B312/B313] sequential type declarations shadow by namespace", async () => {
  const result = await checkSource(`
    type Box = Number;
    let first: Box = 1;
    type Box = String;
    let second: Box = "two";
    let original = first + 1;
  `);

  expectBinding(result.env, "first", { type: "Number", vars: 0 });
  expectBinding(result.env, "second", { type: "String", vars: 0 });
  expectBinding(result.env, "original", { type: "Number", vars: 0 });
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
    let seqnum: Void -> Number = () => (1; 2);
    let sequnit: Void -> Void = () => (1;);
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

Deno.test("supports lambda return annotations before and after the body", async () => {
  const result = await checkSource(`
    let bindingAnnotated: Void -> Bool = () => { true };
    let arrowAnnotated = (): Bool => { true };
    let bodyAnnotated = () => { true }: Bool;
    let fullyAnnotated: Void -> Bool = (): Bool => { true }: Bool;
  `);

  for (
    const name of [
      "bindingAnnotated",
      "arrowAnnotated",
      "bodyAnnotated",
      "fullyAnnotated",
    ]
  ) {
    expectBinding(result.env, name, { type: "Void -> Bool", vars: 0 });
  }
});

Deno.test("lambda return annotations check the inferred body", async () => {
  await assertRejects(
    () => checkSource(`let init = (): Bool => { 1 };`),
    Error,
    "type mismatch",
  );
  await assertRejects(
    () => checkSource(`let init = () => { 1 }: Bool;`),
    Error,
    "type mismatch",
  );
});

Deno.test("typed lambda parameters reject incompatible calls", async () => {
  await assertRejects(
    () => checkSource('let inc = (x: Number) => { x + 1 }; let bad = inc("no");'),
    Error,
    "type collision",
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
