import { assertEquals, assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { toNullable } from "../src/integrations/interop.mjs";
// A Workman module of the compiler, imported directly: deno.json maps it to its generated
// artifact at runtime, and tsc types it through the content mapper.
import { suggestName } from "../src/name_suggestion.wm";

const suggest = (name: string, candidates: string[]) => toNullable(suggestName(name, candidates));

Deno.test("suggests the closest name within a third of its length", () => {
  assertEquals(suggest("totl", ["count", "total", "totals"]), "total");
  assertEquals(suggest("lenght", ["length", "list"]), "length");
  assertEquals(suggest("mapPartal", ["map", "mapPartial", "mapPartial2"]), "mapPartial");
  // Short names allow one edit.
  assertEquals(suggest("xs", ["x", "ys"]), "x");
});

Deno.test("suggests nothing for exact, distant, or absent names", () => {
  assertEquals(suggest("total", ["total"]), undefined);
  assertEquals(suggest("total", ["fragment", "length"]), undefined);
  assertEquals(suggest("total", []), undefined);
});

Deno.test("unknown names suggest the closest name in scope", async () => {
  await assertRejects(
    () => checkSource("let total = 1; let main = () => totl + 1;"),
    Error,
    'unknown name totl; did you mean "total"?',
  );
});
