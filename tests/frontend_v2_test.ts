import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { fileURLToPath } from "node:url";
import { compileLibraryFile } from "../src/compiler.ts";
import {
  FRONTEND_V2_SCHEMA_VERSION,
  type LexRoundTripResult,
  loadFrontendV2,
} from "../src/frontend_v2_loader.ts";
import { compareSupportedFrontendSemantics } from "../src/frontend_v2_compare.ts";
import { semanticProjectionToModule } from "../src/frontend_v2_semantic.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const generatedFrontend = await buildFrontend();

Deno.test("frontend-v2 generated library exposes the schema-versioned lexer ABI", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const source = 'from "x" import { A as b }; let value: Number = 12.5 ++ "x"; // c\n@';
  const result = frontend.lexRoundTrip(source);

  assertEquals(result.schemaVersion, FRONTEND_V2_SCHEMA_VERSION);
  assertEquals(result.rendered, source);
  assertEquals(
    result.tokens.filter((token) => token.kind !== "whitespace").map((token) => token.kind),
    [
      "keyword",
      "string",
      "keyword",
      "punctuation",
      "constructor",
      "keyword",
      "identifier",
      "punctuation",
      "semicolon",
      "let",
      "identifier",
      "punctuation",
      "constructor",
      "equals",
      "number",
      "operator",
      "string",
      "semicolon",
      "comment",
      "opaque",
      "eof",
    ],
  );
  assertConcreteCoverage(source, result);
});

Deno.test("frontend-v2 offsets and line starts use UTF-16 code units", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const source = "let 🚀 = e\u0301;\r\n// next\rfinal";
  const result = frontend.lexRoundTrip(source);
  const rocket = result.tokens.find((token) => token.text === "🚀");

  assertEquals(result.sourceLength, source.length);
  assertEquals(rocket, {
    kind: "opaque",
    text: "🚀",
    start: 4,
    end: 6,
    origin: "concrete",
  });
  assertEquals(result.lineStarts, [0, 14, 22]);
  assertConcreteCoverage(source, result);
});

Deno.test("frontend-v2 losslessly handles newline and malformed lexical edge cases", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const fixtures = [
    "",
    "\n",
    "\r",
    "\r\n",
    "no final newline",
    '"unterminated',
    String.fromCharCode(96) + "multiline\ntext",
    "-- comment\r\nlet x=1;",
    "// comment\nlet x = @;",
    "\uD800",
    "👩‍💻",
  ];

  for (const source of fixtures) {
    const result = frontend.lexRoundTrip(source);
    assertEquals(result.rendered, source);
    assertConcreteCoverage(source, result);
  }
});

Deno.test("frontend-v2 round-trips the repository WM corpus", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const roots = [
    new URL("../std", import.meta.url),
    new URL("../examples", import.meta.url),
    new URL("../tooling", import.meta.url),
  ];
  let checked = 0;

  for (const root of roots) {
    for await (const path of wmFiles(root)) {
      const source = await Deno.readTextFile(path);
      const result = frontend.lexRoundTrip(source);
      assertEquals(result.rendered, source, path);
      assertConcreteCoverage(source, result);
      checked += 1;
    }
  }

  if (checked < 20) throw new Error("expected a WM corpus, checked only " + checked + " files");
});

Deno.test("frontend-v2 bounded generated strings retain every UTF-16 code unit", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const alphabet = [
    "a",
    "Z",
    "0",
    " ",
    "\t",
    "\n",
    "\r",
    "-",
    "/",
    '"',
    String.fromCharCode(96),
    "@",
    "🚀",
    "\u0301",
  ];
  let seed = 0x5eed;

  for (let sample = 0; sample < 100; sample += 1) {
    let source = "";
    const length = sample % 31;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      source += alphabet[seed % alphabet.length];
    }
    const result = frontend.lexRoundTrip(source);
    assertEquals(result.rendered, source);
    assertConcreteCoverage(source, result);
  }
});

Deno.test("frontend-v2 loader rejects incompatible generated artifacts", async () => {
  const dir = await Deno.makeTempDir();
  const missing = dir + "/missing.mjs";
  const incompatible = dir + "/incompatible.mjs";
  await Deno.writeTextFile(missing, "export const other = 1;");
  await Deno.writeTextFile(
    incompatible,
    "export const lexRoundTrip = () => ({ schemaVersion: 999 }); export const parseStructural = lexRoundTrip; export const projectSemantic = lexRoundTrip;",
  );

  await assertRejects(
    () => loadFrontendV2(new URL("file://" + missing)),
    Error,
    "does not export lexRoundTrip",
  );
  const frontend = await loadFrontendV2(new URL("file://" + incompatible));
  assertThrows(
    () => frontend.lexRoundTrip(""),
    Error,
    "unsupported frontend-v2 schema version 999",
  );
});

Deno.test("frontend-v2 exposes schema-versioned semantic projection provenance", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const source = "let complete: Number = one;\nlet recovered =;\nlet authored = ?;\n@";
  const result = frontend.projectSemantic(source);

  assertEquals(result.schemaVersion, FRONTEND_V2_SCHEMA_VERSION);
  assertEquals(result.moduleKind, "Module");
  assertEquals(result.sourceLength, source.length);
  assertEquals(
    result.decls.map((decl) => [
      decl.structuralKind,
      decl.semanticKind,
      decl.status,
      decl.recursive,
      decl.patternKind,
      decl.annotationText,
      decl.expressionKind,
      decl.authoredExpressionHole,
    ]),
    [
      ["let", "LetDecl", "complete", false, "name", " Number", "atom", false],
      ["let", "LetDecl", "recovered", false, "name", "", "hole", false],
      ["let", "LetDecl", "complete", false, "name", "", "authored-hole", true],
      ["opaque", "ErrorDecl", "opaque", false, "", "", "", false],
    ],
  );
  assertEquals(result.decls[1].expressionRecoveryId > 0, true);
  assertEquals(result.decls[1].patternText, "recovered");
  assertEquals(result.decls[1].expressionText, "");
  assertEquals(result.decls[2].patternText, "authored");
  assertEquals(result.decls[2].expressionText, "?");
  assertEquals(result.decls[3].recoveryId > 0, true);
});

Deno.test("frontend-v2 projects complete simple let declarations into Module shape", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const projection = frontend.projectSemantic(
    'let alias: Number = source;\nlet tupled: (Number, value) = source;\nlet fnTyped: (Number, value) => Result<String, value> = source;\nlet variable: value = source;\nlet nested: Result<String, List<value>> = source;\nlet rec self = self;\nlet _ = 99;\nlet Some = value;\nlet true = flag;\nlet 1 = one;\nlet "tag" = tagged;\nlet void = emptyValue;\nlet count = 42;\nlet ratio = 1.5;\nlet label = "ok";\nlet enabled = true;\nlet empty = void;\nlet first = one and second = two;\nlet recovered =;',
  );
  const result = semanticProjectionToModule(projection);

  assertEquals(result.module, {
    kind: "Module",
    decls: [
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "alias" },
          annotation: { kind: "TName", name: "Number", args: [] },
          value: { kind: "Var", name: "source" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "tupled" },
          annotation: {
            kind: "TTuple",
            items: [
              { kind: "TName", name: "Number", args: [] },
              { kind: "TVar", name: "value" },
            ],
          },
          value: { kind: "Var", name: "source" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "fnTyped" },
          annotation: {
            kind: "TFn",
            params: [
              { kind: "TName", name: "Number", args: [] },
              { kind: "TVar", name: "value" },
            ],
            result: {
              kind: "TName",
              name: "Result",
              args: [
                { kind: "TName", name: "String", args: [] },
                { kind: "TVar", name: "value" },
              ],
            },
          },
          value: { kind: "Var", name: "source" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "variable" },
          annotation: { kind: "TVar", name: "value" },
          value: { kind: "Var", name: "source" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "nested" },
          annotation: {
            kind: "TName",
            name: "Result",
            args: [
              { kind: "TName", name: "String", args: [] },
              {
                kind: "TName",
                name: "List",
                args: [{ kind: "TVar", name: "value" }],
              },
            ],
          },
          value: { kind: "Var", name: "source" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: true,
        bindings: [{
          pattern: { kind: "PVar", name: "self" },
          value: { kind: "Var", name: "self" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{ pattern: { kind: "PWildcard" }, value: { kind: "Int", value: 99 } }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PCtor", name: "Some", args: [] },
          value: { kind: "Var", name: "value" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PBool", value: true },
          value: { kind: "Var", name: "flag" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{ pattern: { kind: "PInt", value: 1 }, value: { kind: "Var", name: "one" } }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PString", value: "tag" },
          value: { kind: "Var", name: "tagged" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{ pattern: { kind: "PVoid" }, value: { kind: "Var", name: "emptyValue" } }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{ pattern: { kind: "PVar", name: "count" }, value: { kind: "Int", value: 42 } }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "ratio" },
          value: { kind: "Float", value: 1.5 },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "label" },
          value: { kind: "String", value: "ok" },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{
          pattern: { kind: "PVar", name: "enabled" },
          value: { kind: "Bool", value: true },
        }],
      },
      {
        kind: "LetDecl",
        exported: true,
        recursive: false,
        bindings: [{ pattern: { kind: "PVar", name: "empty" }, value: { kind: "Void" } }],
      },
    ],
  });
  assertEquals(result.diagnostics, [
    {
      code: "frontend-v2.unsupported-decl",
      structuralId: projection.decls[17].structuralId,
      message:
        'frontend-v2 semantic adapter does not yet project let (pattern=name, expression=atom "one")',
    },
    {
      code: "frontend-v2.recovered-decl",
      structuralId: projection.decls[18].structuralId,
      message: "cannot project let declaration with recovered status",
    },
  ]);
});

Deno.test("frontend-v2 semantic adapter anchors repeated RHS text after binding equals", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const source = "let value: Number = value;";
  const result = semanticProjectionToModule(frontend.projectSemantic(source), { source });
  const binding = result.module.decls[0].kind === "LetDecl"
    ? result.module.decls[0].bindings[0]
    : undefined;

  assertEquals(binding?.pattern.node?.span, { line: 1, col: 4, start: 4, end: 9 });
  assertEquals(binding?.value.node?.span, { line: 1, col: 20, start: 20, end: 25 });
  assertEquals(binding?.node?.span, { line: 1, col: 4, start: 4, end: 25 });
});

Deno.test("frontend-v2 semantic projection matches Peggy on supported valid sources", async () => {
  const frontend = await loadFrontendV2(generatedFrontend);
  const corpus = [
    'from "./lib.wm" import { value };',
    'from "./lib.wm" import { value as alias };',
    'from "./lib.wm" import { first, second as renamed };\nlet x = renamed;',
    "let alias = source;",
    "let typed: Number = source;",
    "let variable: value = source;",
    "let qualified: Js.Value = source;",
    "let nested: Result<String, List<value>> = source;",
    "let tupled: (Number, value) = source;",
    "let fnTyped: (Number, value) => Result<String, value> = source;",
    "let rec self = self;",
    "let _ = 99;",
    "let Some = value;",
    "let true = flag;",
    "let 1 = one;",
    'let "tag" = tagged;',
    "let void = emptyValue;",
    "let count = 42;",
    "let ratio = 1.5;",
    'let label = "ok";',
    "let enabled = true;",
    "let disabled = false;",
    "let empty = void;",
    "let first = one;\nlet second = 2;",
  ];

  for (const source of corpus) {
    const comparison = await compareSupportedFrontendSemantics(source, frontend);
    assertEquals(comparison.diagnostics, [], source);
    assertEquals(comparison.equivalent, true, source);
    assertEquals(comparison.v2, comparison.v1, source);
  }
});

function assertConcreteCoverage(source: string, result: LexRoundTripResult): void {
  let cursor = 0;
  for (const token of result.tokens) {
    assertEquals(token.origin, "concrete");
    assertEquals(token.start, cursor);
    assertEquals(token.text, source.slice(token.start, token.end));
    cursor = token.end;
  }
  assertEquals(cursor, source.length);
  assertEquals(result.tokens.at(-1)?.kind, "eof");
  assertEquals(result.tokens.at(-1)?.start, source.length);
}

async function buildFrontend(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  const source = await compileLibraryFile(frontendSource);
  assertStringIncludes(source, "lexRoundTrip");
  await Deno.writeTextFile(output, source);
  return new URL("file://" + output);
}

async function* wmFiles(root: URL): AsyncGenerator<string> {
  const directory = new URL(root.href.endsWith("/") ? root.href : root.href + "/");
  for await (const entry of Deno.readDir(root)) {
    const entryUrl = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) {
      yield* wmFiles(entryUrl);
    } else if (entry.isFile && entry.name.endsWith(".wm")) {
      yield fileURLToPath(entryUrl);
    }
  }
}
