import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import {
  FRONTEND_V2_SCHEMA_VERSION,
  type LexRoundTripResult,
  loadFrontendV2,
} from "../src/frontend_v2_loader.ts";

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
    "export const lexRoundTrip = () => ({ schemaVersion: 999 }); export const parseStructural = lexRoundTrip;",
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
  for await (const entry of Deno.readDir(root)) {
    const path = root.pathname + "/" + entry.name;
    if (entry.isDirectory) {
      yield* wmFiles(new URL(root.href + "/" + entry.name + "/"));
    } else if (entry.isFile && entry.name.endsWith(".wm")) {
      yield path;
    }
  }
}
