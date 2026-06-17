import { assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";

Deno.test("supports annotations on tuple lambda parameters", async () => {
  await checkSource(`
    let first = ((x, _): (Number, String)) => { x };
    let value = first((1, "a"));
  `);
});

Deno.test("treats multi-argument calls as one tuple argument", async () => {
  await checkSource(`
    let first = (x, _) => { x };
    let a = first(1, 2);
    let b = first((3, 4));
  `);
});

Deno.test("empty call syntax passes a unit/void argument", async () => {
  await checkSource(`
    let one = () => { 1 };
    let a = one();
    let b = one(void);
  `);
  await assertRejects(
    () => checkSource("let one = () => { 1 }; let bad = one(1);"),
    Error,
    "type mismatch",
  );
});

Deno.test("reuses repeated type variables within an annotation", async () => {
  await checkSource(`
    let first_same = (x: t, y: t) => { x };
    let a = first_same(1, 2);
    let b = first_same("a", "b");
  `);
  await assertRejects(
    () =>
      checkSource(`
        let first_same = (x: t, y: t) => { x };
        let bad = first_same(1, "s");
      `),
    Error,
    "type mismatch",
  );
});

Deno.test("supports curried call chaining as unary application", async () => {
  await checkSource("let call = (x) => { (y) => { x + y } }; let result = call(1)(2);");
});

Deno.test("supports whitespace application for curried calls", async () => {
  await checkSource(`
    let call = (x) => { (y) => { x + y } };
    let result = call 1 2;
  `);
});

Deno.test("supports whitespace lambda arguments for curried calls", async () => {
  await checkSource(`
    let use = (x) => { (f) => { f(x) } };
    let result = use 41 (n) => { n + 1 };
  `);
});
