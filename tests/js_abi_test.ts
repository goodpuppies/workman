import { assertEquals, assertThrows } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";
import { basisCtorId } from "../src/basis.ts";
// @ts-types="../src/integrations/interop.d.mts"
import * as interop from "../src/integrations/interop.mjs";

async function library(source: string, files: Record<string, string> = {}) {
  const code = await compileLibraryVirtual(
    "/test/main.wm",
    new Map(Object.entries({
      "/test/main.wm": source,
      ...files,
    })),
  );
  const url = `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`;
  return await import(`${url}#${crypto.randomUUID()}`);
}

Deno.test("JS ABI exports positional fast implementations and preserves aliases", async () => {
  const m = await library(`
    let add = (left: Number, right: Number) => left + right;
    let alias = add;
    let identity = item => item;
    let zero = () => 42;
    let useInside = add(20, 22);
  `);
  assertEquals(m.add(20, 22), 42);
  assertEquals(m.add.length, 2);
  assertEquals(m.alias, m.add);
  assertEquals(m.identity(m.add), m.add);
  assertEquals(m.zero(), 42);
  assertEquals(m.zero.length, 0);
  assertEquals(m.useInside, 42);
  // The origin links the exported function directly to the original positional entry.
  const origin = m.add[Symbol.for("wm.jsAbi.v1.origin")];
  assertEquals(origin.value[Symbol.for("wm.tupleEntry.v1.2")], m.add);
});

Deno.test("JS ABI converts positional callbacks in both directions", async () => {
  const m = await library(`
    let invoke = (function, left: Number, right: Number) => function(left, right);
    let add = (left: Number, right: Number) => left + right;
    let make = (offset: Number) => (left: Number, right: Number) => offset + left + right;
    let roundTrip = (function: (Number, Number) -> Number) => function;
    let apply = (function, argument) => function(argument);
  `);
  const host = (a: number, b: number) => a * b;
  assertEquals(m.invoke(host, 6, 7), 42);
  assertEquals(m.invoke(m.add, 20, 22), 42);
  assertEquals(m.make(10)(20, 12), 42);
  assertEquals(m.make(10).length, 2);
  assertEquals(m.roundTrip(host), host);
  assertEquals(m.roundTrip(m.add), m.add);
  // Generic apply deliberately accepts a unary callback; its T can itself be a tuple.
  assertEquals(m.apply((pair: number[]) => pair[0] + pair[1], [20, 22]), 42);
});

Deno.test("JS ABI converts callback factories and callbacks accepting callbacks", async () => {
  const m = await library(`
    let factory = (make, value: Number) => { let function = make(value); function(20, 12) };
    let nested = (consume, a: Number, b: Number) => consume((x: Number, y: Number) => x + y, a, b);
    let curried = (offset: Number) => (a: Number, b: Number) => offset + a + b;
  `);
  assertEquals(m.factory((offset: number) => (a: number, b: number) => offset + a + b, 10), 42);
  assertEquals(
    m.nested((fn: (a: number, b: number) => number, a: number, b: number) => fn(a, b), 20, 22),
    42,
  );
  assertEquals(m.curried(10)(20, 12), 42);
});

Deno.test("JS ABI preserves inner tuple values and tuple results", async () => {
  const m = await library(`
    let nested = (pair, extra: Number) => { let (a, b) = pair; a + b + extra };
    let totals = (a: Number, b: Number) => (a + b, a - b);
    let pack = () => ((a: Number, b: Number) => a + b, 10);
    let unpack = pair => { let (function, value) = pair; function(value, 2) };
  `);
  assertEquals(m.nested([20, 12], 10), 42);
  assertEquals(m.totals(20, 12), [32, 8]);
  const [fn, value] = m.pack();
  assertEquals(fn(20, 22), 42);
  assertEquals(value, 10);
  assertEquals(m.unpack((a: number, b: number) => a + b, 40), 42);
});

Deno.test("JS ABI exports nested namespace functions with stable identity", async () => {
  const m = await library(
    `
    export from "./base.wm" import * as Numbers;
    export from "./base.wm" import { add as plus };
    export from "./other.wm" import * as Outer;
  `,
    {
      "/test/base.wm": "let add = (a: Number, b: Number) => a + b;",
      "/test/other.wm": 'export from "./base.wm" import * as Inner;',
    },
  );
  assertEquals(m.Numbers.add(20, 22), 42);
  assertEquals(m.Outer.Inner.add(20, 22), 42);
  assertEquals(m.Numbers.add, m.plus);
  assertEquals(m.Outer.Inner.add, m.plus);
});

Deno.test("JS ABI supports tuple functions without a simple fast entry", async () => {
  const m = await library(`
    let nested = ((left, right), extra: Number) => left + right + extra;
    let fromGeneric = (function, arg) => function(arg);
    let one = pair => { let (left, right) = pair; left + right };
  `);
  assertEquals(m.nested([20, 12], 10), 42);
  assertEquals(m.one(20, 22), 42);
  assertEquals(m.fromGeneric((pair: number[]) => pair[0] + pair[1], [20, 22]), 42);
  assertThrows(() => m.nested(20, 10));
});

Deno.test("JS ABI works across independently compiled libraries", async () => {
  const producer = await library("let add = (a: Number, b: Number) => a + b;");
  const consumer = await library(`
    let invoke = (function, a: Number, b: Number) => function(a, b);
    let roundTrip = (function: (Number, Number) -> Number) => function;
  `);
  assertEquals(consumer.invoke(producer.add, 20, 22), 42);
  assertEquals(consumer.roundTrip(producer.add), producer.add);
});

Deno.test("JS ABI refreshes mutable tuple inputs and ignores host callback arity", async () => {
  const m = await library(`
    let consume = (pair, offset: Number) => { let (function, value) = pair; function(value, offset) };
  `);
  // Defaults/rest change Function.length; inferred signatures, not JS reflection, decide arity.
  const callback = (a = 0, ...rest: number[]) => a + rest[0];
  const pair: [(a: number, b: number) => number, number] = [callback, 10];
  assertEquals(callback.length, 0);
  assertEquals(m.consume(pair, 2), 12);
  pair[1] = 40;
  assertEquals(m.consume(pair, 2), 42);
});

Deno.test("JS ABI projects Result and Task values and nested positional callbacks", async () => {
  const m = await library(`
    let good: Number -> Result<Number, String> = value => Ok(value + 1);
    let bad: String -> Result<Number, String> = error => Err(error);
    let later: Number -> Task<Number, String> = value => Task.succeed(value + 1);
    let failed: String -> Task<Number, String> = error => Task.fail(error);
    let consume = (result: Result<Number, String>) => match(result) { Ok(value) => value, Err(_) => 0 };
    let consumeTask = (task: Task<Number, String>) => Task.map(task, value => value + 1);
    let callback: Void -> Task<(Number, Number) -> Number, String> = () => Task.succeed((a, b) => a + b);
    let useCallback = (result: Result<(Number, Number) -> Number, String>) => {
      match(result) { Ok(f) => f(20, 22), Err(_) => 0 }
    };
  `);
  assertEquals(m.good(41), { ok: true, value: 42 });
  assertEquals(m.bad("no"), { ok: false, error: "no" });
  assertEquals(await m.later(41), { ok: true, value: 42 });
  assertEquals(await m.failed("no"), { ok: false, error: "no" });
  assertEquals(m.consume({ ok: true, value: 42 }), 42);
  assertEquals(m.consume({ ok: false, error: "no" }), 0);
  assertEquals(await m.consumeTask(Promise.resolve({ ok: true, value: 41 })), {
    ok: true,
    value: 42,
  });
  const result = await m.callback();
  assertEquals(result.ok, true);
  assertEquals(result.value(20, 22), 42);
  assertEquals(m.useCallback({ ok: true, value: (a: number, b: number) => a + b }), 42);
});

Deno.test("JS ABI passes Options as opaque values, keeping nesting and Some(undefined)", async () => {
  const m = await library(`
    let echo = (value: Option<Option<Number>>) => value;
    let missing: Option<Void> = None;
    let present: Option<Void> = Some(void);
    let apply = (value: Option<(Number, Number) -> Number>) => {
      match(value) { Some(f) => f(20, 22), None => 0 }
    };
    let depth = (value: Option<Option<Number>>) => {
      match(value) { None => 0, Some(None) => 1, Some(Some(_)) => 2 }
    };
    let adder: Option<(Number, Number) -> Number> = Some((a, b) => a + b);
  `);
  assertEquals(interop.isNone(m.missing), true);
  assertEquals(m.missing, interop.None);
  assertEquals(interop.isSome(m.present), true);
  assertEquals(interop.toNullable(m.present), undefined);
  const nested = m.echo(interop.Some(interop.None));
  assertEquals(interop.isSome(nested), true);
  assertEquals(interop.getOr(nested, interop.Some(1)), interop.None);
  // Nullary None matches by identity, so the interop None must be the runtime singleton.
  assertEquals(m.depth(interop.None), 0);
  assertEquals(m.depth(interop.Some(interop.None)), 1);
  assertEquals(m.depth(interop.fromNullable(interop.fromNullable(5))), 2);
  // Payloads still use the positional ABI in both directions.
  assertEquals(m.apply(interop.Some((a: number, b: number) => a + b)), 42);
  assertEquals(m.apply(interop.None), 0);
  assertEquals(
    interop.match(m.adder, {
      some: (f: (a: number, b: number) => number) => f(20, 22),
      none: () => 0,
    }),
    42,
  );
  assertThrows(() => m.apply({ some: true, value: () => 0 }), TypeError);
});

Deno.test("JS ABI shares nullary basis constructors across separately compiled libraries", async () => {
  const producer = await library(`
    let none: Void -> Option<Number> = () => None;
    let nested: Option<Option<Number>> = Some(None);
  `);
  const consumer = await library(`
    let read = (value: Option<Number>) => match(value) { None => -1, Some(n) => n };
    let depth = (value: Option<Option<Number>>) => {
      match(value) { None => 0, Some(None) => 1, Some(Some(_)) => 2 }
    };
  `);
  assertEquals(consumer.read(producer.none()), -1);
  assertEquals(consumer.depth(producer.nested), 1);
});

Deno.test("interop helpers use the basis constructor ids", () => {
  assertEquals((interop.None as unknown as { ctor: number }).ctor, basisCtorId("None"));
  assertEquals((interop.Some(1) as unknown as { ctor: number }).ctor, basisCtorId("Some"));
  assertEquals(interop.Ok(1), { ok: true, value: 1 });
  assertEquals(interop.Err("no"), { ok: false, error: "no" });
});

Deno.test("JS ABI does not treat user types named Option or Result as basis constructors", async () => {
  const m = await library(`
    type Option = | CustomOption<Number>;
    type Result = | CustomResult<Number>;
    let option = CustomOption(42);
    let result = CustomResult(21);
  `);
  assertEquals(m.option.a0, 42);
  assertEquals(m.result.a0, 21);
  assertEquals(m.option.some, undefined);
  assertEquals(m.result.ok, undefined);
});

Deno.test("JS ABI adapts function fields of nominal records", async () => {
  const m = await library(`
    record Op = { name: String, apply: (Number, Number) -> Number };
    let add: Op = .{ name = "add", apply = (a, b) => a + b };
    let run = (op: Op) => op.apply(20, 22);
  `);
  assertEquals(m.add.name, "add");
  assertEquals(m.add.apply(20, 22), 42);
  assertEquals(m.run({ name: "sub", apply: (a: number, b: number) => a - b }), -2);
});
