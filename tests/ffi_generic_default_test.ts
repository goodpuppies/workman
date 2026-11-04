import { assertEquals, assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const imports = `
  from js.module("./tests/fixtures/ffi_generic_defaulted.ts") import type { Tagged, Pair };
  from js.module("./tests/fixtures/ffi_generic_defaulted.ts") import unsafe {
    numberTagged, stringTagged, numberPair
  };
`;

Deno.test("a bare reference infers a defaulted type parameter at each use", async () => {
  const result = await checkSource(`${imports}
    let same = (tagged: Tagged) => { tagged };
    let number = same(numberTagged());
    let text = same(stringTagged());
    let annotated = () => { let local: Tagged = numberTagged(); local };
  `);
  expectBinding(result.env, "number", { type: "Tagged<Number>!", vars: 0 });
  expectBinding(result.env, "text", { type: "Tagged<String>!", vars: 0 });
  expectBinding(result.env, "annotated", { type: "Void -> Tagged<Number>!", vars: 0 });
  assertEquals(result.warnings, []);
});

Deno.test("a bare reference in an FFI signature works at each use", async () => {
  const result = await checkSource(`
    from js.module("./tests/fixtures/ffi_generic_defaulted.ts") import type { Tagged };
    from js.module("./tests/fixtures/ffi_generic_defaulted.ts") import unsafe {
      numberTagged, stringTagged, describe: Tagged -> String
    };
    let a = describe(numberTagged());
    let b = describe(stringTagged());
  `);
  expectBinding(result.env, "describe", { type: "Tagged<'a> -> String!", vars: 1 });
  expectBinding(result.env, "a", { type: "String!", vars: 0 });
  expectBinding(result.env, "b", { type: "String!", vars: 0 });
});

Deno.test("explicit arguments may stop before the defaulted parameters", async () => {
  const result = await checkSource(`${imports}
    let pair: Pair<Number> = numberPair();
    let both: Pair<Number, Number> = numberPair();
  `);
  expectBinding(result.env, "pair", { type: "Pair<Number, Number>!", vars: 0 });
  expectBinding(result.env, "both", { type: "Pair<Number, Number>!", vars: 0 });
});

Deno.test("an explicit argument is still checked against the value", async () => {
  await assertRejects(() =>
    checkSource(`${imports}
      let wrong: Tagged<String> = numberTagged();
    `)
  );
});

Deno.test("a type parameter with no default can't be omitted", async () => {
  await assertRejects(
    () => checkSource(`${imports} let pair: Pair = numberPair();`),
    Error,
    "Pair expects 2 type arguments",
  );
  await assertRejects(
    () => checkSource(`${imports} let pair: Pair<Number, Number, Number> = numberPair();`),
    Error,
    "Pair expects 2 type arguments",
  );
});

Deno.test("a record field has to write its foreign type arguments", async () => {
  await assertRejects(
    () => checkSource(`${imports} record Holder = { tagged: Tagged };`),
    Error,
    "Tagged expects 1 type arguments",
  );
});
