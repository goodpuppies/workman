import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, compileLibraryVirtual } from "../src/compiler.ts";

Deno.test("repeated wildcards work in constructor payloads and list match patterns", async () => {
  const source = `
    type Pair = | Pair<Number, String>;
    type Item = Operand<Number> | Operator<String>;
    let pair = match(value) => {
      Pair(_, _) => { 1 },
    };
    let items = match(values) => {
      [Operand(_), .._] => { 1 },
      [_, _, .._] => { 2 },
      _ => { 0 },
    };
    let named = match(value) => {
      Pair(_number, _text) => { (_number, _text) },
    };
    let pairResult = pair(Pair(3, "three"));
    let operandResult = items([Operand(3)]);
    let listResult = items([Operator("+"), Operand(3)]);
    let emptyResult = items([]);
    let namedResult = named(Pair(3, "three"));
  `;
  const result = await checkSource(source);
  assertEquals(result.warnings, []);

  const js = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const module = await import(`data:text/javascript;base64,${btoa(js)}`);
  assertEquals(module.pairResult, 1);
  assertEquals(module.operandResult, 1);
  assertEquals(module.listResult, 2);
  assertEquals(module.emptyResult, 0);
  assertEquals(module.namedResult, [3, "three"]);
});

Deno.test("constructor and list wildcards do not introduce a variable binding", async () => {
  for (const pattern of ["Some(_)", "[_]", "[1, .._]"]) {
    await assertRejects(
      () =>
        checkSource(`
          type Option<T> = None | Some<T>;
          let bad = match(value) => {
            ${pattern} => { _ },
            _ => { 0 },
          };
        `),
      Error,
      "unknown name _",
    );
  }
});
