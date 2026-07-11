import { assertEquals, assertStringIncludes } from "@std/assert";
import { typeDebugFile } from "../src/type_debug.ts";

Deno.test("type-debug prints type facts and unresolved FFI facts", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(main, 'let value = (x) => { "a" ++ x.foo };\n');

  const output = await typeDebugFile(main);

  assertStringIncludes(output, "nearby type facts:");
  assertStringIncludes(output, 'PVar "x"');
  assertStringIncludes(output, "ffi facts:");
  assertStringIncludes(output, "status: unresolved");
  assertStringIncludes(output, "constraints:");
  assertStringIncludes(output, "String");
  assertStringIncludes(output, "?ffi#");
});

Deno.test("type-debug hides the standard-library environment by default", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(main, "let answer = 42;\n");

  const output = await typeDebugFile(main);

  assertStringIncludes(output, "note: std env hidden");
  assertStringIncludes(output, "answer: Number");
  assertEquals(output.includes("List.map:"), false);
});
