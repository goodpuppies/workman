import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";

const parser = await import(
  new URL("../src/generated/frontend_v2_parser.js", import.meta.url).href
) as { formatSurfaceSource(source: string): { name: "Some" | "None"; a0: string } };

const library = `
private let helper = (n) => { n * 2 };
private let rec even = (n) => { if (n == 0) { true } else { odd(n - 1) } }
and odd = (n) => { if (n == 0) { false } else { even(n - 1) } };
private type Hidden = | Secret<Int32.Int> and Other = | OtherSecret;
private record Point = { x: Int32.Int, y: Int32.Int };
let double = (n) => { helper(n) };
let isEven = (n) => { even(n) };
let reveal = (n) => { match(Secret(n)) { Secret(m) => { m } } };
let norm = (n) => { let p = .{ x = n, y = n }; p.x + p.y };
`;

async function run(main: string): Promise<string[]> {
  const files = new Map([["/test/lib.wm", library], ["/test/main.wm", main]]);
  const js = await compileVirtual("/test/main.wm", files);
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/main.mjs`;
    await Deno.writeTextFile(path, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-config", path],
      stdout: "piped",
    }).output();
    return new TextDecoder().decode(result.stdout).trim().split("\n");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("private declarations are visible in their module and hidden from importers", async () => {
  assertEquals(
    await run(`
      from "./lib.wm" import * as Lib;
      print((Lib.double(4), Lib.isEven(10), Lib.reveal(3), Lib.norm(5)));
    `),
    ["(8, true, 3, 10)"],
  );
  for (
    const use of [
      "Lib.helper(1)",
      "Lib.even(2)",
      "Lib.odd(2)",
      "Lib.Secret(1)",
      "Lib.OtherSecret",
      "let value: Lib.Hidden = Lib.reveal(1);",
      "let value: Lib.Other = Lib.reveal(1);",
      "let p: Lib.Point = Lib.norm(1);",
    ]
  ) {
    const main = `from "./lib.wm" import * as Lib;\n${
      use.endsWith(";") ? use : `let it = ${use};`
    }`;
    const error = await assertRejects(
      () =>
        checkVirtual(
          "/test/main.wm",
          new Map([["/test/lib.wm", library], ["/test/main.wm", main]]),
        ),
    );
    assertStringIncludes(String(error), "unknown", use);
  }
});

Deno.test("a public binding whose type mentions a private type is an error", async () => {
  const error = await assertRejects(() =>
    checkVirtual(
      "/test/main.wm",
      new Map([[
        "/test/main.wm",
        "private type Hidden = | Secret<Int32.Int>; let leak = Secret(1);",
      ]]),
    )
  );
  assertStringIncludes(String(error), "non-exported type");
});

Deno.test("private is contextual: it stays usable as a name", async () => {
  const files = new Map([[
    "/test/main.wm",
    "let private = 2; let twice = private * 2; private;",
  ]]);
  await checkVirtual("/test/main.wm", files);
});

Deno.test("the formatter keeps private declarations", () => {
  const source =
    "private let x = 1;\nprivate type T = | A | B;\nprivate record R = { a: Int32.Int };";
  const formatted = parser.formatSurfaceSource(source);
  assertEquals(formatted.name, "Some");
  assertEquals(formatted.a0, source);
});
