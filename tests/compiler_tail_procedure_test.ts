import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileLibraryFile, compileLibraryVirtual } from "../src/compiler.ts";

const result = `
  type Result<a, e> = Good<a> | Bad<e>;
  let bind = (value, f) => {
    match(value) { Good(x) => { f(x) }, Bad(e) => { Bad(e) } }
  };
  let via = (f) => (value) => { bind(value, f) };
`;

async function build(source: string, extra: [string, string][] = []) {
  const js = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([
      ["/test/main.wm", source],
      ["/test/result.wm", result],
      ...extra,
    ]),
  );
  const mod = await import(`data:text/javascript;base64,${btoa(js)}`);
  return { js, mod };
}

Deno.test("tail-specializes imported procedure factories and nested callback stages", async () => {
  const { js, mod } = await build(`
    from "./result.wm" import * as R;
    let via = R.via;
    let run = (limit) => {
      let rec go = (n, acc) => {
        let read = via (next) => {
          if (next == 0) { R.Good(acc) } else {
            let append = via (value) => { go(next - 1, value) };
            R.Good(acc + 1) :> append
          }
        };
        R.Good(n) :> read
      };
      go(limit, 0)
    };
    let answer = run(100000);
    let failed = {
      let rec go = (n) => {
        let read = via (next) => { go(next - 1) };
        if (n == 0) { R.Good(0) } else { R.Bad("stop") :> read }
      };
      go(100000)
    };
  `);
  assertStringIncludes(js, "continue __wm_tail_");
  assertEquals(mod.answer.name, "Good");
  assertEquals(mod.answer.args, [100000]);
  assertEquals(mod.failed.name, "Bad");
  assertEquals(mod.failed.args, ["stop"]);
});

Deno.test("procedure specialization preserves callback captures and argument evaluation order", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const host = `${dir}/effects.ts`;
    await Deno.writeTextFile(
      host,
      `
      const log: string[] = [];
      export function note(x: string): void { log.push(x); }
      export function history(): string { return log.join(","); }
    `,
    );
    const input = `${dir}/main.wm`;
    await Deno.writeTextFile(
      input,
      `
      from js.module("./effects.ts") import { history, note };
      let make = (f) => (value) => { f(value) };
      let rec go = (n, acc) => {
        let saved = n;
        note("capture");
        let callback = (x) => {
          if (saved == 0) { acc } else { go(x - 1, acc + saved) }
        };
        let stage = make(callback);
        let value = { note("argument"); n };
        stage(value)
      };
      let answer = go(3, 0);
      let log = history();
    `,
    );
    const js = await compileLibraryFile(input);
    const mod = await import(`data:text/javascript;base64,${btoa(js)}`);
    assertStringIncludes(js, "continue __wm_tail_");
    assertEquals(mod.answer, 6);
    assertEquals(mod.log.name, "Ok");
    assertEquals(mod.log.args, [
      "capture,argument,capture,argument,capture,argument,capture,argument",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("does not treat callbacks with subsequent work as tail calls", async () => {
  const { js, mod } = await build(`
    let after = (f) => (x) => { f(x) + 1 };
    let rec go = (n) => {
      let stage = after (next) => { go(next - 1) };
      if (n == 0) { 0 } else { stage(n) }
    };
    let answer = go(30);
  `);
  assertEquals(mod.answer, 30);
  assertEquals(js.includes("continue __wm_tail_"), false);
});

Deno.test("tail-specializes wrappers through named imports with their defining module scope", async () => {
  const { mod } = await build(
    `
    from "./adapter.wm" import { wrap };
    let rec go = (n) => {
      let step = wrap (x) => { if (x == 0) { 7 } else { go(x - 1) } };
      step(n)
    };
    let answer = go(100000);
  `,
    [[
      "/test/adapter.wm",
      `
    from "./forward.wm" import { forward };
    let wrap = (f) => (x) => { forward(x, f) };
  `,
    ], ["/test/forward.wm", "let forward = (x, f) => { f(x) };"]],
  );
  assertEquals(mod.answer, 7);
});
