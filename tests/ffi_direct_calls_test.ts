import { assertEquals, assertMatch } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

async function execute(
  files: Map<string, string>,
  inspect: (js: string) => void,
) {
  const js = await compileLibraryVirtual("/test/main.wm", files);
  inspect(js);
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/compiled.mjs`;
    await Deno.writeTextFile(path, js);
    return await import(`file://${path}`);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("JS imports use direct tuple entries across modules and retain higher-order adapters", async () => {
  const module = await execute(
    new Map([
      [
        "/test/foreign.wm",
        `
      from js.global("Math") import unsafe { max: (Number, Number) -> Number };
      let maximum = (left, right) => { max(left, right) };
    `,
      ],
      [
        "/test/main.wm",
        `
      from "./foreign.wm" import { maximum };
      from js.global("Math") import unsafe { min: (Number, Number) -> Number };
      from js.global("Math") import { max as checkedMax };
      let higher = (function) => { function(4, 9) };
      let throughTuple = (left, right) => { let pair = (left, right); min(pair) };
      let direct = maximum(4, 9);
      let variadic = checkedMax(4, 9, 2);
      let firstClass = higher(min);
      let existingTuple = throughTuple(4, 9);
      let shadow = (min) => { min(4, 9) };
      let shadowed = shadow((left, right) => { left + right });
    `,
      ],
    ]),
    (js) => {
      assertMatch(js, /return max_\d+__wm_d2\(left_\d+, right_\d+\)/);
      assertMatch(js, /maximum_\d+__wm_d2\(4, 9\)/);
      assertMatch(js, /min_\d+\(pair_\d+\)/);
    },
  );
  assertEquals([module.direct, module.firstClass, module.existingTuple, module.shadowed], [
    9,
    4,
    4,
    13,
  ]);
  assertEquals(module.variadic.name, "Ok");
  assertEquals(module.variadic.args[0], 9);
});

Deno.test("direct JS calls preserve optional values, callbacks, receivers, constructors and failures", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const helper = `${directory}/host.ts`;
    await Deno.writeTextFile(
      helper,
      `
      let counter = 0;
      export function next(): number { return ++counter; }
      export function combine(a: number, b: number): number { return a * 10 + b; }
      export function optional(a: number | null, b: number): number | null { return a === null ? null : a + b; }
      export function callback(a: number, f: (left: number, right: number) => number): number { return f(a, 3); }
      export function throwing(a: number, b: number): number { if (b < 0) throw Error("sync failure"); return a + b; }
      export function task(a: number, b: number): Promise<number> {
        if (b === -1) throw Error("task sync failure");
        return b < 0 ? Promise.reject(Error("task rejection")) : Promise.resolve(a + b);
      }
      export const owner = { base: 10, add(a: number, b: number): number { return this.base + a + b; } };
      export class Box {
        base: number;
        constructor(a: number, b: number) { this.base = a + b; }
        add(a: number, b: number): number { return this.base + a + b; }
      }
    `,
    );
    const module = await execute(
      new Map([[
        "/test/main.wm",
        `
      from js.module(${JSON.stringify(helper)}) import { optional, callback, throwing, task, Box };
      from js.module(${JSON.stringify(helper)}) import unsafe { next, combine };
      from js.module(${JSON.stringify(helper)}) import * as Host;
      let order = combine(next(), next());
      let some = optional(Some(4), 3);
      let none = optional(None, 3);
      let higher = (function) => { function(Some(4), 3) };
      let fromValue = higher(optional);
      let calledBack = callback(4, (left, right) => { left + right });
      let success = throwing(4, 3);
      let failure = throwing(4, -1);
      let receiver = Host.owner.add(2, 3);
      let constructed = match(Box.new(2, 3)) {
        Ok(box) => { box.add(4, 5) },
        Err(error) => { Err(error) }
      };
      let promised = task(4, 3);
      let rejected = task(4, -2);
      let syncRejected = task(4, -1);
    `,
      ]]),
      (js) => {
        assertMatch(js, /optional_[\d_]+__wm_d2\(/);
        assertMatch(js, /callback_[\d_]+__wm_d2\(/);
        assertMatch(js, /task_[\d_]+__wm_d2\(/);
        for (const name of ["optional", "callback", "task"]) {
          const start = js.search(new RegExp(`const ${name}_\\d+__wm_d2 =`));
          assertEquals(start >= 0, true);
          const end = js.indexOf("\n};", start);
          assertEquals(js.slice(start, end).includes("__wm_js_apply"), false);
        }
      },
    );
    assertEquals(module.order, 12);
    assertEquals(module.some.name, "Ok");
    assertEquals(module.some.args[0].name, "Some");
    assertEquals(module.some.args[0].args[0], 7);
    assertEquals(module.none.args[0].name, "None");
    assertEquals(module.fromValue.args[0].args[0], 7);
    for (
      const [name, value] of [["calledBack", 7], ["success", 7], ["receiver", 15], [
        "constructed",
        14,
      ]] as const
    ) {
      assertEquals(module[name].name, "Ok", name);
      assertEquals(module[name].args[0], value, name);
    }
    assertEquals(module.failure.name, "Err");
    assertEquals((await module.promised).args[0], 7);
    assertEquals((await module.rejected).name, "Err");
    assertEquals((await module.syncRejected).name, "Err");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test({
  name: "direct C calls retain pointer and string conversions and higher-order tuple calls",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const module = await execute(
      new Map([[
        "/test/main.wm",
        `
      from c.lib("c") import unsafe {
        strcmp: (String, String) -> I32,
        strchr as required: (String, I32) -> String,
        strchr as optional: (Option<String>, I32) -> Option<String>
      };
      from c.header("string.h") import unsafe { memcmp };
      from "host/c/pointer.wm" import * as Pointer;
      let equal = strcmp("same", "same");
      let suffix = required("aabb", 98);
      let missing = optional(Some("aabb"), 99);
      let present = optional(Some("aabb"), 98);
      let bytes = memcmp(Some(Pointer.fromString("same")), Some(Pointer.fromString("same")), 4);
      let higher = (function) => { function("same", "same") };
      let firstClass = higher(strcmp);
    `,
      ]]),
      (js) => {
        assertMatch(js, /strcmp_\d+__wm_d2\("same", "same"\)/);
        assertMatch(js, /memcmp_\d+__wm_d3\(/);
        const start = js.search(/const strcmp_\d+__wm_d2 =/);
        assertEquals(start >= 0, true);
        const end = js.indexOf("\n};", start);
        assertEquals(js.slice(start, end).includes("__wm_c_call"), false);
      },
    );
    assertEquals([module.equal, module.bytes, module.firstClass], [0, 0, 0]);
    assertEquals(module.suffix, "bb");
    assertEquals(module.missing.name, "None");
    assertEquals(module.present.args[0], "bb");
  },
});
