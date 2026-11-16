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

Deno.test("integer literals default to Int32 while division selects Real64", async () => {
  assertEquals(
    await runLines(`
      let half = (x) => { x / 2 };
      let one: Real64 = 1;
      print(half(one));
      print(3 / 2);
      let integer = 2147483647;
      print(integer + (0: Int32));
    `),
    ["0.5", "1.5", "2147483647"],
  );
});

Deno.test("integer literals take Int32.Int from context", async () => {
  assertEquals(
    await runLines(`
      let add = (x: Int32.Int, y: Int32.Int) => { x + y };
      let limit: Int32.Int = 2147483647;
      print(add(1, 2));
      print(limit);
      print(limit > 0);
      print(match(add(1, 1)) { 2 => { "two" }, _ => { "other" } });
      print((-2147483648: Int32.Int));
      print(match((3: Int32.Int)) { (3: Int32.Int) => { "three" }, _ => { "other" } });
    `),
    ["3", "2147483647", "true", "two", "-2147483648", "three"],
  );
});

Deno.test("Int32.Int and Real64.Real do not mix", async () => {
  assertStringIncludes(await typeError(`let bad = (x: Int32.Int) => { x + 1.5 };`), "Real64.Real");
  assertStringIncludes(await typeError(`let bad = (x: Int32.Int) => { x / 2 };`), "Int32.Int");
  assertStringIncludes(
    await typeError(`let n: Real64.Real = 1; let bad = (x: Int32.Int) => { x < n };`),
    "Int32.Int",
  );
  assertStringIncludes(await typeError(`let bad = (x: Int32.Int) => { x ++ "a" };`), "Int32.Int");
});

Deno.test("integer literals outside the Int32.Int range are rejected when selected as Int32.Int", async () => {
  assertStringIncludes(await typeError(`let bad: Int32.Int = 2147483648;`), "out of range for Int32.Int");
  assertStringIncludes(await typeError(`let bad: Int32.Int = -2147483649;`), "out of range for Int32.Int");
  assertStringIncludes(await typeError(`let bad: Int32.Int = 1.0;`), "Real64.Real");
});

Deno.test("Int32.Int arithmetic is exact at the boundaries", async () => {
  assertEquals(
    await runLines(`
      let sub = (x: Int32.Int, y: Int32.Int) => { x - y };
      let mul = (x: Int32.Int, y: Int32.Int) => { x * y };
      let neg = (x: Int32.Int) => { -x };
      print(sub(Int32.minimum, 0));
      print(neg(Int32.maximum));
      print(mul(46340, 46340));
      print(mul(0, -5));
      print(mul(-65536, 32768));
    `),
    ["-2147483648", "-2147483647", "2147395600", "0", "-2147483648"],
  );
});

Deno.test("Int32.Int overflow panics", async () => {
  for (
    const expr of [
      "Int32.maximum + 1",
      "Int32.minimum - 1",
      "-Int32.minimum",
      "Int32.maximum * 2",
      "65536 * 32768",
      "Int32.div(Int32.minimum, -1)",
    ]
  ) {
    assertStringIncludes(
      await panics(`let f = (x: Int32.Int) => { x }; print(f(${expr}));`),
      "Int32 overflow",
      expr,
    );
  }
});

Deno.test("Int32.Int division and modulo floor like SML", async () => {
  assertEquals(
    await runLines(`
      print(Int32.div(7, 2));
      print(Int32.div(-7, 2));
      print(Int32.div(7, -2));
      print(Int32.div(-7, -2));
      print(Int32.mod(7, 2));
      print(Int32.mod(-7, 2));
      print(Int32.mod(7, -2));
      print(Int32.mod(-7, -2));
      print(Int32.mod(-6, 2));
      print(Int32.mod(Int32.minimum, -1));
    `),
    ["3", "-4", "-4", "3", "1", "1", "-1", "-1", "0", "0"],
  );
  assertStringIncludes(await panics(`print(Int32.div(1, 0));`), "Int32 division by zero");
  assertStringIncludes(await panics(`print(Int32.mod(1, 0));`), "Int32 division by zero");
});

Deno.test("Int32 checked operations, conversions and Basis parsers", async () => {
  assertEquals(
    await runLines(`
      print(Int32.checkedAdd(Int32.maximum, 1));
      print(Int32.checkedSub(Int32.minimum, 1));
      print(Int32.checkedMul(65536, -32768));
      print(Int32.checkedAdd(1, 2));
      print(Int32.fromReal64(1.5));
      print(Int32.fromReal64(2147483648));
      print(Int32.fromReal64(-0));
      print(Int32.parseDecimal("-2147483648"));
      print(Int32.parseDecimal("2147483648"));
      print(Int32.parseDecimal(" 1"));
      print(Int32.fromString(" 1x"));
      print(Int32.toString(Int32.minimum));
      print(Int32.toReal64(5) / 2);
    `),
    [
      "None",
      "None",
      "Some(-2147483648)",
      "Some(3)",
      "None",
      "None",
      "Some(0)",
      "Ok(-2147483648)",
      "Err(Overflow)",
      "Err(InvalidInteger)",
      "Ok(1)",
      "-2147483648",
      "2.5",
    ],
  );
});
