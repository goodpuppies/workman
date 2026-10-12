import { assert, assertEquals } from "@std/assert";
import peggy from "peggy";
import { compileLibraryFile } from "../src/compiler.ts";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Focused type-slice contracts, not a full compiler suite.
const repository = fileURLToPath(new URL("../", import.meta.url));
const build = await new Deno.Command("python3", {
  args: [join(repository, "scripts/build_frontend_v3_native.py"), "--type-driver", ...Deno.args],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!build.success) throw new Error(new TextDecoder().decode(build.stderr));
const output = dirname(new TextDecoder().decode(build.stdout).trim().split("\n").at(-1)!);
// This bridge always uses the vendored WM runtime adapters, not staged native checker modules.
const frontend = "./" + relative(output, join(repository, "tooling/frontend-v3"));
const bridge = join(output, "type-parity.wm");
await Deno.writeTextFile(
  bridge,
  `
from "${frontend}/src/lexer/lexer.wm" import * as Lexer;
from "${frontend}/src/parser/type.wm" import * as Types;
from "${frontend}/adapters/portable/type_document.wm" import * as Document;
from "${frontend}/adapters/portable/document.wm" import * as Lexical;
from "${frontend}/lib/subsetml/subset_utf16_source.wm" import * as Text;
from "${frontend}/lib/subsetml/subset_result.wm" import * as R;
let source = (text: String) => {
  match(Text.fromNativeUnits(text)) {
    R.Ok(source) => {source},
    R.Err(_) => {Panic("unreachable")} // JS strings contain only 16-bit source units.
  }
};
let snapshot = (text) => {
  let input = source(text);
  Document.encode(Types.parseComplete(input, Lexer.lex(input)))
};
let lexicalSnapshot = (text) => {Lexical.encode(Lexer.lex(source(text)))};
`,
);
const module = join(output, "type-parity.mjs");
await Deno.writeTextFile(module, await compileLibraryFile(bridge));
const { snapshot, lexicalSnapshot } = await import(`file://${module}`);
const grammar = peggy.generate(
  await Deno.readTextFile(join(repository, "src/grammar.peggy")) +
    "\nFrontendV3TypeProbe = _ t:TypeExpr _ { return t; }\n",
  { allowedStartRules: ["FrontendV3TypeProbe"] },
);

const valid = [
  "a",
  "A",
  "_",
  "a'",
  "A'",
  "letter",
  "let'",
  "Let",
  "Result.Item",
  "One.Two.Three",
  "List<A>",
  "Map<A, B>",
  "Map<A, B,>",
  "A -> B -> C",
  "(A -> B)",
  "(A, B)",
  "(A,)",
  "(A, B,)",
  "(A, B) -> C",
  "(A,) -> C",
  "(A, B,) -> C",
  "((A -> B) -> C)",
  "List<(A, B)>",
  "List<(A -> B)>",
  "Pair<List<A>, B -> C>",
  "List<List<List<a>>>",
  "(A, B -> C) -> (D, E)",
  " /* leading */ Map<A, // item\n B> /* trailing */ ",
  "A\r\n -> B",
  "((A, B) -> C) -> D",
];
const invalid = [
  "A .B",
  "A. B",
  "A . B",
  "List <A>",
  "A/* comment */.B",
  "List/* comment */<A>",
  "",
  "()",
  "(A)",
  "((A, B))",
  "((A -> B))",
  "List<>",
  "a<B>",
  "A.b",
  "A.",
  ".",
  "?",
  "A B",
  "A ->",
  "List<A,,B>",
  "(A,,B)",
  "(A;B)",
  "(A -> B]",
  "List<A)",
  "A<",
  "(A)",
  "List<a.b>",
  "A -> ()",
  ...[
    "from",
    "import",
    "as",
    "let",
    "rec",
    "and",
    "type",
    "record",
    "if",
    "else",
    "match",
    "true",
    "false",
    "void",
  ],
];
// Each expectation is [missing closer kind, anchor]. No other insertion policy is assumed.
const recovered: [string, [string, number][]][] = [
  ["List<A", [["GreaterThan", 6]]],
  ["List<A,", [["GreaterThan", 7]]],
  ["(A -> B", [["RightParen", 7]]],
  ["(A,B", [["RightParen", 4]]],
  ["List<(A -> B>", [["RightParen", 12]]],
  ["List<List<A", [["GreaterThan", 11], ["GreaterThan", 11]]],
  ["List<(A -> B", [["RightParen", 12], ["GreaterThan", 12]]],
  ["(A, List<B)", [["GreaterThan", 10]]],
  ["((A -> B) -> C", [["RightParen", 14]]],
  ["List<A   ", [["GreaterThan", 9]]],
];

// Independently inspect token ownership, IDs, slot references and mark preservation.
function inspect(tree: any, lexical: any, text: string) {
  const state = tree[2];
  const authored: any[] = [], nodes: number[] = [], delimiters: number[] = [], missing: any[] = [];
  const kinds = new Set([
    "TypeVariable",
    "TypeName",
    "TypeTuple",
    "TypeFunction",
    "TypeParenthesized",
  ]);
  function walk(value: any) {
    if (!Array.isArray(value)) return;
    if (
      value.length === 5 && Array.isArray(value[0]) && Array.isArray(value[1]) &&
      value[1].length === 2 &&
      value[1].every((p: any) =>
        Array.isArray(p) && p.length === 3 && p.every((n: any) => typeof n === "number")
      )
    ) {
      authored.push(value);
      return;
    }
    if (kinds.has(value[0])) {
      nodes.push(value[1][0]);
      assert(value[1][1][0] <= value[1][1][1] && value[1][1][1] <= text.length);
    }
    if (
      value.length === 4 && typeof value[0] === "number" &&
      ["AuthoredSlot", "MissingSlot"].includes(value[1]?.[0]) &&
      ["AuthoredSlot", "MissingSlot"].includes(value[3]?.[0])
    ) delimiters.push(value[0]);
    if (value[0] === "MissingSlot") missing.push(value);
    for (const item of value) walk(item);
  }
  walk(tree[1]);
  authored.sort((a, b) => a[1][0][0] - b[1][0][0]);
  assertEquals(authored, lexical[0].slice(0, -1), `authored token ownership: ${text}`);
  assertEquals(state[1], lexical[0].slice(-1)); // EOF retains trailing trivia.
  assertEquals(state[0], lexical[0].length - 1);
  assertEquals(nodes.sort((a, b) => a - b), Array.from({ length: state[4] }, (_, i) => i));
  assertEquals(delimiters.sort((a, b) => a - b), Array.from({ length: state[5] }, (_, i) => i));
  const marks = state[2];
  assertEquals(
    marks.filter((m: any) => m[0] === "LexicalSurfaceMark").map((m: any) => m[1]),
    lexical[1],
  );
  assertEquals(marks.map((m: any) => m[1][0]), Array.from({ length: state[3] }, (_, i) => i));
  const syntax = marks.filter((m: any) => m[0] === "SyntaxSurfaceMark").map((m: any) => m[1]);
  assertEquals(missing.length, syntax.length);
  for (const slot of missing) {
    const mark = syntax.find((m: any) => m[0] === slot[1]);
    assert(mark);
    assertEquals(mark[1], ["MissingToken", slot[2]]);
    assertEquals(mark[2], ["RecoveredWith", ["InsertedToken", slot[2]]]);
    assertEquals(mark[4], [mark[3], mark[3]]);
    assertEquals(mark[5], null); // Proximity alone does not establish a cause.
  }
  return syntax.map((m: any) => [m[1][1][1][1][0], m[3]]);
}

async function check(text: string) {
  const wm = JSON.parse(snapshot(text));
  const raw = new Uint8Array(text.length * 2);
  const view = new DataView(raw.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  const path = join(output, "type-input.bin");
  await Deno.writeFile(path, raw);
  const result = await new Deno.Command(join(output, "native-type"), {
    args: ["--utf16le", path],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(result.success, new TextDecoder().decode(result.stderr));
  assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), wm, `native parity: ${text}`);
  return wm;
}
// Compare type structure independently of surface punctuation and IDs. The legacy
// params array represents the components of a tuple domain, not a distinct SML type.
function referenceType(value: any): any {
  switch (value.kind) {
    case "TVar":
      return ["Variable", value.name];
    case "TName":
      return ["Name", value.name, value.args.map(referenceType)];
    case "TTuple":
      return ["Tuple", value.items.map(referenceType)];
    case "TFn": {
      const args = value.params.map(referenceType);
      return ["Arrow", args.length === 1 ? args[0] : ["Tuple", args], referenceType(value.result)];
    }
    default:
      throw new Error(`Unexpected reference type ${value.kind}`);
  }
}
function surfaceType(value: any, text: string): any {
  const spelling = (token: any) => text.slice(token[1][0][0], token[1][1][0]);
  switch (value[0]) {
    case "TypeVariable":
      return ["Variable", spelling(value[2])];
    case "TypeName": {
      const name = [...value[2][0], value[2][2]].map(spelling).join(".");
      const args = value[3] === null
        ? []
        : value[3][2][0].map((item: any) => surfaceType(item, text));
      return ["Name", name, args];
    }
    case "TypeTuple":
      return ["Tuple", value[2][2][0].map((item: any) => surfaceType(item, text))];
    case "TypeParenthesized":
      return surfaceType(value[2][2], text);
    case "TypeFunction": {
      let domain = surfaceType(value[2], text);
      // Current WM accepts a comma after a single domain item: (A,) -> B.
      // Its semantic parser stores that as the single A domain, retaining no comma.
      if (value[2][0] === "TypeTuple" && domain[1].length === 1) domain = domain[1][0];
      return ["Arrow", domain, surfaceType(value[4], text)];
    }
    default:
      throw new Error(`Unexpected surface type ${value[0]}`);
  }
}
for (const text of valid) {
  const reference = grammar.parse(text);
  const tree = await check(text);
  assertEquals(tree[0], "Parsed", text);
  assertEquals(surfaceType(tree[1], text), referenceType(reference), `type structure: ${text}`);
  assertEquals(inspect(tree, JSON.parse(lexicalSnapshot(text)), text), []);
}
for (const text of invalid) {
  let rejected = false;
  try {
    grammar.parse(text);
  } catch {
    rejected = true;
  }
  assert(rejected, `reference grammar unexpectedly accepts ${text}`);
  assertEquals((await check(text))[0], "Rejected", text);
}
for (const [text, expected] of recovered) {
  const tree = await check(text);
  assertEquals(tree[0], "Parsed", text);
  assertEquals(inspect(tree, JSON.parse(lexicalSnapshot(text)), text), expected);
}
// Damaged trailing trivia remains lexical evidence, independent of grammatical completion.
const damagedTrivia = "List<A> /*";
const tree = await check(damagedTrivia);
assertEquals(tree[0], "Parsed");
assertEquals(inspect(tree, JSON.parse(lexicalSnapshot(damagedTrivia)), damagedTrivia), []);
console.log(
  `Type parser: ${valid.length} valid, ${invalid.length} rejected, ${recovered.length} missing-closer cases and damaged trivia passed WM/native checks`,
);
