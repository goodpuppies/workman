import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function wm(args: string[], cwd: string) {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
}

async function hasMlton(): Promise<boolean> {
  try {
    // MLton has no -version switch. Starting it establishes availability even though
    // invoking it without an input prints usage and exits unsuccessfully.
    await new Deno.Command("mlton", { args: [], stdout: "null", stderr: "null" }).output();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

const program = `record P = { x: Int32.Int, s: String };
let failed: Result<Int32.Int, String> = Err("e");
let _ = print(\`n=\${-7 % 3} r=\${-7.5 % 2.0} same=\${0.1 + 0.2 != 0.3} \${[1, 2]}\`);
let _ = print(1, "a", true, failed, .{ x = -1, s = "q" }, [Some(0.1 + 0.2), None]);
`;

Deno.test("wm sml writes a relocatable MLton project that prints as wm run does", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-sml-test-" });
  try {
    await Deno.writeTextFile(join(directory, "app.wm"), program);
    const translated = await wm(["sml", "app.wm", "out"], directory);
    assertEquals(translated.code, 0, translated.stderr);
    const project = await Deno.readTextFile(join(directory, "out", "project.mlb"));
    assert(!project.includes(directory), "project.mlb names files inside the output directory relatively");
    assertStringIncludes(project, '"subset_host_native.sml"');
    if (!await hasMlton()) return;

    // The directory builds after it moves.
    await Deno.rename(join(directory, "out"), join(directory, "moved"));
    const built = await new Deno.Command("mlton", {
      args: ["-output", "app", "project.mlb"],
      cwd: join(directory, "moved"),
      stderr: "piped",
    }).output();
    assert(built.success, new TextDecoder().decode(built.stderr));
    const native = await new Deno.Command(join(directory, "moved", "app"), { stdout: "piped" }).output();
    const run = await wm(["run", "app.wm"], directory);
    assertEquals(new TextDecoder().decode(native.stdout), run.stdout);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("wm sml translates a program that never prints, and rejects JavaScript imports", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-sml-test-" });
  try {
    await Deno.writeTextFile(join(directory, "quiet.wm"), "let answer = 6 * 7;\n");
    const quiet = await wm(["sml", "quiet.wm", "quiet"], directory);
    assertEquals(quiet.code, 0, quiet.stderr);

    await Deno.writeTextFile(
      join(directory, "js.wm"),
      'from js.global("console") import * as console;\nlet _ = print("x");\n',
    );
    const js = await wm(["sml", "js.wm", "js"], directory);
    assertEquals(js.code, 1);
    assertStringIncludes(js.stderr, "JavaScript imports");

    const usage = await wm(["sml", "quiet.wm"], directory);
    assertEquals(usage.code, 2);
    assertStringIncludes(usage.stderr, "usage: wm sml");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("wm sml shares pervasive bindings and portable std extensions with lexical shadowing", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-sml-scope-" });
  try {
    await Deno.writeTextFile(join(directory, "own.wm"),
      'type Option = | None | Some<String>;\nlet map = (n: Int32.Int) => { n + 10 };\n');
    await Deno.writeTextFile(join(directory, "app.wm"), `
from "std/general.wm" import { before as keep };
let projected = map([1, 2], (n) => { n + 1 });
let collected = foldLeft(projected, 0, (n, acc) => { n + acc });
let local = (map) => { map(3) };
let shadowed = local((n: Int32.Int) => { n * 2 });
let arm = match(Some(4)) { Some(map) => { map + 1 }, None => { 0 } };
record Labeled = { map: Int32.Int };
let labeled: Labeled = .{ map = 3 };
let nested = () => {
  let map = (n: Int32.Int) => { n + 20 };
  map(2)
};
let rec length = (n: Int32.Int) => { if (n == 0) { 0 } else { 1 + length(n - 1) } };
let first = List.findMap([1, 2, 3], (n) => { if (n > 1) { Some(n) } else { None } });
let combined = Option.map2(Some(2), Some(3), (a, b) => { a + b });
let applicative = .{ succeed = Some, map = Option.map, map2 = Option.map2 };
let applied = applicative.map2(Some(4), Some(5), (a, b) => { a + b });
let carried = Monad.map(Ok(2), Result, (n) => { n + 1 });
let rank = (value: Order) => { match(value) { Less => { 1 }, Equal => { 2 }, Greater => { 3 } } };
let _ = print(projected, collected, shadowed, arm, labeled.map, nested(), length(3), first, combined, applied, carried, rank(Less), keep(7, void));
type Order = | Less | Equal;
let ownRank = match { Less => { 8 }, Equal => { 9 } };
let _ = print(ownRank(Less));
`);
    const translated = await wm(["sml", "app.wm", "out"], directory);
    assertEquals(translated.code, 0, translated.stderr);
    const emitted = await Deno.readTextFile(join(directory, "out", "app.sml"));
    assertStringIncludes(emitted, "findMap");
    if (!await hasMlton()) return;
    const built = await new Deno.Command("mlton", {
      args: ["-output", "app", "project.mlb"],
      cwd: join(directory, "out"), stderr: "piped",
    }).output();
    assert(built.success, new TextDecoder().decode(built.stderr));
    const native = await new Deno.Command(join(directory, "out", "app"), { stdout: "piped" }).output();
    const run = await wm(["run", "app.wm"], directory);
    assertEquals(run.code, 0, run.stderr);
    assertEquals(new TextDecoder().decode(native.stdout), run.stdout);

    // An explicit open has precedence over the default map and remains private.
    await Deno.writeTextFile(join(directory, "explicit.wm"),
      'from "./own.wm" import *;\nlet answer = map(2);\nlet own: Option = Some("own");\nlet _ = print(answer, own);\n');
    const explicit = await wm(["sml", "explicit.wm", "explicit"], directory);
    assertEquals(explicit.code, 0, explicit.stderr);

    await Deno.writeTextFile(join(directory, "leak.wm"),
      'from "./app.wm" import * as App;\nlet leaked = App.isEmpty([]);\n');
    const leak = await wm(["sml", "leak.wm", "leak"], directory);
    assertEquals(leak.code, 1);
    assertStringIncludes(leak.stderr, "unbound");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
