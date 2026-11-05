import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compile } from "../src/compiler.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { hoverAt } from "../src/lsp/hover.ts";
import { renameAt } from "../src/lsp/rename.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { show } from "../src/types.ts";
import { expectBinding } from "./type_helpers.ts";

const records = `
  record Inner = { n: Number, label: String };
  record Outer = { did: String, inner: Inner, add: Number -> Number };
  let make = (did: String) => {
    Outer(did, Inner(1, "one"), (n) => { n + 1 })
  };
`;

async function runProgram(source: string): Promise<string> {
  const js = await compile(source);
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, js);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(new TextDecoder().decode(output.stderr), "");
    return new TextDecoder().decode(output.stdout);
  } finally {
    await Deno.remove(path);
  }
}

Deno.test("a field can be read from any expression without a binding", async () => {
  const result = await checkSource(`
    ${records}
    let call = make("a").did;
    let grouped = (make("b")).did;
    let chained = make("c").inner.n;
    let groupedChain = (make("d").inner).label;
    let inOperand = make("f").inner.n + 1;
  `);
  expectBinding(result.env, "call", { type: "String", vars: 0 });
  expectBinding(result.env, "grouped", { type: "String", vars: 0 });
  expectBinding(result.env, "chained", { type: "Number", vars: 0 });
  expectBinding(result.env, "groupedChain", { type: "String", vars: 0 });
  expectBinding(result.env, "inOperand", { type: "Number", vars: 0 });
});

Deno.test("a field holding a function can be called", async () => {
  const result = await checkSource(`
    ${records}
    let called = make("a").add(1);
  `);
  expectBinding(result.env, "called", { type: "Number", vars: 0 });
});

const paged = `
  ${records}
  let page = (did: String, n: Number) => {
    print("page " ++ did);
    Outer(did, Inner(n, "label"), (m) => { m + n })
  };
  let same = (n: Number) => { n };
`;

Deno.test("a pipe goes into the first call of a field access", async () => {
  const result = await checkSource(`
    ${paged}
    let field = "a" :> page(1).did;
    let chain = "a" :> page(1).inner.n;
    let called = "a" :> page(1).add(2);
    let staged = "a" :> page(1).inner.n :> same;
    let placeholder = "a" :> page(_, 1).did;
  `);
  expectBinding(result.env, "field", { type: "String!", vars: 0 });
  expectBinding(result.env, "chain", { type: "Number!", vars: 0 });
  expectBinding(result.env, "called", { type: "Number!", vars: 0 });
  expectBinding(result.env, "staged", { type: "Number!", vars: 0 });
  expectBinding(result.env, "placeholder", { type: "String!", vars: 0 });
});

Deno.test("parentheses make a piped field access a value", async () => {
  const result = await checkSource(`
    ${paged}
    let groupedReceiver = 1 :> (make("a")).add;
    let groupedWhole = 1 :> (make("a").add);
  `);
  expectBinding(result.env, "groupedReceiver", { type: "Number", vars: 0 });
  expectBinding(result.env, "groupedWhole", { type: "Number", vars: 0 });
});

Deno.test("a piped field access runs the pipeline once, in order", async () => {
  const output = await runProgram(`
    ${paged}
    let main = () => {
      let input = (did: String) => { print("input " ++ did); did };
      print(input("a") :> page(5).did);
      print(input("b") :> page(5).add(1));
      print(input("c") :> page(5).inner.n :> same);
      print(7 :> (make("d").add));
    };
  `);
  assertEquals(
    output,
    "input a\npage a\na\ninput b\npage b\n6\ninput c\npage c\n5\n8\n",
  );
});

Deno.test("a numeric literal can't take a field", async () => {
  for (const source of ["let bad = 4.E5;", "let bad = 3.14.x;", "let bad = 0x2a.x;"]) {
    await assertRejects(() => checkSource(source), Error);
  }
});

Deno.test("field access evaluates its receiver once and reads the field", async () => {
  const output = await runProgram(`
    ${records}
    let main = () => {
      let traced = (did: String) => { print("made " ++ did); make(did) };
      print(traced("a").did);
      print(traced("b").inner.n);
      print(traced("c").add(41));
    };
  `);
  assertEquals(output, "made a\na\nmade b\n1\nmade c\n42\n");
});

Deno.test("nested field accesses keep their own receivers", async () => {
  const output = await runProgram(`
    ${records}
    let main = () => {
      print(make(make("inner").did).did);
      print(make(make("x").inner.label).inner.n);
    };
  `);
  assertEquals(output, "inner\n1\n");
});

Deno.test("field access means the same as reading the field from a let", async () => {
  const result = await checkSource(`
    ${records}
    from js.global("JSON") import unsafe { parse: String -> Js.Object } as JSON;
    let recordField = make("a").inner;
    let recordLet = { let value = make("a"); value.inner };
    let jsField = (text: String) => { JSON.parse(text).did };
    let jsLet = (text: String) => { let value = JSON.parse(text); value.did };
  `);
  for (
    const [field, viaLet] of [
      ["recordField", "recordLet"],
      ["jsField", "jsLet"],
    ]
  ) {
    assertEquals(show(result.env.get(field)!.type), show(result.env.get(viaLet)!.type), field);
  }
});

Deno.test("field access keeps a dropped-effect taint", async () => {
  const result = await checkSource(`
    ${records}
    from js.global("JSON") import unsafe { parse: String -> Js.Object } as JSON;
    let tainted = (did: String) => { let _ = JSON.parse("1"); make(did) };
    let viaField = tainted("a").did;
    let viaLet = { let value = tainted("a"); value.did };
  `);
  assertEquals(show(result.env.get("viaField")!.type), show(result.env.get("viaLet")!.type));
});

Deno.test("a field access on a primitive follows the same rule as a let", async () => {
  for (const access of ["(1 + 2).did", "{ let value = 1 + 2; value.did }"]) {
    await checkSource(`let read = ${access};`);
    await assertRejects(
      () => checkSource(`record Named = { did: String }; let read = ${access};`),
      Error,
      "requires a nominal record, got Number",
    );
  }
});

Deno.test("a missing field is rejected and names the field, not a compiler binding", async () => {
  const error = await assertRejects(
    () => checkSource(`${records} let bad = make("a").missing;`),
    Error,
  );
  assertStringIncludes(error.message, "missing");
  assertEquals(error.message.includes("$wm_"), false);
});

Deno.test("names and space calls keep their existing meaning", async () => {
  const result = await checkSource(`
    ${records}
    let value = make("a");
    let same = (n: Number) => { n };
    let spaced = same value.inner.n;
    let qualified = value.inner.n;
  `);
  expectBinding(result.env, "spaced", { type: "Number", vars: 0 });
  expectBinding(result.env, "qualified", { type: "Number", vars: 0 });
});

Deno.test("an ascribed expression still can't be projected", async () => {
  await assertRejects(
    () => checkSource(`${records} let bad = make("a"): Outer.did;`),
    Error,
  );
});

Deno.test("the formatter keeps field access", async () => {
  const source = `let a = make("x").did;
let b = (make("y")).inner.n;
let c = make("z").add(1);`;
  assertEquals(await formatFrontendV2Source(source), source);
});

const editorSource = `record Inner = { n: Number };
record Outer = { did: String, inner: Inner };
let make = (did: String) => { Outer(did, Inner(1)) };
let plain = make("a");
let viaName = plain.did;
let viaCall = make("a").did;
let viaChain = make("a").inner.n;`;

function positionOf(needle: string, offset: number) {
  const index = editorSource.indexOf(needle) + offset;
  const lines = editorSource.slice(0, index).split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

async function editorFile(): Promise<string> {
  const path = `${await Deno.makeTempDir()}/main.wm`;
  await Deno.writeTextFile(path, editorSource);
  return pathToFileUri(path);
}

Deno.test("hover on a field access shows the field, not a compiler binding", async () => {
  const uri = await editorFile();
  const cases: [string, number, string][] = [
    ['make("a").did', 'make("a").'.length, ".did: String"],
    ['make("a").inner.n', 'make("a").'.length, ".inner: Inner"],
    ['make("a").inner.n', 'make("a").inner.'.length, ".n: Number"],
  ];
  for (const [needle, offset, expected] of cases) {
    const hover = await hoverAt(uri, positionOf(needle, offset), new Map());
    assertEquals(hover?.contents.value, `\`\`\`wm\n${expected}\n\`\`\``);
  }
});

Deno.test("renaming a field updates field accesses on expressions", async () => {
  const uri = await editorFile();
  const rename = await renameAt(
    uri,
    positionOf('make("a").did', 'make("a").'.length),
    "id",
    new Map(),
  );
  const edits = rename?.changes[uri] ?? [];
  const lines = edits.map((edit) => edit.range.start.line).sort((a, b) => a - b);
  // The declaration, `plain.did` and `make("a").did`.
  assertEquals(lines, [1, 4, 5]);
  for (const edit of edits) assertEquals(edit.range.end.character - edit.range.start.character, 3);
});
