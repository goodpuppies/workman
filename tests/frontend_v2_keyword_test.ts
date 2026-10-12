import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import peggy from "peggy";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { ParseError } from "../src/parser.ts";

Deno.test("frontend-v2 reserves record while retaining rec, prefixes and primed names", async () => {
  const reference = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  for (const source of ["let record = 1;", "let value: record = 1;"]) {
    assertThrows(() => reference.parse(source));
    await assertRejects(() => parseCompilerModule(source), ParseError);
  }
  for (
    const source of [
      "record Point = {x: Number}; let p = Point(1);",
      "let rec loop = (x) => {loop(x)};",
      "let recorder = 1; let record' = 2; let rec' = 3;",
    ]
  ) {
    const expected = reference.parse(source) as { decls: unknown[] };
    const actual = await parseCompilerModule(source);
    assertEquals(actual.decls.length, expected.decls.length);
  }
});

Deno.test("frontend-v2 pattern guards exclude exact Var without excluding longer constructors", async () => {
  const reference = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  for (
    const source of [
      "let Ctor(Variant) = value;",
      "let Ctor(Variety) = value;",
      "let Ctor(Var') = value;",
      "let selected = match(value) { Ctor(Variant(x)) => { x } };",
      "let Var(A) = value;",
    ]
  ) {
    const expected = reference.parse(source) as { decls: unknown[] };
    const actual = await parseCompilerModule(source);
    assertEquals(actual.decls.length, expected.decls.length);
  }
  for (
    const source of [
      "let Ctor(Var(x)) = value;",
      "let Ctor(Var) = value;",
      "let selected = match(value) { Ctor(Var(x)) => { x } };",
    ]
  ) {
    assertThrows(() => reference.parse(source));
    await assertRejects(() => parseCompilerModule(source), ParseError);
  }
});
