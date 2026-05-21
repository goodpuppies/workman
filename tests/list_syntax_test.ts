import { assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const listPrelude = "type List<T> = Nil | Cons<T, List<T>>;";

Deno.test("list literals lower to the algebraic list model", async () => {
  const result = await checkSource(`
    ${listPrelude}
    let empty = [];
    let nums = [1, 2, 3];
    let more = [0, ..nums];
  `);

  expectBinding(result.env, "empty", { type: "List<'a>", vars: 1 });
  expectBinding(result.env, "nums", { type: "List<Number>", vars: 0 });
  expectBinding(result.env, "more", { type: "List<Number>", vars: 0 });
});

Deno.test("list patterns lower to constructor patterns", async () => {
  const result = await checkSource(`
    ${listPrelude}
    let rec sum = match(xs) => {
      [] => { 0 },
      [head, ..tail] => { head + sum(tail) },
    };
    let first_two = match(xs) => {
      [a, b, .._] => { (a, b) },
      _ => { (0, 0) },
    };
  `);

  expectBinding(result.env, "sum", { type: "(List<Number>) => Number", vars: 0 });
  expectBinding(result.env, "first_two", {
    type: "(List<Number>) => (Number, Number)",
    vars: 0,
  });
});

Deno.test("list pattern binder duplicates are rejected", async () => {
  await assertRejects(
    () =>
      checkSource(`
        ${listPrelude}
        let bad = match(xs) => {
          [x, x] => { x },
          _ => { 0 },
        };
      `),
    Error,
    "duplicate pattern binder x",
  );
});

Deno.test("list syntax requires an in-scope algebraic list model", async () => {
  await assertRejects(
    () => checkSource("let nums = [1, 2, 3];"),
    Error,
    "unknown name Nil",
  );
});
