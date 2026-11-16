import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, checkVirtual, compileVirtual } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

async function run(source: string, extra = new Map<string, string>()): Promise<string[]> {
  const files = new Map([["/test/main.wm", source], ...extra]);
  const js = await compileVirtual("/test/main.wm", files);
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/main.mjs`;
    await Deno.writeTextFile(path, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-config", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim().split(/\r?\n/);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("ordinary literals take each existing exact numeric type from context", async () => {
  assertEquals(
    await run(`
    let byte: Word8.Word = 255;
    let port: Word16.Word = 65535;
    let flags: Word32.Word = 4294967295;
    let mask: Word64.Word = 18446744073709551615;
    let min: Int64.Int = -9223372036854775808;
    let max: Int64.Int = 9223372036854775807;
    print(Word8.toReal64(byte));
    print(Word16.toReal64(port));
    print(Word32.toReal64(flags));
    print(Text.of(mask));
    print(Int64.toString(min));
    print(Int64.toString(max));
    print(Word8.toReal64(Word8.add(254, 1)));
    print(Text.of(Word64.add(9007199254740993, 2)));
  `),
    [
      "255",
      "65535",
      "4294967295",
      "18446744073709551615",
      "-9223372036854775808",
      "9223372036854775807",
      "255",
      "9007199254740995",
    ],
  );
});

Deno.test("hexadecimal literals and patterns preserve exact 64-bit magnitudes", async () => {
  assertEquals(
    await run(`
    let mask: Word64.Word = 0xffffffffffffffff;
    let min: Int64.Int = -0x8000000000000000;
    print(Text.of(mask));
    print(Int64.toString(min));
    print(match(mask) { 0xfffffffffffffffe => { "wrong" }, 0xffffffffffffffff => { "max" }, _ => { "other" } });
    print(match(min) { -9223372036854775808 => { "min" }, _ => { "other" } });
    let (9007199254740993: Word64.Word) = (9007199254740993: Word64.Word);
    print("matched binding");
  `),
    ["18446744073709551615", "-9223372036854775808", "max", "min", "matched binding"],
  );
});

Deno.test("large unresolved literals retain Real64 defaults and exact types do not coerce existing values", async () => {
  assertEquals(
    await run(`
    let number = 9007199254740993;
    let half = x => x / 2;
    print(number);
    print(half(1));
    print((1: Int32.Int));
  `),
    ["9007199254740992", "0.5", "1"],
  );
  for (
    const source of [
      "let number = 1; let byte: Word8.Word = number;",
      "let bad: Word8.Word = 1.0;",
      "let byte: Word8.Word = 1; let bad: Word16.Word = byte;",
      // Words take `+ - * %` since 0.8.0, but not negation (Appendix E: `~` is `realint`).
      "let bad = (x: Word8.Word) => { -x };",
    ]
  ) {
    await assertRejects(() => checkVirtual("/test/main.wm", new Map([["/test/main.wm", source]])));
  }
});

Deno.test("integer defaults are fixed at declaration boundaries and respect signed ranges", async () => {
  const result = await checkSource(`
    let zero = 0;
    let minimum = -2147483648;
    let maximum = 2147483647;
    let above = 2147483648;
    let below = -2147483649;
    let nonNegative = value => if (value < 0) { 0 } else { value };
    let realNonNegative = (value: Real64) => if (value < 0) { 0 } else { value };
    let realLiteral = 1.0;
    let exponent = 1e3;
    let add = (left, right) => left + right;
  `);
  for (const name of ["zero", "minimum", "maximum"]) {
    expectBinding(result.env, name, { type: "Int32.Int", vars: 0 });
  }
  for (const name of ["above", "below", "realLiteral", "exponent"]) {
    expectBinding(result.env, name, { type: "Real64.Real", vars: 0 });
  }
  expectBinding(result.env, "nonNegative", { type: "Int32.Int -> Int32.Int", vars: 0 });
  expectBinding(result.env, "realNonNegative", { type: "Real64.Real -> Real64.Real", vars: 0 });
  expectBinding(result.env, "add", { type: "(Real64.Real, Real64.Real) -> Real64.Real", vars: 0 });
  for (
    const source of [
      "let n = 1; let real: Real64 = n;",
      "let nonNegative = x => if (x < 0) { 0 } else { x }; nonNegative(1.5);",
    ]
  ) await assertRejects(() => checkSource(source));
});

Deno.test("Int32 values use JS number parameters and methods without widening WM calls", async () => {
  assertEquals(
    await run(`
    from js.global("Math") import unsafe { max };
    from js.global("Math") import unsafe * as Math;
    let one = 1;
    let two = 2;
    print(max(one, two));
    print(Math.max(one, two));
    print(one :> .toString() :> Result.getOr("failed"));
  `),
    ["2", "2", "1"],
  );
  await assertRejects(() =>
    checkSource(`
    let takesReal = (n: Real64) => n;
    let n = 1;
    takesReal(n);
  `)
  );
  await assertRejects(() =>
    checkSource(`
    from js.global("Math") import unsafe { max };
    let integer: Int32 = max(1, 2);
  `)
  );
});

Deno.test("reflection decides numeric fallbacks before integer defaulting", async () => {
  assertEquals(
    await run(`
    let width = value => value :> .length :> Result.getOr(0);
    let actual: Real64 = width("abc");
    print(actual);
  `),
    ["3"],
  );
});

Deno.test("undecided integer literals in GPU lambdas retain the real default", async () => {
  const result = await checkSource(`
    let host = 1;
    let shade = uv => {
      @gpu;
      let value = 1;
      Gpu.color((value, value, value, 1))
    };
  `);
  expectBinding(result.env, "host", { type: "Int32.Int", vars: 0 });
  expectBinding(result.env, "shade", {
    type: "'a -> (Real64.Real, Real64.Real, Real64.Real, Real64.Real)",
    vars: 1,
  });
});

Deno.test("selected numeric types report literal range errors without wrapping or rounding", async () => {
  for (
    const [type, literal] of [
      ["Word8.Word", "256"],
      ["Word8.Word", "-1"],
      ["Word16.Word", "65536"],
      ["Word32.Word", "4294967296"],
      ["Word64.Word", "18446744073709551616"],
      ["Word64.Word", "-1"],
      ["Int64.Int", "9223372036854775808"],
      ["Int64.Int", "-9223372036854775809"],
      ["Int32.Int", "2147483648"],
    ]
  ) {
    const error = await assertRejects(
      () =>
        checkVirtual(
          "/test/main.wm",
          new Map([
            ["/test/main.wm", `let bad: ${type} = ${literal};`],
          ]),
        ),
      Error,
      "out of range",
    );
    assertStringIncludes(error.message, type);
    assertStringIncludes(error.message, literal);
  }
});

Deno.test("literal constraints follow aliases and module boundaries without admitting user numeric lookalikes", async () => {
  assertEquals(
    await run(
      `
    from "./values.wm" import { echo, exact };
    type Byte = Word8.Word;
    let local: Byte = 42;
    print(Word8.toReal64(local));
    print(Text.of(echo(9007199254740993)));
    print(Text.of(exact));
  `,
      new Map([[
        "/test/values.wm",
        `
    let echo = (value: Word64.Word) => { value };
    let exact: Word64.Word = 18446744073709551615;
  `,
      ]]),
    ),
    ["42", "9007199254740993", "18446744073709551615"],
  );
  await assertRejects(() =>
    checkVirtual(
      "/test/main.wm",
      new Map([
        ["/test/main.wm", 'from "./fake.wm" import * as Fake; let bad: Fake.Word = 1;'],
        ["/test/fake.wm", "record Word = { value: Real64.Real };"],
      ]),
    )
  );
});

Deno.test("failed numeric inference does not affect the next inference session", async () => {
  await assertRejects(() =>
    checkVirtual(
      "/test/main.wm",
      new Map([
        ["/test/main.wm", "let pending = x => { x + 1 }; let invalid: Word8.Word = 256;"],
      ]),
    )
  );
  assertEquals(
    await run(`let value: Word64.Word = 9007199254740993; print(Text.of(value));`),
    ["9007199254740993"],
  );
});

Deno.test("exact word literals need no runtime library in the kernel profile", async () => {
  assertEquals(
    await run(`-- @no-prelude
    let byte: Word8.Word = 255;
    let mask: Word64.Word = 18446744073709551615;
    print(byte);
    print(mask);
  `),
    ["255", "18446744073709551615"],
  );
});

Deno.test("arithmetic operators follow the Appendix E classes for every numeric type", async () => {
  assertEquals(
    await run(`
    let w: Word8.Word = 250;
    print((w + 10, w - 251, w * 2, w % 7, w < 251));
    let big: Word64.Word = 0xffffffffffffffff;
    print((big + 2, big % 10));
    let w32: Word32.Word = 0xffffffff;
    print((w32 * w32, w32 + 1));
    let i: Int64.Int = 9000000000;
    print((i * 3, -i, i % 7, -7 % (2: Int64.Int)));
    let f: Real32.Real = 0.1 :> Real32.fromReal64;
    print((f + f, -f, f + 1));
    let isEven = (n) => { n % 2 == 0 };
    print((isEven(4), -7 % 2, 7 % -2, -2147483648 % -1));
    print(7.5 % 2);
  `),
    [
      "(4, 255, 244, 5, true)",
      "(1, 5)",
      "(1, 0)",
      "(27000000000, -9000000000, 5, -1)",
      "(0.20000000298023224, -0.10000000149011612, 1.100000023841858)",
      "(true, -1, 1, 0)",
      "1.5",
    ],
  );
  for (
    const source of [
      "let n: Int32.Int = 5; let bad = n / 2;",
      "let w: Word16.Word = 5; let bad = w / 2;",
      "let i: Int64.Int = 5; let bad = -i / 2;",
    ]
  ) {
    await assertRejects(() => checkVirtual("/test/main.wm", new Map([["/test/main.wm", source]])));
  }
});

Deno.test("integer % and overflow fail instead of producing NaN or wrapping", async () => {
  for (
    const [source, message] of [
      ["let z: Int32.Int = 0; print(5 % z);", "Int32 division by zero"],
      ["let z: Word8.Word = 0; let w: Word8.Word = 5; print(w % z);", "Word8 division by zero"],
      ["let z: Int64.Int = 0; let i: Int64.Int = 5; print(i % z);", "Int64 division by zero"],
      ["let i: Int64.Int = 9223372036854775807; print(i + 1);", "Int64 overflow"],
    ] as const
  ) {
    await assertRejects(() => run(source), Error, message);
  }
});
