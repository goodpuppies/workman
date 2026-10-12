import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Focused full-document parity; build once, then exercise valid and damaged buffers.
const repository = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(repository, "_scratch/frontend-v3-native");
const build = await new Deno.Command("python3", {
  args: [join(repository, "scripts/build_frontend_v3_native.py"), ...Deno.args],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!build.success) throw new Error(new TextDecoder().decode(build.stderr));
// The build tool prints the executable's absolute path, allowing --output overrides.
const executable = new TextDecoder().decode(build.stdout).trim().split("\n").at(-1)!;
await Deno.mkdir(output, { recursive: true });
const bridge = join(output, "parity.wm");
await Deno.writeTextFile(
  bridge,
  `
from "../../tooling/frontend-v3/adapters/js/lexer.wm" import * as JsLexer;
from "../../tooling/frontend-v3/adapters/portable/document.wm" import * as Document;
let lex = JsLexer.lex;
let sourceUnits = JsLexer.sourceUnits;
let snapshot = (text) => {Document.encode(JsLexer.lex(text))};
`,
);
const module = join(output, "parity.mjs");
await Deno.writeTextFile(module, await compileLibraryFile(bridge));
const { lex, sourceUnits, snapshot } = await import(`file://${module}`);
// Check the same authored schema under WM as well as the native build's AST closure.
await compileLibraryFile(join(repository, "tooling/frontend-v3/src/surface/ast.wm"));
await compileLibraryFile(join(repository, "tooling/frontend-v3/src/parser/type.wm"));

type Variant = { name: string; args: any[] };
function list(value: Variant): any[] {
  const result = [];
  while (value.name === "Cons") {
    const [head, tail] = value.args[0];
    result.push(head);
    value = tail;
  }
  assertEquals(value.name, "Nil");
  return result;
}
function variant(value: Variant): any[] {
  const args = value.args.length === 1 && Array.isArray(value.args[0]) ? value.args[0] : value.args;
  return [value.name, ...args.map((v: any) => typeof v === "object" ? variant(v) : v)];
}
const position = (value: any) => [value.index, value.line, value.col];
const span = (value: any) => [position(value.startPos), position(value.endPos)];
const mark = (value: any) => [
  value.id.args[0],
  variant(value.problem),
  variant(value.recovery),
  value.anchor.args[0],
  [value.affectedSpan.start.args[0], value.affectedSpan.end.args[0]],
  value.causedBy.name === "None" ? null : value.causedBy.args[0].args[0],
];
function document(value: any) {
  return [
    list(value.tokens).map((token: any) => [
      variant(token.kind),
      span(token.span),
      token.mateIdx.name === "NoMate" ? null : token.mateIdx.args[0],
      list(token.marks).map(mark),
      list(token.leadingTrivia).map((trivia: any) => [
        variant(trivia.kind),
        list(sourceUnits(trivia.text)),
        span(trivia.span),
        list(trivia.marks).map(mark),
      ]),
    ]),
    list(value.marks).map(mark),
  ];
}
const corpus = new Set([
  "",
  " \t",
  "\r\n\r\n",
  "x\0y",
  "\0",
  "\uD800",
  "\uDC00",
  "\uD800x\uDC00",
  "'😀'",
  "'a' 'ab' ''",
  "'\\u{1f600}'",
  "'\\q'",
  '"😀\uD800"',
  "/*\uD800*/",
  "let foo' = Upper; foo_bar'",
  "0 42 3.14 -1.5 0x2a 0w42 0wxFF 1e-3",
  "0x 0w 0wx 1e+ 42foo 3.14bar 0xG 0wxg 0w9a 1e2foo",
  "( ) { } [ ] < > , ; : . .. .{ @ = => -> | :> || && == != <= >= + - * / % ++ ! ?",
  ".{[()]} ",
  "([)]",
  "{(}",
  ")(",
  "[[",
  "&&&",
  "😀",
  "-- comment\r\nx\n// tail",
  "/* outer\r\n/* inner */ tail */x",
  "/* outer /* inner",
  '"{[(]}" /* {[(]} */',
  '{ & "\\q" } ] /*',
  '{ & "\\q" /*',
  "`hello ${foo({a: [1]})} tail`",
  "`a${`b${x}`}c`",
  "`😀${x}`",
  "`a${",
  '"\\x41\\u{1f600}\\^A"',
  '"\\q\\xZ\\u{110000}"',
  "\uFEFFlet x = 1",
]);
for (
  const source of [
    'let x = "a\\q"; & [42] // comment\n"unfinished\\',
    "`a${foo([1])}z`",
    "/* outer /* inner */ tail */x",
  ]
) {
  for (let end = 0; end <= source.length; end++) corpus.add(source.slice(0, end));
}
corpus.add(await Deno.readTextFile(join(repository, "tooling/frontend-v3/examples/example.wm")));
const input = await Deno.makeTempFile();
const decoder = new TextDecoder();
let utf8Count = 0;
try {
  for (const source of corpus) {
    const expected = document(lex(source));
    assertEquals(JSON.parse(snapshot(source)), expected, `WM encoder: ${JSON.stringify(source)}`);
    const units = new Uint8Array(source.length * 2);
    for (let index = 0; index < source.length; index++) {
      const unit = source.charCodeAt(index);
      units[index * 2] = unit & 255;
      units[index * 2 + 1] = unit >>> 8;
    }
    await Deno.writeFile(input, units);
    const raw = await new Deno.Command(executable, { args: ["--utf16le", input] }).output();
    assertEquals(raw.code, 0, decoder.decode(raw.stderr));
    assertEquals(
      JSON.parse(decoder.decode(raw.stdout)),
      expected,
      `native raw: ${JSON.stringify(source)}`,
    );
    if (source.isWellFormed()) {
      await Deno.writeTextFile(input, source);
      const utf8 = await new Deno.Command(executable, { args: [input] }).output();
      assertEquals(utf8.code, 0, decoder.decode(utf8.stderr));
      assertEquals(
        JSON.parse(decoder.decode(utf8.stdout)),
        expected,
        `native UTF-8: ${JSON.stringify(source)}`,
      );
      utf8Count++;
    }
  }
  for (
    const [args, bytes] of [
      [[input], [0xc0, 0x80]],
      [[input], [0xed, 0xa0, 0x80]],
      [[input], [0xf0, 0x9f]],
      [["--utf16le", input], [0x00]],
    ] as [string[], number[]][]
  ) {
    await Deno.writeFile(input, new Uint8Array(bytes));
    const result = await new Deno.Command(executable, { args }).output();
    assertEquals(result.code, 1);
    assertEquals(result.stdout.length, 0);
    assertEquals(decoder.decode(result.stderr), "invalid source encoding\n");
  }
} finally {
  await Deno.remove(input);
}
console.log(
  `Native lexer parity: ${corpus.size} raw-unit documents, ${utf8Count} UTF-8 documents and encoding failures passed`,
);
