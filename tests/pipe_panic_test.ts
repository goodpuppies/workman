import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import peggy from "peggy";
import { checkSource, compileLibraryVirtual, compileVirtual } from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { FrontendDiagnosticError } from "../src/diagnostics.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";

function normalizedAst(module: unknown): unknown {
  const names = new Map<string, string>();
  return JSON.parse(JSON.stringify(normalizeFrontendSemanticAst(module), (_key, value) => {
    if (typeof value !== "string" || !/^\$wm_(match|pipe)_\d+$/.test(value)) return value;
    if (!names.has(value)) names.set(value, `$generated_${names.size}`);
    return names.get(value);
  }));
}

Deno.test("Panic consumes piped strings in functions, pipeline lambdas and match arms", async () => {
  const source = `from "./custom.wm" import * as Custom;
let fail = => :> Panic;
let braced = => { :> Panic };
let unwrap = match { Ok(value) => value, Err => :> Panic };
let direct = (): Int32 => "direct" :> Panic;
let chained = (): String => "chain" :> (text => text ++ "!") :> Panic;
let fromLambda = (): Bool => "lambda" :> fail;
let fromBlock = (): String => "block" :> braced;
let fromMatch = (): Int32 => unwrap(Err("match"));
let passed: Int32 = unwrap(Ok(42));
let qualified = "payload" :> Custom.Panic :> match { Custom.Panic(text) => text };`;
  const code = await compileLibraryVirtual(
    "/test/panic.wm",
    new Map([
      ["/test/panic.wm", source],
      ["/test/custom.wm", "type Custom = | Panic<String>;"],
    ]),
  );
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  for (
    const [name, message] of [
      ["direct", "direct"],
      ["chained", "chain!"],
      ["fromLambda", "lambda"],
      ["fromBlock", "block"],
      ["fromMatch", "match"],
    ]
  ) {
    assertThrows(() => runtime[name](), Error, message);
  }
  assertEquals(runtime.passed, 42);
  assertEquals(runtime.qualified, "payload");
});

Deno.test("piped Panic evaluates the input once and stops later stages", async () => {
  const source = `let message = () => { print("message"); "boom" };
let after = value => { print("after"); value };
let main = () => message() :> Panic :> after;`;
  const code = await compileVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/main.mjs`;
    await Deno.writeTextFile(path, code);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 1);
    assertEquals(new TextDecoder().decode(output.stdout), "message\n");
    assertStringIncludes(new TextDecoder().decode(output.stderr), "boom");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("piped Panic retains syntax and implicit input through parsing and formatting", async () => {
  const grammar = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  for (
    const source of [
      'let crash = "boom" :> Panic;',
      'let crash = "boom" :> (Panic);',
      'let crash = "boom" :> Panic :> after;',
      "let fail = => :> Panic;",
      "let fail = => { :> Panic };",
      "let unwrap = match { Ok(value) => value, Err => :> Panic };",
    ]
  ) {
    const original = normalizedAst(await parseCompilerModule(source));
    assertEquals(normalizedAst(grammar.parse(source)), original, source);
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<piped-panic>", fix);
      assertStringIncludes(formatted, ":>");
      assertStringIncludes(formatted, "Panic");
      assertEquals(normalizedAst(await parseCompilerModule(formatted)), original);
      assertEquals(await formatFrontendV2Source(formatted, "<piped-panic>", fix), formatted);
    }
  }
});

Deno.test("piped Panic rejects non-string messages at the input expression", async () => {
  const source = "let bad = (42: Int32) :> Panic;";
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.failure.frame.rule, "InferPanic.MessageString");
  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") throw new Error("missing panic input location");
  assertEquals(primary.span.start, source.indexOf("42"));
  await assertRejects(
    () => checkSource("let fail = => :> Panic; let bad = fail(1);"),
    FrontendDiagnosticError,
  );
});
