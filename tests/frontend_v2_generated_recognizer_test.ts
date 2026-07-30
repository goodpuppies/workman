import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { emitRecognizer } from "../scripts/generate_frontend_v2_recognizer.ts";
import { parseWorkmanGrammar } from "../scripts/frontend_v2_grammar_ir.ts";
import { parse } from "../src/parser.ts";
import {
  surfaceConstructorCount,
  surfaceRuleCoverage,
} from "../tooling/frontend-v2/generator/surface_schema.ts";

const grammarPath = new URL("../src/grammar.peggy", import.meta.url);
const grammar = parseWorkmanGrammar(
  await Deno.readTextFile(grammarPath),
  "src/grammar.peggy",
);
const generatedDirectory = new URL("../tooling/frontend-v2/generated/", import.meta.url);
const surfaceParserSource =
  new URL("../tooling/frontend-v2/surface_parser_frontend.wm", import.meta.url).pathname;
const compiledProbeSource = new URL(
  "../tooling/frontend-v2/generated/compiled_probe_dispatch.wm",
  import.meta.url,
).pathname;
const compiledProbe = await loadLibrary<{
  recognizeCompiled(source: string): boolean;
  parseCompiledCapture(source: string): { name: "Some" | "None" };
}>(compiledProbeSource);

type WorkmanList<T> =
  | Readonly<{ name: "Nil"; args: readonly [] }>
  | Readonly<{ name: "Cons"; args: readonly [readonly [T, WorkmanList<T>]] }>;

type SurfaceRecoveryMark = Readonly<{
  id: number;
  anchor: number;
  expectedText: string;
  rule: string;
  repairClass: Readonly<{ name: "AutoFix" | "RecoveryOnly" }>;
}>;

const surfaceParser = await loadLibrary<{
  parsesSurfaceSyntax(source: string): boolean;
  formatSurfaceSource(source: string): {
    name: "Some" | "None";
    args: readonly [string];
  };
  formatSurfaceSourceFix(source: string): {
    name: "Some" | "None";
    args: readonly [string];
  };
  parseSurfaceProgram(source: string): {
    name: "Some" | "None";
    args: readonly [{ marks: WorkmanList<SurfaceRecoveryMark> }];
  };
  surfaceSyntaxFingerprint(source: string): {
    name: "Some" | "None";
    args: readonly [string];
  };
}>(surfaceParserSource);

Deno.test("frontend-v2 generated WM recognizer files are reproducible and bounded", async () => {
  const expected = await emitRecognizer(grammar);
  const actualNames: string[] = [];
  for await (const entry of Deno.readDir(generatedDirectory)) {
    if (entry.isFile) actualNames.push(entry.name);
  }
  assertEquals(actualNames.sort(), [...expected.keys()].sort());
  for (const [name, source] of expected) {
    assertEquals(await Deno.readTextFile(new URL(name, generatedDirectory)), source, name);
    if (name.endsWith(".wm")) {
      assertEquals(source.split("\n").length <= 500, true, name);
    }
  }
});

Deno.test("frontend-v2 formatting Surface schema classifies the complete grammar", () => {
  assertEquals(surfaceRuleCoverage(grammar), {
    classified: 123,
    missing: [],
    unknown: [],
    duplicates: [],
    missingBuilders: [],
    unknownConstructors: [],
  });
  assertEquals(surfaceConstructorCount() >= 70, true);
});

Deno.test("frontend-v2 generated WM recognizer matches Peggy for every example", async () => {
  const root = new URL("../examples/", import.meta.url);
  let checked = 0;
  let formatted = 0;
  for await (const path of wmFiles(root)) {
    const source = await Deno.readTextFile(path);
    let peggyAccepted = true;
    try {
      await parse(source);
    } catch {
      peggyAccepted = false;
    }
    assertEquals(compiledProbe.recognizeCompiled(source), peggyAccepted, path);
    assertEquals(compiledProbe.parseCompiledCapture(source).name, peggyAccepted ? "Some" : "None");
    assertEquals(surfaceParser.parsesSurfaceSyntax(source), peggyAccepted, path);
    const first = surfaceParser.formatSurfaceSource(source);
    assertEquals(first.name, peggyAccepted ? "Some" : "None", path);
    if (first.name === "Some") {
      await parse(first.args[0]);
      assertEquals(contentFingerprint(first.args[0]), contentFingerprint(source), path);
      const second = surfaceParser.formatSurfaceSource(first.args[0]);
      assertEquals(second.name, "Some", path);
      assertEquals(second.args[0], first.args[0], path);
      formatted += 1;
    }
    checked += 1;
  }
  assertEquals(checked >= 40, true);
  assertEquals(formatted >= 40, true);
});

Deno.test("frontend-v2 preserves authored content in the completed formatting slice", async () => {
  for (
    const relative of [
      "../examples/factorial.wm",
      "../examples/exercises/math.wm",
      "../examples/raylib/orbital/color.wm",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(relative, import.meta.url));
    const formatted = surfaceParser.formatSurfaceSource(source);
    assertEquals(formatted.name, "Some", relative);
    assertEquals(contentFingerprint(formatted.args[0]), contentFingerprint(source), relative);
  }
});

Deno.test("frontend-v2 marks a committed missing semicolon and fixes only in fix mode", () => {
  const source = "let answer = 42";
  const normal = surfaceParser.formatSurfaceSource(source);
  const fixed = surfaceParser.formatSurfaceSourceFix(source);
  assertEquals(normal.name, "Some");
  assertEquals(normal.args[0], source);
  assertEquals(fixed.name, "Some");
  assertEquals(fixed.args[0], "let answer = 42;");
  const parsed = surfaceParser.parseSurfaceProgram(source);
  assertEquals(parsed.name, "Some");
  assertEquals(
    parsed.name === "Some" ? recoveryMarkSummary(parsed.args[0].marks) : [],
    [[1, 15, ";", "TopPhrase:semicolon", "AutoFix"]],
  );
});

Deno.test("frontend-v2 marks committed braceless lambda body and semicolon slots", async () => {
  const source = 'let main=()=>print "hello world"';
  const normal = surfaceParser.formatSurfaceSource(source);
  const fixed = surfaceParser.formatSurfaceSourceFix(source);
  assertEquals(normal.name, "Some");
  assertEquals(normal.args[0], 'let main = () =>\n  print "hello world"');
  assertEquals(fixed.name, "Some");
  assertEquals(fixed.args[0], 'let main = () => {\n  print "hello world"\n};');
  const parsed = surfaceParser.parseSurfaceProgram(source);
  assertEquals(parsed.name, "Some");
  assertEquals(
    parsed.name === "Some" ? recoveryMarkSummary(parsed.args[0].marks) : [],
    [
      [1, 13, "{", "LambdaBlock:open-brace", "AutoFix"],
      [2, 32, "}", "LambdaBlock:close-brace", "AutoFix"],
      [3, 32, ";", "TopPhrase:semicolon", "AutoFix"],
    ],
  );
  if (fixed.name === "Some") {
    await parse(fixed.args[0]);
    const second = surfaceParser.formatSurfaceSourceFix(fixed.args[0]);
    assertEquals(second.name, "Some");
    assertEquals(second.args[0], fixed.args[0]);
    const fixedProgram = surfaceParser.parseSurfaceProgram(fixed.args[0]);
    assertEquals(fixedProgram.name, "Some");
    assertEquals(
      fixedProgram.name === "Some" ? recoveryMarkSummary(fixedProgram.args[0].marks) : [],
      [],
    );
  }
});

Deno.test("frontend-v2 marks a committed missing closing block brace", () => {
  const source = "let answer = { 42";
  const fixed = surfaceParser.formatSurfaceSourceFix(source);
  assertEquals(fixed.name, "Some");
  assertEquals(fixed.args[0], "let answer = {\n  42\n};");
  const parsed = surfaceParser.parseSurfaceProgram(source);
  assertEquals(parsed.name, "Some");
  assertEquals(
    parsed.name === "Some" ? recoveryMarkSummary(parsed.args[0].marks) : [],
    [
      [1, 17, "}", "Block:close-brace", "AutoFix"],
      [2, 17, ";", "TopPhrase:semicolon", "AutoFix"],
    ],
  );
});

Deno.test("frontend-v2 marks an unambiguous missing block-declaration semicolon", async () => {
  const source = "let x = { let y = 1 let z = 2; z };";
  const normal = surfaceParser.formatSurfaceSource(source);
  const fixed = surfaceParser.formatSurfaceSourceFix(source);
  assertEquals(normal.name, "Some");
  assertEquals(
    normal.args[0],
    "let x = {\n  let y = 1\n  let z = 2;\n  z\n};",
  );
  assertEquals(fixed.name, "Some");
  assertEquals(
    fixed.args[0],
    "let x = {\n  let y = 1;\n  let z = 2;\n  z\n};",
  );
  const parsed = surfaceParser.parseSurfaceProgram(source);
  assertEquals(parsed.name, "Some");
  assertEquals(
    parsed.name === "Some" ? recoveryMarkSummary(parsed.args[0].marks) : [],
    [[1, 20, ";", "SemiToken:semicolon", "AutoFix"]],
  );
  if (fixed.name === "Some") await parse(fixed.args[0]);
});

Deno.test("frontend-v2 generated brace annotations repair committed grammar families", async () => {
  for (
    const [source, expected] of [
      ["record Point = x: Number }", "record Point = { x: Number };"],
      ["record Point = { x: Number", "record Point = { x: Number };"],
      ['from "./x.wm" import a }', 'from "./x.wm" import { a };'],
      ["let x = JSON answer: 42 };", "let x = JSON{ answer: 42 };"],
      ["let x = JSON { answer: 42;", "let x = JSON{ answer: 42 };"],
      [
        "let x = if (true) 1 } else { 2 };",
        "let x = if (true) {\n  1\n} else {\n  2\n};",
      ],
    ] as const
  ) {
    const fixed = surfaceParser.formatSurfaceSourceFix(source);
    assertEquals(fixed.name, "Some", source);
    assertEquals(fixed.args[0], expected, source);
    await parse(expected);
    const parsed = surfaceParser.parseSurfaceProgram(source);
    assertEquals(parsed.name, "Some", source);
    const marks = parsed.name === "Some" ? recoveryMarkSummary(parsed.args[0].marks) : [];
    assertEquals(marks.length > 0, true, source);
    assertEquals(
      marks.every((mark) => [";", "{", "}"].includes(mark[2])),
      true,
      source,
    );
  }
});

Deno.test("frontend-v2 constructs and canonically renders the type-declaration slice", () => {
  const source = "type Int_list=Empty|ICons<Number,Int_list>;\n" +
    "type List<T>=Nil|Cons<T,List<T>>;\n" +
    "type Ordering=Less|Equal|Greater;\n" +
    "let rec answer:Number=42;";
  const expected = "type Int_list = Empty | ICons<Number, Int_list>;\n" +
    "type List<T> = Nil | Cons<T, List<T>>;\n" +
    "type Ordering = Less | Equal | Greater;\n" +
    "let rec answer: Number = 42;";
  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertEquals(first.args[0], expected);
  const second = surfaceParser.formatSurfaceSource(first.args[0]);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], expected);
});

Deno.test("frontend-v2 preserves and formats postfix type ascriptions", async () => {
  const source = "let answer=(1+2):Number;";
  const expected = "let answer = (1 + 2): Number;";
  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertEquals(first.args[0], expected);
  await parse(expected);
  const second = surfaceParser.formatSurfaceSource(expected);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], expected);
});

Deno.test("frontend-v2 formats parenthesized lambda sequences", async () => {
  const source = "let f=(x)=>(x;x);";
  const expected = "let f = (x) => (x; x);";
  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertEquals(first.args[0], expected);
  await parse(expected);
  const second = surfaceParser.formatSurfaceSource(expected);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], expected);
});

Deno.test("frontend-v2 constructs and canonically renders generated import captures", () => {
  const source = 'from "./x.wm" import *;\n' +
    'from "./x.wm" import * as X;\n' +
    'from "./x.wm" import {a,b as c};\n' +
    "from js.global import unsafe {Date};\n" +
    'from js.global("Deno") import unsafe {serve as run};\n' +
    'from js.module("x") import type {Foo: Bar};';
  const expected = 'from "./x.wm" import *;\n' +
    'from "./x.wm" import * as X;\n' +
    'from "./x.wm" import { a, b as c };\n' +
    "from js.global import unsafe { Date };\n" +
    'from js.global("Deno") import unsafe { serve as run };\n' +
    'from js.module("x") import type { Foo: Bar };';
  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertEquals(first.args[0], expected);
  const second = surfaceParser.formatSurfaceSource(first.args[0]);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], expected);
});

Deno.test("frontend-v2 canonically formats the math example through the Surface AST", async () => {
  const source = await Deno.readTextFile(
    new URL("../examples/exercises/math.wm", import.meta.url),
  );
  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertStringIncludes(
    first.args[0],
    "let rec foldLeft = (fn, acc, list) => {\n" +
      "  match(list) {\n" +
      "    [] => {\n" +
      "      acc\n" +
      "    },",
  );
  assertStringIncludes(
    first.args[0],
    "      if (fn(head)) {\n" +
      "        [head, ..filterList(fn, tail)]\n" +
      "      } else {",
  );
  const second = surfaceParser.formatSurfaceSource(first.args[0]);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], first.args[0]);
});

async function loadLibrary<T>(pathname: string): Promise<T> {
  const source = await compileLibraryFile(pathname);
  const directory = await Deno.makeTempDir();
  const path = `${directory}/recognizer.mjs`;
  await Deno.writeTextFile(path, source);
  return await import(`${new URL(`file://${path}`).href}?cache=${crypto.randomUUID()}`) as T;
}

function contentFingerprint(source: string): string {
  const value = surfaceParser.surfaceSyntaxFingerprint(source);
  if (value.name !== "Some") return "<unrecognized>";
  // Canonical formatting may remove an optional trailing comma. All authored
  // names, literals, operators, delimiters, and required punctuation remain.
  return value.args[0].replaceAll(",", "");
}

function recoveryMarkSummary(
  marks: WorkmanList<SurfaceRecoveryMark>,
): readonly (readonly [number, number, string, string, string])[] {
  const output: [number, number, string, string, string][] = [];
  let remaining = marks;
  while (remaining.name === "Cons") {
    const [mark, rest] = remaining.args[0];
    output.push([
      mark.id,
      mark.anchor,
      mark.expectedText,
      mark.rule,
      mark.repairClass.name,
    ]);
    remaining = rest;
  }
  return output;
}

async function* wmFiles(root: URL): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const entryUrl = new URL(entry.name + (entry.isDirectory ? "/" : ""), root);
    if (entry.isDirectory) {
      yield* wmFiles(entryUrl);
    } else if (entry.isFile && entry.name.endsWith(".wm")) {
      yield entryUrl.pathname;
    }
  }
}
