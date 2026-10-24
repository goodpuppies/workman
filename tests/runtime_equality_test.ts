import { assertEquals } from "@std/assert";
import { emitRuntimePrelude } from "../src/core/emit_prelude.ts";

const equal = new Function(
  emitRuntimePrelude().join("\n") + "\nreturn __wm_eq;",
)() as (left: unknown, right: unknown) => boolean;

Deno.test("emitted equality preserves primitive and nested structural comparisons", () => {
  const pairs: [unknown, unknown, boolean][] = [
    [0, -0, true],
    [1, 2, false],
    [NaN, NaN, false],
    ["same", "same", true],
    ["left", "right", false],
    [true, false, false],
    [1n, 2n, false],
    [undefined, undefined, true],
    [null, null, true],
    [null, undefined, false],
    [1, { value: 1 }, false],
    [[1, ["x", true]], [1, ["x", true]], true],
    [[1, 2], [1, 3], false],
    [{ x: 1, y: [2] }, { y: [2], x: 1 }, true],
    [{ x: 1 }, { x: 1, y: 2 }, false],
    [{ ctor: 123, args: [[1, "x"]] }, { ctor: 123, args: [[1, "x"]] }, true],
    [{ ctor: 123, args: [1] }, { ctor: 124, args: [1] }, false],
  ];
  for (const [left, right, expected] of pairs) assertEquals(equal(left, right), expected);
});

Deno.test("emitted equality retains vector contents and slice identity semantics", () => {
  const bytes = (values: number[]) => ({
    [Symbol.for("wm.Word8Vector.data")]: new Uint8Array(values),
  });
  const vector = (values: unknown[]) => ({ [Symbol.for("wm.Vector.data")]: values });
  const slice = () => ({ [Symbol.for("wm.Word8VectorSlice.data")]: {} });
  assertEquals(equal(bytes([1, 2]), bytes([1, 2])), true);
  assertEquals(equal(bytes([1, 2]), bytes([1, 3])), false);
  assertEquals(equal(bytes([1]), {}), false);
  assertEquals(equal(vector([{ x: 1 }]), vector([{ x: 1 }])), true);
  assertEquals(equal(vector([1]), vector([2])), false);
  const same = slice();
  assertEquals(equal(same, same), true);
  assertEquals(equal(slice(), slice()), false);
});

Deno.test("emitted equality compares long lists without recursion", () => {
  const list = (length: number, last: unknown) => {
    let cell: unknown = { ctor: 0, args: [] };
    for (let index = 0; index < length; index++) {
      cell = { ctor: 1, args: [[index === 0 ? last : "x", cell]] };
    }
    return cell;
  };
  assertEquals(equal(list(200000, "x"), list(200000, "x")), true);
  assertEquals(equal(list(200000, "x"), list(200000, "y")), false);
});
