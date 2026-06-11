import { checkFile, checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";
import { fileURLToPath } from "node:url";

Deno.test("typechecks AoC-style depth analysis fixture", async () => {
  const source = await Deno.readTextFile(
    new URL("./fixtures/aoc_depths.wm", import.meta.url),
  );
  const result = await checkSource(source);

  expectBinding(result.env, "map", {
    type: "((('a) => 'b, List<'a>)) => List<'b>",
    vars: 2,
  });
  expectBinding(result.env, "filter", {
    type: "((('a) => Bool, List<'a>)) => List<'a>",
    vars: 1,
  });
  expectBinding(result.env, "fold", {
    type: "(((('a, 'b)) => 'a, 'a, List<'b>)) => 'a",
    vars: 2,
  });
  expectBinding(result.env, "windowSums", {
    type: "(List<Number>) => List<Number>",
    vars: 0,
  });
  expectBinding(result.env, "countIncreases", {
    type: "(List<Number>) => Number",
    vars: 0,
  });
  expectBinding(result.env, "countWindowIncreases", {
    type: "(List<Number>) => Number",
    vars: 0,
  });
  expectBinding(result.env, "sampleDepths", {
    type: "List<Number>",
    vars: 0,
  });
  expectBinding(result.env, "largeDepthSum", {
    type: "Number",
    vars: 0,
  });
});

Deno.test("typechecks AoC-style example program", async () => {
  const source = await Deno.readTextFile(
    new URL("../examples/aoc_depths.wm", import.meta.url),
  );
  const result = await checkSource(source);

  expectBinding(result.env, "sampleWindowIncreaseCount", {
    type: "Number",
    vars: 0,
  });
});

Deno.test("typechecks explicit-cons AoC day 1 example", async () => {
  const source = await Deno.readTextFile(
    new URL("../examples/aoc2021_day1.wm", import.meta.url),
  );
  const result = await checkSource(source);

  expectBinding(result.env, "count_window_increases", {
    type: "(List<Number>) => Number",
    vars: 0,
  });
});

Deno.test("typechecks wmsml overlap for polymorphic list helpers", async () => {
  const result = await checkSource(
    `
      datatype 'a list = Nil | Cons of 'a * 'a list

      val rec map = fn (f, xs) =>
        case xs of
          Nil => Nil
        | Cons (x, rest) => Cons (f x, map (f, rest))

      val rec fold = fn (f, acc, xs) =>
        case xs of
          Nil => acc
        | Cons (x, rest) => fold (f, f (acc, x), rest)

      val rec windowSums = fn xs =>
        case xs of
          Cons (a, Cons (b, Cons (c, rest))) =>
            Cons (a + b + c, windowSums (Cons (b, Cons (c, rest))))
        | _ => Nil
    `,
    { surface: "wmsml" },
  );

  expectBinding(result.env, "map", {
    type: "((('a) => 'b, list<'a>)) => list<'b>",
    vars: 2,
  });
  expectBinding(result.env, "fold", {
    type: "(((('a, 'b)) => 'a, 'a, list<'b>)) => 'a",
    vars: 2,
  });
  expectBinding(result.env, "windowSums", {
    type: "(list<Number>) => list<Number>",
    vars: 0,
  });
});

Deno.test("typechecks webhook JS FFI stress fixture", async () => {
  await checkFile(fileURLToPath(new URL("../examples/webhook.wm", import.meta.url)));
});
