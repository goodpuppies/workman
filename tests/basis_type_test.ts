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
let typed = (value: R.Result<Real64.Real, String>) => { value };
print(typed(Ok(3)));
from js.global("JSON") import { parse };
print(match(parse("1")) { R.Ok(_) => { "parsed" }, R.Err(_) => { "failed" } });`,
    }),
    ["Ok(2)", "2", "e", "Ok(3)", "parsed"],
  );
});

Deno.test("the source-owned SubsetML option shares WM's Option type and constructor identities", async () => {
  assertEquals(
    await run({
      "/test/main.wm": `
from "basis/option_value.wm" import * as O;
from "basis/option.wm" import * as Options;
from "basis/result.wm" import * as Results;
from "basis/list.wm" import * as Lists;
let typed = (value: O.Option<Real64.Real>) => { Options.getOr(value, 0) };
print(typed(Some(42)));
print(match(Results.toOption(Ok("yes"))) { O.Some(s) => { s }, O.None => { "no" } });
print(match(Results.toOption(Err("missing"))) { Some(_) => { false }, None => { true } });
print(match(Lists.find([1, 2], (n) => { n == 2 })) { O.Some(n) => { n }, O.None => { 0 } });
print(match(O.Some(3)) { Some(n) => { n }, None => { 0 } });
print(match(None) { O.Some(_) => { false }, O.None => { true } });
`,
    }),
    ["42", "yes", "true", "2", "3", "true"],
  );
});

Deno.test("Result helpers and the independent source datatype share WM and FFI identities", async () => {
  assertEquals(
    await run({
      "/test/main.wm": `
from "basis/result_value.wm" import * as Values;
from "basis/result.wm" import * as Results;
from js.global("JSON") import { parse };
let typed = (value: Values.Result<Int32.Int, String>) => { Results.map(value, (n) => { n + 1 }) };
print(typed(Ok(41)));
print(match(Results.Ok(3)) { Values.Ok(n) => { n }, Values.Err(_) => { 0 } });
print(match(Values.Err("bad")) { Ok(_) => { "ok" }, Err(error) => { error } });
print(match(parse("1")) { Values.Ok(_) => { "parsed" }, Values.Err(_) => { "failed" } });
print(Results.toOption(Values.Ok(7)));
`,
    }),
    ["Ok(42)", "3", "bad", "parsed", "Some(7)"],
  );
});

Deno.test("a source Basis contract accepts renamed type parameters", async () => {
  assertEquals(
    await run({
      "/test/result.wm":
        "// @basis-type Result\ntype Result<value, error> = Ok<value> | Err<error>;",
      "/test/main.wm": `from "./result.wm" import * as R;
let preserve = (value: R.Result<Int32.Int, String>) => { value };
print(preserve(R.Ok(7)));
print(preserve(Err("failure")));`,
    }),
    ["Ok(7)", "Err(failure)"],
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
      "@basis-type Result: the declaration must be Result<a, e> = Ok<a> | Err<e>",
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
let typed = (value: R.Result<Real64.Real, String>) => { value };
print(typed(Ok(1)));`,
    }),
    "Result",
  );
});
