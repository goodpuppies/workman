import { assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";

Deno.test("generalizes recursive function bindings after solving", async () => {
  await checkSource('let rec id = (x) => { x }; let a = id(1); let b = id("s");');
});

Deno.test("allows rec marker without recursive value use", async () => {
  await checkSource("let rec value = 1;");
});

Deno.test("rejects unguarded recursive value bindings", async () => {
  await assertRejects(
    () => checkSource("let rec x = x;"),
    Error,
    "recursive references must be guarded by a function",
  );
  await assertRejects(
    () => checkSource("type List<T> = Nil | Cons<T, List<T>>; let rec xs = Cons(1, xs);"),
    Error,
    "recursive references must be guarded by a function",
  );
});

Deno.test("rejects unguarded recursive value uses in block-local declarations", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let rec x = {
          let y = x;
          1
        };
      `),
    Error,
    "recursive references must be guarded by a function",
  );
});

Deno.test("recursive use scanner respects local block shadowing after initializer checks", async () => {
  await checkSource(`
    let rec x = {
      let x = 1;
      x
    };
  `);
});

Deno.test("allows recursive records when recursive use is function-guarded", async () => {
  await checkSource(`
    record Runner = { run: (Number) => Number };
    let rec runner: Runner = .{ run = (n) => { runner.run(n) } };
  `);
});

Deno.test("checks annotations on recursive function bindings", async () => {
  await checkSource(`
    let rec id: (t) => t = (x) => { x };
    let a = id(1);
    let b = id("s");
  `);
  await assertRejects(
    () => checkSource("let rec bad: (Number) => String = (x) => { x };"),
    Error,
    "type mismatch",
  );
});
