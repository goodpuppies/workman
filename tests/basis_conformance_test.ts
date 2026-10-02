// Conformance tests for layer-1 structures, written from the Basis Library spec pages in
// `research/sml-basis-spec/Basis/`. Functions that raise in the spec return
// `Result<T, Basis.Error>` (`markdown/basis-design.md`, Basis exceptions).
import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { librarySources } from "../src/generated/assets.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";

const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function run(lines: string[]): Promise<string[]> {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(input, `let main = () => {\n${lines.join("\n")}\n};\n`);
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, "run", input],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(new TextDecoder().decode(output.stderr), "");
  return new TextDecoder().decode(output.stdout).trimEnd().split("\n");
}

Deno.test("Option follows OPTION", async () => {
  assertEquals(
    await run([
      "print(Option.isSome(Some(1)));",
      "print(Option.isSome(None));",
      "print(Option.valOf(Some(2)));",
      "print(Option.valOf(None));",
      "print(Option.filter(3, (x) => { x > 2 }));",
      "print(Option.filter(1, (x) => { x > 2 }));",
      "print(Option.join(Some(Some(4))));",
      "print(Option.join(Some(None)));",
      "Option.app(Some(5), print);",
      "Option.app(None, print);",
      "print(Option.compose((x) => { x + 1 }, (y) => { Some(y) })(5));",
      "print(Option.compose((x) => { x + 1 }, (y) => { None })(5));",
      "print(Option.composePartial((x) => { Some(x * 2) }, (y) => { Some(y + 1) })(5));",
    ]),
    [
      "true",
      "false",
      "Ok(2)",
      "Err(Option)",
      "Some(3)",
      "None",
      "Some(4)",
      "None",
      "5",
      "Some(6)",
      "None",
      "Some(12)",
    ],
  );
});

Deno.test("List follows LIST", async () => {
  assertEquals(
    await run([
      "print((List.null([]), List.null([1])));",
      "print((List.hd([1, 2]), List.hd([])));",
      "print((List.tl([1, 2]), List.tl([])));",
      "print((List.last([1, 2, 3]), List.last([])));",
      "print((List.getItem([1, 2]), List.getItem([])));",
      "print(List.concat([[1], [2, 3], []]));",
      "print(List.revAppend([1, 2], [3]));",
      "List.app([1, 2], print);",
      "print(List.mapPartial([1, 2, 3], (x) => { if (x == 2) { None } else { Some(x * 10) } }));",
      "print((List.find([1, 2, 3], (x) => { x > 1 }), List.find([1], (x) => { x > 1 })));",
      "print(List.partition([1, 2, 3, 4], (x) => { x % 2 == 0 }));",
      "print((List.tabulate(3, (i) => { i * i }), List.tabulate(0, (i) => { i })));",
    ]),
    [
      "(true, false)",
      "(Ok(1), Err(Empty))",
      "(Ok(Cons(2, Nil)), Err(Empty))",
      "(Ok(3), Err(Empty))",
      "(Some(1, Cons(2, Nil)), None)",
      "Cons(1, Cons(2, Cons(3, Nil)))",
      "Cons(2, Cons(1, Cons(3, Nil)))",
      "1",
      "2",
      "Cons(10, Cons(30, Nil))",
      "(Some(2), None)",
      "(Cons(2, Cons(4, Nil)), Cons(1, Cons(3, Nil)))",
      "(Cons(0, Cons(1, Cons(4, Nil))), Nil)",
    ],
  );
});

Deno.test("ListPair follows LIST_PAIR", async () => {
  assertEquals(
    await run([
      'print(ListPair.zip([1, 2, 3], ["a", "b"]));',
      'print((ListPair.zipEq([1], ["a", "b"]), ListPair.zipEq([1], ["a"])));',
      'print(ListPair.unzip([(1, "a"), (2, "b")]));',
      "print(ListPair.map([1, 2], [10, 20, 30], (a, b) => { a + b }));",
      "print((ListPair.mapEq([1], [2, 3], (a, b) => { a + b }), ListPair.mapEq([1], [2], (a, b) => { a + b })));",
      "print(ListPair.foldl([1, 2], [3, 4], [], (a, b, acc) => { [a * b, ..acc] }));",
      "print(ListPair.foldr([1, 2], [3, 4], [], (a, b, acc) => { [a * b, ..acc] }));",
      "print(ListPair.foldlEq([1], [2, 3], 0, (a, b, acc) => { acc + a + b }));",
      "print(ListPair.foldrEq([1, 2], [3, 4], 0, (a, b, acc) => { acc + a * b }));",
      "print((ListPair.all([1, 2], [1], (a, b) => { a == b }), ListPair.allEq([1, 2], [1], (a, b) => { a == b })));",
      "print((ListPair.exists([1, 2], [0, 2], (a, b) => { a == b }), ListPair.exists([1], [0], (a, b) => { a == b })));",
      'ListPair.app([1, 2], ["x", "y", "z"], (a, b) => { print((a, b)) });',
      "print(ListPair.appEq([1], [], (a, b) => { print(a) }));",
    ]),
    [
      "Cons((1, a), Cons((2, b), Nil))",
      "(Err(UnequalLengths), Ok(Cons((1, a), Nil)))",
      "(Cons(1, Cons(2, Nil)), Cons(a, Cons(b, Nil)))",
      "Cons(11, Cons(22, Nil))",
      "(Err(UnequalLengths), Ok(Cons(3, Nil)))",
      "Cons(8, Cons(3, Nil))",
      "Cons(3, Cons(8, Nil))",
      "Err(UnequalLengths)",
      "Ok(11)",
      "(true, false)",
      "(true, false)",
      "(1, x)",
      "(2, y)",
      "Err(UnequalLengths)",
    ],
  );
});

Deno.test("Vector follows VECTOR", async () => {
  assertEquals(
    await run([
      "let v = Vector.fromList([1, 2, 3]);",
      "print((v, Vector.length(v), Vector.maxLen));",
      "print((Vector.sub(v, 1), Vector.sub(v, 3), Vector.sub(v, -1), Vector.sub(v, 0.5)));",
      "print((Vector.update(v, 0, 9), Vector.update(v, 3, 9), v));",
      "print((Vector.tabulate(3, (i) => { i * 2 }), Vector.concat([v, v])));",
      "print((Vector.map(v, (x) => { x + 1 }), Vector.mapi(v, (i, x) => { i * x })));",
      "print((Vector.foldl(v, [], (x, acc) => { [x, ..acc] }), Vector.foldr(v, [], (x, acc) => { [x, ..acc] })));",
      "print(Vector.foldli(v, [], (i, x, acc) => { [(i, x), ..acc] }));",
      "print(Vector.foldri(v, [], (i, x, acc) => { [(i, x), ..acc] }));",
      "print((Vector.findi(v, (i, x) => { x > 1 }), Vector.find(v, (x) => { x > 5 })));",
      "print((Vector.exists(v, (x) => { x == 2 }), Vector.all(v, (x) => { x > 1 })));",
      "Vector.appi(v, (i, x) => { print((i, x)) });",
      "print((v == Vector.fromList([1, 2, 3]), v == Vector.fromList([1, 2])));",
    ]),
    [
      "(Vector[1, 2, 3], 3, 4294967295)",
      "(Ok(2), Err(Subscript), Err(Subscript), Err(Subscript))",
      "(Ok(Vector[9, 2, 3]), Err(Subscript), Vector[1, 2, 3])",
      "(Vector[0, 2, 4], Vector[1, 2, 3, 1, 2, 3])",
      "(Vector[2, 3, 4], Vector[0, 2, 6])",
      "(Cons(3, Cons(2, Cons(1, Nil))), Cons(1, Cons(2, Cons(3, Nil))))",
      "Cons((2, 3), Cons((1, 2), Cons((0, 1), Nil)))",
      "Cons((0, 1), Cons((1, 2), Cons((2, 3), Nil)))",
      "(Some(1, 2), None)",
      "(true, false)",
      "(0, 1)",
      "(1, 2)",
      "(2, 3)",
      "(true, false)",
    ],
  );
});

Deno.test("VectorSlice follows VECTOR_SLICE", async () => {
  assertEquals(
    await run([
      "let v = Vector.fromList([10, 20, 30, 40]);",
      "let s = VectorSlice.full(v);",
      "print((s, VectorSlice.length(s), VectorSlice.sub(s, 3), VectorSlice.sub(s, 4)));",
      "print((VectorSlice.slice(v, 1, Some(2)), VectorSlice.slice(v, 4, None)));",
      "print((VectorSlice.slice(v, 5, None), VectorSlice.slice(v, 1, Some(4))));",
      "match(VectorSlice.slice(v, 1, None)) {",
      "  Ok(mid) => {",
      "    print((VectorSlice.base(mid), VectorSlice.vector(mid)));",
      "    print((VectorSlice.subslice(mid, 1, Some(1)), VectorSlice.subslice(mid, 2, Some(2))));",
      "    print((VectorSlice.getItem(mid), VectorSlice.isEmpty(mid)));",
      "    print((VectorSlice.foldl(mid, 0, (x, acc) => { acc + x }), VectorSlice.mapi(mid, (i, x) => { i + x })));",
      "    print((VectorSlice.findi(mid, (i, x) => { x == 30 }), VectorSlice.concat([mid, s])));",
      "    print((VectorSlice.exists(mid, (x) => { x == 10 }), VectorSlice.all(mid, (x) => { x > 10 })))",
      "  },",
      "  Err(error) => { print(error) }",
      "};",
    ]),
    [
      "(VectorSlice[10, 20, 30, 40], 4, Ok(40), Err(Subscript))",
      "(Ok(VectorSlice[20, 30]), Ok(VectorSlice[]))",
      "(Err(Subscript), Err(Subscript))",
      "((Vector[10, 20, 30, 40], 1, 3), Vector[20, 30, 40])",
      "(Ok(VectorSlice[30]), Err(Subscript))",
      "(Some(20, VectorSlice[30, 40]), false)",
      "(90, Vector[20, 31, 42])",
      "(Some(1, 30), Vector[20, 30, 40, 10, 20, 30, 40])",
      "(false, true)",
    ],
  );
});

Deno.test("vectors admit equality exactly when their elements do; slices never do", async () => {
  for (
    const expression of [
      "Vector.fromList([(x) => { x }]) == Vector.fromList([])",
      "VectorSlice.full(Vector.fromList([1])) == VectorSlice.full(Vector.fromList([1]))",
    ]
  ) {
    const dir = await Deno.makeTempDir();
    const input = `${dir}/main.wm`;
    await Deno.writeTextFile(input, `let main = () => { print(${expression}) };\n`);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", cli, "run", input],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 1, expression);
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(stderr.includes("does not admit equality"), true, stderr);
  }
});

Deno.test("General follows GENERAL", async () => {
  assertEquals(
    await run([
      "print(General.o((x) => { x + 1 }, (x) => { x * 2 })(5));",
      'print(General.before(1, print("evaluated")));',
      "print(General.ignore(3));",
      "print((General.Less, General.Equal, General.Greater));",
    ]),
    ["11", "evaluated", "1", "void", "(Less, Equal, Greater)"],
  );
});

Deno.test("collate compares lexicographically", async () => {
  const compare =
    "(a, b) => { if (a < b) { General.Less } else { if (a > b) { General.Greater } else { General.Equal } } }";
  assertEquals(
    await run([
      `let compare = ${compare};`,
      "print((List.collate([1, 2], [1, 2], compare), List.collate([1], [1, 2], compare), List.collate([2], [1, 9], compare)));",
      "let v = (items) => { Vector.fromList(items) };",
      "print((Vector.collate(v([1, 2]), v([1, 2]), compare), Vector.collate(v([1, 2]), v([1]), compare), Vector.collate(v([0, 9]), v([1]), compare)));",
      "let s = (items) => { VectorSlice.full(Vector.fromList(items)) };",
      "let tail = Result.debug(VectorSlice.slice(Vector.fromList([9, 1, 2]), 1, None));",
      "print((VectorSlice.collate(tail, s([1, 2]), compare), VectorSlice.collate(tail, s([1, 3]), compare), VectorSlice.collate(s([]), s([]), compare)));",
    ]),
    [
      "(Equal, Less, Greater)",
      "(Equal, Greater, Less)",
      "(Equal, Less, Equal)",
    ],
  );
});

Deno.test("Math follows MATH", async () => {
  assertEquals(
    await run([
      "print((Math.pi, Math.sqrt(16), Math.atan2(1, 1), Math.ln(Math.e), Math.pow(2, 10), Math.log10(1000)));",
      "print((Math.sqrt(0 - 1), Math.cos(0), Math.tanh(0)));",
    ]),
    ["(3.141592653589793, 4, 0.7853981633974483, 1, 1024, 3)", "(NaN, 1, 0)"],
  );
});

Deno.test("Real follows REAL for the implemented subset", async () => {
  const nan = "(0 / 0)";
  assertEquals(
    await run([
      `print((Real.rem(7, 3), Real.rem(0 - 7, 3), Real.min(1, ${nan}), Real.max(${nan}, 2)));`,
      `print((Real.sign(0 - 3), Real.sign(0), Real.sign(${nan})));`,
      "print((Real.signBit(-0), Real.signBit(0), Real.sameSign(0 - 1, 0 - 2), Real.copySign(3, -0)));",
      `print((Real.compare(1, 2), Real.compare(2, 2), Real.compare(${nan}, 1), Real.unordered(1, ${nan})));`,
      "print((Real.toManExp(8), Real.fromManExp(Real.toManExp(0 - 12.5)), Real.split(0 - 3.25), Real.realMod(2.75)));",
      "print((Real.nextAfter(1, 2) - 1, Real.isNormal(Real.minPos), Real.isNormal(1), Real.isFinite(Real.posInf)));",
      "print((Real.realRound(2.5), Real.realRound(3.5), Real.realRound(0 - 2.5), Real.realFloor(0 - 1.5)));",
      `print((Real.round(0.5), Real.floor(0 - 1.5), Real.ceil(1.2), Real.trunc(${nan})));`,
      "print((Real.checkFloat(1.5), Real.radix, Real.precision, Real.minNormalPos > 0));",
    ]),
    [
      "(1, -1, 1, 2)",
      "(Ok(-1), Ok(0), Err(Domain))",
      "(true, false, true, -3)",
      "(Ok(Less), Ok(Equal), Err(Unordered), true)",
      "({ exp = 4, man = 0.5 }, -12.5, { frac = -0.25, whole = -3 }, 0.75)",
      "(2.220446049250313e-16, false, true, false)",
      "(2, 4, -2, -2)",
      "(Ok(0), Ok(-2), Ok(2), Err(Domain))",
      "(1.5, 2, 53, true)",
    ],
  );
});

Deno.test("Number.div and Number.mod floor like SML's div and mod", async () => {
  assertEquals(
    await run([
      "print((Number.div(7, 2), Number.div(0 - 7, 2), Number.mod(0 - 7, 3), Number.mod(7, 0 - 3), (0 - 7) % 3));",
    ]),
    ["(3, -4, 2, -2, -1)"],
  );
});

Deno.test("layer 1 names Js.* only in the signatures of its primitive imports (BD17)", async () => {
  const leaks: string[] = [];
  for (const [path, source] of Object.entries(librarySources)) {
    if (!path.startsWith("basis/")) continue;
    const module = await parseCompilerModule(source, {}, path);
    for (const decl of module.decls) {
      if (decl.kind === "JsImportDecl") continue;
      const names = JSON.stringify(decl, (key, value) => key === "node" ? undefined : value)
        .match(/"Js\.[A-Za-z.]+"/g) ?? [];
      leaks.push(...names.map((name) => `${path}: ${name}`));
    }
  }
  assertEquals(leaks, []);
});
