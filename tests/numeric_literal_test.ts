import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";

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
    print(Word8.toNumber(byte));
    print(Word16.toNumber(port));
    print(Word32.toNumber(flags));
    print(Text.of(mask));
    print(Int64.toString(min));
    print(Int64.toString(max));
    print(Word8.toNumber(Word8.add(254, 1)));
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

Deno.test("unresolved literals retain Number defaults and exact types do not coerce existing values", async () => {
  assertEquals(
    await run(`
    let number = 9007199254740993;
    let half = x => x / 2;
    print(number);
    print(half(1));
    print((1: I32));
  `),
    ["9007199254740992", "0.5", "1"],
  );
  for (
    const source of [
      "let number = 1; let byte: Word8.Word = number;",
      "let bad: Word8.Word = 1.0;",
      "let byte: Word8.Word = 1; let bad: Word16.Word = byte;",
      "let bad = (x: Word8.Word) => { x + 1 };",
    ]
  ) {
    await assertRejects(() => checkVirtual("/test/main.wm", new Map([["/test/main.wm", source]])));
  }
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
      ["I32", "2147483648"],
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
    print(Word8.toNumber(local));
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
        ["/test/fake.wm", "record Word = { value: Number };"],
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
