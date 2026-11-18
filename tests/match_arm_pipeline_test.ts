import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import peggy from "peggy";
import { checkSource, compileLibraryVirtual } from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { loadFrontendV2Surface } from "../src/frontend_v2_surface_loader.ts";
import { ParseError } from "../src/parser.ts";

function normalizedAst(module: unknown): unknown {
  const names = new Map<string, string>();
  return JSON.parse(JSON.stringify(normalizeFrontendSemanticAst(module), (key, value) => {
    if (key === "applicationStyle" && value === "explicit") return undefined;
    if (typeof value !== "string" || !/^\$wm_(match|pipe|arg)_\d+$/.test(value)) return value;
    if (!names.has(value)) names.set(value, `$generated_${names.size}`);
    return names.get(value);
  }));
}

Deno.test("match arm pipelines consume constructor payloads and keep nested inputs independent", async () => {
  const source = `
type Failure = | Message<String> | Nested<Failure>;
let prefix = "error: ";
let describe = match {
  Message => :> (text => prefix ++ text),
  Nested => :> match {
    Message => { :> (text => text ++ "!") },
    Nested(_) => "deep"
  }
};
let unwrap = match {
  Ok(v) => v,
  Err => :> match {
    Message => :> (text => prefix ++ text),
    Nested => :> describe
  }
};
let checks = (
  unwrap(Ok("success")),
  unwrap(Err(Message("failed"))),
  unwrap(Err(Nested(Message("nested")))),
  describe(Nested(Message("payload"))),
  match(Message("direct")) { Message => :> (x => x ++ "!"), Nested(_) => "other" },
  (Some("once") :> match { Some => { :> (x => x ++ "!"); "done" }, None => "none" })
);`;
  const code = await compileLibraryVirtual(
    "/test/match-arm-pipeline.wm",
    new Map([
      ["/test/match-arm-pipeline.wm", source],
    ]),
  );
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.checks, [
    "success",
    "error: failed",
    "error: nested",
    "payload!",
    "direct!",
    "done",
  ]);
});

Deno.test("match arm pipelines support qualified constructors", async () => {
  const source = `from "./packet.wm" import * as Packet;
let unpack = match {
  Packet.Data => :> (text => text ++ "!"),
};
let value = unpack(Packet.Data("payload"));`;
  const code = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([
      ["/test/main.wm", source],
      ["/test/packet.wm", "type Packet = | Data<String>;"],
    ]),
  );
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.value, "payload!");
});

Deno.test("match arm pipelines round-trip through both parsers and formatting", async () => {
  const grammar = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  const frontend = await loadFrontendV2Surface(
    new URL("../src/generated/frontend_v2_parser.js", import.meta.url),
  );
  for (
    const source of [
      "let f = match { Ok(v) => v, Err => :> match { Message(text) => text } };",
      "let f = match(value) { Some => { :> first :> second }, None => 0 };",
      "let f = match(value) => { Lib.Error => /* payload */ :> handle, Other => :> fallback };",
      "let f = match { Some => { /* start */ :> first; let x = 1; x }, None => 0 };",
      "let f = match { Some => :> if { 1 } else { 2 }, None => 0 };",
      "let f = match { Some => :> .length, None => 0 };",
      "let f = match { Some => :> apply(=> :> first), None => 0 };",
      "let f = match { Some => :> match { Other => :> next }, None => 0 };",
      "let f = match { Some(x) => (=> :> first), None => (=> :> second) };",
    ]
  ) {
    const original = normalizedAst(await parseCompilerModule(source));
    assertEquals(normalizedAst(grammar.parse(source)), original, source);
    const surface = frontend.parseSurfaceProgram(source);
    assert(surface, source);
    assertEquals(surface.marks, [], source);
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<match-arm-pipeline>", fix);
      assert(!formatted.includes("$wm_pipe_"), formatted);
      assertEquals(
        normalizedAst(await parseCompilerModule(formatted)),
        original,
        formatted,
      );
      assertEquals(await formatFrontendV2Source(formatted, "<match-arm-pipeline>", fix), formatted);
    }
  }
});

Deno.test("match arm pipelines require an omitted single constructor payload", async () => {
  for (
    const source of [
      "let f = match { Err(e) => :> handle };",
      "let f = match { _ => :> handle };",
      "let f = match { Var(x) => :> handle };",
    ]
  ) {
    const error = await assertRejects(() => parseCompilerModule(source), ParseError);
    assertStringIncludes(error.message, "constructor without an explicit payload pattern");
    assertEquals(error.span.start, source.indexOf("{ ") + 2);
  }
  for (
    const source of [
      "let f = match { Some => :> };",
      "let f = match { Some => { :> } };",
      "let f = match { Some => { let x = 1; :> handle } };",
      "let f = match { Some => { :> first; :> second } };",
      "let f = match { None => :> (x => x) };",
      "type Pair = | Both<Int32, String>; let f = match { Both => :> (x => x) };",
    ]
  ) {
    await assertRejects(() => checkSource(source));
  }
  await checkSource("let unwrap = match { Some(x) => x, None => 0 }; let value = unwrap(Some(1));");
});
