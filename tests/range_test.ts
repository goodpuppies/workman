import { assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

async function execute(source: string) {
  const files = new Map([["/app/main.wm", source]]);
  const code = await compileLibraryVirtual("/app/main.wm", files);
  return await import(`data:text/javascript;base64,${btoa(code)}`);
}

Deno.test("List.unfold generates values from arbitrary state in order and stops at None", async () => {
  const module = await execute(`
    let values = List.unfold(["a", "b", "c"], match(state) => {
      [] => None,
      [first, ..rest] => Some((first, rest))
    });
    let empty: List<String> = List.unfold(false, active => {
      if (active) { Some(("unexpected", false)) } else { None }
    });
    let long = List.unfold((0: Int32), n => {
      if (n == 100000) { None } else { Some((n, n + 1)) }
    }) :> List.length32;
    let rendered = List.toString(values);
    let emptyCount = List.length32(empty);
  `);
  assertEquals(module.rendered, "[a, b, c]");
  assertEquals(module.emptyCount, 0);
  assertEquals(module.long, 100000);
});

for (const width of ["Int32", "Int64"]) {
  Deno.test(`${width} range and foldRange have matching inclusive ascending contracts`, async () => {
    const module = await execute(`
      let all = ${width}.range(-2, 2) :> List.toString;
      let empty = ${width}.range(2, -2) :> List.length32;
      let singleton = ${width}.range(${width}.maximum, ${width}.maximum)
        :> List.map(${width}.toString) :> List.toString;
      let upper = ${width}.range(${width}.maximum - 1, ${width}.maximum)
        :> List.map(${width}.toString) :> List.toString;
      let lower = ${width}.range(${width}.minimum, ${width}.minimum + 1)
        :> List.map(${width}.toString) :> List.toString;
      let reversed = ${width}.foldRange(${width}.maximum, ${width}.minimum, "empty", (_, _) => Panic("unexpected callback"));
      let order = ${width}.foldRange(3, 5, [], (value, acc) => [value, ..acc]) :> List.toString;
      let upperCount = ${width}.foldRange(${width}.maximum - 1, ${width}.maximum,
        (0: Int32), (_, count) => count + 1);
      let count = ${width}.foldRange(1, 100000, (0: Int32), (_, count) => count + 1);
    `);
    const [minimum, maximum] = width === "Int32"
      ? [-2147483648n, 2147483647n]
      : [-9223372036854775808n, 9223372036854775807n];
    assertEquals(module.all, "[-2, -1, 0, 1, 2]");
    assertEquals(module.empty, 0);
    assertEquals(module.singleton, `[${maximum}]`);
    assertEquals(module.upper, `[${maximum - 1n}, ${maximum}]`);
    assertEquals(module.lower, `[${minimum}, ${minimum + 1n}]`);
    assertEquals(module.reversed, "empty");
    assertEquals(module.order, "[5, 4, 3]");
    assertEquals(module.upperCount, 2);
    assertEquals(module.count, 100000);
  });
}

Deno.test("Int64 ranges and folds need no conversion through collection indices", async () => {
  const module = await execute(`
    let bounds = (3000000000: Int64, 3000000002: Int64);
    let ids = bounds :> Int64.range :> List.toString;
    let total = Int64.foldRange(3000000000, 3000000002, (0: Int64),
      (id, sum) => Int64.checkedAdd(id, sum) :> Result.debug);
    let renderedTotal = Int64.toString(total);
    let count = List.length32(Int64.range(3000000000, 3000000002));
  `);
  assertEquals(module.ids, "[3000000000, 3000000001, 3000000002]");
  assertEquals(module.renderedTotal, "9000000003");
  assertEquals(module.count, 3);
});
