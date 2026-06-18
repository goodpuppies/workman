import { assertEquals, assertStringIncludes } from "@std/assert";

const cli = new URL("../src/main.ts", import.meta.url).pathname;

Deno.test("cli prints help with no arguments", async () => {
  const result = await runCli([]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "wm-mini - Workman subset compiler and runner");
  assertStringIncludes(result.stdout, "wm run examples/factorial.wm");
});

Deno.test("cli prints help with --help", async () => {
  const result = await runCli(["--help"]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "commands:");
});

Deno.test("cli run compiles and executes a wm file", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let main = () => {
        print(40 + 2);
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertEquals(result.stdout, "42\n");
});

Deno.test("cli compile command keeps js-out path", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const output = `${dir}/main.mjs`;
  await Deno.writeTextFile(input, "let answer = 42;");

  const result = await runCli(["compile", input, output]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(await Deno.readTextFile(output), "const answer_");
  assertStringIncludes(await Deno.readTextFile(output), " = 42;");
});

Deno.test("cli check reports ok for valid modules", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(input, "let answer = 42;");

  const result = await runCli(["check", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "ok\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli check prints warnings before ok", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    "type Option<T> = None | Some<T>; let opt = None; let bad = match(opt) { None => { 0 } };",
  );

  const result = await runCli(["check", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "ok\n");
  assertStringIncludes(result.stderr, "warning[pattern.non-exhaustive");
  assertStringIncludes(result.stderr, "missing Some");
});

Deno.test("cli run uses Core constructor identity through imports", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/a.wm`,
    `
      type A = | Box;
      let make = () => { Box };
      let describe = match(value) => {
        Box => { "a" },
      };
    `,
  );
  await Deno.writeTextFile(
    `${dir}/b.wm`,
    `
      type B = | Box;
      let make = () => { Box };
      let describe = match(value) => {
        Box => { "b" },
      };
    `,
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./a.wm" import * as A;
      from "./b.wm" import * as B;
      let main = () => {
        print(A.describe(A.make()));
        print(B.describe(B.make()));
        void
      };
    `,
  );

  const result = await runCli(["run", `${dir}/main.wm`]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "a\nb\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run compares records by labels, not JS insertion order", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      record Point = { x: Number, y: Number };
      let a: Point = .{ x = 1, y = 2 };
      let b: Point = .{ y = 2, x = 1 };
      let main = () => {
        print(a == b);
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "true\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run preserves sequential shadowing in generated JS", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let value = 1;
      let first = value;
      let value = 2;
      let main = () => {
        print(first);
        print(value);
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "1\n2\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run closures capture their defining environment", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let value = 1;
      let get = () => { value };
      let value = 2;
      let main = () => {
        print(get());
        print(value);
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "1\n2\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run supports mutually recursive closure bindings", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let rec even = (n) => {
        if (n == 0) { true } else { odd(n - 1) }
      } and odd = (n) => {
        if (n == 0) { false } else { even(n - 1) }
      };
      let main = () => {
        print(even(4));
        print(odd(4));
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "true\nfalse\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run supports star import without alias", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(
    lib,
    "type Int_list = Empty | Cons<Number, Int_list>; let rec sumList = (list) => { let rec inner = (list, acc) => { match(list) { Empty => {acc}, Cons(i, rest) => {inner(rest, acc+i)} } }; inner(list, 0) };",
  );
  await Deno.writeTextFile(
    main,
    'from "./lib.wm" import *; let main = () => { print(sumList(Cons(1, Cons(2, Empty)))) };',
  );

  const output = await runCli(["run", main]);
  assertEquals(output.code, 0);
  assertEquals(output.stdout.trim(), "3");
});

Deno.test("cli run prints nested ADT values by constructor shape", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      type Int_list = Empty | Cons<Number, Int_list>;
      type Box<T> = | Box<T>;
      let main = () => {
        print(Cons(1, Cons(2, Empty)));
        print(Box(Cons(3, Empty)));
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "Cons(1, Cons(2, Empty))\nBox(Cons(3, Empty))\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run uses basis Option and Result constructors", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let main = () => {
        print(Some(1));
        print(None);
        print(Ok("yes"));
        print(Err("no"))
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "Some(1)\nNone\nOk(yes)\nErr(no)\n");
  assertEquals(result.stderr, "");
});

async function runCli(args: string[]) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", cli, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
