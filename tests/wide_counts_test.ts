import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compileLibraryVirtual } from "../src/compiler.ts";

async function execute(source: string) {
  const code = await compileLibraryVirtual("/app/counts.wm", new Map([["/app/counts.wm", source]]));
  return await import(
    `data:text/javascript;base64,${
      btoa(Array.from(new TextEncoder().encode(code), (byte) => String.fromCharCode(byte)).join(""))
    }`
  );
}

Deno.test("collection defaults use Int64 while explicit 32 variants preserve Int32", async () => {
  const module = await execute(`
    let values = [10, 20, 30];
    let wide: Int64 = List.length(values);
    let narrow: Int32 = List.length32(values);
    let pervasive: Int64 = length(values);
    let pervasive32: Int32 = length32(values);
    let indices: List<Int64> = List.tabulate(3, i => i) :> Result.debug;
    let indices32: List<Int32> = List.tabulate32(3, i => i) :> Result.debug;
    let index: Int64 = List.at(indices, 2) :> Result.debug;
    let index32: Int32 = List.at32(indices32, 2) :> Result.debug;
    let halves = List.splitAt(values, 1) :> Result.debug;
    let halves32 = List.splitAt32(values, 1) :> Result.debug;
    let kept = List.take(values, 2) :> Result.debug :> List.toString;
    let dropped = List.drop(values, 2) :> Result.debug :> List.toString;
    let repeated = List.repeat(7, 3) :> Result.debug :> List.toString;
    let sameHalves = halves == halves32;
    let tupleItems = List.tabulate(2, i => (i, i + 1)) :> Result.debug :> List.length;
  `);
  assertEquals([module.wide, module.narrow, module.pervasive, module.pervasive32], [3n, 3, 3n, 3]);
  assertEquals([module.index, module.index32, module.tupleItems], [2n, 2, 2n]);
  assertEquals([module.kept, module.dropped, module.repeated, module.sameHalves], [
    "[10, 20]",
    "[30]",
    "[7, 7, 7]",
    true,
  ]);
});

Deno.test("byte strings and Unicode text have coherent wide and 32-bit size and slice APIs", async () => {
  const module = await execute(`
    let wide: Int64 = String.size("abc") :> Result.debug;
    let narrow: Int32 = String.size32("abc") :> Result.debug;
    let pervasive: Int64 = size("abc") :> Result.debug;
    let pervasive32: Int32 = size32("abc") :> Result.debug;
    let textWide: Int64 = Text.size("a🐈b") :> Result.debug;
    let text32: Int32 = Text.size32("a🐈b") :> Result.debug;
    let bytes = String.substring("abc", 1, 2) :> Result.debug;
    let bytes32 = String.substring32("abc", 1, 2) :> Result.debug;
    let tail = String.extract("abc", 1, None) :> Result.debug;
    let scalar = Text.substring("a🐈b", 1, 1) :> Result.debug;
    let scalar32 = Text.substring32("a🐈b", 1, 1) :> Result.debug;
    let scalarTail = Text.extract("a🐈b", 1, None) :> Result.debug;
    let nativeOf = Text.of(42);
    let padded = StringCvt.padLeft("ab", 4, '0') :> Result.debug;
    let padded32 = StringCvt.padLeft32("ab", 4, '0') :> Result.debug;
    let paddedText = StringCvt.padTextRight("🐈", 3, 46) :> Result.debug;
    let negativeWidth = StringCvt.padRight("ab", -9223372036854775808, '0') :> Result.debug;
  `);
  assertEquals([
    module.wide,
    module.narrow,
    module.pervasive,
    module.pervasive32,
    module.textWide,
    module.text32,
  ], [3n, 3, 3n, 3, 3n, 3]);
  assertEquals([
    module.bytes,
    module.bytes32,
    module.tail,
    module.scalar,
    module.scalar32,
    module.scalarTail,
    module.nativeOf,
  ], ["bc", "bc", "bc", "🐈", "🐈", "🐈b", "42"]);
  assertEquals([module.padded, module.padded32, module.paddedText, module.negativeWidth], [
    "00ab",
    "00ab",
    "🐈..",
    "ab",
  ]);
});

Deno.test("wide indices are validated without narrowing or invoking invalid-count callbacks", async () => {
  const module = await execute(`
    let huge = 3000000000: Int64;
    let missing = List.at([1], huge) == Err(List.OutOfBounds);
    let shortTake = List.take([1], huge) == Err(List.OutOfBounds);
    let shortDrop = List.drop([1], huge) == Err(List.OutOfBounds);
    let negative = List.splitAt([1], -9223372036854775808) == Err(List.InvalidIndex);
    let empty = List.tabulate(-1, _ => Panic("unexpected callback"));
    let invalidTabulate = match(empty) { Err(List.InvalidCount) => true, _ => false };
    let invalidRepeat = List.repeat(1, -1) == Err(List.InvalidCount);
    let bytes = String.substring("abc", huge, 1) == Err(String.InvalidIndex);
    let text = Text.substring("a🐈b", huge, 1) == Err(Text.InvalidIndex);
  `);
  for (
    const key of [
      "missing",
      "shortTake",
      "shortDrop",
      "negative",
      "invalidTabulate",
      "invalidRepeat",
      "bytes",
      "text",
    ]
  ) assertEquals(module[key], true, key);
});

Deno.test("count widths remain explicit across already-bound values", async () => {
  await assertRejects(() =>
    checkSource("let count: Int32 = 3; let values = List.tabulate(count, i => i);")
  );
  const error = await assertRejects(() =>
    checkSource("let count: Int64 = 3; let values = List.tabulate32(count, i => i);")
  );
  assertStringIncludes(String(error), "Int64");
});
