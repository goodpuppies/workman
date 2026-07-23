import { assertEquals, assertStringIncludes } from "@std/assert";

const cli = new URL("../src/main.ts", import.meta.url).pathname;

Deno.test("cli run calls typed JS namespace imports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("console") import unsafe { log: (String, Number) => Void } as console;
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

Deno.test("cli run converts reflected TypeScript tuple results and parameters", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/tuple.ts`,
    `
      export function makePair(): [number, string] { return [42, "answer"]; }
      export function showPair(pair: [number, string]): string {
        return pair[1] + ":" + pair[0];
      }
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./tuple.ts") import { makePair, showPair };
      let main = () => {
        makePair()
          :> Result.andThen((number, text) => { showPair((number, text)) })
          :> Result.map((shown) => { print(shown) })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stdout, "answer:42\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run converts reflected tuples nested in JS arrays", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/tuple_array.ts`,
    `
      export function makeRows(): Array<[number, string]> {
        return [[42, "answer"], [7, "lucky"]];
      }
      export function showRows(rows: Array<[number, string]>): string {
        return rows.map(([number, text]) => text + ":" + number).join(",");
      }
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./tuple_array.ts") import { makeRows, showRows };
      let main = () => {
        makeRows()
          :> Result.andThen((rows) => {
            match(Js.Array.toList(rows)) {
              [(Var(firstNumber), Var(firstText)), (Var(secondNumber), Var(secondText))] => {
                showRows(Js.Array.fromList([
                  (firstNumber, firstText),
                  (secondNumber, secondText)
                ]))
              },
              _ => { Panic("unexpected rows") }
            }
          })
          :> Result.map((shown) => { print(shown) })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stdout, "answer:42,lucky:7\n");
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
      from js.global("Array") import unsafe { isArray: (Js.Value) => Bool } as Array;
      from js.global("JSON") import unsafe { stringify: (Js.Value) => String } as JSON;
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
      from js.global("JSON") import unsafe { parse: (String) => Option<Js.Value> } as JSON;
      from js.global("Object") import unsafe { is: (Option<Js.Value>, Js.Value) => Bool } as Object;
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
        let proc = spawn(${JSON.stringify(Deno.execPath())}, JSON["--version"]);
        match(proc) {
          Ok(p) => {
            p.on("close", (code) => {
              print(code);
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
        print(match(Deno.readTextFileSync(${JSON.stringify(`${dir}/missing.txt`)})) {
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

Deno.test("cli run normalizes JS throws into matchable Js.Error values", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global import { eval as jsEval: (String) => Js.Value };
      let main = () => {
        print(match(jsEval("throw 'boom'")) {
          Ok(_) => { "ok" },
          Err(Js.Error("boom")) => { "string" },
          Err(Js.Error(_)) => { "error" },
          Err(Js.Unknown) => { "unknown" },
        });
        print(match(jsEval("throw null")) {
          Ok(_) => { "ok" },
          Err(Js.Error(_)) => { "error" },
          Err(Js.Unknown) => { "unknown" },
        })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "string\nunknown\n");
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
            match(url :> .pathname) {
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

Deno.test("cli run resolves package imports from the source project", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/node_modules/fakepkg`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/package.json`,
    JSON.stringify({ dependencies: { fakepkg: "1.0.0" } }),
  );
  await Deno.writeTextFile(
    `${dir}/node_modules/fakepkg/package.json`,
    JSON.stringify({
      name: "fakepkg",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  await Deno.writeTextFile(
    `${dir}/node_modules/fakepkg/index.js`,
    "export const answer = 42;\n",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from js.module("fakepkg") import unsafe { answer: Number };
      let main = () => {
        print(answer)
      };
    `,
  );

  const result = await runCli(["run", `${dir}/main.wm`]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "42\n");
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
