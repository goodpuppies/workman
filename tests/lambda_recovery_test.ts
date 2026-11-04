import { assertEquals } from "@std/assert";
import { parseCompilerModule } from "../src/compiler_frontend.ts";

const frontendV2ModuleUrl = new URL("../src/generated/frontend_v2_parser.js", import.meta.url);

async function bindingKinds(source: string) {
  const module = await parseCompilerModule(source, { frontend: "v2", frontendV2ModuleUrl });
  return module.decls.flatMap((declaration) =>
    declaration.kind === "LetDecl"
      ? declaration.bindings.map((binding) => [
        binding.pattern.kind === "PVar" ? binding.pattern.name : "?",
        binding.value.kind,
      ])
      : []
  );
}

for (
  const source of [
    "let f = () => { 1",
    "let f = (x) => { x",
    "let f = x => { x",
    "let f = (x: String) => { x",
    "let f = (x, y) => { x",
    "let f = (x): Number => { x",
    "let f = (x) => { @gpu x };",
  ]
) {
  Deno.test(`an unfinished lambda recovers as one lambda: ${source}`, async () => {
    assertEquals(await bindingKinds(source), [["f", "Lambda"]]);
  });
}

Deno.test("recovery keeps parentheses that aren't lambda parameters as a group", async () => {
  assertEquals(await bindingKinds("let a = (1)\nlet b = (a, 2)"), [
    ["a", "Int"],
    ["b", "Tuple"],
  ]);
});

Deno.test("a lambda inside an unfinished block still recovers", async () => {
  assertEquals(await bindingKinds("let f = () => {\n  let g = (x) => { x\n"), [["f", "Lambda"]]);
});
