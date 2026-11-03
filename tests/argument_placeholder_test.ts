import { assert, assertEquals, assertRejects } from "@std/assert";
import { checkSource, compileLibraryVirtual, compileVirtual } from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { FrontendDiagnosticError } from "../src/diagnostics.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("argument placeholders select positions, preserve order and belong to the nearest call", async () => {
  const source = `
    let z = (n, flag) => if (flag) { n + 1 } else { n };
    let x = f => f(4);
    let p = z(_, true);
    let subtract = (a, b) => a - b;
    let reverse = subtract(_, _);
    let swap = (a, b) => (b, a);
    let curried = a => b => a + b;
    let checks = (
      p(4), 4 :> z(_, true), true :> z(4, _),
      reverse(8, 3), (8, 3) :> subtract(_, _),
      x(z(_, true)), subtract(_, 2)(8),
      (2, 9) :> swap(_, _), curried(_)(3)(4),
      Some(_)(7) == Some(7),
      ([1, 2] :> List.map(_, z(_, true))) == [2, 3],
      ([1, 2] :> List.map(z(_, true))) == [2, 3],
      3 :> subtract(10, _),
      3 :> subtract(10),
      2 :> z(_, true) :> subtract(_, 1)
    );
  `;
  // Ordinary insertion is still data-first: subtract(3, 10) is -7.
  const runtime = await library(source);
  assertEquals(runtime.checks, [
    5,
    5,
    5,
    5,
    5,
    5,
    6,
    [9, 2],
    7,
    true,
    true,
    true,
    7,
    -7,
    2,
  ]);
});

Deno.test("placeholder lambdas infer generically without capturing authored names", async () => {
  const result = await checkSource(`
    let identity = x => x;
    let partial = identity(_);
    let n = partial(1);
    let s = partial("text");
    let _value = 10;
    let add = (a, b) => a + b;
    let named = add(_value, _);
    let n2 = named(2);
    let ignored = List.map([1, 2], _ => 5);
    let pattern = Some(4) :> match { Some(_) => 7, None => 0 };
  `);
  expectBinding(result.env, "n", { type: "Number", vars: 0 });
  expectBinding(result.env, "s", { type: "String", vars: 0 });
  expectBinding(result.env, "n2", { type: "Number", vars: 0 });
});

Deno.test("placeholder formatting preserves call scope and wildcard lambdas", async () => {
  for (
    const source of [
      "let p=z(_,true);",
      "let p=x(z(_,true));",
      "let p=f(_, g(_, 1), _,);",
      "let p=f(_, _)(1, 2);",
      "let p=value :> f(fixed, _);",
      "let p=(left, right) :> f(_, _);",
      "let p=List.map(_, _ => 5);",
      "let p=List.map(_, (_, _) => 5);",
      "let p=f(/* input */ _, true);",
      "let p=f(_name, _);",
    ]
  ) {
    const module = await parseCompilerModule(source);
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<placeholder>", fix);
      assertEquals(
        normalizeFrontendSemanticAst(await parseCompilerModule(formatted)),
        normalizeFrontendSemanticAst(module),
      );
      assertEquals(await formatFrontendV2Source(formatted, "<placeholder>", fix), formatted);
    }
  }
  const module = await parseCompilerModule("let p = f(_, true);");
  const declaration = module.decls[0];
  assert(declaration.kind === "LetDecl");
  const lambda = declaration.bindings[0].value;
  assert(lambda.kind === "Lambda");
  assertEquals(lambda.params[0].pattern.node?.span, { line: 1, col: 10, start: 10, end: 11 });
});

Deno.test("placeholder lambdas defer callee and fixed-argument effects until each invocation", async () => {
  const source = `
    let make = () => { print("callee"); (a, b) => { print("call"); a + b } };
    let fixed = () => { print("fixed"); 10 };
    let main = () => {
      let p = make()(_, fixed());
      print("created");
      print(p(1));
      print(p(2))
    };
  `;
  const code = await compileVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/main.mjs`;
    await Deno.writeTextFile(path, code);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0);
    assertEquals(new TextDecoder().decode(output.stderr), "");
    assertEquals(
      new TextDecoder().decode(output.stdout),
      "created\ncallee\nfixed\ncall\n11\ncallee\nfixed\ncall\n12\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("argument placeholders work with foreign functions", async () => {
  const runtime = await library(`
    from js.global("Math") import unsafe { pow: (Number, Number) -> Number };
    let square = pow(_, 2);
    let squared = square(3);
    let power = 3 :> pow(2, _);
  `);
  assertEquals(runtime.squared, 9);
  assertEquals(runtime.power, 8);
});

Deno.test("placeholder calls retain ordinary arity and type checks", async () => {
  for (
    const source of [
      "let f = (a, b) => a + b; let result = 1 :> f(_, _);",
      'let f = (a: Number, b: Bool) => a; let result = "text" :> f(_, true);',
      "let f = (a, b) => a + b; let result = f(_, 1)(2, 3);",
      "let f = x => x; let result = f(_ + 1);",
      "let f = x => x; let result = f((_));",
    ]
  ) {
    await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  }
});

async function library(source: string) {
  const code = await compileLibraryVirtual(
    "/test/placeholders.wm",
    new Map([["/test/placeholders.wm", source]]),
  );
  return await import(`data:text/javascript;base64,${btoa(code)}`);
}
