import { assertEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";
import {
  compileLibraryVirtual,
  compileReplFileArtifacts,
  compileVirtual,
} from "../src/compiler.ts";

Deno.test("[module update T122/T123/R509] diamond dependencies initialize once in source-edge DFS order", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/shared.wm", 'let shared = print("shared");'],
    [
      "/test/left.wm",
      'from "./shared.wm" import * as Shared; let left = print("left");',
    ],
    [
      "/test/right.wm",
      'from "./shared.wm" import * as Shared; let right = print("right");',
    ],
    [
      "/test/main.wm",
      'from "./left.wm" import * as Left; ' +
      'from "./right.wm" import * as Right; ' +
      'let initialized = print("entry"); ' +
      'let main = () => { print("main") };',
    ],
  ]);

  const run = await evaluateVirtual("/test/main.wm", virtualFs);

  assertEquals(run.error, undefined);
  assertEquals(run.output, ["shared", "left", "right", "entry", "main"]);
});

Deno.test("[module update T124/R507] dependencies initialize before declaration-ordered importer evaluation", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/dependency.wm", 'let dependency = print("dependency");'],
    [
      "/test/main.wm",
      'let before = print("before"); ' +
      'from "./dependency.wm" import * as Dependency; ' +
      'let after = print("after"); ' +
      'let main = () => { print("main") };',
    ],
  ]);

  const run = await evaluateVirtual("/test/main.wm", virtualFs);

  assertEquals(run.error, undefined);
  assertEquals(run.output, ["dependency", "before", "after", "main"]);
});

Deno.test("[module update T125/T127/T128/R512/R514] dependency failure preserves prior effects and prevents importer main", async () => {
  const virtualFs = failingGraph();

  const run = await evaluateVirtual("/test/main.wm", virtualFs);

  assertStringIncludes(String(run.error), "boom");
  assertEquals(run.output, ["completed", "before failure"]);
});

Deno.test("[module update T126/R510] a repeated module request remembers initialization failure", async () => {
  const javaScript = await compileVirtual("/test/main.wm", failingGraph());
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const url = `data:text/javascript;base64,${btoa(javaScript)}#${crypto.randomUUID()}`;
    const first = await importError(url);
    const second = await importError(url);

    assertStrictEquals(second, first);
    assertEquals(output, ["completed", "before failure"]);
  } finally {
    console.log = original;
  }
});

Deno.test("[module update T129/G17] namespace, open, and named imports agree at runtime", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let first = 10; let second = 20;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Namespace; ' +
      'from "./lib.wm" import *; ' +
      'from "./lib.wm" import { second as named }; ' +
      "let main = () => { print(Namespace.first + second + named) };",
    ],
  ]);

  const run = await evaluateVirtual("/test/main.wm", virtualFs);

  assertEquals(run.error, undefined);
  assertEquals(run.output, ["50"]);
});

Deno.test("[module update R508/R513/R515] every emit target uses the explicit module-instance protocol", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Lib; let answer = Lib.value; let main = () => { void };',
    ],
  ]);
  const executable = await compileVirtual("/test/main.wm", virtualFs);
  const library = await compileLibraryVirtual("/test/main.wm", virtualFs);
  const dir = await Deno.makeTempDir();
  const replEntry = `${dir}/main.wm`;
  await Deno.writeTextFile(`${dir}/lib.wm`, "let value = 1;");
  await Deno.writeTextFile(
    replEntry,
    'from "./lib.wm" import * as Lib; let answer = Lib.value;',
  );
  const repl = (await compileReplFileArtifacts(replEntry))[0].code;

  for (const emitted of [executable, library, repl]) {
    assertStringIncludes(emitted, 'state: "uninitialized"');
    assertStringIncludes(emitted, 'instance.state = "initializing"');
    assertStringIncludes(emitted, 'instance.state = "completed"');
    assertStringIncludes(emitted, 'instance.state = "failed"');
    assertStringIncludes(emitted, "for (const dependency of instance.dependencies)");
    assertStringIncludes(emitted, "__wm_define_module(");
    assertStringIncludes(emitted, "await __wm_request_module(");
  }
});

function failingGraph(): Map<string, string> {
  return new Map([
    ["/test/completed.wm", 'let completed = print("completed");'],
    [
      "/test/failing.wm",
      'from "./completed.wm" import * as Completed; ' +
      'let before = print("before failure"); ' +
      'let broken: Number = Panic("boom");',
    ],
    ["/test/later.wm", 'let later = print("must not run");'],
    [
      "/test/main.wm",
      'from "./failing.wm" import * as Failing; ' +
      'from "./later.wm" import * as Later; ' +
      'let initialized = print("importer must not run"); ' +
      'let main = () => { print("main must not run") };',
    ],
  ]);
}

async function evaluateVirtual(
  entry: string,
  virtualFs: Map<string, string>,
): Promise<{ output: string[]; error: unknown }> {
  const javaScript = await compileVirtual(entry, virtualFs);
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const url = `data:text/javascript;base64,${btoa(javaScript)}#${crypto.randomUUID()}`;
    return { output, error: await importError(url) };
  } finally {
    console.log = original;
  }
}

async function importError(url: string): Promise<unknown> {
  try {
    await import(url);
    return undefined;
  } catch (error) {
    return error;
  }
}
