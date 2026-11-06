import { assertEquals, assertStringIncludes } from "@std/assert";
import { evaluateReplFile,
  runInteractiveRepl, topLevelPhraseRanges } from "../src/repl.ts";
import { FrontendV2ParseCache } from "../src/frontend_v2_parse_cache.ts";
import { basename, dirname } from "node:path";
import { topLevelPhraseEnd } from "../src/top_level_phrases.ts";
import { parseReplArguments } from "../src/main.ts";
import denoConfig from "../deno.json" with { type: "json" };

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));

Deno.test("cli starts an interactive session with no arguments", async () => {
  const result = await runCliWithStdin([], "1 + 1;\n");

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, `🗿 Workman ${denoConfig.version}\n`);
  assertStringIncludes(result.stdout, "it = 2 : Number");
});

Deno.test("cli prints help with command and flag variants", async () => {
  for (const args of [["help"], ["--help"], ["-h"]]) {
    const result = await runCli(args);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    assertStringIncludes(result.stdout, `🗿 workman ${denoConfig.version} - compiler and runner`);
    assertStringIncludes(result.stdout, "wm run examples/factorial.wm");
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

Deno.test("cli rejects unknown arguments to the stdio language server", async () => {
  const result = await runCli(["lsp", "unexpected"]);

  assertEquals(result.code, 2);
  assertEquals(result.stdout, "");
  assertEquals(result.stderr, "usage: wm lsp [--stdio]\n");
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

Deno.test("cli fmt --fix materializes a marked missing semicolon", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(input, 'let main=()=>print "hello world"');

  const first = await runCli(["fmt", "--fix", input]);
  const formatted = await Deno.readTextFile(input);
  const second = await runCli(["fmt", "--fix", input]);

  assertEquals(first, { code: 0, stdout: "", stderr: "" });
  assertEquals(second, { code: 0, stdout: "", stderr: "" });
  assertEquals(formatted, 'let main = () => print "hello world";');
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
        'Expected a GPU member after "Gpu."; available types: Color, Fragment, RenderTarget2D, SampledTexture2D, Sampler, ShaderTarget, Texture2D, Uniform; available functions: artifactIdentity, bindGroupEntries, bindingCount, callableName, color',
    },
    {
      source: "let value: Gpu. = void;",
      expected:
        'Expected a GPU member after "Gpu."; available types: Color, Fragment, RenderTarget2D, SampledTexture2D, Sampler, ShaderTarget, Texture2D, Uniform; available functions: artifactIdentity, bindGroupEntries, bindingCount, callableName, color',
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

Deno.test("interactive repl applies named and anonymous match functions as one expression", async () => {
  const result = await runCliWithStdin(
    ["repl"],
    [
      "match(x)=>{true=>1,false=>0} true;",
      "match{true=>1,false=>0} true;",
      "match(x)=>{true=>x,false=>x}(false);",
      "match(x)=>{true=>1,false=>0} true;",
    ].join("\n") + "\n",
  );
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertEquals(
    result.stdout,
    `🗿 Workman ${denoConfig.version}\nPress Ctrl-C or Ctrl-D to exit.\n` +
      "- it = 1 : Number\n- it = 1 : Number\n- it = false : Bool\n- it = 1 : Number\n- ",
  );
});

Deno.test("repl shows lists in list syntax, at any depth", async () => {
  const result = await runCliWithStdin(
    ["repl"],
    [
      "let a = [1, 2];",
      "Some([1]);",
      "[];",
      "[[1], []];",
      '["a"];',
      'let p = (["x"], 1);',
      "Cons(1, Nil);",
    ].join("\n") + "\n",
  );
  assertEquals(result.stderr, "");
  for (
    const line of [
      "a = [1, 2] : List<Number>",
      "it = Some([1]) : Option<List<Number>>",
      "it = [] : List<'a>",
      "it = [[1], []] : List<List<Number>>",
      'it = ["a"] : List<String>',
      'p = (["x"], 1) : (List<String>, Number)',
      "it = [1] : List<Number>",
    ]
  ) assertStringIncludes(result.stdout, line);
  assertEquals(result.stdout.includes("Cons"), false);
});

Deno.test("repl keeps constructors for a user's own Cons type and for print", async () => {
  const own = await runCliWithStdin(["repl"], "type Mine = Cons<Number, Mine> | Nil;\nCons(1, Nil);\n");
  assertStringIncludes(own.stdout, "it = Cons(1, Nil) : Mine");
  const printed = await runCliWithStdin(["repl"], "print([1, 2]);\n");
  assertStringIncludes(printed.stdout, "Cons(1, Cons(2, Nil))");
});

Deno.test("repl shows a long list without exhausting the stack", async () => {
  const result = await runCliWithStdin(
    ["repl"],
    "let rec build = (n, acc) => { if (n == 0) { acc } else { build(n - 1, Cons(n, acc)) } };\n" +
      "build(50000, []);\n",
  );
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "it = [1, 2, 3, ");
  assertStringIncludes(result.stdout, "49999, 50000] : List<Number>");
});

Deno.test("repl :type shows a type without running the expression or changing the session", async () => {
  const result = await runCliWithStdin(
    ["repl"],
    [
      "let x = 5;",
      ":type x + 1;",
      ':t print("must not run");',
      ":t (a) => a;",
      ":t x +",
      "1;",
      ":t x; // a comment",
      ":t;",
      "let z = 1;",
      "y;",
      "x + 1;",
    ].join("\n") + "\n",
  );
  assertEquals(result.code, 0);
  assertEquals(result.stdout.includes("must not run"), false);
  assertStringIncludes(
    result.stdout,
    "x = 5 : Number\n- Number\n- Void!\n- 'a -> 'a\n- = Number\n- Number\n",
  );
  assertStringIncludes(result.stdout, "usage: :type <expression>;");
  assertStringIncludes(result.stderr, "unknown name y");
  assertStringIncludes(result.stdout, "it = 6 : Number");
  assertEquals(result.stdout.includes("it = void"), false);
});

Deno.test("repl :type reports a bad expression and the session carries on", async () => {
  const result = await runCliWithStdin(
    ["repl"],
    "let x = 5;\n:t nope;\n:t x +;\nx + 1;\n",
  );
  assertEquals(result.code, 0);
  assertStringIncludes(result.stderr, "unknown name nope");
  assertStringIncludes(result.stdout, "it = 6 : Number");
});

Deno.test("repl :help and unknown commands print without touching the session", async () => {
  const result = await runCliWithStdin(
    ["repl"],
    "let x = 5;\n:help\n:help type\n:nope\n:help nope\nx;\n",
  );
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, ":type <expression>;  show an expression's type");
  assertStringIncludes(result.stdout, "Nothing runs and no binding changes");
  assertStringIncludes(result.stdout, "unknown command :nope; try :help");
  assertStringIncludes(result.stdout, "it = 5 : Number");
});

Deno.test("interactive repl quit prints the phrase's output and ends the session", async () => {
  const result = await runCliWithStdin(
    ["repl"],
    'let done = true;\nprint("before");\nif (done) { print("bye"); quit() } else { 42 };\nprint("never");\n',
  );
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "before\n");
  assertStringIncludes(result.stdout, "bye\n");
  assertEquals(result.stdout.includes("never"), false);
});

Deno.test("interactive repl quit fires only when called and can be shadowed", async () => {
  const deferred = await runCliWithStdin(
    ["repl"],
    'let leave = () => { quit() };\nprint("alive");\nleave();\nprint("never");\n',
  );
  assertEquals(deferred.code, 0);
  assertStringIncludes(deferred.stdout, "alive\n");
  assertEquals(deferred.stdout.includes("never"), false);
  const shadowed = await runCliWithStdin(["repl"], "let quit = 5;\nquit + 1;\n");
  assertEquals(shadowed.stderr, "");
  assertStringIncludes(shadowed.stdout, "it = 6 : Number");
});

Deno.test("quit is not defined outside interactive sessions", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const input = `${dir}/main.wm`;
    await Deno.writeTextFile(input, "quit();\n");
    const result = await evaluateReplFile(input);
    assertEquals(result.code, 1);
    assertStringIncludes(String(result.staticErrors), "unknown name quit");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("interactive repl explains the named-match collision and continues without repairing it", async () => {
  const result = await runCliWithStdin(["repl"], [
    "let (a,b) = (1,2);",
    '(a,b) :> (match (a,b)=>print("meow"),_=>Panic("X"));',
    "a + b;",
  ].join("\n") + "\n");
  assertEquals(result.code, 0);
  assertStringIncludes(result.stderr, "Expected a match arm (`pattern => body`)");
  assertStringIncludes(result.stderr, "put braces around the arms");
  assertStringIncludes(result.stderr, "match { (a, b) => expression, _ => fallback }");
  assertEquals(result.stdout.includes("meow"), false);
  assertStringIncludes(result.stdout, "it = 3 : Number");
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

Deno.test("repl evaluates parenthesized and space-applied Panic identically", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/panic.wm`;
    for (const expression of ['Panic("x")', 'Panic "x"', 'Panic ("x")', 'Panic { "x" }']) {
      await Deno.writeTextFile(path, `let crash = ${expression};`);
      const result = await evaluateReplFile(path);
      assertEquals(result.code, 1, expression);
      assertEquals(new TextDecoder().decode(result.stdout), "", expression);
      assertEquals(new TextDecoder().decode(result.stderr), "runtime[Panic]: x\n", expression);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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

Deno.test("cli run accepts declaration-driven entry modules without main", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/hello.wm`;
  await Deno.writeTextFile(input, 'let _ = print("hello");');

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "hello\n");
  assertEquals(result.stderr, "");
});

Deno.test("cli run executes the selected file instead of redirecting to importing mains", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const library = `${dir}/library.wm`;
    await Deno.writeTextFile(library, 'let _ = print("library");');
    await Deno.writeTextFile(
      `${dir}/main.wm`,
      'from "./library.wm" import * as Library; let main = () => {};',
    );
    await Deno.writeTextFile(
      `${dir}/test.wm`,
      'from "./library.wm" import * as Library; let main = () => {};',
    );

    const result = await runCli(["run", library]);

    assertEquals(result.code, 0);
    assertEquals(result.stdout, "library\n");
    assertEquals(result.stderr, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cli err accepts a module without main as a valid runnable entry", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/hello.wm`;
  await Deno.writeTextFile(input, 'let greeting = "hello";');

  const result = await runCli(["err", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "");
  assertEquals(result.stderr, "err: no compiler or runner errors found\n");
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

Deno.test("cli run executes deep tail recursion forwarded through a local helper", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let rec count = (remaining, acc) => {
        let step = (next) => { count(next, acc + 1) };
        if (remaining == 0) { acc } else { step(remaining - 1) }
      };
      let main = () => {
        print(count(100000, 0));
        void
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "100000\n");
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
    `error[runtime.stack-overflow ${resolve(input)}:7:29]: non-tail recursion exhausted the JavaScript call stack`,
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
      from js.module("node:fs") import { readFileSync };

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
      `🗿 Workman ${denoConfig.version}\nPress Ctrl-C or Ctrl-D to exit.\n`,
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
      controller.enqueue(new TextEncoder().encode("let fir"));
      controller.enqueue(new TextEncoder().encode("st =\n"));
      controller.enqueue(new TextEncoder().encode("7; let sec"));
      controller.enqueue(new TextEncoder().encode("ond = first + 1;\n"));
      // Split both a UTF-8 character and a terminator from the rest of its line.
      for (const byte of new TextEncoder().encode('let text = "café";\ntext;')) {
        controller.enqueue(new Uint8Array([byte]));
      }
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
  assertStringIncludes(stdout, 'text = "café" : String');
  assertStringIncludes(stdout, 'it = "café" : String');
});

Deno.test("interactive repl phrases see only the phrases that succeeded", async () => {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode([
        "let x = 40;",
        "let bad = ;",
        'let x = Panic("boom");',
        "let bad = missing;",
        "x + 2;",
        "bad;",
      ].join("\n")));
      controller.close();
    },
  });
  const writes: string[] = [];
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const errors: unknown[] = [];
  const originalWrite = Deno.writeTextFile;
  const originalStdout = Deno.stdout.write;
  const originalStderr = Deno.stderr.write;
  Deno.writeTextFile = async (...args: Parameters<typeof Deno.writeTextFile>) => {
    writes.push(String(args[0]));
    await originalWrite(...args);
  };
  Deno.stdout.write = (chunk) => {
    stdoutChunks.push(chunk.slice());
    return Promise.resolve(chunk.length);
  };
  Deno.stderr.write = (chunk) => {
    stderrChunks.push(chunk.slice());
    return Promise.resolve(chunk.length);
  };
  try {
    await runInteractiveRepl({ input, quiet: true, onError: (error) => errors.push(error) });
  } finally {
    Deno.writeTextFile = originalWrite;
    Deno.stdout.write = originalStdout;
    Deno.stderr.write = originalStderr;
  }
  // Definition rules 189 and 190: neither a phrase that fails to elaborate nor one that raises
  // changes the basis, so x is still 40 and bad was never bound.
  assertEquals(errors.length, 3);
  assertStringIncludes(String(errors.at(-1)), "unknown name bad");
  const decode = (chunks: Uint8Array[]) =>
    chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
  assertStringIncludes(decode(stdoutChunks), "it = 42 : Number\n");
  assertEquals(decode(stderrChunks), "runtime[Panic]: boom\n");
  // Phrases live in memory; only emitted code is written, and only to the OS temporary directory.
  const probe = await Deno.makeTempDir();
  await Deno.remove(probe);
  const temporary = dirname(probe);
  assertEquals(writes.filter((path) => !path.startsWith(temporary)), []);
});

Deno.test("interactive repl keeps a js import visible to later phrases", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, "repl"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode([
    'from js.global("Math") import unsafe { max: (Number, Number) -> Number };',
    "let x = 1;",
    "max(x, 2);",
  ].join("\n")));
  await writer.close();
  const result = await child.output();
  assertEquals(new TextDecoder().decode(result.stderr), "");
  assertStringIncludes(new TextDecoder().decode(result.stdout), "it = 2 : Number");
});

Deno.test("interactive repl evaluates each phrase once", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, "repl"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode([
    'let x = { print("once"); 40 };',
    'let y = Panic("boom");',
    "x + 2;",
    "let x = x + 1;",
    "x;",
  ].join("\n")));
  await writer.close();
  const result = await child.output();
  const stdout = new TextDecoder().decode(result.stdout);
  assertEquals(stdout.split("once").length - 1, 1, stdout);
  assertStringIncludes(stdout, "it = 42 : Number");
  assertStringIncludes(stdout, "it = 41 : Number");
  assertEquals(new TextDecoder().decode(result.stderr), "runtime[Panic]: boom\n");
});

Deno.test("repl session has SML's top-level structures without imports", async () => {
  const phrases = [
    "Bool.not(true);",
    "Char.isDigit;",
    "Int.fromString;",
    "Io.readFile;",
    "OS.Process.isSuccess(OS.Process.success);",
    'OS.Path.dir("a/b");',
    "StringCvt.padLeft(\"a\", 3, ' ');",
    "Text.size;",
    // Session imports shadow the header's, as in any module.
    'from "basis/list.wm" import * as Text;',
    "Text.length;",
  ];
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(phrases.join("\n")));
      controller.close();
    },
  });
  const errors: unknown[] = [];
  const stdoutChunks: Uint8Array[] = [];
  const originalStdout = Deno.stdout.write;
  Deno.stdout.write = (chunk) => {
    stdoutChunks.push(chunk.slice());
    return Promise.resolve(chunk.length);
  };
  try {
    await runInteractiveRepl({ input, quiet: true, onError: (error) => errors.push(error) });
  } finally {
    Deno.stdout.write = originalStdout;
  }
  assertEquals(errors, []);
  assertStringIncludes(
    stdoutChunks.map((chunk) => new TextDecoder().decode(chunk)).join(""),
    "it = true : Bool",
  );
});

Deno.test("repl phrase end ignores quoted and commented semicolons", () => {
  assertEquals(topLevelPhraseEnd("let x = 1;"), 10);
  assertEquals(topLevelPhraseEnd("let x = 1; let y ="), undefined);
  assertEquals(topLevelPhraseEnd("let x = 1; -- trailing ; comment\n"), 10);
  assertEquals(topLevelPhraseEnd('let x = "a;b";'), 14);
  assertEquals(topLevelPhraseEnd('let x = "open'), undefined);
});

Deno.test("interactive repl compiles every phrase through the session parse cache", async () => {
  // A phrase's imports resolve from the working directory.
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".wm-repl-cache-test-" });
  await Deno.writeTextFile(`${dir}/numbers.wm`, "let base = 40;\n");
  const parsed: string[] = [];
  class CountingCache extends FrontendV2ParseCache {
    override surface(...args: Parameters<FrontendV2ParseCache["surface"]>) {
      parsed.push(args[0]);
      return super.surface(...args);
    }
  }
  const script = `from "./${basename(dir)}/numbers.wm" import { base };\nbase + 1;\nbase + 2;\n`;
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(script));
      controller.close();
    },
  });
  const originalStdout = Deno.stdout.write;
  const stdout: string[] = [];
  Deno.stdout.write = (chunk: Uint8Array): Promise<number> => {
    stdout.push(new TextDecoder().decode(chunk));
    return Promise.resolve(chunk.length);
  };
  try {
    await runInteractiveRepl({ input, frontendV2ParseCache: new CountingCache() });
  } finally {
    Deno.stdout.write = originalStdout;
    await Deno.remove(dir, { recursive: true });
  }
  assertStringIncludes(stdout.join(""), "it = 42 : Number");
  const dependencyParses = parsed.filter((path) => path.endsWith("numbers.wm")).length;
  assertEquals(dependencyParses >= 3, true, parsed.join("\n"));
});
