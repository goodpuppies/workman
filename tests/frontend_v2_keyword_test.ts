import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import peggy from "peggy";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { ParseError } from "../src/parser.ts";

Deno.test("frontend-v2 treats record contextually while retaining rec, prefixes and primed names", async () => {
  const reference = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  for (
    const source of [
      "let record = 1;",
      "let value: record = 1;",
      "let read = (record) => { record };",
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

Deno.test("frontend-v2 accepts record as a field name and preserves formatting", async () => {
  const reference = peggy.generate(
    await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
  );
  {
    const name = "record";
    const source = [
      `record Wire = { ${name}: Js.Object };`,
      `let wire = Wire{ ${name} = object };`,
      `let copy = .{ ${name} = object };`,
      `let .{ ${name} = bound } = wire;`,
      `let read = (.{ ${name} = value }) => { value };`,
      `let selected = match(wire) { .{ ${name} = Var(value) } => { value } };`,
      `let object = wire.${name};`,
      `let json = JSON{ ${name}: 1 };`,
    ].join("\n");
    const expected = reference.parse(source) as { decls: unknown[] };
    const actual = await parseCompilerModule(source);
    assertEquals(actual.decls.length, expected.decls.length);
    const formatted = await formatFrontendV2Source(source);
    const roundTrip = await parseCompilerModule(formatted);
    assertEquals(roundTrip.decls.length, actual.decls.length);
    assertEquals(await formatFrontendV2Source(formatted), formatted);
  }
});
