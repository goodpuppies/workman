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

Deno.test("cli run uses Core constructor identity through imports", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/a.wm`,
    `
      export type A = | Box;
      export let make = () => { Box };
      export let describe = match(value) => {
        Box => { "a" },
      };
    `,
  );
  await Deno.writeTextFile(
    `${dir}/b.wm`,
    `
      export type B = | Box;
      export let make = () => { Box };
      export let describe = match(value) => {
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
    "export type Int_list = Empty | Cons<Number, Int_list>; export let rec sumList = (list) => { let rec inner = (list, acc) => { match(list) { Empty => {acc}, Cons(i, rest) => {inner(rest, acc+i)} } }; inner(list, 0) };",
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

Deno.test("cli run calls typed JS namespace imports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("console") import { log: (String, Number) => Void } as console;
      let main = () => {
        console.log("answer", 42)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "answer 42\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run calls inferred JS imports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("Math") import { max as jsmax, floor };
      from js.global("Math") import * as Math;
      let main = () => {
        print(match(jsmax(1, 2)) {
          Ok(n) => { n },
          Err(_) => { -1 },
        });
        print(match(floor(4.8)) {
          Ok(n) => { n },
          Err(_) => { -1 },
        });
        print(match(Math.sqrt(9)) {
          Ok(n) => { n },
          Err(_) => { -1 },
        })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "2\n4\n3\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run calls inferred variadic JS imports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("console") import * as console;
      let main = () => {
        console.log("hello world");
        console.log("answer", 42)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "hello world\nanswer 42\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run calls inferred JS module imports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.module("node:crypto") import { createHash };
      let main = () => {
        createHash("sha256");
        print("made")
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "made\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run passes JSON arrays as one JS argument", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("Array") import { isArray: (Js.Value) => Bool } as Array;
      from js.global("JSON") import { stringify: (Js.Value) => String } as JSON;
      let main = () => {
        print(Array.isArray(JSON[1, 2]));
        print(JSON.stringify(JSON{
          stdio: JSON["ignore", "pipe", "inherit"],
          env: JSON{ "USER_AGENT": "Workman-FFI" }
        }))
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(
    result.stdout,
    'true\n{"stdio":["ignore","pipe","inherit"],"env":{"USER_AGENT":"Workman-FFI"}}\n',
  );
  assertEquals(result.stderr, "");
});

Deno.test("cli run wraps and unwraps JS nullish Option values", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("JSON") import { parse: (String) => Option<Js.Value> } as JSON;
      from js.global("Object") import { is: (Option<Js.Value>, Js.Value) => Bool } as Object;
      let main = () => {
        let none = JSON.parse("null");
        let some = JSON.parse("{\\"ok\\":true}");
        let value = JSON{};
        print(match(none) {
          None => { "none" },
          Some(_) => { "some" },
        });
        print(match(some) {
          None => { "none" },
          Some(_) => { "some" },
        });
        print(Object.is(Some(value), value));
        print(Object.is(None, value))
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "none\nsome\ntrue\nfalse\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run grants generated JS permissions for reflected child process interop", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.module("node:child_process") import { spawn };
      let main = () => {
        let proc = spawn("sh", JSON["-c", "exit 0"]);
        match(proc) {
          Ok(p) => {
            p.on("close", (code) => {
              print(match(code) {
                Some(n) => { n },
                None => { -1 },
              });
            });
            void
          },
          Err(_) => { print(-1) },
        }
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "0\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run reads a text file through reflected Deno APIs", async () => {
  const dir = await Deno.makeTempDir();
  const data = `${dir}/message.txt`;
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(data, "hello from deno");
  await Deno.writeTextFile(
    input,
    `
      from js.global("Deno") import * as Deno;
      let main = () => {
        print(match(Deno.readTextFileSync(${JSON.stringify(data)})) {
          Ok(text) => { text },
          Err(_) => { "read failed" },
        })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "hello from deno\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run maps reflected JS throws to Result Err", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("Deno") import * as Deno;
      let main = () => {
        print(match(Deno.readTextFileSync("${dir}/missing.txt")) {
          Ok(_) => { "ok" },
          Err(_) => { "err" },
        })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "err\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run constructs reflected JS globals and reads properties", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global import { URL };
      let main = () => {
        print(match(URL.new("https://example.com/a")) {
          Ok(url) => {
            match(url.pathname) {
              Ok(path) => { path },
              Err(_) => { "property failed" },
            }
          },
          Err(_) => { "constructor failed" },
        })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "/a\n");
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
