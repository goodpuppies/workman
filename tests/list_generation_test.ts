import { assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

async function execute(source: string) {
  const path = "/app/generation.wm";
  const code = await compileLibraryVirtual(path, new Map([[path, source]]));
  return await import(`data:text/javascript,${encodeURIComponent(code)}`);
}

Deno.test("deferred generation and pure consumers support map, filter, flattening and partition", async () => {
  const module = await execute(`
    let unused = [1] :> List.generate(Result, _ => Panic("generation ran a check"));
    let filtered = [1, 2, 2, 3] :> List.generate(Result, n => Ok(n % 2 == 0)) :> List.collect(Primitive.filter);
    let mapped = [1, 2] :> List.generate(Result, n => Ok(Int32.toString(n))) :> List.collect(Primitive.map);
    let nested = [1, 2] :> List.generate(Result, n => Ok([n, n])) :> List.collect(Primitive.map);
    let flattened = [1, 2] :> List.generate(Result, n => Ok([n, n])) :> List.collect(Primitive.concatMap);
    let selected = [1, 2, 3] :> List.generate(Result,
      n => Ok(if (n == 2) { None } else { Some(Int32.toString(n)) })) :> List.collect(Primitive.filterMap);
    let partitioned = [1, 2, 3] :> List.generate(Result, n => Ok(n % 2 == 0)) :> List.collect(Primitive.partition);
    let pure = [1, 2, 3] :> List.concatMap(n => [n, -n]);
    let annotated = [1, 2] :> List.annotate(Result, n => Ok(n % 2 == 0));
    let checks = (filtered == Ok([2, 2]), mapped == Ok(["1", "2"]), nested == Ok([[1, 1], [2, 2]]),
      flattened == Ok([1, 1, 2, 2]), selected == Ok(["1", "3"]), partitioned == Ok(([2], [1, 3])),
      pure == [1, -1, 2, -2, 3, -3], annotated == Ok([(1, false), (2, true)]));
  `);
  assertEquals(module.checks, Array(8).fill(true));
});

Deno.test("find, findMap, exists, all and takeWhile stop before the next check", async () => {
  const module = await execute(`
    let predicate = n => if (n == 3) { Panic("check after successful stop") } else { Ok(n == 2) };
    let found = [1, 2, 3] :> List.generate(Result, predicate) :> List.collect(Primitive.find);
    let exists = [1, 2, 3] :> List.generate(Result, predicate) :> List.collect(Primitive.exists);
    let all = [2, 1, 3] :> List.generate(Result, predicate) :> List.collect(Primitive.all);
    let prefix = [2, 1, 3] :> List.generate(Result, predicate) :> List.collect(Primitive.takeWhile);
    let selected = [1, 2, 3] :> List.generate(Result, n => {
      if (n == 3) { Panic("findMap after stop") } else { Ok(if (n == 2) { Some("two") } else { None }) }
    }) :> List.collect(Primitive.findMap);
    let checks = (found == Ok(Some(2)), exists == Ok(true), all == Ok(false), prefix == Ok([2]), selected == Ok(Some("two")));
  `);
  assertEquals(module.checks, Array(5).fill(true));
});

Deno.test("deferred consumers preserve typed errors and distinguish empty identities and absence", async () => {
  const module = await execute(`
    type Failure = | Rejected<Int32>;
    let failed = [1, 2, 3] :> List.generate(Result, n => {
      if (n == 1) { Ok(false) } else {
        if (n == 2) { Err(Rejected(n)) } else { Panic("check after error") }
      }
    }) :> List.collect(Primitive.find);
    let emptyFind: Result<Option<Int32>, String> = [] :> List.generate(Result, _ => Err("unexpected")) :> List.collect(Primitive.find);
    let emptyFilter: Result<List<Int32>, String> = [] :> List.generate(Result, _ => Err("unexpected")) :> List.collect(Primitive.filter);
    let emptyExists: Result<Bool, String> = [] :> List.generate(Result, _ => Err("unexpected")) :> List.collect(Primitive.exists);
    let emptyAll: Result<Bool, String> = [] :> List.generate(Result, _ => Err("unexpected")) :> List.collect(Primitive.all);
    let absent = [1, 2] :> List.generate(Result, _ => Ok(false)) :> List.collect(Primitive.find);
    let checks = (failed == Err(Rejected(2)), emptyFind == Ok(None), emptyFilter == Ok([]),
      emptyExists == Ok(false), emptyAll == Ok(true), absent == Ok(None));
  `);
  assertEquals(module.checks, Array(6).fill(true));
});

Deno.test("custom pure consumers may finish with a different output type and stop immediately", async () => {
  const module = await execute(`
    let consumer = Primitive.Consumer{
      initial = 0,
      step = (n, _, _) => Monad.Stop(Int32.toString(n)),
      finish = _ => Panic("finish after Stop")
    };
    let result = [1, 2] :> List.generate(Result, n => {
      if (n == 2) { Panic("check after Stop") } else { Ok(true) }
    }) :> List.collect(consumer) :> Result.debug;
  `);
  assertEquals(module.result, "1");
});

Deno.test("Task generators defer checks, sequence them once and short circuit on success or failure", async () => {
  const module = await execute(`
    let source = [1, 2, 3] :> List.generate(Task, n => { print(n); Task.succeed(n == 2) });
    let run = () => source :> List.collect(Primitive.find) :> Task.map(found => found == Some(2));
    let fail = () => [1, 2, 3] :> List.generate(Task, n => {
      print(n);
      if (n == 1) { Task.succeed(false) } else {
        if (n == 2) { Task.fail("stop") } else { Panic("task after error") }
      }
    }) :> List.collect(Primitive.find);
    let empty = () => [] :> List.generate(Task, _ => Task.fail("unexpected")) :> List.collect(Primitive.exists);
  `);
  const original = console.log;
  const seen: string[] = [];
  console.log = (value) => seen.push(String(value));
  try {
    assertEquals(await module.run(), { ok: true, value: true });
    assertEquals(seen, ["1", "2"]);
    seen.length = 0;
    assertEquals(await module.run(), { ok: true, value: true });
    assertEquals(seen, ["1", "2"]);
    seen.length = 0;
    assertEquals(await module.fail(), { ok: false, error: "stop" });
    assertEquals(seen, ["1", "2"]);
    seen.length = 0;
    assertEquals(await module.empty(), { ok: true, value: false });
    assertEquals(seen, []);
  } finally {
    console.log = original;
  }
});

Deno.test("carrier loops keep long synchronous and asynchronous generation stack safe", async () => {
  const module = await execute(`
    let count = List.tabulate32(200000, i => i) :> Result.debug
      :> List.generate(Result, n => Ok([n, n])) :> List.collect(Primitive.concatMap)
      :> Result.map(List.length32) :> Result.debug;
    let run = () => {
      let counting = Primitive.Consumer{initial = 0, step = (_, _, acc) => Monad.Continue(acc + 1), finish = x => x};
      List.tabulate32(50000, i => i) :> Result.debug
        :> List.generate(Task, Task.succeed) :> List.collect(counting)
    };
    let accumulated = List.tabulate32(200000, i => i) :> Result.debug
      :> List.generateState(Result, 0, (_, total) => Ok(total + 1))
      :> List.collect(Primitive.lastOr(0));
    let looped = Monad.loop(0, Result, n => Ok(if (n == 200000) { Monad.Stop(n) } else { Monad.Continue(n + 1) }));
    let loopFailed = Result.loop(0, n => if (n == 2) { Err("stop") } else { Ok(Monad.Continue(n + 1)) });
    let checks = (looped == Ok(200000), loopFailed == Err("stop"), accumulated == Ok(200000));
  `);
  assertEquals(module.count, 400000);
  assertEquals(module.checks, [true, true, true]);
  assertEquals(await module.run(), { ok: true, value: 50000 });
});

Deno.test("explicit std imports expose carrier-at-generation composition", async () => {
  const module = await execute(`
    from "std/list.wm" import { generate, collect };
    from "std/primitive.wm" import * as P;
    let result = [1, 2, 3] :> generate(Result, n => Ok(n > 1)) :> collect(P.filter)
      :> Result.map(List.toString) :> Result.debug;
  `);
  assertEquals(module.result, "[2, 3]");
});

Deno.test("Day 2 keeps range and predicate errors in the carrier until the boundary", async () => {
  const module = await execute(`
    type Failure = | ListFailed<List.Error>;
    let hasIdenticalHalves = n => {
      let digits = Int64.toString(n) :> String.toList;
      let count = List.length(digits);
      List.splitAt(digits, Int64.div(count, 2))
        :> Result.map((left, right) => count % 2 == 0 && left == right) :> Result.mapErr(ListFailed)
    };
    let result = Ok([222, 456456, 1212, 1234]) :> Monad.via Result items => {
      items :> List.generate(Result, hasIdenticalHalves) :> List.collect(Primitive.filter)
    } :> Result.map(List.toString) :> Result.debug;
  `);
  assertEquals(module.result, "[456456, 1212]");
});

Deno.test("stateful generation carries checked accumulation and can collect its history or final state", async () => {
  const module = await execute(`
    type Failure = | NumberFailed<Int64.Error>;
    let add = (n, total) => Int64.checkedAdd(n, total) :> Result.mapErr(NumberFailed);
    let summed = [3, 4, 5] :> List.generateState(Result, (0: Int64), add)
      :> List.collect(Primitive.lastOr((0: Int64)));
    let history = [3, 4, 5] :> List.generateState(Result, 0, (n, total) => Ok(n + total))
      :> List.collect(Primitive.map);
    let empty: Result<Int64, Failure> = [] :> List.generateState(Result, (0: Int64), add)
      :> List.collect(Primitive.lastOr((0: Int64)));
    let overflow = [Int64.maximum, 1, 2] :> List.generateState(Result, (0: Int64), (n, total) => {
      if (n == 2) { Panic("stateful check after overflow") } else { add(n, total) }
    }) :> List.collect(Primitive.lastOr((0: Int64)));
    let limit = Primitive.Consumer{
      initial = void,
      step = (_, total, _) => if (total >= 3) { Monad.Stop(total) } else { Monad.Continue(void) },
      finish = _ => 0
    };
    let stopped = [1, 2, 3] :> List.generateState(Result, 0, (n, total) => {
      if (n == 3) { Panic("stateful check after success") } else { Ok(total + n) }
    }) :> List.collect(limit);
    let checks = (summed == Ok(12), history == Ok([3, 7, 12]), empty == Ok(0),
      overflow == Err(NumberFailed(Int64.Overflow)), stopped == Ok(3));
  `);
  assertEquals(module.checks, [true, true, true, true, true]);
});

Deno.test("stateful Task generation sequences using each successful state", async () => {
  const module = await execute(`
    let run = () => [1, 2, 3] :> List.generateState(Task, 0, (n, total) => Task.succeed(n + total))
      :> List.collect(Primitive.lastOr(0));
    let stopped = () => [1, 2, 3] :> List.generateState(Task, false, (n, seen) => {
      if (n == 3) { Panic("stateful Task after stop") } else { Task.succeed(seen || n == 2) }
    }) :> List.collect(Primitive.find) :> Task.map(found => found == Some(2));
  `);
  assertEquals(await module.run(), { ok: true, value: 6 });
  assertEquals(await module.stopped(), { ok: true, value: true });
});
