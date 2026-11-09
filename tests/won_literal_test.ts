import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compile, compileVirtual } from "../src/compiler.ts";
import { parseCompilerModule, parseCompilerModuleRecovered } from "../src/compiler_frontend.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { ParseError } from "../src/parser.ts";
import { documentSymbols } from "../src/lsp/document_symbols.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

async function execute(source: string): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, await compile(source));
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  } finally {
    await Deno.remove(path);
  }
}

Deno.test("native WON records and lists construct portable values without an explicit import", async () => {
  assertEquals(
    await execute(`
    from "basis/won_value.wm" import * as W;
    let empty = WON{};
    let values = WON[null true false 1 1.0 1E+00 -2.50e-3 x"00ff"];
    let main = () => {
      print(empty == W.Record([]));
      print(values == W.List([W.Null, W.Boolean(true), W.Boolean(false), W.Number("1"), W.Number("1.0"), W.Number("1E+00"), W.Number("-2.50e-3"), W.Blob(['\\000', '\\255'])]));
      print(WON[] == W.List([]))
    };
  `),
    "true\ntrue\ntrue",
  );
});

Deno.test("native WON matches portable decoding including Unicode comments tags and keys", async () => {
  const document = String
    .raw`{title = "Hei 🌍" "é key" = "a\n\t\x00" items = [Ready [1 2] Ready[1 2] Box<color = "red">{x = 1} Text("hi") Flag]}`;
  assertEquals(
    await execute(`
    from "basis/won.wm" import * as Won;
    from "basis/text.wm" import * as Utf8;
    from "basis/string.wm" import * as Bytes;
    let native = WON${document};
    let source = ${JSON.stringify(document)};
    let decoded = source :> Utf8.toUtf8 :> Result.debug :> Bytes.toNative :> Result.debug :> Won.decode :> Result.debug;
    let comments = WON[/* outer /* inner */ done */ 1,, // comment
      2,];
    let main = () => { print(native == decoded); print(comments == WON[1 2]) };
  `),
    "true\ntrue",
  );
});

Deno.test("native WON preserves authored syntax through formatting and lowers to constructors", async () => {
  const literal = `WON[Ready [1 2] Ready[1 2] /* keep */ button<onClick = Action("add")>("Add")]`;
  const source = `let view=${literal};`;
  const formatted = await formatFrontendV2Source(source);
  assertStringIncludes(formatted, literal);
  assertEquals(await formatFrontendV2Source(formatted), formatted);
  await checkSource(formatted);
  const module = await parseCompilerModule(source);
  assertEquals(module.decls[0].kind, "ImportDecl");
  assertEquals(module.decls[0].kind === "ImportDecl" && module.decls[0].path, "basis/won_value.wm");
  assertEquals(JSON.stringify(module).includes('"name":"$wonLiteral.Tag"'), true);
  assertEquals(JSON.stringify(module).includes('"name":"decode"'), false);
});

Deno.test("native WON rejects malformed portable syntax and deferred interpolation", async () => {
  for (
    const literal of [
      "WON[Tag()]",
      "WON[Tag(null)]",
      "WON[Tag([1])]",
      "WON[Tag<>]",
      "WON[01]",
      "WON[1.]",
      "WON[1e]",
      "WON[+1]",
      'WON[x"FF"]',
      'WON["\\u0041"]',
      'WON["\\x41"]',
      'WON{"identifier" = 1}',
      "WON[x = 1]",
      "WON{key: 1}",
      "WON[1true]",
      'WON["a""b"]',
      "WON[${count}]",
      "WON{callback = (_) => { void }}",
    ]
  ) {
    await assertRejects(() => checkSource(`let value = ${literal};`), Error, undefined, literal);
  }
});

Deno.test("native WON duplicate field errors locate the second key", async () => {
  for (const literal of ["WON{key = 1 key = 2}", "WON[Tag<key = 1 key = 2>]"]) {
    const source = `let value =\n  ${literal};`;
    const error = await assertRejects(
      () => parseCompilerModule(source),
      ParseError,
      "duplicate key",
    );
    assertEquals(error.span.start, source.lastIndexOf("key"));
    assertEquals(error.span.line, 2);
  }
});

Deno.test("native WON construction is independent of locally shadowed list constructors", async () => {
  assertEquals(
    await execute(`
    from "basis/won_value.wm" import * as W;
    type Other = Nil | Cons<Number>;
    let value = WON["hello" {key = 1}];
    let main = () => {
      print(match(value) { W.List(_) => { true }, _ => { false } })
    };
  `),
    "true",
  );
  await assertRejects(() => checkSource("let value: Bool = WON[];"));
});

Deno.test("native WON errors support editor recovery without dropping following declarations", async () => {
  const source = "let bad = WON{key = 1 key = 2};\nlet following = 42;";
  const recovered = await parseCompilerModuleRecovered(source);
  assertEquals(recovered.syntax, "recovered");
  assertEquals(recovered.diagnostics.length, 1);
  assertEquals(JSON.stringify(recovered.module).includes('"name":"following"'), true);
});

Deno.test("native WON hides compiler helper bindings from document symbols", async () => {
  const path = await Deno.makeTempFile({ suffix: ".wm" });
  try {
    await Deno.writeTextFile(path, 'let view = WON[button("Add")];');
    const symbols = await documentSymbols(pathToFileUri(path), new Map());
    assertEquals(symbols.map((symbol) => symbol.name), ["view"]);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("native WON values compose through normal functions lists and module exports", async () => {
  const output = await compileVirtual(
    "/test/main.wm",
    new Map([
      ["/test/view.wm", `let item = WON[button<onClick = Action("add")>("Add")];`],
      [
        "/test/main.wm",
        `from "./view.wm" import { item }; from "basis/won_value.wm" import * as W;
      let wrap = (value) => { W.List([value, WON{}]) };
      let main = () => { print(wrap(item) == W.List([item, W.Record([])])) };`,
      ],
    ]),
  );
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, output);
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "true");
  } finally {
    await Deno.remove(path);
  }
});
