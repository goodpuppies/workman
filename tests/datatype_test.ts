import { assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("polymorphic datatype constructors generalize over type parameters", async () => {
  const result = await checkSource(`
    type Option<T> = None | Some<T>;
    let none = None;
    let some_number = Some(1);
    let some_string = Some("s");
  `);

  expectBinding(result.env, "None", { type: "Option<T>", vars: 1 });
  expectBinding(result.env, "Some", { type: "(T) => Option<T>", vars: 1 });
  expectBinding(result.env, "none", { type: "Option<'a>", vars: 1 });
  expectBinding(result.env, "some_number", { type: "Option<Number>", vars: 0 });
  expectBinding(result.env, "some_string", { type: "Option<String>", vars: 0 });
});

Deno.test("constructor arity is checked in expressions and patterns", async () => {
  await assertRejects(
    () => checkSource("type Pair = | Pair<Number, Number>; let bad = Pair(1);"),
    Error,
    "type mismatch",
  );
  await assertRejects(
    () =>
      checkSource(`
        type Pair = | Pair<Number, Number>;
        let value = Pair(1, 2);
        let bad = match(value) => { Pair(x) => { x } };
      `),
    Error,
    "Pair expects 2 patterns",
  );
});

Deno.test("type constructor arity is checked for datatypes and aliases", async () => {
  await assertRejects(
    () => checkSource("type Box<T> = | Box<T>; let bad: Box = Box(1);"),
    Error,
    "Box expects 1 type arguments",
  );
  await assertRejects(
    () => checkSource("type Pair<A, B> = | Pair<A, B>; type Bad<T> = Pair<T>;"),
    Error,
    "Pair expects 2 type arguments",
  );
});

Deno.test("type alias parameter substitution preserves sharing", async () => {
  const result = await checkSource(`
    type Pair<T> = (T, T);
    let first_same = (pair: Pair<Number>) => {
      let (x, _) = pair;
      x
    };
  `);

  expectBinding(result.env, "first_same", { type: "((Number, Number)) => Number", vars: 0 });
});
