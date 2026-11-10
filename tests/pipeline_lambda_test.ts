import { assert, assertEquals, assertRejects } from "@std/assert";
import peggy from "peggy";
import { parseCompilerModule as parse } from "../src/compiler_frontend.ts";
import { checkSource, compileLibraryVirtual } from "../src/compiler.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import { loadFrontendV2Surface } from "../src/frontend_v2_surface_loader.ts";

Deno.test("pipeline lambdas execute with independent inputs, blocks and carrier continuations", async () => {
  const source = `
    let add = (value, amount) => value + amount;
    let times = (value, amount) => value * amount;
    let apply = (value, f) => f(value);
    let offset = 9;
    let chain = => :> add(2) :> times(3);
    let braced = => { :> add(2) :> times(3) };
    let nested = => :> apply(=> :> add(1)) :> times(2);
    let captured = => :> add(offset);
    let placeholder = => :> add(_, 2);
    let arithmetic = => :> add(2) * 3;
    let branch = => :> if { 1 } else { 2 };
    let sum = (a, b) => a + b;
    let tupled = => :> sum;
    let block = => { :> add(1); let final = 17; final };
    let discarded = => { :> add(1); };
    let unitFn = => { 42 };
    let safeAdd = (value, amount) => Ok(value + amount);
    let success: Result<Number, String> = Ok(4)
      :> Monad.via Result => :> safeAdd(2) :> Result.map(times(_, 3));
    let failure: Result<Number, String> = Err("stop")
      :> Monad.via Result => { :> safeAdd(2) };
    let task: Task<Number, String> = Task.succeed(4)
      :> Monad.via Task => :> add(2) :> Task.succeed;
    let unwrap = result => match(result) { Ok(value) => value, Err(_) => -1 };
    let checks = (
      chain(4), braced(4), nested(4), captured(4), placeholder(4), arithmetic(4),
      branch(true), branch(false), tupled(3, 5), block(4), discarded(4), unitFn(void),
      unwrap(success), match(failure) { Err(error) => error, Ok(_) => "unexpected" }
    );
  `;
  const code = await compileLibraryVirtual(
    "/test/pipeline-lambda.wm",
    new Map([["/test/pipeline-lambda.wm", source]]),
  );
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.checks, [18, 18, 10, 13, 6, 18, 1, 2, 8, 17, undefined, 42, 18, "stop"]);
  assertEquals(runtime.unwrap(await runtime.task), 6);
});

Deno.test("pipeline lambda syntax and formatting preserve the implicit input", async () => {
  const grammar = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  const frontend = await loadFrontendV2Surface(
    new URL("../src/generated/frontend_v2_parser.js", import.meta.url),
  );
  for (
    const source of [
      "let f = => :> add(1);",
      "let f = => { :> add(1) :> times(2) };",
      "let f = => /* comment */ { /* input */ :> add(1); let x = 2; x };",
      "let f = => { :> add(1); };",
      "let f = (=> :> add(1));",
      "let f = List.map([1, 2], => :> add(1));",
      "let f = => :> apply(=> :> add(1));",
      'let f = task :> Monad.via Task => { :> unpack("vendor/lib", 1) };',
      "let f = => :> if { 1 } else { 2 };",
      "let f = => :> .length;",
      "let f = => :> .slice(1);",
      "let f = => :> add(2) * 3;",
    ]
  ) {
    grammar.parse(source);
    const original = normalizeFrontendSemanticAst(await parse(source));
    const surface = frontend.parseSurfaceProgram(source);
    assert(surface, source);
    assertEquals(surface.marks, [], source);
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<pipeline-lambda>", fix);
      assert(formatted.includes("=>"), formatted);
      assert(!formatted.includes("$wm_pipe_"), formatted);
      assertEquals(normalizeFrontendSemanticAst(await parse(formatted)), original, formatted);
      assertEquals(await formatFrontendV2Source(formatted, "<pipeline-lambda>", fix), formatted);
    }
  }
});

Deno.test("leading pipes are restricted to the start of bare lambda bodies", async () => {
  const grammar = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  const frontend = await loadFrontendV2Surface(
    new URL("../src/generated/frontend_v2_parser.js", import.meta.url),
  );
  for (
    const source of [
      "let bad = :> f;",
      "let bad = => { let x = 1; :> f };",
      "let bad = => { :> f; :> g };",
      "let bad = => :>;",
      "let bad = => { :> };",
    ]
  ) {
    assertEquals(
      (() => {
        try {
          grammar.parse(source);
          return true;
        } catch {
          return false;
        }
      })(),
      false,
      source,
    );
    const surface = frontend.parseSurfaceProgram(source);
    assert(!surface || surface.marks.length > 0, source);
  }
  await assertRejects(() =>
    checkSource(
      'let add = (a: Number, b: Number) => a + b; let f = => :> add(2); let bad = f("text");',
    )
  );
});
