import { assertEquals, assertStringIncludes } from "@std/assert";
import { evaluateReplFile, runInteractiveRepl, topLevelPhraseRanges } from "../src/repl.ts";
import { topLevelPhraseEnd } from "../src/top_level_phrases.ts";
import { parseReplArguments } from "../src/main.ts";
import denoConfig from "../deno.json" with { type: "json" };

import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));

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
    assertStringIncludes(result.stdout, "watch <file.wm> [-- args...]");
    assertStringIncludes(result.stdout, "repl [--v2] [file.wm]");
    assertStringIncludes(
      result.stdout,
      "lsp                           run the Workman language server",
    );
    assertStringIncludes(result.stdout, "problems [entrypoint.wm]");
  }
});

Deno.test("cli rejects arguments to the stdio language server", async () => {
  const result = await runCli(["lsp", "unexpected"]);

  assertEquals(result.code, 2);
  assertEquals(result.stdout, "");
  assertEquals(result.stderr, "usage: wm lsp\n");
});

Deno.test("cli rejects more than one problems entrypoint", async () => {
  const result = await runCli(["problems", "a.wm", "b.wm"]);

  assertEquals(result.code, 2);
  assertEquals(result.stdout, "");
  assertEquals(result.stderr, "usage: wm problems [entrypoint.wm]\n");
});

Deno.test("cli todo and what list typed holes across the module graph", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${directory}/lib.wm`,
      `-- TODO implement renderer
let render: Number -> String = ?;
let label = "TODO is not a comment";
let template = \`// TODO is also not a comment\`;`,
    );
    await Deno.writeTextFile(
      `${directory}/main.wm`,
      `from "./lib.wm" import { render };
// TODO choose an algorithm
let calculate = (): Number => {
  ?
};
let main = () => { Ok(render(calculate())) :> Result.debug :> print };`,
    );

    const todo = await runCli(["todo", "main.wm"], directory);
    const what = await runCli(["what", "main.wm"], directory);

    assertEquals(todo.code, 0);
    assertEquals(todo.stderr, "");
    assertEquals(what, todo);
    assertEquals(
      todo.stdout,
      `--- lib.wm ---

lib.wm:2:32: ? expected Number -> String
2 | let render: Number -> String = ?;
                                   ^

lib.wm:1:4: TODO comment
1 | -- TODO implement renderer
       ^^^^

--- main.wm ---

main.wm:6:54: warning[lint.result-debug]: Result.debug aborts on Err; handle the Result explicitly when possible.
6 | let main = () => { Ok(render(calculate())) :> Result.debug :> print };
                                                         ^^^^^

main.wm:4:3: ? expected Number
4 |   ?
      ^

main.wm:2:4: TODO comment
2 | // TODO choose an algorithm
       ^^^^
`,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("cli todo reports when a project has no typed holes", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/main.wm`, "let main = () => { void };");

    const result = await runCli(["todo", "main.wm"], directory);

    assertEquals(result, {
      code: 0,
      stdout: "no errors, warnings, typed holes, or TODO comments found\n",
      stderr: "",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("cli todo keeps errors and comments visible in a broken project", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${directory}/main.wm`,
      `// TODO repair the value
let bad: Number = true;`,
    );

    const result = await runCli(["todo", "main.wm"], directory);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    assertStringIncludes(result.stdout, "main.wm:2:19: error[type.mismatch]");
    assertStringIncludes(result.stdout, "main.wm:1:4: TODO comment");
    assertEquals(
      result.stdout.indexOf("error[type.mismatch]") < result.stdout.indexOf("TODO comment"),
      true,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("cli refuses to start the problems TUI without a terminal", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/main.wm`, "let answer = 42;");
    const result = await runCli(["problems"], directory);

    assertEquals(result.code, 2);
    assertEquals(result.stdout, "");
    assertEquals(result.stderr, "wm problems needs a terminal; run it directly in a shell\n");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("cli explains an ambiguous default problems entrypoint", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/alpha.wm`, "let answer = 1;");
    await Deno.writeTextFile(`${directory}/beta.wm`, "let answer = 2;");
    const result = await runCli(["problems"], directory);

    assertEquals(result.code, 2);
    assertEquals(result.stdout, "");
    assertEquals(
      result.stderr,
      "no main.wm and 2 .wm files here (alpha.wm, beta.wm); run: wm problems <entrypoint.wm>\n",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
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

Deno.test("cli fmt --stdout prints canonical Surface formatting without changing the file", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/math.wm`;
  const source = await Deno.readTextFile(
    new URL("../examples/exercises/math.wm", import.meta.url),
  );
  await Deno.writeTextFile(input, source);

  const result = await runCli(["fmt", "--stdout", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "let rec myDiv = (n, d) => {\n");
  assertStringIncludes(result.stdout, "    1 + myDiv(n - d, d)\n");
  assertEquals(await Deno.readTextFile(input), source);
});

Deno.test("cli fmt formats in place by default and is idempotent", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(input, "let answer=1+2*3;");

  const first = await runCli(["fmt", input]);
  const formatted = await Deno.readTextFile(input);
  const second = await runCli(["fmt", input]);

  assertEquals(first, { code: 0, stdout: "", stderr: "" });
  assertEquals(second, { code: 0, stdout: "", stderr: "" });
  assertEquals(formatted, "let answer = 1 + 2 * 3;");
  assertEquals(await Deno.readTextFile(input), formatted);
});

Deno.test("cli fmt --fix materializes marked missing braces and semicolon", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(input, 'let main=()=>print "hello world"');

  const first = await runCli(["fmt", "--fix", input]);
  const formatted = await Deno.readTextFile(input);
  const second = await runCli(["fmt", "--fix", input]);

  assertEquals(first, { code: 0, stdout: "", stderr: "" });
  assertEquals(second, { code: 0, stdout: "", stderr: "" });
  assertEquals(formatted, 'let main = () => {\n  print "hello world"\n};');
  assertEquals(await Deno.readTextFile(input), formatted);
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
    "answer = 42 : Number\nid = <function> : 'a -> 'a\n",
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
  assertStringIncludes(result.stderr, "Error: RUNNER[run.missing-entrypoint]");
  assertStringIncludes(result.stderr, "has no `main` function");
  assertStringIncludes(result.stderr, "let main = () => {};");
});

Deno.test("cli run suggests every importing entrypoint with main", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const library = `${dir}/library.wm`;
    await Deno.writeTextFile(library, "let answer = 42;");
    await Deno.writeTextFile(
      `${dir}/main.wm`,
      'from "./library.wm" import * as Library; let main = () => {};',
    );
    await Deno.writeTextFile(
      `${dir}/test.wm`,
      'from "./library.wm" import * as Library; let main = () => {};',
    );

    const result = await runCli(["run", library]);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "Did you mean one of these entrypoint files?");
    assertStringIncludes(result.stderr, `${dir}/main.wm`);
    assertStringIncludes(result.stderr, `${dir}/test.wm`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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

Deno.test("cli run points stack overflows at the non-tail Workman call", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let rec build = (n, items) => {
        if (n == 0) { items } else { build(n - 1, [n, ..items]) }
      };
      let rec count = match(items) => {
        [] => { 0 },
        [_, ..rest] => { 1 + count(rest) }
      };
      let main = () => {
        print(count(build(50000, [])));
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 1);
  assertEquals(result.stdout, "");
  assertStringIncludes(
    result.stderr,
    `error[runtime.stack-overflow ${input}:7:29]: non-tail recursion exhausted the JavaScript call stack`,
  );
  assertStringIncludes(result.stderr, "[_, ..rest] => { 1 + count(rest) }");
  assertStringIncludes(result.stderr, "`count` calls itself outside tail position.");
  assertStringIncludes(
    result.stderr,
    "Rewrite it using an accumulator so the compiler can emit a loop.",
  );
  assertEquals(result.stderr.includes("main.mjs"), false);
});

Deno.test("cli run explains stack overflow in the runtime value formatter", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let rec build = (n, items) => {
        if (n == 0) { items } else { build(n - 1, [n, ..items]) }
      };
      let main = () => { print(build(50000, [])) };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 1);
  assertStringIncludes(
    result.stderr,
    "error[runtime.stack-overflow]: displaying a Workman value exhausted the JavaScript call stack",
  );
  assertStringIncludes(result.stderr, "The value passed to `print` is nested too deeply");
  assertEquals(result.stderr.includes("main.mjs"), false);
});

Deno.test("cli run computes the length of a deep list without growing the JS stack", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let rec build = (n, items) => {
        if (n == 0) { items } else { build(n - 1, [n, ..items]) }
      };
      let main = () => {
        print(List.length(build(50000, [])));
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "50000\n");
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

Deno.test("cli run passes stdin through to the Workman program", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.module("node:fs") import {
        readFileSync: (Number, String) -> String
      };

      let main = () => {
        match(readFileSync(0, "utf8")) {
          Ok(text) => { print(text) },
          Err(_) => { print("read failed") },
        }
      };
    `,
  );

  const result = await runCliWithStdin(["run", input], "hello from stdin");

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "hello from stdin\n");
  assertEquals(result.stderr, "");
});

async function runCli(args: string[], cwd?: string) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", cli, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function runCliWithStdin(args: string[], input: string) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", cli, ...args],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const result = await child.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

Deno.test("interactive repl evaluates phrases, prints prompts, and keeps the basis after failures", async () => {
  const script = [
    "1 + 2;",
    "let x = 40;",
    "x + 2;",
    "let bad = ;",
    "x + 3;",
  ].join("\n");
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${script}\n`));
      controller.close();
    },
  });
  const output = new TextEncoder();
  const stdoutChunks: Uint8Array[] = [];
  const errors: unknown[] = [];
  const originalStdout = Deno.stdout.write;
  Deno.stdout.write = (chunk: Uint8Array): Promise<number> => {
    stdoutChunks.push(chunk.slice());
    return Promise.resolve(chunk.length);
  };
  try {
    await runInteractiveRepl({ input, onError: (error) => errors.push(error) });
  } finally {
    Deno.stdout.write = originalStdout;
  }
  const stdout = stdoutChunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
  assertEquals(
    stdout,
    [
      `🗿 workman ${denoConfig.version} repl\nPress Ctrl-C or Ctrl-D to exit.\n`,
      "- ",
      "it = 3 : Number\n",
      "- ",
      "x = 40 : Number\n",
      "- ",
      "it = 42 : Number\n",
      "- ",
      "- ",
      "it = 43 : Number\n",
      "- ",
    ].join(""),
  );
  assertEquals(errors.length, 1);
});

Deno.test("interactive repl carries partial phrases across reads and supports multi-phrase lines", async () => {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("let first =\n"));
      controller.enqueue(new TextEncoder().encode("7; let second = first + 1;\n"));
      controller.close();
    },
  });
  const stdoutChunks: Uint8Array[] = [];
  const originalStdout = Deno.stdout.write;
  Deno.stdout.write = (chunk: Uint8Array): Promise<number> => {
    stdoutChunks.push(chunk.slice());
    return Promise.resolve(chunk.length);
  };
  try {
    await runInteractiveRepl({ input });
  } finally {
    Deno.stdout.write = originalStdout;
  }
  const stdout = stdoutChunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
  assertStringIncludes(stdout, "first = 7 : Number");
  assertStringIncludes(stdout, "second = 8 : Number");
});

Deno.test("repl phrase end ignores quoted and commented semicolons", () => {
  assertEquals(topLevelPhraseEnd("let x = 1;"), 10);
  assertEquals(topLevelPhraseEnd("let x = 1; let y ="), undefined);
  assertEquals(topLevelPhraseEnd("let x = 1; -- trailing ; comment\n"), 10);
  assertEquals(topLevelPhraseEnd('let x = "a;b";'), 14);
  assertEquals(topLevelPhraseEnd('let x = "open'), undefined);
});
