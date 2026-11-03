import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compileLibraryVirtual, compileVirtual } from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { FrontendDiagnosticError } from "../src/diagnostics.ts";
import { ParseError } from "../src/parser.ts";

Deno.test("piped conditionals compose with matches, ordinary pipes and nested conditionals", async () => {
  const source = `
    let positive = Some(1) :> match { Some(x) => x > 0 }
      :> if { "positive" } else { "nonpositive" };
    let negative = false :> if { "yes" } else { "no" } :> (text => text ++ "!");
    let nested = true :> if {
      false :> if { 1 } else { 2 }
    } else { 3 };
    let consecutive = false :> if { true } else { false } :> if { 4 } else { 5 };
    let ordinary = true :> if { if (false) { 6 } else { 7 } } else { 8 };
    let scoped = true :> if { let local = 9; local } else { let local = 10; local };
    let unary = !false :> if { true } else { false };
  `;
  const code = await compileLibraryVirtual(
    "/test/conditional.wm",
    new Map([["/test/conditional.wm", source]]),
  );
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(
    [
      runtime.positive,
      runtime.negative,
      runtime.nested,
      runtime.consecutive,
      runtime.ordinary,
      runtime.scoped,
      runtime.unary,
    ],
    ["positive", "no!", 2, 5, 7, 9, true],
  );
});

Deno.test("piped conditionals lower to normal if expressions and round-trip through the formatter", async () => {
  for (
    const source of [
      'let result=true:>if{"yes"}else{"no"};',
      'let result = (value > 0) :> if { "positive" } else { "nonpositive" };',
      "let result = true :> if { false :> if { 1 } else { 2 } } else { 3 } :> f;",
      "let result = true :> if { if (false) { 1 } else { 2 } } else { 3 };",
      "let result = f(false :> if { 1 } else { 2 }, 3);",
      'let result = Some(1) :> match { Some(x) => x > 0 } :> if { "positive" } else { "nonpositive" };',
      "let result = [true :> if { 1 } else { 2 }, 3];",
    ]
  ) {
    const module = await parseCompilerModule(source);
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<piped-if>", fix);
      assertEquals(
        normalizeFrontendSemanticAst(await parseCompilerModule(formatted)),
        normalizeFrontendSemanticAst(module),
      );
      assertEquals(await formatFrontendV2Source(formatted, "<piped-if>", fix), formatted);
    }
  }
  const module = await parseCompilerModule("let result = true :> if { 1 } else { 2 };");
  const declaration = module.decls[0];
  assert(declaration.kind === "LetDecl");
  const value = declaration.bindings[0].value;
  assert(value.kind === "If");
  assertEquals(value.cond.kind, "Bool");
  assertEquals(value.node?.span.start, 13);
  assertEquals(value.node?.span.end, 40);
});

Deno.test("piped conditionals evaluate the condition once and only the selected branch", async () => {
  const output = await run(`
    let condition = () => { print("condition"); true };
    let main = () => {
      let first = condition() :> if { print("then"); 7 } else { Panic "unselected" };
      let second = false :> if { Panic "unselected" } else { print("else"); 8 };
      print(first);
      print(second)
    };
  `);
  assertEquals(output.code, 0);
  assertEquals(new TextDecoder().decode(output.stderr), "");
  assertEquals(new TextDecoder().decode(output.stdout), "condition\nthen\nelse\n7\n8\n");
});

Deno.test("a failed input match does not run either piped conditional branch", async () => {
  const output = await run(`
    let main = () => {
      (None :> match { Some(x) => x > 0 })
        :> if { print("then") } else { print("else") }
    };
  `);
  assertEquals(output.code, 1);
  assertEquals(new TextDecoder().decode(output.stdout), "");
  assertStringIncludes(new TextDecoder().decode(output.stderr), "non-exhaustive match");
});

Deno.test("piped conditionals require a Boolean, compatible branches, and scoped bindings", async () => {
  for (
    const source of [
      "let result = 1 :> if { 2 } else { 3 };",
      'let result = true :> if { 2 } else { "three" };',
      "let result = true :> if { let local = 1; local } else { local };",
    ]
  ) {
    await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  }
  for (
    const source of [
      "let result = if { 1 } else { 2 };",
      "let result = true :> if { 1 };",
      "let result = true :> if { 1 } else;",
    ]
  ) {
    await assertRejects(() => parseCompilerModule(source), ParseError);
  }
});

async function run(source: string): Promise<Deno.CommandOutput> {
  const code = await compileVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/main.mjs`;
    await Deno.writeTextFile(path, code);
    return await new Deno.Command(Deno.execPath(), {
      args: ["run", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
