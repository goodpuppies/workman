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

Deno.test("wm sml selectively re-exports values and generic types through facades", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-sml-exports-" });
  try {
    await Deno.writeTextFile(join(directory, "base.wm"), `
type Shape = | Circle<Int32.Int>;
type Items<a> = List<a>;
record Pair<a> = { first: a, second: a };
let identity = (x) => { x };
let make = (n: Int32.Int) => { Circle(n) };
let hidden = 99;
let _ = print("loaded");
`);
    await Deno.writeTextFile(join(directory, "facade.wm"), `
export from "./base.wm" import { Shape as Figure, Items, Pair as Duo, identity as id, identity as Some, make };
`);
    await Deno.writeTextFile(join(directory, "forward.wm"), `
export from "./facade.wm" import { Figure, Items, Duo, id, Some as apply, make };
`);
    await Deno.writeTextFile(join(directory, "app.wm"), `
from "./forward.wm" import * as F;
from "./base.wm" import * as B;
let shape: F.Figure = F.make(4);
let values: F.Items<Int32.Int> = [F.id(1), F.id(2)];
let pair: F.Duo<Int32.Int> = F.Duo(3, 5);
let n = match(shape) { B.Circle(n) => { n } };
let _ = print(n, values, pair.first, pair.second, F.apply("ok"));
`);
    const translated = await wm(["sml", "app.wm", "out"], directory);
    assertEquals(translated.code, 0, translated.stderr);
    if (await hasMlton()) {
      const built = await new Deno.Command("mlton", {
        args: ["-output", "app", "project.mlb"], cwd: join(directory, "out"), stderr: "piped",
      }).output();
      assert(built.success, new TextDecoder().decode(built.stderr));
      const native = await new Deno.Command(join(directory, "out", "app"), { stdout: "piped" }).output();
      const run = await wm(["run", "app.wm"], directory);
      assertEquals(run.code, 0, run.stderr);
      assertEquals(new TextDecoder().decode(native.stdout), run.stdout);
    }
    await Deno.writeTextFile(join(directory, "leak.wm"),
      'from "./facade.wm" import * as F;\nlet leaked = F.hidden;\n');
    const leak = await wm(["sml", "leak.wm", "leak"], directory);
    assertEquals(leak.code, 1);
    assertStringIncludes(leak.stderr, "unbound");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("wm sml preserves selective constructor aliases in patterns and lexical scopes", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-sml-constructors-" });
  try {
    await Deno.writeTextFile(join(directory, "base.wm"), `
type Shape = | Circle<Int32.Int> | Empty;
type Maybe<a> = | Missing | Present<a>;
type Token = | Token<Int32.Int>;
let make = () => { Circle(7) };
let _ = print("initialized");
`);
    await Deno.writeTextFile(join(directory, "facade.wm"), `
export from "./base.wm" import { Shape as Figure, Circle as Ring, Empty as Blank, Maybe, Missing as Nothing, Present as Some, Token as Ticket, make };
`);
    await Deno.writeTextFile(join(directory, "forward.wm"), `
export from "./facade.wm" import { Figure, Ring as Loop, Blank, Maybe, Nothing, Some, Ticket, make };
`);
    await Deno.writeTextFile(join(directory, "outer.wm"),
      'export from "./forward.wm" import * as API;\n');
    await Deno.writeTextFile(join(directory, "selected.wm"),
      'export from "./outer.wm" import { API as Shapes };\n');
    await Deno.writeTextFile(join(directory, "app.wm"), `
from "./selected.wm" import { Shapes as Q };
from "./forward.wm" import { Loop as Selected };
let read = (value: Q.Figure) => { match(value) { Q.Loop(n) => { n }, Q.Blank => { 0 } } };
let original = match(Selected(3)) { Selected(n) => { n }, _ => { 0 } };
let build = Q.Loop;
let present: Q.Maybe<Int32.Int> = Q.Some(8);
let missing: Q.Maybe<Int32.Int> = Q.Nothing;
let ticket: Q.Ticket = Q.Ticket(9);
let payload = match(present) { Q.Some(n) => { n }, Q.Nothing => { 0 } };
let absent = match(missing) { Q.Nothing => { true }, _ => { false } };
let stamped = match(ticket) { Q.Ticket(n) => { n } };
type Local = | Selected<String>;
let local = match(Selected("own")) { Selected(s) => { s } };
let _ = print(read(Q.make()), read(build(11)), read(Q.Blank), original, payload, absent, stamped, local);
`);
    const translated = await wm(["sml", "app.wm", "out"], directory);
    assertEquals(translated.code, 0, translated.stderr);
    if (await hasMlton()) {
      const built = await new Deno.Command("mlton", {
        args: ["-output", "app", "project.mlb"], cwd: join(directory, "out"), stderr: "piped",
      }).output();
      assert(built.success, new TextDecoder().decode(built.stderr));
      const native = await new Deno.Command(join(directory, "out", "app"), { stdout: "piped" }).output();
      const run = await wm(["run", "app.wm"], directory);
      assertEquals(run.code, 0, run.stderr);
      assertEquals(new TextDecoder().decode(native.stdout), run.stdout);
    }
    await Deno.writeTextFile(join(directory, "other.wm"), 'type Shape = | Circle<Int32.Int>;\n');
    await Deno.writeTextFile(join(directory, "wrong.wm"), `
from "./selected.wm" import { Shapes as Q };
from "./other.wm" import * as Other;
let wrong: Q.Figure = Other.Circle(1);
`);
    const wrong = await wm(["sml", "wrong.wm", "wrong"], directory);
    assertEquals(wrong.code, 1);
    assertStringIncludes(wrong.stderr, "expected");
    await Deno.writeTextFile(join(directory, "leak.wm"),
      'from "./forward.wm" import * as F;\nlet leaked = F.Circle(1);\n');
    const leak = await wm(["sml", "leak.wm", "leak"], directory);
    assertEquals(leak.code, 1);
    assertStringIncludes(leak.stderr, "unbound");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
