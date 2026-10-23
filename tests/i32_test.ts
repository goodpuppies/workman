import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";

async function run(main: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const js = await compileVirtual("/test/main.wm", new Map([["/test/main.wm", main]]));
  const directory = await Deno.makeTempDir();
  try {
    const emitted = `${directory}/main.mjs`;
    await Deno.writeTextFile(emitted, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", emitted],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return {
      code: result.code,
      stdout: decoder.decode(result.stdout).trim(),
      stderr: decoder.decode(result.stderr),
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function runLines(main: string): Promise<string[]> {
  const result = await run(main);
  assertEquals(result.code, 0, result.stderr);
  return result.stdout.split("\n");
}

async function panics(main: string): Promise<string> {
  const result = await run(main);
  assert(result.code !== 0, `expected a panic, got: ${result.stdout}`);
  return result.stderr;
}

async function typeError(main: string): Promise<string> {
  try {
    await checkVirtual("/test/main.wm", new Map([["/test/main.wm", main]]));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert(false, "expected a type error");
}

Deno.test("integer literals default to Number", async () => {
  assertEquals(
    await runLines(`
      let half = (x) => { x / 2 };
      let one = 1;
      print(half(one));
      print(3 / 2);
    `),
    ["0.5", "1.5"],
  );
});

Deno.test("integer literals take I32 from context", async () => {
  assertEquals(
    await runLines(`
      let add = (x: I32, y: I32) => { x + y };
      let limit: I32 = 2147483647;
      print(add(1, 2));
      print(limit);
      print(limit > 0);
      print(match(add(1, 1)) { 2 => { "two" }, _ => { "other" } });
    `),
    ["3", "2147483647", "true", "two"],
  );
});

Deno.test("I32 and Number do not mix", async () => {
  assertStringIncludes(await typeError(`let bad = (x: I32) => { x + 1.5 };`), "Number");
  assertStringIncludes(await typeError(`let bad = (x: I32) => { x / 2 };`), "I32");
  assertStringIncludes(
    await typeError(`let n: Number = 1; let bad = (x: I32) => { x < n };`),
    "I32",
  );
  assertStringIncludes(await typeError(`let bad = (x: I32) => { x ++ "a" };`), "I32");
});

Deno.test("integer literals outside the I32 range are Number only", async () => {
  assertStringIncludes(await typeError(`let bad: I32 = 2147483648;`), "Number");
  assertStringIncludes(await typeError(`let bad: I32 = 1.0;`), "Number");
});

Deno.test("I32 arithmetic is exact at the boundaries", async () => {
  assertEquals(
    await runLines(`
      let sub = (x: I32, y: I32) => { x - y };
      let mul = (x: I32, y: I32) => { x * y };
      let neg = (x: I32) => { -x };
      print(sub(I32.minimum, 0));
      print(neg(I32.maximum));
      print(mul(46340, 46340));
      print(mul(0, -5));
      print(mul(-65536, 32768));
    `),
    ["-2147483648", "-2147483647", "2147395600", "0", "-2147483648"],
  );
});

Deno.test("I32 overflow panics", async () => {
  for (
    const expr of [
      "I32.maximum + 1",
      "I32.minimum - 1",
      "-I32.minimum",
      "I32.maximum * 2",
      "65536 * 32768",
      "I32.div(I32.minimum, -1)",
    ]
  ) {
    assertStringIncludes(
      await panics(`let f = (x: I32) => { x }; print(f(${expr}));`),
      "I32 overflow",
      expr,
    );
  }
});

Deno.test("I32 division and modulo floor like SML", async () => {
  assertEquals(
    await runLines(`
      print(I32.div(7, 2));
      print(I32.div(-7, 2));
      print(I32.div(7, -2));
      print(I32.div(-7, -2));
      print(I32.mod(7, 2));
      print(I32.mod(-7, 2));
      print(I32.mod(7, -2));
      print(I32.mod(-7, -2));
      print(I32.mod(-6, 2));
      print(I32.mod(I32.minimum, -1));
    `),
    ["3", "-4", "-4", "3", "1", "1", "-1", "-1", "0", "0"],
  );
  assertStringIncludes(await panics(`print(I32.div(1, 0));`), "I32 division by zero");
  assertStringIncludes(await panics(`print(I32.mod(1, 0));`), "I32 division by zero");
});

Deno.test("I32 checked operations and conversions return options", async () => {
  assertEquals(
    await runLines(`
      print(I32.checkedAdd(I32.maximum, 1));
      print(I32.checkedSub(I32.minimum, 1));
      print(I32.checkedMul(65536, -32768));
      print(I32.checkedAdd(1, 2));
      print(I32.fromNumber(1.5));
      print(I32.fromNumber(2147483648));
      print(I32.fromNumber(-0));
      print(I32.fromString("-2147483648"));
      print(I32.fromString("2147483648"));
      print(I32.fromString(" 1"));
      print(I32.fromString("+1"));
      print(I32.toString(I32.minimum));
      print(I32.toNumber(5) / 2);
    `),
    [
      "None",
      "None",
      "Some(-2147483648)",
      "Some(3)",
      "None",
      "None",
      "Some(0)",
      "Some(-2147483648)",
      "None",
      "None",
      "None",
      "-2147483648",
      "2.5",
    ],
  );
});
