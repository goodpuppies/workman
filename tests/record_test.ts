import { assertRejects } from "@std/assert";
import { checkSource, checkSourceSteps } from "../src/compiler.ts";
import { expectBinding, expectStepBinding, expectStepMissing } from "./type_helpers.ts";

Deno.test("nominal records infer construction and field access", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
    let xVal = p.x;
  `);

  expectBinding(result.env, "p", { type: "Point", vars: 0 });
  expectBinding(result.env, "xVal", { type: "Number", vars: 0 });
});

Deno.test("polymorphic record fields preserve type parameters", async () => {
  const result = await checkSource(`
    record Pair<A, B> = { first: A, second: B };
    let pair = .{ first = 1, second = true };
    let first = pair.first;
    let second = pair.second;
  `);

  expectBinding(result.env, "pair", { type: "Pair<Number, Bool>", vars: 0 });
  expectBinding(result.env, "first", { type: "Number", vars: 0 });
  expectBinding(result.env, "second", { type: "Bool", vars: 0 });
});

Deno.test("record patterns bind fields through nominal record types", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
    let .{ x, y } = p;
    let sum = x + y;
  `);

  expectBinding(result.env, "x", { type: "Number", vars: 0 });
  expectBinding(result.env, "y", { type: "Number", vars: 0 });
  expectBinding(result.env, "sum", { type: "Number", vars: 0 });
});

Deno.test("record elaboration snapshots expose record values after declaration order", async () => {
  const steps = await checkSourceSteps(`
    record Point = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
    let getX = (point: Point) => { point.x };
  `);

  expectStepMissing(steps, 0, "p");
  expectStepBinding(steps, 1, "p", { type: "Point", vars: 0 });
  expectStepBinding(steps, 2, "getX", { type: "(Point) => Number", vars: 0 });
});

Deno.test("records are nominal and reject shape-only ambiguity", async () => {
  await assertRejects(
    () =>
      checkSource(`
        record Point = { x: Number, y: Number };
        record Vector = { x: Number, y: Number };
        let p = .{ x = 10, y = 20 };
      `),
    Error,
    "ambiguous record type",
  );
});

Deno.test("record declarations reject duplicate fields", async () => {
  await assertRejects(
    () => checkSource("record Bad = { x: Number, x: Bool };"),
    Error,
    "duplicate record field x",
  );
});
