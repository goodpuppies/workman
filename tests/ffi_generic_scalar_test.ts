import { assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const fixture = "./tests/fixtures/ffi_generic_cell.ts";

Deno.test("scalar literals instantiate generic tuples before discovery types escape", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { makeCell };
    let numeric = () => {
      let (value, set) = makeCell(0) :> Result.debug;
      set(value + 1);
      value + 1
    };
    let textual = () => {
      let (value, set) = makeCell("hello") :> Result.debug;
      set(value ++ "!");
      value ++ "!"
    };
  `);
  expectBinding(result.env, "numeric", { type: "Void -> Number!", vars: 0 });
  expectBinding(result.env, "textual", { type: "Void -> String!", vars: 0 });
});

Deno.test("scalar generic specialization retains unsafe precision and rejects wrong setters", async () => {
  const header = `from js.module("${fixture}") import unsafe { makeCell };`;
  const result = await checkSource(`${header}
    let numeric = () => {
      let (value, set) = makeCell(0);
      set(value + 1);
      value + 1
    };
  `);
  expectBinding(result.env, "numeric", { type: "Void -> Number!", vars: 0 });
  await assertRejects(() =>
    checkSource(`${header}
    let wrong = () => {
      let (value, set) = makeCell(0);
      set("wrong")
    };
  `)
  );
});

Deno.test("HM scalar arguments specialize erased generics without annotations", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { makeCell };
    let numeric = () => {
      let initial = 1 + 2;
      let (value, set) = makeCell(initial) :> Result.debug;
      set(value + 1);
      value + 1
    };
  `);
  expectBinding(result.env, "numeric", { type: "Void -> Number!", vars: 0 });
});

Deno.test("generic lazy initializers wait for HM callback result evidence", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { makeCell };
    let numeric = () => {
      let (value, set) = makeCell(() => { 0 }) :> Result.debug;
      set(value + 1);
      value + 1
    };
  `);
  expectBinding(result.env, "numeric", { type: "Void -> Number!", vars: 0 });
});
