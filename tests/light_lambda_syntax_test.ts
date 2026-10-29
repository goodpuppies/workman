import { assert, assertEquals } from "@std/assert";
import { parseCompilerModule as parse } from "../src/compiler_frontend.ts";
import { checkSource, compileLibraryVirtual } from "../src/compiler.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { loadFrontendV2Surface } from "../src/frontend_v2_surface_loader.ts";
import { parseWorkmanGrammar } from "../scripts/frontend_v2_grammar_ir.ts";
import { recognizeGrammar } from "../tooling/frontend-v2/generator/recognizer.ts";
import { expectBinding } from "./type_helpers.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";

const grammar = parseWorkmanGrammar(
  await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  "src/grammar.peggy",
);
const frontend = await loadFrontendV2Surface(
  new URL("../src/generated/frontend_v2_parser.js", import.meta.url),
);

Deno.test("lightweight lambdas are strict syntax with no synthesized punctuation", async () => {
  for (
    const source of [
      "let square = x => x*x;",
      "let square = (x) => x*x;",
      "let square = x => (x*x);",
      "let square = x => { x*x };",
      "let add = x => y => x+y;",
      "let apply = f => f(2);",
      "let value = apply x => x*x;",
      "let value = map([1, 2], x => x*x);",
      "let value = apply(x => x+1, 2);",
      "let f = [head, ..tail] => head;",
      "let f = _ => 42;",
      "let f = x:Number => x*x;",
      "let f = x : Number => x*x;",
      "let f = (x : Number) => x*x;",
      "let f = (x):Number => x*x;",
      "let f = x |offset| => x+offset;",
      "let f = flag => if (flag) { 1 } else { 2 };",
      "let f = x => match(x) { true => { 1 }, false => { 2 } };",
      "let f = x => x + 1; let next = f(2);",
      "let f = x => (print(x); x);",
      "let f = x => { x; };",
      "let rec fac = match(n) => 0 => 1, Var(n) => n * fac(n - 1);",
      "let rec fac = match(n) => {0 => 1, Var(n) => n * fac(n - 1)};",
      "let f = match(n) => {0 => { 1 }, Var(n) => n,};",
      "let f = match(a, b) => (0, _) => 1, (_, Var(b)) => b;",
      "let result = apply(match(n) => 0 => 1, Var(n) => n, 5);",
      "let result = apply(match(n) => 0 => 1, Var(n) => n, 5,);",
      "let result = match(1) {0 => 1, Var(n) => n};",
      "let f = match {0 => 1, Var(n) => n};",
      "let f = match(n) => 0 => match(n) {0 => 1, _ => 2}, _ => 3;",
      "let f = match(n) => 0 => (match(n) => 0 => 1, _ => 2), _ => 3;",
      "let f = match(n) => 0 => match(n) => 0 => 1, _ => 2;",
    ]
  ) {
    assert(recognizeGrammar(grammar, source), source);
    const surface = frontend.parseSurfaceProgram(source);
    assert(surface, source);
    assertEquals(surface.marks, [], source);
    const original = normalizeFrontendSemanticAst(await parse(source));
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<test>", fix);
      const reparsed = frontend.parseSurfaceProgram(formatted);
      assert(reparsed, formatted);
      assertEquals(reparsed.marks, [], formatted);
      assertEquals(normalizeFrontendSemanticAst(await parse(formatted)), original, formatted);
      assertEquals(await formatFrontendV2Source(formatted, "<test>", fix), formatted);
    }
  }
});

Deno.test("expression match arms and braceless recursive match functions execute", async () => {
  const source = `
    let rec fac = match(n) => 0 => 1, Var(n) => n * fac(n - 1);
    let rec bracedFac = match(n) => {0 => 1, Var(n) => n * bracedFac(n - 1)};
    let apply = (f, value) => f(value);
    let checks = (
      fac(5), bracedFac(5),
      apply(match(n) => 0 => 1, Var(n) => n * 2, 5),
      apply(match(n) => 0 => 1, Var(n) => n * 2, 5,),
      (match {0 => 1, Var(n) => n * 2})(3),
      match(4) {0 => 1, Var(n) => n * 2},
      (match(a, b) => (0, _) => 1, (_, Var(b)) => b)(2, 7)
    );
  `;
  const code = await compileLibraryVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.checks, [120, 120, 10, 10, 6, 8, 7]);
  for (
    const [body, expectedArms] of [
      ["match(n) => 0 => match(n) => 0 => 1, _ => 2", 1],
      ["match(n) => 0 => (match(n) => 0 => 1, _ => 2), _ => 3", 2],
    ] as const
  ) {
    const module = await parse(`let f = ${body};`);
    const declaration = module.decls[0];
    assert(declaration.kind === "LetDecl");
    const value = declaration.bindings[0].value;
    assert(value.kind === "Lambda" && value.body.kind === "Match");
    assertEquals(value.body.arms.length, expectedArms);
  }
});

Deno.test("an expression lambda leaves the phrase semicolon outside its body", async () => {
  const source = "let square = x => x*x; let answer = square(5);";
  const module = await parse(source);
  assertEquals(module.decls.length, 2);
  const decl = module.decls[0];
  assert(decl.kind === "LetDecl");
  const lambda = decl.bindings[0].value;
  assert(lambda.kind === "Lambda");
  assertEquals(lambda.body.kind, "Binary");
  assertEquals(lambda.body.node?.span.end, source.indexOf(";"));
  assertEquals(lambda.params[0].pattern.node?.span, {
    start: 13,
    end: 14,
    line: 1,
    col: 13,
  });
  const result = await checkSource(`
    let square = x => x*x;
    let grouped = x => (x*x);
    let explicitBlock = x => { x*x };
    let explicitVoid = x => { x*x; };
    let sequenceVoid = x => (x*x;);
    let answer = square(5);
  `);
  for (const name of ["square", "grouped", "explicitBlock"]) {
    expectBinding(result.env, name, { type: "Number -> Number", vars: 0 });
  }
  for (const name of ["explicitVoid", "sequenceVoid"]) {
    expectBinding(result.env, name, { type: "Number -> Void", vars: 0 });
  }
  expectBinding(result.env, "answer", { type: "Number", vars: 0 });
  assertEquals(
    await formatFrontendV2Source("let square=x=>x*x;", "<test>", true),
    "let square = x => x * x;",
  );
});

Deno.test("bare and expression lambdas execute across calls, captures and blocks", async () => {
  const source = `
    let add = x => y => x+y;
    let apply = (f, value) => f(value);
    let call = f => f(5);
    let offset = 2;
    let captured = x |offset| => x+offset;
    let typed = x:Number => x*x;
    let first = [head, ..tail] => head;
    let checks = (
      add 2 3 == 5,
      apply(x => x*x, 4) == 16,
      call x => x*x,
      captured(3) == 5,
      typed(3) == 9,
      first([7, 8]) == 7,
      map([1, 2], x => x*x) == [1, 4],
      { let f = x => x+1; f(2) } == 3
    );
  `;
  const code = await compileLibraryVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.checks, [true, true, 25, true, true, true, true, true]);
});
