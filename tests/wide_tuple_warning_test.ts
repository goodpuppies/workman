import { assertEquals, assertStringIncludes } from "@std/assert";
import { checkSource } from "../src/compiler.ts";

Deno.test("wide tuple expressions and patterns produce style warnings", async () => {
  const result = await checkSource(`
    let values = (1, 2, 3, 4, 5);
    let fifth = match(values) {
      (_, _, _, _, Var(value)) => { value }
    };
  `);

  assertEquals(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["style.wide-tuple", "style.wide-tuple"],
  );
  assertStringIncludes(result.warnings[0], "tuple expression has 5 elements");
  assertStringIncludes(result.warnings[1], "tuple pattern has 5 elements");
});

Deno.test("wide carrier pipes remain valid and recommend a record boundary", async () => {
  const result = await checkSource(`
    record Values = {
      first: Number,
      second: Number,
      third: Number,
      fourth: Number,
      fifth: Number,
    };

    let values = Result|Ok(1), Ok(2), Ok(3), Ok(4), Ok(5)|
      :> Result.map((first, second, third, fourth, fifth) => {
        .{ first, second, third, fourth, fifth }
      });
  `);

  assertEquals(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "style.wide-tuple",
  ]);
  assertStringIncludes(result.warnings[0], "carrier pipe has 5 elements");
  assertStringIncludes(result.warnings[0], "named record immediately");
});

Deno.test("tuples with four elements do not produce a style warning", async () => {
  const result = await checkSource("let values = (1, 2, 3, 4);");

  assertEquals(result.diagnostics, []);
  assertEquals(result.warnings, []);
});
