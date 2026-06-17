import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("constructor fields bind while bare tuple identifiers pin", async () => {
  await checkSource(`
    type Option<T> = None | Some<T>;
    let x = 1;
    let from_ctor = match(opt) => {
      Some(x) => { x },
      None => { 0 },
    };
    let tuple_pin = match(pair) => {
      (x, Var(y)) => { y },
      _ => { 0 },
    };
  `);
});

Deno.test("bare match identifiers must already be in scope", async () => {
  await assertRejects(
    () => checkSource("let bad = match(x) => { y => { 1 }, _ => { 0 } };"),
    Error,
    "unknown pinned pattern y",
  );
});

Deno.test("explicit binder patterns are exhaustive", async () => {
  await checkSource(`
    let id_match = match(value) => {
      Var(x) => { x },
    };
    let first_pair = match(pair) => {
      (Var(x), Var(_y)) => { x },
    };
  `);
});

Deno.test("warns for non-exhaustive matches over closed sums", async () => {
  const result = await checkSource(
    "type Option<T> = None | Some<T>; let bad = match(opt) => { None => { 0 } };",
  );
  assertStringIncludes(result.warnings.join("\n"), "missing Some");
});

Deno.test("warns for partial constructor argument coverage in closed sums", async () => {
  const result = await checkSource(
    "type Option<T> = None | Some<T>; let opt = Some(true); let bad = match(opt) => { Some(true) => { 1 }, None => { 0 } };",
  );
  assertStringIncludes(result.warnings.join("\n"), "non-exhaustive match");
});

Deno.test("accepts exhaustive boolean matches without wildcard", async () => {
  await checkSource("let flag = true; let ok = match(flag) => { true => { 1 }, false => { 0 } };");
});

Deno.test("warns for non-exhaustive non-sum matches", async () => {
  const result = await checkSource("let n = 0; let bad = match(n) => { 0 => { 1 } };");
  assertStringIncludes(result.warnings.join("\n"), "non-exhaustive match");
});

Deno.test("warns for basic redundant match arms", async () => {
  const result = await checkSource("let bad = match(x) => { _ => { 1 }, 0 => { 2 } };");
  assertStringIncludes(result.warnings.join("\n"), "redundant match arm: 0");
  assertEquals(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "pattern.redundant-arm",
  ]);
  assertEquals(
    result.diagnostics[0].primary.kind === "source"
      ? result.diagnostics[0].primary.span.start
      : undefined,
    36,
  );
});

Deno.test("supports constructor and literal let patterns", async () => {
  await checkSource(`
    type Option<T> = None | Some<T>;
    let Some(flag) = Some(true);
    let true = flag;
    let tagged = Some(1);
    let Some(1) = tagged;
  `);
});

Deno.test("warns when let pattern may fail at runtime", async () => {
  const result = await checkSource("type Option<T> = None | Some<T>; let Some(x) = None;");
  assertEquals(result.warnings.length, 1);
  assertStringIncludes(result.warnings[0], "refutable let pattern may fail at runtime");
  assertStringIncludes(result.warnings[0], "Some(x)");
  assertEquals(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "pattern.refutable-let",
  ]);
});

Deno.test("does not warn for irrefutable let patterns", async () => {
  const result = await checkSource("let (x, y) = (1, 2);");
  assertEquals(result.warnings.length, 0);
});

Deno.test("literal let patterns reject mismatches", async () => {
  await assertRejects(
    () => checkSource("let true = 2;"),
    Error,
    "type mismatch",
  );
});

Deno.test("constructor names in let patterns keep constructor status and report refutability", async () => {
  const result = await checkSource(`
    type Option<T> = None | Some<T>;
    let None = Some(1);
  `);

  expectBinding(result.env, "None", { type: "Option<T>", vars: 1 });
  assertStringIncludes(result.warnings.join("\n"), "refutable let pattern may fail at runtime");
});

Deno.test("constructor payload binders reject duplicates across nested patterns", async () => {
  await assertRejects(
    () =>
      checkSource(`
        type Pair<T> = | Pair<T, T>;
        let bad = match(value) => {
          Pair(Var(x), (Var(y), Var(x))) => { y },
          _ => { 0 },
        };
      `),
    Error,
    "duplicate pattern binder x",
  );
});
