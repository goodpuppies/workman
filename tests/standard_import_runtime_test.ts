import { assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

async function execute(source: string, extra = new Map<string, string>()) {
  const files = new Map([["/test/main.wm", source], ...extra]);
  const code = await compileLibraryVirtual("/test/main.wm", files);
  return await import(`data:text/javascript;base64,${btoa(code)}`);
}

Deno.test("explicit std namespaces retain compiler operations beside source functions", async () => {
  const module = await execute(`
    from "std/int32.wm" import * as Int32;
    let value: Int32 = 41;
    let converted = Int32.toReal64(value);
    let parsed = Int32.parseDecimal("42") :> Result.getOr(0);
    let checked = Int32.checkedAdd(20, 22) :> Result.getOr(0);
    let rendered = Int32.toString(value);
  `);
  assertEquals([module.converted, module.parsed, module.checked, module.rendered], [
    41,
    42,
    42,
    "41",
  ]);
});

Deno.test("named and open std imports retain compiler values and list constructors", async () => {
  const module = await execute(`
    from "std/int32.wm" import { toReal64 as convert, minimum };
    from "std/int32.wm" import *;
    from "std/list.wm" import { Cons as cons, Nil as empty };
    let converted = convert(7);
    let rendered = toString(8);
    let smallest = minimum;
    let count = List.length32(cons(1, cons(2, empty)));
  `);
  assertEquals([module.converted, module.rendered, module.smallest, module.count], [
    7,
    "8",
    -2147483648,
    2,
  ]);
});

Deno.test("compiler exports survive namespace named and open re-export chains", async () => {
  const module = await execute(
    `
    from "./bridge.wm" import * as Bridge;
    from "./open.wm" import { toReal64 as convert };
    let first = Bridge.Numbers.toReal64(1);
    let second = Bridge.convert(2);
    let third = convert(3);
    let rendered = Bridge.render(true);
    let count = List.length32(Bridge.cons(4, Bridge.empty));
  `,
    new Map([
      [
        "/test/bridge.wm",
        `
      export from "std/int32.wm" import * as Numbers;
      export from "std/int32.wm" import { toReal64 as convert };
      export from "basis/text.wm" import { of as render };
      export from "std/list.wm" import { Cons as cons, Nil as empty };
    `,
      ],
      ["/test/open.wm", 'export from "std/int32.wm" import *;'],
    ]),
  );
  assertEquals([module.first, module.second, module.third, module.rendered, module.count], [
    1,
    2,
    3,
    "true",
    1,
  ]);
});

Deno.test("compiler imports retain declaration-order shadowing and captured aliases", async () => {
  const module = await execute(`
    from "std/int32.wm" import { toReal64 as convert };
    let earlier = () => convert(7);
    from "basis/text.wm" import { of as convert };
    let later = () => convert(true);
    let convert = _ => "local";
    let values = (earlier(), later(), convert(void));
  `);
  assertEquals(module.values, [7, "true", "local"]);
});

Deno.test("source declarations override forwarded compiler exports", async () => {
  const module = await execute(
    `
    from "./bridge.wm" import * as Bridge;
    let converted = Bridge.toReal64(5);
    let rendered = Bridge.toString(5);
  `,
    new Map([[
      "/test/bridge.wm",
      `export from "std/int32.wm" import *;
     let toString = _ => "overridden";`,
    ]]),
  );
  assertEquals([module.converted, module.rendered], [5, "overridden"]);
});

Deno.test("explicit std imports work without implicit library namespaces", async () => {
  const module = await execute(`-- @no-prelude
    from "std/int32.wm" import { toReal64 as convert };
    let value = convert(42);
  `);
  assertEquals(module.value, 42);
});
