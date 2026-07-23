import { assertEquals, assertStringIncludes } from "@std/assert";
import { evaluateReplFile, topLevelPhraseRanges } from "../src/repl.ts";
import { parseReplArguments } from "../src/main.ts";
import denoConfig from "../deno.json" with { type: "json" };

const cli = new URL("../src/main.ts", import.meta.url).pathname;

Deno.test("cli prints help with no arguments", async () => {
  const result = await runCli([]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, `🗿 workman ${denoConfig.version} - compiler and runner`);
  assertStringIncludes(result.stdout, "wm run examples/factorial.wm");
});

Deno.test("cli prints help with command and flag variants", async () => {
  for (const args of [["help"], ["--help"], ["-h"]]) {
    const result = await runCli(args);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    assertStringIncludes(result.stdout, "commands:");
    assertStringIncludes(result.stdout, "repl [--v2] <file.wm>");
  }
});

Deno.test("cli prints the deno.json version with command and flag variants", async () => {
  for (const args of [["version"], ["--version"], ["-v"], ["-V"]]) {
    const result = await runCli(args);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    assertEquals(result.stdout, `🗿 workman ${denoConfig.version}\n`);
  }
});

Deno.test("cli treats a wm path as the compatibility compile form", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/answer.wm`;
  await Deno.writeTextFile(input, "let answer = 42;");

  const result = await runCli([input]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, " = 42;");
});

Deno.test("cli rejects an unknown command instead of treating it as a file", async () => {
  const result = await runCli(["comiple"]);

  assertEquals(result.code, 2);
  assertEquals(result.stdout, "");
  assertEquals(result.stderr, "unknown command: comiple\ntry: wm --help\n");
});

Deno.test("cli explains how to import JavaScript and TypeScript modules", async () => {
  for (const extension of ["js", "ts"]) {
    const dir = await Deno.makeTempDir();
    const input = `${dir}/main.wm`;
    await Deno.writeTextFile(
      input,
      `from "./helper.${extension}" import { helper }; let answer = 42;`,
    );
    await Deno.writeTextFile(`${dir}/helper.${extension}`, "export const helper = 1;");

    const result = await runCli(["check", input]);

    assertEquals(result.code, 1);
    assertEquals(result.stdout, "");
    assertStringIncludes(result.stderr, "JavaScript and TypeScript modules use js.module(...)");
    assertStringIncludes(
      result.stderr,
      `try: from js.module("./helper.${extension}") import ...`,
    );
  }
});

Deno.test("cli lists valid members after incomplete js namespaces", async () => {
  const cases = [
    {
      source: "from js. import { value };",
      expected: 'Expected "global", "module", or "worker" after "js."',
    },
    {
      source: "let value: Js. = void;",
      expected:
        'Expected "Array", "ArrayLike", "Dict", "Error", "Object", "Promise", "Unknown", or "Value" after "Js."',
    },
    {
      source: "let value = Gpu.;",
      expected:
        'Expected a GPU member after "Gpu."; available types: Color, Fragment, RenderTarget2D, SampledTexture2D, Sampler, Texture2D, Uniform; available functions: artifactIdentity, bindGroupEntries, bindingCount, color',
    },
    {
      source: "let value: Gpu. = void;",
      expected:
        'Expected a GPU member after "Gpu."; available types: Color, Fragment, RenderTarget2D, SampledTexture2D, Sampler, Texture2D, Uniform; available functions: artifactIdentity, bindGroupEntries, bindingCount, color',
    },
  ];

  for (const testCase of cases) {
    const dir = await Deno.makeTempDir();
    const input = `${dir}/main.wm`;
    await Deno.writeTextFile(input, testCase.source);

    const result = await runCli(["check", input]);

    assertEquals(result.code, 1);
    assertEquals(result.stdout, "");
    assertStringIncludes(result.stderr, testCase.expected);
  }
});

Deno.test("repl parses --v2 before or after its input", () => {
  assertEquals(parseReplArguments(["--v2", "scratch.wm"]), {
    input: "scratch.wm",
    options: { frontend: "v2" },
  });
  assertEquals(parseReplArguments(["scratch.wm", "--v2"]), {
    input: "scratch.wm",
    options: { frontend: "v2" },
  });
  assertEquals(parseReplArguments(["scratch.wm"]), {
    input: "scratch.wm",
    options: {},
  });
});

Deno.test("repl evaluates top-level bindings without a main function", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/hello.wm`;
  await Deno.writeTextFile(input, "let x = 1 + 1;");

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 0);
  assertEquals(new TextDecoder().decode(result.stdout), "x = 2 : Number\n");
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("v2 repl evaluates source with recovered terminators and delimiters", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/recovered.wm`;
  await Deno.writeTextFile(input, "let answer = 42\nlet id = (x) => { x");

  const result = await evaluateReplFile(input, { frontend: "v2" });

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    "answer = 42 : Number\nid = <function> : ('a) => 'a\n",
  );
  assertEquals(new TextDecoder().decode(result.stderr), "");
  assertEquals(result.staticErrors, undefined);
});

Deno.test("v2 repl evaluates basic arithmetic with precedence", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/arithmetic.wm`;
  await Deno.writeTextFile(
    input,
    "let sum = 1+1\nlet precedence = 1 + 2 * 3\nlet grouped = (1 + 2) * 3",
  );

  const result = await evaluateReplFile(input, { frontend: "v2" });

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    "sum = 2 : Number\nprecedence = 7 : Number\ngrouped = 9 : Number\n",
  );
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("repl prints each final top-level binding using Workman value syntax", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/values.wm`;
  await Deno.writeTextFile(
    input,
    'let tuple = (1, "two"); let answer = Some(42);',
  );

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    'tuple = (1, "two") : (Number, String)\nanswer = Some(42) : Option<Number>\n',
  );
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("repl binds a top-level expression to it", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/expression.wm`;
  await Deno.writeTextFile(input, "1 + 1;");

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 0);
  assertEquals(new TextDecoder().decode(result.stdout), "it = 2 : Number\n");
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("repl reports every binder introduced by a top-level pattern", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/pattern.wm`;
  await Deno.writeTextFile(input, 'let (number, text) = (1, "two");');

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    'number = 1 : Number\ntext = "two" : String\n',
  );
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("repl reports top-level datatype and record declarations", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/types.wm`;
  await Deno.writeTextFile(
    input,
    "type Box<T> = Empty | Box<T>; record Point = { x: Number, y: Number }; let value = Box(2);",
  );

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    "type Box<T> = Empty | Box<T>\nrecord Point = { x: Number, y: Number }\nvalue = Box(2) : Box<Number>\n",
  );
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("repl reports shadowed phrases with the type in force at each phrase", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/shadow.wm`;
  await Deno.writeTextFile(input, 'let value = 1; let value = "two";');

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    'value = 1 : Number\nvalue = "two" : String\n',
  );
});

Deno.test("repl keeps the basis and continues after static phrase failure", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/static-failure.wm`;
  await Deno.writeTextFile(
    input,
    'let first = 1; let bad = first + "two"; let after = first + 2;',
  );

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 1);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    "first = 1 : Number\nafter = 3 : Number\n",
  );
  assertEquals(result.staticErrors?.length, 1);
});

Deno.test("repl rejects later phrases that depend on a failed phrase", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/dependent-static-failure.wm`;
  await Deno.writeTextFile(
    input,
    'let first = 1; let bad = first + "two"; let dependent = bad + 1;',
  );

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 1);
  assertEquals(new TextDecoder().decode(result.stdout), "first = 1 : Number\n");
  assertEquals(result.staticErrors?.length, 2);
});

Deno.test("repl continues after a parse failure at a semicolon phrase boundary", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/parse-failure.wm`;
  await Deno.writeTextFile(input, "let first = 1; let broken = ; let after = first + 2;");

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 1);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    "first = 1 : Number\nafter = 3 : Number\n",
  );
  assertEquals(result.staticErrors?.length, 1);
});

Deno.test("repl phrase boundaries ignore nested and quoted semicolons", () => {
  const source = 'let text = ";"; let value = { let inner = 1; inner }; -- ;\n1 + 1;';
  assertEquals(topLevelPhraseRanges(source).length, 3);
});

Deno.test("repl preserves successful phrase output before runtime failure", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/runtime-failure.wm`;
  await Deno.writeTextFile(
    input,
    'let first = 1; let bad = Panic("boom"); let never = 3;',
  );

  const result = await evaluateReplFile(input);

  assertEquals(result.code, 1);
  assertEquals(new TextDecoder().decode(result.stdout), "first = 1 : Number\n");
  assertEquals(new TextDecoder().decode(result.stderr), "runtime[Panic]: boom\n");
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

Deno.test("cli run explains when the entry module has no main function", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/hello.wm`;
  await Deno.writeTextFile(input, 'let greeting = "hello";');

  const result = await runCli(["run", input]);

  assertEquals(result.code, 1);
  assertEquals(result.stdout, "");
  assertStringIncludes(result.stderr, "-- RUNNER");
  assertStringIncludes(result.stderr, "has no `main` function");
  assertStringIncludes(result.stderr, "let main = () => {};");
});

Deno.test("cli err prints the authored and low-level missing-entrypoint diagnostic", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/hello.wm`;
  await Deno.writeTextFile(input, 'let greeting = "hello";');

  const result = await runCli(["err", input]);

  assertEquals(result.code, 1);
  assertEquals(result.stdout, "");
  assertStringIncludes(result.stderr, "-- error 1");
  assertStringIncludes(result.stderr, "* authored diagnostic:");
  assertStringIncludes(result.stderr, "let main = () => {};");
  assertStringIncludes(result.stderr, "* low-level diagnostic:");
  assertStringIncludes(result.stderr, "rule: Run.EntryPoint");
  assertStringIncludes(result.stderr, "* compiler trace:");
  assertStringIncludes(result.stderr, "-- error 1 end");
  assertStringIncludes(result.stderr, "--- compiler state ---");
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

Deno.test("cli compile-library writes an importable module without invoking main", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/library.wm`;
  const output = `${dir}/library.mjs`;
  await Deno.writeTextFile(
    input,
    `
      let main = () => { Panic("must not run during import") };
      let answer = 42;
    `,
  );

  const result = await runCli(["compile-library", input, output]);
  const module = await import(`${new URL(`file://${output}`).href}?test=${crypto.randomUUID()}`);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertEquals(result.stdout, "");
  assertEquals(module.answer, 42);
  assertEquals(typeof module.main, "function");
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

Deno.test("cli run executes deep direct tail recursion without growing the JS stack", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let rec sumTo = (n, acc) => {
        if (n == 0) {
          acc
        } else {
          let next = n - 1;
          match(n > 0) {
            true => { sumTo(next, acc + n) },
            false => { acc }
          }
        }
      };
      let main = () => {
        print(sumTo(100000, 0));
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "5000050000\n");
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
