import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  checkFile,
  checkSource,
  checkSourceSteps,
  checkVirtual,
  compile,
} from "../src/compiler.ts";
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

Deno.test("records support JavaScript-style mixed-case field names", async () => {
  const result = await checkSource(`
    record Current = { FeelsLikeC: String, windspeedKmph: String };
    let current: Current = .{ FeelsLikeC = "4", windspeedKmph = "12" };
    let feels = current.FeelsLikeC;
    let .{ windspeedKmph = wind } = current;
    let payload = JSON{ FeelsLikeC: feels };
  `);

  expectBinding(result.env, "current", { type: "Current", vars: 0 });
  expectBinding(result.env, "feels", { type: "String", vars: 0 });
  expectBinding(result.env, "wind", { type: "String", vars: 0 });
  expectBinding(result.env, "payload", { type: "Js.Value", vars: 0 });
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

Deno.test("records warn and choose first nominal type on shape-only ambiguity", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    record Vector = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
  `);

  expectBinding(result.env, "p", { type: "Point", vars: 0 });
  assertEquals(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "record.ambiguous-literal",
  ]);
  assertStringIncludes(result.warnings[0], "using first matching record type called Point");
  assertStringIncludes(result.warnings[0], "Candidates: Point, Vector");
  assertStringIncludes(result.warnings[0], "Hint: use an annotation like `x: Point = .{ ... }`");
  assertStringIncludes(result.warnings[0], "or explicit form `x = Point{ ... }`");
});

Deno.test("record annotations disambiguate same-shaped nominal records", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    record Vector = { x: Number, y: Number };
    let p: Point = .{ x = 10, y = 20 };
    let v: Vector = .{ x = 1, y = 2 };
  `);

  expectBinding(result.env, "p", { type: "Point", vars: 0 });
  expectBinding(result.env, "v", { type: "Vector", vars: 0 });
});

Deno.test("record literals support spread update and field punning", async () => {
  const source = `
    record Point = { x: Number, y: Number };
    let p1: Point = .{ x = 10, y = 20 };
    let x = 100;
    let p2 = .{ ..p1, x };
    let p3: Point = .{ ..p2, y = 30 };
  `;
  const result = await checkSource(source);
  const js = await compile(source);

  expectBinding(result.env, "p2", { type: "Point", vars: 0 });
  expectBinding(result.env, "p3", { type: "Point", vars: 0 });
  assertStringIncludes(js, "...");
});

Deno.test("record spread uses annotated nominal target for nested literals", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    record Vector = { x: Number, y: Number };
    let v: Vector = .{ .. .{ x = 1, y = 2 }, x = 3 };
  `);

  expectBinding(result.env, "v", { type: "Vector", vars: 0 });
});

Deno.test("imported records remain nominal across file boundaries", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/a.wm",
      "record Point = { x: Number, y: Number }; let make = () => { .{ x = 1, y = 2 } };",
    ],
    [
      "/test/b.wm",
      "record Point = { x: Number, y: Number }; let make = () => { .{ x = 1, y = 2 } };",
    ],
    [
      "/test/main.wm",
      'from "./a.wm" import * as A; from "./b.wm" import * as B; let good: A.Point = A.make(); let bad: A.Point = B.make();',
    ],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});

Deno.test("imported record annotations guide record literals", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/point.wm", "record Point = { x: Number, y: Number };"],
    [
      "/test/main.wm",
      'from "./point.wm" import * as Geometry; let p: Geometry.Point = .{ x = 1, y = 2 }; let x = p.x;',
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("named imports expose exported record types", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/point.wm", "record Point = { x: Number, y: Number };"],
    [
      "/test/main.wm",
      'from "./point.wm" import { Point }; let p: Point = .{ x = 1, y = 2 }; let x = p.x;',
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("block-local record names do not escape", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let p = {
          record Point = { x: Number, y: Number };
          .{ x = 1, y = 2 }
        };
      `),
    Error,
    "local type escapes scope",
  );
});

Deno.test("record declarations reject duplicate fields", async () => {
  await assertRejects(
    () => checkSource("record Bad = { x: Number, x: Bool };"),
    Error,
    "duplicate record field x",
  );
});

Deno.test("record patterns reject duplicate fields", async () => {
  await assertRejects(
    () =>
      checkSource(`
        record Point = { x: Number };
        let p = .{ x = 1 };
        let .{ x = a, x = b } = p;
      `),
    Error,
    "duplicate record field x",
  );
});

Deno.test("record literals reject missing and extra fields against the nominal target", async () => {
  await assertRejects(
    () =>
      checkSource(`
        record Point = { x: Number, y: Number };
        let missing: Point = .{ x = 1 };
      `),
    Error,
    "missing record field for Point",
  );
  await assertRejects(
    () =>
      checkSource(`
        record Point = { x: Number };
        let extra: Point = .{ x = 1, y = 2 };
      `),
    Error,
    "Point has no field y",
  );
});

Deno.test("record field projection can infer a structural field requirement", async () => {
  const result = await checkSource(`
    record Point = { x: Number };
    record Offset = { x: Number };
    let getX = (value) => { value.x };
    let point: Point = .{ x = 1 };
    let offset: Offset = .{ x = 2 };
    let px = getX(point);
    let ox = getX(offset);
  `);

  expectBinding(result.env, "getX", { type: "({ x: 'a }) => 'a", vars: 1 });
  expectBinding(result.env, "px", { type: "Number", vars: 0 });
  expectBinding(result.env, "ox", { type: "Number", vars: 0 });
});

Deno.test("record function fields compose with whitespace curried calls", async () => {
  const result = await checkSource(`
    record Task = { fn: (() => Number) => Number };
    let lift = (x) => {
      (f) => {
        x.fn(f)
      }
    };
    let task: Task = .{ fn = (f) => { f() } };
    let value = lift task () => { 42 };
  `);

  expectBinding(result.env, "value", { type: "Number", vars: 0 });
});

Deno.test("record function fields support generic structural lift", async () => {
  const result = await checkSource(`
    record TaskLike = { fn: (() => Number) => Number };
    let lift = (x) => {
      (f) => {
        x.fn(f)
      }
    };
    let task: TaskLike = .{ fn = (f) => { f() } };
    let value = lift task () => { 42 };
  `);

  expectBinding(result.env, "lift", { type: "({ fn: ('a) => 'b }) => ('a) => 'b", vars: 2 });
  expectBinding(result.env, "value", { type: "Number", vars: 0 });
});
