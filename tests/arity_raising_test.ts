import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

async function library(source: string, extra: Record<string, string> = {}) {
  const code = await compileLibraryVirtual(
    "/test/main.wm",
    new Map(Object.entries({ "/test/main.wm": source, ...extra })),
    { libraryAbi: "tuple" },
  );
  const url = `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`;
  // A distinct fragment keeps independent test modules from sharing initialized values.
  const module = await import(`${url}#${crypto.randomUUID()}`);
  return { code, module };
}

/** Fail if a higher-order call uses the tupled entry instead of the positional entry. */
function directOnly(fn: (...args: any[]) => any) {
  return new Proxy(fn, {
    apply() {
      throw new Error("tupled entry was called");
    },
  });
}

Deno.test("first-class tuple calls skip the tupled entry for named functions and aliases", async () => {
  const { code, module } = await library(`
    let add = (left: Number, right: Number) => left + right;
    let alias = add;
    let invoke = (function, left: Number, right: Number) => function(left, right);
    let viaAlias = alias(20, 22);
  `);
  assertEquals(module.viaAlias, 42);
  assertEquals(module.invoke([directOnly(module.add), 20, 22]), 42);
  assertEquals(module.invoke([directOnly(module.alias), 2, 3]), 5);
  assertMatch(code, /__wm_tuple_call_2\(_function_\d+, left_\d+, right_\d+\)/);
  assertMatch(code, /direct\(a0, a1\)/);
  assertEquals(Object.keys(module.add), [], "fast-entry metadata must not be enumerable");
});

Deno.test("anonymous, captured, returned, and conditional function values carry fast entries", async () => {
  const { module } = await library(`
    let add = (a: Number, b: Number) => a + b;
    let subtract = (a: Number, b: Number) => a - b;
    let make = (offset: Number) => (a: Number, b: Number) => offset + a + b;
    let choose = flag => if (flag) { add } else { subtract };
    let invoke = (function, a: Number, b: Number) => function(a, b);
    let anonymous = invoke((a, b) => a * b, 6, 7);
  `);
  assertEquals(module.anonymous, 42);
  assertEquals(module.invoke([directOnly(module.make(10)), 20, 12]), 42);
  assertEquals(module.invoke([directOnly(module.choose(true)), 30, 12]), 42);
  assertEquals(module.invoke([directOnly(module.choose(false)), 50, 8]), 42);
});

Deno.test("recursive first-class fast entries retain tail-loop lowering", async () => {
  const { code, module } = await library(`
    let rec count = (remaining: Number, total: Number) => {
      if (remaining == 0) { total } else { count(remaining - 1, total + 1) }
    };
    let invoke = (function, a: Number, b: Number) => function(a, b);
  `);
  assertEquals(module.invoke([directOnly(module.count), 100000, 0]), 100000);
  assertMatch(code, /continue __wm_tail_/);
});

Deno.test("generic and complex-pattern functions retain tuple fallback semantics", async () => {
  const { module } = await library(`
    let identity = value => value;
    let first = pair => match(pair) { (1, Var(value)) => { value }, (_, Var(value)) => { value + 1 } };
    let add = (left: Number, right: Number) => left + right;
    let apply = (function, argument) => function(argument);
    let invoke = (function, a: Number, b: Number) => function(a, b);
    let genericTuple = identity(1, 2);
    let existingTuple = (20, 22);
    let genericApplied = apply(add, existingTuple);
  `);
  assertEquals(module.genericTuple, [1, 2]);
  assertEquals(module.genericApplied, 42);
  assertEquals(module.apply([module.add, [3, 4]]), 7);
  assertEquals(module.invoke([module.first, 1, 42]), 42);
  assertEquals(module.invoke([module.first, 0, 41]), 42);
  assertEquals(module.invoke([(pair: number[]) => pair[0] * pair[1], 6, 7]), 42);
  assertThrows(() => module.add([1]), Error);
});

Deno.test("higher-order tuple dispatch preserves evaluation order and runs each expression once", async () => {
  const { module } = await library(`
    let invoke = (getFunction, getLeft, getRight) => getFunction()(getLeft(), getRight());
  `);
  const events: string[] = [];
  const result = module.invoke([
    () => {
      events.push("function");
      return (pair: number[]) => {
        events.push("call");
        return pair[0] + pair[1];
      };
    },
    () => {
      events.push("left");
      return 20;
    },
    () => {
      events.push("right");
      return 22;
    },
  ]);
  assertEquals(result, 42);
  assertEquals(events, ["function", "left", "right", "call"]);
});

Deno.test("fast entries survive WM re-exports and separately compiled library boundaries", async () => {
  const producer = await library(
    `
    export from "./base.wm" import { add as sum };
  `,
    { "/test/base.wm": "let add = (a: Number, b: Number) => a + b;" },
  );
  const consumer = await library(`
    let invoke = (function, a: Number, b: Number) => function(a, b);
    let local = (a: Number, b: Number) => a - b;
  `);
  assertEquals(consumer.module.invoke([directOnly(producer.module.sum), 20, 22]), 42);
  assertEquals(producer.module.sum([3, 4]), 7, "existing JS tuple ABI stays supported");
  const symbols = Object.getOwnPropertySymbols(producer.module.sum);
  assert(symbols.some((symbol) => Symbol.keyFor(symbol) === "wm.tupleEntry.v1.2"));
});

Deno.test("nested tuple components and wildcard parameters retain their shapes", async () => {
  const { module } = await library(`
    let ignore = (_: Number, value: Number) => value;
    let nested = (pair, extra: Number) => { let (a, b) = pair; a + b + extra };
    let invoke = (function, argument) => function(argument, 10);
    let invoke3 = function => function(1, 2, 3);
    let triple = (a: Number, b: Number, c: Number) => a + b + c;
  `);
  assertEquals(module.invoke([directOnly(module.ignore), 0]), 10);
  assertEquals(module.invoke([directOnly(module.nested), [20, 12]]), 42);
  assertEquals(module.invoke3(directOnly(module.triple)), 6);
});

Deno.test("fast function values survive tuples, record fields, and curried result stages", async () => {
  const { module } = await library(`
    record Handler = { run: (Number, Number) -> Number };
    let add = (a: Number, b: Number) => a + b;
    let handlers = (add, add);
    let stored = Handler{ run = add };
    let viaTuple = { let (function, _) = handlers; function(20, 22) };
    let viaRecord = stored.run(20, 22);
    let curried = (offset: Number) => (a: Number, b: Number) => offset + a + b;
    let viaCurried = curried(10)(20, 12);
    let consume = handler => handler.run(20, 22);
  `);
  assertEquals([module.viaTuple, module.viaRecord, module.viaCurried], [42, 42, 42]);
  assertEquals(module.consume({ run: directOnly(module.add) }), 42);
});

Deno.test("arity dispatch falls back for mismatched shapes and preserves refutable checks", async () => {
  const { module } = await library(`
    let nested = ((left, right), extra: Number) => left + right + extra;
    let invoke = (function, argument) => function(argument, 10);
    let add = (left: Number, right: Number) => left + right;
    let wrongShape = function => function(1, 2, 3);
  `);
  assertEquals(module.invoke([module.nested, [20, 12]]), 42);
  assertThrows(() => module.invoke([module.nested, 20]), Error);
  assertThrows(() => module.wrongShape(module.add), Error);
});
