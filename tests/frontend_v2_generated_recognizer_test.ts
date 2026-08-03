import { assertEquals, assertStringIncludes } from "@std/assert";
import { emitRecognizer } from "../scripts/generate_frontend_v2_recognizer.ts";
import { parseWorkmanGrammar } from "../scripts/frontend_v2_grammar_ir.ts";
import { parseCompilerModule as parse } from "../src/compiler_frontend.ts";
import { decodeSurfaceProgram } from "../src/frontend_v2_surface_loader.ts";
import { surfaceProgramToModule } from "../src/frontend_v2_surface_semantic.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import {
  surfaceConstructorCount,
  surfaceRuleCoverage,
} from "../tooling/frontend-v2/generator/surface_schema.ts";
import {
  frontendV2SemanticGolden,
  hashFrontendSemanticWithSpans,
  repositoryWmPath,
} from "./frontend_v2_semantic_golden.ts";

const grammarPath = new URL("../src/grammar.peggy", import.meta.url);
const grammar = parseWorkmanGrammar(
  await Deno.readTextFile(grammarPath),
  "src/grammar.peggy",
);
const generatedDirectory = new URL("../tooling/frontend-v2/generated/", import.meta.url);

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

type SurfaceParseFailure = Readonly<{
  offset: number;
  expected: string;
  rule: string;
}>;

const packagedSurfaceParser = await import(
  new URL("../src/generated/frontend_v2_parser.js", import.meta.url).href
) as {
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
  parseSurfaceFailure(source: string): {
    name: "Some" | "None";
    args: readonly [SurfaceParseFailure];
  };
};

const surfaceParser = {
  ...packagedSurfaceParser,
  parsesSurfaceSyntax: (source: string) =>
    packagedSurfaceParser.parseSurfaceProgram(source).name === "Some",
};
const compiledProbe = {
  recognizeCompiled: surfaceParser.parsesSurfaceSyntax,
  parseCompiledCapture: (source: string) => surfaceParser.parseSurfaceProgram(source),
};

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
    classified: 128,
    missing: [],
    unknown: [],
    duplicates: [],
    missingBuilders: [],
    unknownConstructors: [],
  });
  assertEquals(surfaceConstructorCount() >= 70, true);
});

Deno.test("frontend-v2 lowers supported semantics from the generated Surface tree", async () => {
  const sources = [
    'from "./lib.wm" import { value as alias };\nlet x: Number = alias;',
    "let sum = 1 + 2 * 3;\nlet pair = (sum, true);",
    'let printer = (x: String) => { print x };\nlet main = () => { printer "ok" };',
    "let record = .{ x = 1, y, ..base };\nlet named = Point{ x = 1 };",
    'let list = [1, 2, ..tail];\nlet json = JSON{ x: 1, "y": true };',
    "let field = source :> .value;\nlet called = source :> .method(1);\nlet piped = x :> f;",
    "let picked = match(value) { Some(x) => { x }, None => { 0 }, };",
    "let head = match(items) { [x, ..xs] => { x }, [] => { 0 }, };",
    "type Pair<t> = (t, t);\ntype Option<t> = | None | Some<t>;",
    "record Point<t> = { x: t, y: t };",
    "let shader = () => { @gpu; 1 };",
    "let choose = match(left, right) => { (true, x) => { x }, (_, y) => { y }, };",
    'from js.global import unsafe { Date };\nfrom js.module("pkg") import type { Item: Js.Value };',
    'from js.worker("./worker.ts") import * as Worker;',
    "let taskPair = |first, second|;\nlet resultPair = Result |first, second|;",
  ];
  for (const source of sources) {
    const surface = decodeSurfaceProgram(surfaceParser.parseSurfaceProgram(source));
    if (!surface) {
      throw new Error(`generated Surface parser rejected parity-valid source: ${source}`);
    }
    const projected = surfaceProgramToModule(surface, source);
    assertEquals(projected.diagnostics, [], source);
    assertEquals(
      normalizeFrontendSemanticAst(projected.module),
      normalizeFrontendSemanticAst(await parse(source)),
      source,
    );
  }
});

Deno.test("frontend-v2 generated WM parser matches the semantic golden for every example", async () => {
  const root = new URL("../examples/", import.meta.url);
  const checked: string[] = [];
  let formatted = 0;
  for await (const path of wmFiles(root)) {
    const source = await Deno.readTextFile(path);
    const relative = repositoryWmPath(path);
    const expectedHash = frontendV2SemanticGolden.files[relative];
    if (expectedHash === undefined) throw new Error(`missing semantic golden for ${relative}`);
    const accepted = expectedHash !== null;
    assertEquals(compiledProbe.recognizeCompiled(source), accepted, relative);
    assertEquals(compiledProbe.parseCompiledCapture(source).name, accepted ? "Some" : "None");
    assertEquals(surfaceParser.parsesSurfaceSyntax(source), accepted, relative);
    const rawSurface = surfaceParser.parseSurfaceProgram(source);
    assertEquals(rawSurface.name, accepted ? "Some" : "None", relative);
    let sourceModule: Awaited<ReturnType<typeof parse>> | undefined;
    if (expectedHash !== null) {
      const surface = decodeSurfaceProgram(rawSurface);
      if (!surface) throw new Error(`missing generated Surface tree for ${relative}`);
      const semantic = surfaceProgramToModule(surface, source);
      assertEquals(semantic.diagnostics, [], relative);
      assertEquals(
        await hashFrontendSemanticWithSpans(semantic.module),
        expectedHash,
        relative,
      );
      sourceModule = semantic.module;
    }
    const first = surfaceParser.formatSurfaceSource(source);
    assertEquals(first.name, accepted ? "Some" : "None", relative);
    if (first.name === "Some") {
      const formattedModule = await parse(first.args[0]);
      assertEquals(
        normalizeFrontendSemanticAst(formattedModule),
        normalizeFrontendSemanticAst(sourceModule),
        relative,
      );
      const second = surfaceParser.formatSurfaceSource(first.args[0]);
      assertEquals(second.name, "Some", relative);
      assertEquals(second.args[0], first.args[0], relative);
      formatted += 1;
    }
    checked.push(relative);
  }
  const expectedExamples = Object.keys(frontendV2SemanticGolden.files)
    .filter((path) => path.startsWith("examples/"))
    .sort();
  assertEquals(checked.sort(), expectedExamples);
  assertEquals(
    formatted,
    expectedExamples.filter((path) => frontendV2SemanticGolden.files[path] !== null).length,
  );
});

Deno.test("frontend-v2 parses a deeply nested generated matcher module without overflowing", async () => {
  const path = new URL(
    "../tooling/frontend-v2/generated/compiled_probe_rules_03.wm",
    import.meta.url,
  );
  const source = await Deno.readTextFile(path);
  assertEquals(surfaceParser.parseSurfaceProgram(source).name, "Some");
});

Deno.test("frontend-v2 generated Surface semantics match the repository golden", async () => {
  const roots = [
    ["std", new URL("../std/", import.meta.url)],
    ["examples", new URL("../examples/", import.meta.url)],
    ["tooling", new URL("../tooling/", import.meta.url)],
  ] as const;
  const checked: string[] = [];
  const rejected: string[] = [];
  for (const [rootName, root] of roots) {
    let rootChecked = 0;
    for await (const path of wmFiles(root)) {
      const source = await Deno.readTextFile(path);
      const relative = repositoryWmPath(path);
      const expectedHash = frontendV2SemanticGolden.files[relative];
      if (expectedHash === undefined) throw new Error(`missing semantic golden for ${relative}`);
      if (expectedHash === null) rejected.push(relative);
      let rawSurface: ReturnType<typeof surfaceParser.parseSurfaceProgram>;
      try {
        rawSurface = surfaceParser.parseSurfaceProgram(source);
      } catch (error) {
        throw new Error(`generated Surface parser crashed for ${relative}`, { cause: error });
      }
      assertEquals(rawSurface.name, expectedHash === null ? "None" : "Some", relative);
      if (expectedHash !== null) {
        const surface = decodeSurfaceProgram(rawSurface);
        if (!surface) throw new Error(`missing generated Surface tree for ${relative}`);
        const semantic = surfaceProgramToModule(surface, source);
        assertEquals(semantic.diagnostics, [], relative);
        assertEquals(
          await hashFrontendSemanticWithSpans(semantic.module),
          expectedHash,
          relative,
        );
      } else {
        const failure = surfaceParser.parseSurfaceFailure(source);
        assertEquals(failure.name, "Some", relative);
        if (failure.name === "Some") {
          assertEquals(
            failure.args[0].offset >= 0 && failure.args[0].offset <= source.length,
            true,
            relative,
          );
          assertEquals(failure.args[0].expected.length > 0, true, relative);
          assertEquals(failure.args[0].rule.length > 0, true, relative);
        }
      }
      checked.push(relative);
      rootChecked += 1;
    }
    assertEquals(rootChecked > 0, true, `${rootName} corpus is empty`);
  }
  assertEquals(
    rejected,
    ["examples/exercises/tree.wm"],
  );
  assertEquals(checked.sort(), Object.keys(frontendV2SemanticGolden.files).sort());
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
    assertEquals(
      normalizeFrontendSemanticAst(await parse(formatted.args[0])),
      normalizeFrontendSemanticAst(await parse(source)),
      relative,
    );
  }
});

Deno.test("frontend-v2 preserves and canonicalizes both no-prelude directive spellings", async () => {
  for (
    const [source, directive] of [
      ["-- @no-prelude\nlet answer=42;", "-- @no-prelude"],
      ["\r\n  // @no-prelude \t\r\nlet answer=42;", "// @no-prelude"],
    ] as const
  ) {
    const expected = `${directive}\nlet answer = 42;`;
    const normal = surfaceParser.formatSurfaceSource(source);
    const fixed = surfaceParser.formatSurfaceSourceFix(source);
    assertEquals(normal.name, "Some", source);
    assertEquals(normal.args[0], expected, source);
    assertEquals(fixed.name, "Some", source);
    assertEquals(fixed.args[0], expected, source);

    const formattedModule = await parse(expected);
    assertEquals(formattedModule.prelude, "none", source);
    assertEquals(
      normalizeFrontendSemanticAst(formattedModule),
      normalizeFrontendSemanticAst(await parse(source)),
      source,
    );

    const normalAgain = surfaceParser.formatSurfaceSource(expected);
    const fixedAgain = surfaceParser.formatSurfaceSourceFix(expected);
    assertEquals(normalAgain.name, "Some", source);
    assertEquals(normalAgain.args[0], expected, source);
    assertEquals(fixedAgain.name, "Some", source);
    assertEquals(fixedAgain.args[0], expected, source);
  }

  const missingSemicolon = "// @no-prelude\nlet answer=42";
  const normal = surfaceParser.formatSurfaceSource(missingSemicolon);
  const fixed = surfaceParser.formatSurfaceSourceFix(missingSemicolon);
  assertEquals(normal.name, "Some");
  assertEquals(normal.args[0], "// @no-prelude\nlet answer = 42");
  assertEquals(fixed.name, "Some");
  assertEquals(fixed.args[0], "// @no-prelude\nlet answer = 42;");
  if (fixed.name === "Some") {
    assertEquals((await parse(fixed.args[0])).prelude, "none");
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

Deno.test("frontend-v2 reports a farthest generated failure for rejected syntax", () => {
  const invalid = surfaceParser.parseSurfaceFailure("let Ctor(Var(x)) = value;");
  assertEquals(invalid.name, "Some");
  assertEquals(invalid.name === "Some" ? invalid.args[0] : undefined, {
    offset: 9,
    expected: ")",
    rule: "LetPattern",
  });
  assertEquals(surfaceParser.parseSurfaceFailure("let x = 1;").name, "None");
});

Deno.test("frontend-v2 does not repair a missing expression as an empty block", () => {
  const source = "let value =;";
  assertEquals(surfaceParser.parseSurfaceProgram(source).name, "None");
  assertEquals(surfaceParser.formatSurfaceSourceFix(source).name, "None");
  const failure = surfaceParser.parseSurfaceFailure(source);
  assertEquals(failure.name, "Some");
  assertEquals(failure.name === "Some" ? failure.args[0] : undefined, {
    offset: 11,
    expected: "an expression",
    rule: "Expr",
  });
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

Deno.test("frontend-v2 formats the coordinated function-type arrow grammar", async () => {
  const source = [
    "let unary:Number->String=f;",
    "let tupled:(Number,String)->Bool=f;",
    "let chained:Number->String->Bool=f;",
    "let higher:(Number->String)->Bool=f;",
    "let nullary:Void->Bool=f;",
  ].join("");
  const expected = [
    "let unary: Number -> String = f;",
    "let tupled: (Number, String) -> Bool = f;",
    "let chained: Number -> String -> Bool = f;",
    "let higher: (Number -> String) -> Bool = f;",
    "let nullary: Void -> Bool = f;",
  ].join("\n");

  const parsed = await parse(expected);
  const annotations = parsed.decls.map((decl) =>
    decl.kind === "LetDecl" ? decl.bindings[0].annotation : undefined
  );
  assertEquals(annotations.map((type) => type?.kind), [
    "TFn",
    "TFn",
    "TFn",
    "TFn",
    "TFn",
  ]);
  assertEquals(annotations[2]?.kind === "TFn" ? annotations[2].result.kind : undefined, "TFn");
  assertEquals(
    annotations[3]?.kind === "TFn" ? annotations[3].params[0].kind : undefined,
    "TFn",
  );

  assertEquals(compiledProbe.recognizeCompiled(expected), true);
  assertEquals(surfaceParser.parsesSurfaceSyntax(expected), true);
  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertEquals(first.args[0], expected);
  const second = surfaceParser.formatSurfaceSource(expected);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], expected);

  for (
    const invalid of [
      "let bad: (Number) = value;",
      "let bad: (Number) -> String = value;",
      "let bad: (Number) => String = value;",
    ]
  ) {
    let compilerAccepted = true;
    try {
      await parse(invalid);
    } catch {
      compilerAccepted = false;
    }
    assertEquals(compilerAccepted, false, invalid);
    assertEquals(compiledProbe.recognizeCompiled(invalid), false, invalid);
    assertEquals(surfaceParser.parsesSurfaceSyntax(invalid), false, invalid);
  }
});

Deno.test("frontend-v2 preserves and formats postfix type ascriptions", async () => {
  const source = "let answer=(1+2):Number;";
  const expected = "let answer = (1 + 2) : Number;";
  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertEquals(first.args[0], expected);
  await parse(expected);
  const second = surfaceParser.formatSurfaceSource(expected);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], expected);
});

Deno.test("frontend-v2 preserves and formats general expression and pattern constraints", async () => {
  const source = "record Point={x:Number,y:Number};let point=(.{x=1,y=2}:Point);" +
    "type Option<T>=None|Some<T>;let get=(value:Option<Number>)=>{" +
    "match(value){(Some(x):Option<Number>)=>{x},None=>{0}}};" +
    "let (left,(right:Number))=(1,2);let add=((x:Number),y)=>{x+y};";
  const expected = [
    "record Point = { x: Number, y: Number };",
    "let point = (.{ x = 1, y = 2 } : Point);",
    "type Option<T> = None | Some<T>;",
    "let get = (value: Option<Number>) => {",
    "  match(value) {",
    "    (Some(x) : Option<Number>) => {",
    "      x",
    "    },",
    "    None => {",
    "      0",
    "    }",
    "  }",
    "};",
    "let (left, (right : Number)) = (1, 2);",
    "let add = ((x : Number), y) => {",
    "  x + y",
    "};",
  ].join("\n");

  const parsed = await parse(expected);
  const get = parsed.decls[3];
  const lambda = get.kind === "LetDecl" ? get.bindings[0].value : undefined;
  const match = lambda?.kind === "Lambda" && lambda.body.kind === "Block"
    ? lambda.body.result
    : undefined;
  assertEquals(match?.kind === "Match" ? match.arms[0].pattern.kind : undefined, "PAscribed");
  assertEquals(compiledProbe.recognizeCompiled(expected), true);
  assertEquals(surfaceParser.parsesSurfaceSyntax(expected), true);

  const first = surfaceParser.formatSurfaceSource(source);
  assertEquals(first.name, "Some");
  assertEquals(first.args[0], expected);
  const second = surfaceParser.formatSurfaceSource(expected);
  assertEquals(second.name, "Some");
  assertEquals(second.args[0], expected);
});

Deno.test("frontend-v2 formats explicit nominal record expressions", async () => {
  const source =
    'record User={name:String,active:Bool};let name="Ada";let user=User{name,..User{name="Grace",active=false},active=true};';
  const expected =
    'record User = { name: String, active: Bool };\nlet name = "Ada";\nlet user = User{ name, ..User{ name = "Grace", active = false }, active = true };';
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

Deno.test("frontend-v2 formats lightweight chained curried lambdas", async () => {
  const source = "let add3=(a)=>(b)=>(c)=>{a+b+c};";
  const expected = "let add3 = (a) => (b) => (c) => {\n  a + b + c\n};";
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
