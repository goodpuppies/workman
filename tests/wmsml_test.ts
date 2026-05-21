import { assertEquals, assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { show } from "../src/types.ts";
import type { SurfaceName } from "./type_helpers.ts";

async function inferred(source: string, name: string, surface: SurfaceName) {
  const result = await checkSource(source, { surface });
  const scheme = result.env.get(name);
  if (!scheme) throw new Error(`missing inferred binding ${name}`);
  return { type: show(scheme.type), vars: scheme.vars.length };
}

async function assertSameBindingType(name: string, workman: string, wmsml: string) {
  assertEquals(
    await inferred(wmsml, name, "wmsml"),
    await inferred(workman, name, "workman"),
  );
}

Deno.test("wmsml val and fn elaborate to the same core as Workman let and lambda", async () => {
  await assertSameBindingType(
    "id",
    "let id = (x) => { x };",
    "val id = fn x => x",
  );
});

Deno.test("wmsml tuple arguments and SML application match Workman tuple-call core", async () => {
  await assertSameBindingType(
    "fst",
    "let fst = (x, y) => { x };",
    "val fst = fn (x, y) => x",
  );
  await assertSameBindingType(
    "value",
    "let fst = (x, y) => { x }; let value = fst(1, true);",
    "val fst = fn (x, y) => x; val value = fst (1, true)",
  );
});

Deno.test("wmsml datatype and case elaborate to same nominal ADT core as Workman type and match", async () => {
  await assertSameBindingType(
    "get",
    `
      type Option<T> = None | Some<T>;
      let get = match(opt) => {
        Some(x) => { x },
        None => { 0 },
      };
    `,
    `
      datatype 'a Option = None | Some of 'a
      val get = fn opt =>
        case opt of
          Some x => x
        | None => 0
    `,
  );
});

Deno.test("wmsml accepts SML-style lowercase type constructors", async () => {
  assertEquals(
    await inferred(
      `
        datatype 'a option = NONE | SOME of 'a
        val get = fn opt =>
          case opt of
            SOME x => x
          | NONE => 0
      `,
      "get",
      "wmsml",
    ),
    { type: "(option<Number>) => Number", vars: 0 },
  );
});

Deno.test("wmsml val rec elaborates to Workman let rec", async () => {
  await assertSameBindingType(
    "fact",
    `
      let rec fact = match(n) => {
        0 => { 1 },
        _ => { n * fact(n - 1) },
      };
    `,
    `
      val rec fact = fn n =>
        case n of
          0 => 1
        | _ => n * fact (n - 1)
    `,
  );
});

Deno.test("wmsml pattern variables bind by default instead of pinning", async () => {
  await checkSource(
    `
      val keep = fn pair =>
        case pair of
          (x, y) => x
    `,
    { surface: "wmsml" },
  );
});

Deno.test("wmsml pattern identifiers are constructor-sensitive through the datatype environment", async () => {
  assertEquals(
    await inferred(
      `
        datatype color = Red | Blue
        val f = fn color =>
          case color of
            Red => 1
          | other => 2
      `,
      "f",
      "wmsml",
    ),
    { type: "(color) => Number", vars: 0 },
  );
});

Deno.test("wmsml nested comments are accepted", async () => {
  await checkSource(
    `
      (* outer (* inner *) still outer *)
      val id = fn x => x
    `,
    { surface: "wmsml" },
  );
});

Deno.test("wmsml duplicate binders are rejected by the shared frontend", async () => {
  await assertRejects(
    () => checkSource("val bad = fn (x, x) => x", { surface: "wmsml" }),
    Error,
    "duplicate pattern binder x",
  );
});
