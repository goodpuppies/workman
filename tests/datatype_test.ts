import { assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("basis exposes Option and Result constructors", async () => {
  const result = await checkSource(`
    let maybe = Some(1);
    let missing: Option<Number> = None;
    let ok = Ok("value");
    let err: Result<String, Number> = Err(404);
    let get = match(maybe) => {
      Some(value) => { value },
      None => { 0 },
    };
    let unwrapped = get(maybe);
  `);

  expectBinding(result.env, "Some", { type: "(T) => Option<T>", vars: 1 });
  expectBinding(result.env, "None", { type: "Option<T>", vars: 1 });
  expectBinding(result.env, "Ok", { type: "(T) => Result<T, E>", vars: 2 });
  expectBinding(result.env, "Err", { type: "(E) => Result<T, E>", vars: 2 });
  expectBinding(result.env, "maybe", { type: "Option<Number>", vars: 0 });
  expectBinding(result.env, "missing", { type: "Option<Number>", vars: 0 });
  expectBinding(result.env, "ok", { type: "Result<String, 'a>", vars: 1 });
  expectBinding(result.env, "err", { type: "Result<String, Number>", vars: 0 });
  expectBinding(result.env, "get", { type: "(Option<Number>) => Number", vars: 0 });
  expectBinding(result.env, "unwrapped", { type: "Number", vars: 0 });
});

Deno.test("no-prelude directive permits a self-contained Result", async () => {
  const result = await checkSource(`
    -- @no-prelude
    type Result<T, E> = Ok<T> | Err<E>;
    record Carrier<A, B> = { liftFn: (A) => B };
    let Var(Result) = .{ liftFn = (f) => { (value) => { f(value) } } };
    let value = Ok(1);
  `);

  expectBinding(result.env, "Ok", { type: "(T) => Result<T, E>", vars: 2 });
  expectBinding(result.env, "value", { type: "Result<Number, 'a>", vars: 1 });
  if (result.env.has("Some") || result.env.has("Result.map")) {
    throw new Error("no-prelude module unexpectedly received prelude bindings");
  }
});

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

Deno.test("value restriction keeps ordinary call results monomorphic", async () => {
  await assertRejects(
    () =>
      checkSource(`
        type Option<T> = None | Some<T>;
        let make = () => { None };
        let value = make();
        let as_number: Option<Number> = value;
        let as_string: Option<String> = value;
      `),
    Error,
    "type mismatch",
  );
});

Deno.test("value restriction still generalizes non-expansive constructor applications", async () => {
  const result = await checkSource(`
    type Option<T> = None | Some<T>;
    let value = Some(None);
    let as_number: Option<Option<Number>> = value;
    let as_string: Option<Option<String>> = value;
  `);

  expectBinding(result.env, "value", { type: "Option<Option<'a>>", vars: 1 });
});

Deno.test("value restriction uses current identifier status for constructor applications", async () => {
  await assertRejects(
    () =>
      checkSource(
        `
          datatype 'a option = NONE | SOME of 'a
          val rec SOME = fn _ => NONE
          val value = SOME 0
          val as_number: int option = value
          val as_string: string option = value
        `,
        { surface: "wmsml" },
      ),
    Error,
    "type mismatch",
  );
});

Deno.test("value restriction leaves top-level expansive type variables monomorphic", async () => {
  const result = await checkSource(`
        type Option<T> = None | Some<T>;
        let make = () => { None };
        let value = make();
      `);

  expectBinding(result.env, "value", { type: "Option<'a>", vars: 0 });
});

Deno.test("value restriction allows later declarations to constrain expansive monotypes", async () => {
  const result = await checkSource(`
    type Option<T> = None | Some<T>;
    let make = () => { None };
    let value = make();
    let as_number: Option<Number> = value;
  `);

  expectBinding(result.env, "value", { type: "Option<Number>", vars: 0 });
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

Deno.test("type declarations reject unbound type variables in their right hand sides", async () => {
  await assertRejects(
    () => checkSource("type Bad<T> = Missing;"),
    Error,
    "unknown type Missing",
  );
  await assertRejects(
    () => checkSource("type Bad<T> = unknown;"),
    Error,
    "unbound type variable unknown",
  );
  await assertRejects(
    () => checkSource("type Bad<T> = | Bad<unknown>;"),
    Error,
    "unbound type variable unknown",
  );
  await assertRejects(
    () => checkSource("record Bad<T> = { value: unknown };"),
    Error,
    "unbound type variable unknown",
  );
});

Deno.test("type aliases reject direct cycles", async () => {
  await assertRejects(
    () => checkSource("type Bad<T> = Bad<T>;"),
    Error,
    "cyclic type alias Bad",
  );
  await assertRejects(
    () => checkSource("type Bad<T> = (T, Bad<T>);"),
    Error,
    "cyclic type alias Bad",
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

Deno.test("type alias substitution is applied inside datatype constructor payloads", async () => {
  const result = await checkSource(`
    type Pair<T> = (T, T);
    type Box<T> = | Box<Pair<T>>;
    let boxed = Box((1, 2));
    let unbox = match(value) => {
      Box(left, right) => { left + right },
    };
  `);

  expectBinding(result.env, "Box", { type: "((T, T)) => Box<T>", vars: 1 });
  expectBinding(result.env, "boxed", { type: "Box<Number>", vars: 0 });
  expectBinding(result.env, "unbox", { type: "(Box<Number>) => Number", vars: 0 });
});

Deno.test("datatype constructors reject payloads mentioning unbound type variables", async () => {
  await assertRejects(
    () => checkSource("type Bad<T> = | Bad<Missing<T>>;"),
    Error,
    "unknown type Missing",
  );
  await assertRejects(
    () => checkSource("type Bad<T> = | Bad<unknown>;"),
    Error,
    "unbound type variable unknown",
  );
});
