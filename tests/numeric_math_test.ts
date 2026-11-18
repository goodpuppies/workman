import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compile, compileLibraryVirtual } from "../src/compiler.ts";

async function execute(source: string) {
  const code = await compileLibraryVirtual("/app/math.wm", new Map([["/app/math.wm", source]]));
  return await import(`data:text/javascript,${encodeURIComponent(code)}`);
}

Deno.test("numeric namespaces select arithmetic carriers while explicit math aliases agree", async () => {
  const module = await execute(`
    from "std/int32.wm" import * as I;
    let narrow: Int32 = [1, 2, 3] :> List.sumWith(Int32);
    let explicit: Int32 = [1, 2, 3] :> List.sumWith(Int32.math);
    let aliased: Int32 = [1, 2, 3] :> List.sumWith(I);
    let wide: Int64 = [3000000000, 2] :> List.sumWith(Int64);
    let product: Int32 = [2, 3, 4] :> List.productWith(Int32);
    let empty: Int64 = [] :> List.sumWith(Int64);
    let emptyProduct: Int64 = [] :> List.productWith(Int64.math);
    let real: Real64 = [1.5, 2.25] :> List.sumWith(Real64);
    let single: Real32 = [1.5, 2.25] :> List.sumWith(Real32);
    let byte: Word8 = [20, 20] :> List.productWith(Word8);
    let short: Word16 = [2, 3] :> List.sumWith(Word16);
    let word: Word32 = [2, 3] :> List.sumWith(Word32);
    let wideWord: Word64 = [2, 3] :> List.sumWith(Word64);
    let ordinary: Int32 = 1 + 2;
    let lifted = (Ok(2) + 3) :> Result.debug;
    let monadic = Ok(1) :> Monad.map(Result, n => n + 1) :> Result.debug;
  `);
  assertEquals([module.narrow, module.explicit, module.aliased, module.wide, module.product], [
    6,
    6,
    6,
    3000000002n,
    24,
  ]);
  assertEquals([module.empty, module.emptyProduct, module.real, module.single], [
    0n,
    1n,
    3.75,
    3.75,
  ]);
  assertEquals([module.byte, module.short, module.word, module.wideWord], [144, 5, 5, 5n]);
  assertEquals([module.ordinary, module.lifted, module.monadic], [3, 5, 2]);
});

Deno.test("arithmetic records work as first-class values with left-to-right accumulation", async () => {
  const module = await execute(`
    let append: Numeric.Arithmetic<String> = .{
      zero = "", one = "!",
      add = (total, value) => total ++ value,
      mul = (total, value) => total ++ value
    };
    let sum = ["a", "b", "c"] :> List.sumWith(append);
    let product = ["a", "b", "c"] :> List.productWith(append);
    let choose = enabled => if (enabled) { Int32.math } else { Int32.carrier };
    let selected = [1, 2] :> List.sumWith(choose(true));
  `);
  assertEquals([module.sum, module.product, module.selected], ["abc", "!abc", 3]);
});

Deno.test("arithmetic and monadic carriers remain distinct ordinary record types", async () => {
  await assertRejects(() => checkSource("let bad = [1, 2] :> List.sumWith(Result);"));
  await assertRejects(() => checkSource("let bad = Ok(1) :> Monad.map(Int32, n => n + 1);"));
  await assertRejects(() =>
    checkSource("let xs: List<Int32> = [1, 2]; let bad = xs :> List.sumWith(Int64);")
  );
});

Deno.test("numeric sums preserve checked integer operator overflow", async () => {
  const js = await compile("let total = [2147483647, 1] :> List.sumWith(Int32);");
  const directory = await Deno.makeTempDir();
  try {
    const filename = `${directory}/main.mjs`;
    await Deno.writeTextFile(filename, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-config", filename],
      stderr: "piped",
    }).output();
    assertEquals(result.success, false);
    assertStringIncludes(new TextDecoder().decode(result.stderr), "Int32 overflow");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
