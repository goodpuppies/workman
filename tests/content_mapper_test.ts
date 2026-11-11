import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import ts from "typescript-api";
import { projectWorkman } from "../src/content_mapper/projection.ts";
import { projectConfiguration } from "../src/content_mapper/project.ts";
import { ContentMapper } from "../src/content_mapper/server.ts";
import { decodeMessages, encodeMessage } from "../src/lsp/rpc.ts";
import type { TransformResult } from "../src/content_mapper/protocol.ts";

const path = "/test/content-mapper.wm";

function checkConsumer(result: TransformResult, consumer: string): readonly ts.Diagnostic[] {
  assertEquals(result.diagnostics, []);
  const files = new Map([
    ["/projection.ts", result.text],
    ["/consumer.ts", consumer],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) => files.get(name) ?? readFile(name);
  host.fileExists = (name) => files.has(name) || fileExists(name);
  host.getSourceFile = (name, target) => {
    const text = host.readFile(name);
    return text === undefined ? undefined : ts.createSourceFile(name, text, target, true);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  return ts.getPreEmitDiagnostics(program);
}

Deno.test("content mapper exposes inferred exports, generics, positional ABI, and currying", async () => {
  const result = await projectWorkman(
    path,
    `
let double = (x: Number) => x + x;
let identity = (x) => x;
let sum = (a: Number, b: Number) => a + b;
let curried = (x: Number) => (y: Number) => x + y;
let zero = () => 0;
let pair = (1, true);
`,
  );
  const errors = checkConsumer(
    result,
    `
import { double, identity, sum, curried, zero, pair } from "./projection";
const number: number = double(21);
const string: string = identity("hello");
const bool: boolean = identity(true);
const total: number = sum(1, 2);
const other: number = curried(1)(2);
const empty: number = zero();
const first: number = pair[0];
// @ts-expect-error WM inferred a numeric argument
double("wrong");
// @ts-expect-error identity preserves its argument type
const wrong: number = identity("hello");
// @ts-expect-error exported WM functions take positional arguments
sum([1, 2]);
// @ts-expect-error WM tuple element types are retained
const bad: string = pair[1];
`,
  );
  assertEquals(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  assert(!result.text.includes("x + x"), "projection must not contain a lowered implementation");
});

Deno.test("content mapper maps final shadowed exports and UTF-16 identifiers", async () => {
  const source =
    "// 🐺 Unicode offsets are UTF-16.\nlet value = 1; let value = true; let id' = (x) => x;";
  const result = await projectWorkman(path, source);
  assertEquals(result.diagnostics, []);
  const lastValue = source.lastIndexOf("value");
  assert(result.mappings.some((mapping) => mapping[2] === lastValue && mapping[3] === 5));
  assert(!result.mappings.some((mapping) => mapping[2] === source.indexOf("value")));
  assertEquals(
    checkConsumer(
      result,
      `
import { value, "id'" as id } from "./projection";
const b: boolean = value;
const n: number = id(42);
`,
    ).length,
    0,
  );
  for (const mapping of result.mappings) {
    assert(mapping[0] + mapping[1] <= result.text.length);
    assert(mapping[2] + mapping[3] <= source.length);
    assertEquals((mapping[5] ?? 0) & (256 | 1024 | 2048), 0, "no TS edits into WM syntax");
  }
});

Deno.test("content mapper uses current unsaved content on every transform", async () => {
  const first = await projectWorkman(path, "let value = 1;");
  const second = await projectWorkman(path, 'let value = "now a string";');
  assertStringIncludes(first.text, ": number;");
  assertStringIncludes(second.text, ": string;");
  assert(!second.text.includes(": number;"));
});

Deno.test("content mapper presents source function and parameter names, including curried stages", async () => {
  const source = `
let double = (value: Number) => value + value;
let identity = (item) => item;
let sum = (left: Number, right: Number) => left + right;
let curried = (first: Number) => { (second: Number) => first + second };
let shadow = (oldName: Number) => oldName;
let shadow = (currentName: String) => currentName;
`;
  const result = await projectWorkman(path, source);
  assertEquals(result.diagnostics, []);
  assertStringIncludes(result.text, "const double: (value: number) => number");
  assertStringIncludes(result.text, "const identity: <T>(item: T) => T");
  assertStringIncludes(result.text, "const sum: (left: number, right: number) => number");
  assertStringIncludes(result.text, "const curried: (first: number) => (second: number) => number");
  assertStringIncludes(result.text, "const shadow: (currentName: string) => string");
  assert(!/__wm_value|arg\d|oldName/.test(result.text));
  assertEquals(
    checkConsumer(
      result,
      `
import { double, sum, curried, shadow } from "./projection";
const n: number = double(21) + sum(1, 2) + curried(1)(2);
const s: string = shadow("hello");
`,
    ).length,
    0,
  );
});

Deno.test("content mapper gives primed names readable, collision-free TS spellings", async () => {
  const result = await projectWorkman(
    path,
    `
let id' = (value') => value';
let id_prime = (original) => original;
let named = (value': Number, value_prime: Number) => value' + value_prime;
`,
  );
  assertEquals(result.diagnostics, []);
  assertStringIncludes(result.text, "const id_prime_2: <T>(value_prime: T) => T");
  assertStringIncludes(result.text, "const id_prime: <T>(original: T) => T");
  assertStringIncludes(
    result.text,
    "const named: (value_prime_2: number, value_prime: number) => number",
  );
  assertEquals(
    checkConsumer(
      result,
      `
import { "id'" as primed, id_prime, named } from "./projection";
const a: number = primed(1);
const b: boolean = id_prime(true);
const c: number = named(2, 3);
`,
    ).length,
    0,
  );
});

Deno.test("content mapper preserves valid declarations alongside WM syntax and type errors", async () => {
  for (const bad of ["let broken = ;", "let broken = 1 + true;"]) {
    const source = `let good = 42; ${bad}`;
    const result = await projectWorkman(path, source);
    assertStringIncludes(result.text, "export declare const good:");
    assert(!result.text.includes("export declare const broken:"));
    assertEquals(result.diagnostics.length, 1);
    const diagnostic = result.diagnostics[0];
    assertEquals(diagnostic.code, 1000);
    assert(diagnostic.start >= source.indexOf("broken"));
    assert(diagnostic.start + diagnostic.length <= source.length);
  }
});

Deno.test("content mapper rejects unsupported nominal and constrained types without any", async () => {
  for (const source of ["let option = Some(1);", "let equal = (x, y) => x == y;"]) {
    const result = await projectWorkman(path, source);
    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0].code, 1001);
    assertEquals(result.diagnostics[0].start, 4);
    assert(!result.text.includes("any"));
    assert(!result.text.includes("declare const"));
  }
});

Deno.test("content mapper uses WM module visibility, namespaces, re-exports, and shadowing", async () => {
  const base = "/test/base.wm";
  const mid = "/test/mid.wm";
  const main = "/test/main.wm";
  const sources = new Map([
    [base, "let value = 1; let hidden = true; let id = (item) => item;"],
    [mid, 'export from "./base.wm" import { value as renamed, id }; let own = 2;'],
  ]);
  const source = `from "./base.wm" import { hidden };
    from "./mid.wm" import * as Mid;
    export from "./mid.wm" import { renamed, id };
    export from "./mid.wm" import * as Public;
    let answer = Mid.renamed;
    let forwarded = Mid.id;
    let renamed = "shadowed";`;
  const result = await projectWorkman(main, source, sources);
  const diagnostics = checkConsumer(
    result,
    `
    import { answer, renamed, id, Public, forwarded } from "./projection";
    const n: number = answer;
    const s: string = renamed;
    const generic: boolean = id(true);
    const alias: number = forwarded(1);
    const member: number = Public.renamed;
    const nested: string = Public.id("hello");
    // @ts-expect-error ordinary imports are private
    import { hidden } from "./projection";
  `,
  );
  assertEquals(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  assertStringIncludes(result.text, "const forwarded: <T>(item: T) => T");
  for (const mapping of result.mappings) {
    assert(mapping[2] + mapping[3] <= source.length);
  }
  sources.set(base, "let value = false; let hidden = true; let id = (item) => item;");
  const updated = await projectWorkman(main, source, sources);
  assertStringIncludes(updated.text, "const answer: boolean");
  assertStringIncludes(updated.text, '"renamed": boolean');
});

Deno.test("content mapper fingerprints and watches transitive WM graphs per project", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wm-mapper-project-" });
  try {
    await Deno.writeTextFile(`${dir}/base.wm`, "let value = 1;");
    await Deno.writeTextFile(`${dir}/main.wm`, 'export from "./base.wm" import *;');
    const first = await projectConfiguration(`${dir}/tsconfig.json`, ["main.wm"]);
    assertEquals(first.watchedFiles, [`${dir}/base.wm`, `${dir}/main.wm`]);
    assertEquals(await projectConfiguration(`${dir}/tsconfig.json`, ["main.wm"]), first);
    await Deno.writeTextFile(`${dir}/base.wm`, "let value = true;");
    const changed = await projectConfiguration(`${dir}/tsconfig.json`, ["main.wm"]);
    assert(changed.configIdentity !== first.configIdentity);
    await Deno.remove(`${dir}/main.wm`);
    const removed = await projectConfiguration(`${dir}/tsconfig.json`, ["main.wm"]);
    assertEquals(removed.watchedFiles, [`${dir}/main.wm`]);
    assert(removed.configIdentity !== changed.configIdentity);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("content mapper keeps project handles isolated and releases closed projects", async () => {
  const mapper = new ContentMapper();
  assertEquals(await mapper.request("initialize", { positionEncodings: ["utf-8", "utf-16"] }), {
    positionEncoding: "utf-16",
    diagnosticSource: "workman",
  });
  await assertRejects(() => mapper.request("initialize", { positionEncodings: ["utf-8"] }));
  assertEquals(
    (await mapper.request("openProject", { projectHandle: "a", options: { typo: true } }) as {
      optionDiagnostics: unknown;
    }).optionDiagnostics,
    [{ path: ["typo"], code: 1003, messageText: "Unknown Workman content mapper option: typo" }],
  );
  await mapper.request("openProject", { projectHandle: "b" });
  await mapper.request("closeProject", { projectHandle: "a" });
  await assertRejects(() =>
    mapper.request("transform", { projectHandle: "a", fileName: path, content: "" })
  );
  const result = await mapper.request("transform", {
    projectHandle: "b",
    fileName: path,
    content: "let value = 42;",
  }) as TransformResult;
  assertStringIncludes(result.text, ": number;");
  await assertRejects(() => mapper.request("not-a-method", {}));
});

Deno.test("content mapper serves framed JSON-RPC over stdio without stdout noise", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "src/content_mapper/server.ts"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  for (
    const [id, method, params] of [
      [1, "initialize", { positionEncodings: ["utf-16"] }],
      [2, "openProject", { projectHandle: "a" }],
      [3, "transform", { projectHandle: "a", fileName: path, content: "let value = 42;" }],
      [4, "closeProject", { projectHandle: "a" }],
      [5, "transform", { projectHandle: "a", fileName: path, content: "" }],
    ] as const
  ) {
    const bytes = encodeMessage({ jsonrpc: "2.0", id, method, params });
    // Exercise framing across arbitrary chunk boundaries.
    await writer.write(bytes.slice(0, 17));
    await writer.write(bytes.slice(17));
  }
  await writer.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  const decoded = decodeMessages(output.stdout);
  assertEquals(decoded.errors, []);
  assertEquals(decoded.rest.length, 0);
  assertEquals(decoded.messages.length, 5);
  assertStringIncludes(
    (decoded.messages[2].result as TransformResult).text,
    "export declare const value:",
  );
  assertEquals((decoded.messages[4].error as { code: number }).code, -32602);
});

Deno.test("content mapper shares the positional ABI through callbacks, factories, and nested tuples", async () => {
  const result = await projectWorkman(
    path,
    `
    let invoke = (function, left: Number, right: Number) => function(left, right);
    let make = (offset: Number) => (left: Number, right: Number) => offset + left + right;
    let nested = (pair, extra: Number) => { let (a, b) = pair; a + b + extra };
    let totals = (a: Number, b: Number) => (a + b, a - b);
    let apply = (function, argument) => function(argument);
  `,
  );
  assertEquals(
    checkConsumer(
      result,
      `
    import { invoke, make, nested, totals, apply } from "./projection";
    const a: number = invoke((left, right) => left + right, 20, 22);
    const b: number = make(10)(20, 12);
    const c: number = nested([20, 12], 10);
    const d: [number, number] = totals(20, 12);
    const e: number = apply((pair: [number, number]) => pair[0] + pair[1], [20, 22]);
    // @ts-expect-error positional callbacks accept scalar arguments
    invoke((pair: [number, number]) => pair[0] + pair[1], 20, 22);
    // @ts-expect-error returned functions use the same positional convention
    make(10)([20, 12]);
  `,
    ).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    [],
  );
});
