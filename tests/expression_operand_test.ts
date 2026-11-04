import { assert, assertEquals } from "@std/assert";
import { parseCompilerModule as parse } from "../src/compiler_frontend.ts";
import { checkSource, compileLibraryVirtual } from "../src/compiler.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { loadFrontendV2Surface } from "../src/frontend_v2_surface_loader.ts";
import { parseWorkmanGrammar } from "../scripts/frontend_v2_grammar_ir.ts";
import { recognizeGrammar } from "../tooling/frontend-v2/generator/recognizer.ts";

const grammar = parseWorkmanGrammar(
  await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  "src/grammar.peggy",
);
const frontend = await loadFrontendV2Surface(
  new URL("../src/generated/frontend_v2_parser.js", import.meta.url),
);

Deno.test("expression operands share syntax across pipes, calls and operators", async () => {
  const operands = [
    "x => x",
    "(x: Number) => x + 1",
    "(Ok(x) => x)",
    "(Ok (x) => x)",
    "(None => 0)",
    "(Pair(x, y) => x + y)",
    "(Empty() => 0)",
    "((None) => 0)",
    "((Ok(x), y) => x + y)",
    "([Ok(x), ..rest] => x)",
    "(.{ value = Ok(x) } => x)",
    "(true => 1)",
    "if (true) { identity } else { identity }",
    "match(true) { true => identity, false => identity }",
    "match { Ok(x) => x, Err(_) => 0 }",
  ];
  for (const operand of operands) {
    for (
      const expression of [operand, `input :> ${operand}`, `apply ${operand}`, `1 + ${operand}`]
    ) {
      const source = `let result = ${expression};`;
      assert(recognizeGrammar(grammar, source), source);
      const surface = frontend.parseSurfaceProgram(source);
      assert(surface, source);
      assertEquals(surface.marks, [], source);
      const original = normalizeFrontendSemanticAst(await parse(source));
      for (const fix of [false, true]) {
        const formatted = await formatFrontendV2Source(source, "<test>", fix);
        assertEquals(normalizeFrontendSemanticAst(await parse(formatted)), original, formatted);
        assertEquals(await formatFrontendV2Source(formatted, "<test>", fix), formatted);
      }
    }
  }
  // The reported example must be accepted without recovery or added punctuation.
  const source = `let main ==> {
    "x" :> .split() :> (Ok(x) => x) :> Js.Array.toList
  };`;
  const surface = frontend.parseSurfaceProgram(source);
  assert(surface);
  assertEquals(surface.marks, []);
  await parse(source);
  await checkSource(source);
});

Deno.test("shared operands execute while preserving lambda scope and pipe associativity", async () => {
  const source = `
    record Box<t> = { value: t };
    type Pair = | Pair<Number, Number>;
    type Empty = | Empty;
    let identity = x => x;
    let increment = x => x + 1;
    let double = x => x * 2;
    let apply = f => f(4);
    let standalone = (Ok(x) => x);
    let checks = (
      3 :> x => x + 1,
      Ok(5) :> (Ok(x) => x),
      (Ok(2), 3) :> ((Ok(x), y) => x + y),
      [Ok(6)] :> ([Ok(x), ..rest] => x),
      Box(Ok(7)) :> (.{ value = Ok(x) } => x),
      true :> (true => 8),
      standalone(Ok(9)),
      Pair(2, 3) :> (Pair(x, y) => x + y),
      Empty :> (Empty() => 10),
      None :> ((None) => 11),
      apply if (true) { increment } else { double },
      apply match(true) { true => increment, false => double },
      10 + if (true) { 2 } else { 3 },
      10 + match(true) { true => 3, false => 4 },
      3 :> if (true) { increment } else { double },
      3 :> match(true) { true => increment, false => double },
      3 :> increment :> double,
      3 :> x => x + 1 :> double,
      3 :> x => { x + 1 } :> double
    );
  `;
  const code = await compileLibraryVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.checks, [4, 5, 5, 6, 7, 8, 9, 5, 10, 11, 5, 5, 12, 13, 4, 4, 8, 5, 8]);
});
