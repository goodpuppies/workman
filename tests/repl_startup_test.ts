import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fileURLToPath } from "node:url";
import { parseReplArguments } from "../src/main.ts";

const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const config = fileURLToPath(new URL("../deno.json", import.meta.url));

async function run(args: string[], input = "", cwd?: string) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--config", config, cli, ...args],
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(30000),
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const output = await child.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test("REPL arguments distinguish code, preload, and watched files with either frontend", () => {
  assertEquals(parseReplArguments(["let answer = 42;"]), {
    input: "let answer = 42;",
    mode: "eval",
    options: {},
  });
  assertEquals(parseReplArguments(["preload", "let answer = 42;", "--v2"]), {
    input: "let answer = 42;",
    mode: "preload",
    options: { frontend: "v2" },
  });
  assertEquals(parseReplArguments(["--v2", "answer.wm"]), {
    input: "answer.wm",
    options: { frontend: "v2" },
  });
  for (const args of [["preload"], ["preload", "a", "b"], ["a", "b"]]) {
    assertThrows(() => parseReplArguments(args), Error, "usage: wm repl");
  }
});

Deno.test("REPL code evaluates each phrase once and exits without consuming stdin", async () => {
  const result = await run(
    ["repl", 'print("once"); let answer = 40; answer + 2'],
    'print("unexpected input");\n',
  );
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stderr, "");
  assertEquals(result.stdout.split("once\n").length - 1, 1);
  assertStringIncludes(result.stdout, "it = 42 : Real64.Real");
  assertEquals(result.stdout.includes("unexpected input"), false);
  assertEquals(result.stdout.includes("Workman"), false);
});

Deno.test("REPL code returns failure for static and runtime errors", async () => {
  for (const source of ["let broken: String = 1;", 'Panic("startup failed");']) {
    const result = await run(["repl", source]);
    assertEquals(result.code, 1);
    assertEquals(result.stderr.length > 0, true);
  }
});

Deno.test("REPL preload imports relative to cwd and retains values without repeating effects", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/repl.wm`, 'let answer = 40; let _ = print("loaded once");');
    const result = await run(
      ["repl", "preload", 'from "./repl.wm" import *;'],
      "answer + 2;\nanswer + 3;\n",
      dir,
    );
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.stderr, "");
    assertEquals(result.stdout.split("loaded once\n").length - 1, 1);
    assertStringIncludes(result.stdout, "it = 42 : Real64.Real");
    assertStringIncludes(result.stdout, "it = 43 : Real64.Real");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("v2 preload reports failed phrases and keeps successful startup bindings", async () => {
  const result = await run(
    ["repl", "--v2", "preload", "let answer = 40;\nlet broken = Missing;"],
    "answer + 2;\n",
  );
  assertEquals(result.code, 0);
  assertStringIncludes(result.stderr, "unknown name Missing");
  assertStringIncludes(result.stdout, "it = 42 : Real64.Real");
});

Deno.test("wm run repl launches a pakman preload command from the project root", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/nested`);
    await Deno.writeTextFile(`${dir}/repl.wm`, "let answer = 42;");
    const preload = 'from "./repl.wm" import *;';
    await Deno.writeTextFile(
      `${dir}/pak.wm`,
      `
      from "pakman/project.wm" import * as P;
      let commands = [P.command("repl", [P.Wm(["repl", "preload", ${JSON.stringify(preload)}])])];
    `,
    );
    const result = await run(["run", "repl"], "answer;\n", `${dir}/nested`);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.stderr, "");
    assertStringIncludes(result.stdout, "it = 42 : Real64.Real");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
