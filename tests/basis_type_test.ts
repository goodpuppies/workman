import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";

const resultModule = `// @basis-type Result
type Result<a, e> = Ok<a> | Err<e>;
let map = (value, f) => { match(value) { Ok(x) => { Ok(f(x)) }, Err(e) => { Err(e) } } };
`;

async function run(files: Record<string, string>): Promise<string[]> {
  const js = await compileVirtual("/test/main.wm", new Map(Object.entries(files)));
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/main.mjs`, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", `${directory}/main.mjs`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    assertEquals(result.code, 0, decoder.decode(result.stderr));
    return decoder.decode(result.stdout).trim().split("\n");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function typeError(files: Record<string, string>): Promise<string> {
  try {
    await checkVirtual("/test/main.wm", new Map(Object.entries(files)));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert(false, "expected an error");
}

Deno.test("a @basis-type declaration is the built-in type and constructors", async () => {
  assertEquals(
    await run({
      "/test/result.wm": resultModule,
      "/test/main.wm": `from "./result.wm" import * as R;
print(R.map(Ok(1), (x) => { x + 1 }));
print(match(R.Ok(2)) { Ok(n) => { n }, Err(_) => { 0 } });
print(match(Err("e")) { R.Ok(_) => { "ok" }, R.Err(e) => { e } });
let typed = (value: R.Result<Number, String>) => { value };
print(typed(Ok(3)));
from js.global("JSON") import { parse };
print(match(parse("1")) { R.Ok(_) => { "parsed" }, R.Err(_) => { "failed" } });`,
    }),
    ["Ok(2)", "2", "e", "Ok(3)", "parsed"],
  );
});

Deno.test("a @basis-type declaration must match the built-in", async () => {
  for (
    const declaration of [
      "type Result<a, e> = Ok<a> | Fail<e>;",
      "type Result<a, e> = Err<e> | Ok<a>;",
      "type Result<a, e> = Ok<e> | Err<a>;",
      "type Result<a> = Ok<a> | Err<a>;",
      "type Result<a, e> = Ok<List<a>> | Err<e>;",
    ]
  ) {
    assertStringIncludes(
      await typeError({ "/test/main.wm": `// @basis-type Result\n${declaration}\n` }),
      "@basis-type Result: the declaration must be Result<T, E> = Ok<T> | Err<E>",
      declaration,
    );
  }
  assertStringIncludes(
    await typeError({ "/test/main.wm": "// @basis-type Shape\ntype Shape = Circle;\n" }),
    "@basis-type Shape: there is no built-in datatype of that name",
  );
});

Deno.test("without the directive a Result declaration is a new type", async () => {
  assertStringIncludes(
    await typeError({
      "/test/result.wm": "type Result<a, e> = Ok<a> | Err<e>;\n",
      "/test/main.wm": `from "./result.wm" import * as R;
let typed = (value: R.Result<Number, String>) => { value };
print(typed(Ok(1)));`,
    }),
    "Result",
  );
});
