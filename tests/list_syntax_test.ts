import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compileLibraryVirtual, compileVirtual } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const listPrelude = "type List<T> = Nil | Cons<T, List<T>>;";

Deno.test("list literals lower to the algebraic list model", async () => {
  const result = await checkSource(`
    ${listPrelude}
    let empty = [];
    let nums = [1, 2, 3];
    let more = [0, ..nums];
  `);

  expectBinding(result.env, "empty", { type: "List<'a>", vars: 1 });
  expectBinding(result.env, "nums", { type: "List<Int32.Int>", vars: 0 });
  expectBinding(result.env, "more", { type: "List<Int32.Int>", vars: 0 });
});

Deno.test("list patterns lower to constructor patterns", async () => {
  const result = await checkSource(`
    ${listPrelude}
    let rec sum = match(xs) => {
      [] => { 0 },
      [head, ..tail] => { head + sum(tail) },
    };
    let first_two = match(xs) => {
      [a, b, .._] => { (a, b) },
      _ => { (0, 0) },
    };
  `);

  expectBinding(result.env, "sum", { type: "List<Int32.Int> -> Int32.Int", vars: 0 });
  expectBinding(result.env, "first_two", {
    type: "List<Int32.Int> -> (Int32.Int, Int32.Int)",
    vars: 0,
  });
});

Deno.test("list pattern binder duplicates are rejected", async () => {
  await assertRejects(
    () =>
      checkSource(`
        ${listPrelude}
        let bad = match(xs) => {
          [x, x] => { x },
          _ => { 0 },
        };
      `),
    Error,
    "duplicate pattern binder x",
  );
});

Deno.test("list syntax works with basis list model", async () => {
  const result = await checkSource("let nums = [1, 2, 3];");
  expectBinding(result.env, "nums", { type: "List<Int32.Int>", vars: 0 });
});

Deno.test("print, Text.of and interpolation render lists consistently at every depth", async () => {
  const source = `
let main = () => {
  print([]);
  print([1, 2]);
  print(Some([[1], []]));
  print(Text.of(([], ["a", "b"])));
  print(\`items: \${[1, 2]}\`);
};`;
  const code = await compileVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(code)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["[]", "[1, 2]", "Some([[1], []])", "([], [a, b])", "items: [1, 2]"]);
});

Deno.test("list display handles long lists and cyclic foreign list spines", async () => {
  const source = "let sample = [1]; let show = (items: List<Int32.Int>) => { Text.of(items) };";
  const code = await compileLibraryVirtual("/test/show.wm", new Map([["/test/show.wm", source]]));
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  const nil = runtime.sample.a1;
  let long = nil;
  for (let n = 50000; n > 0; n--) long = { ...runtime.sample, a0: n, a1: long };
  const text = runtime.show(long);
  assertStringIncludes(text, "[1, 2, 3, ");
  assertStringIncludes(text, "49999, 50000]");
  runtime.sample.a1 = runtime.sample;
  assertEquals(runtime.show(runtime.sample), "[1, <cycle>]");
});

Deno.test("main failure messages render list payloads with quoted strings", async () => {
  const source = 'let main = () => { Err(["x", "y"]) };';
  const code = await compileVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, code);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-config", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 1);
    assertStringIncludes(new TextDecoder().decode(result.stderr), 'main failed with ["x", "y"]');
  } finally {
    await Deno.remove(path);
  }
});
