import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, checkVirtual, compileLibraryVirtual } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("Atomics helpers retain nominal typed-array parameters through ordinary WM calls", async () => {
  const inferred = await checkSource(`
    from js.global("Atomics") import { wait };
    let ready = (cells) => { wait(cells, 0, 1, 0) };
  `);
  expectBinding(inferred.env, "ready", {
    type: "Int32Array -> Result<String, Js.Error>!",
    vars: 0,
  });
  const result = await checkSource(`
    from js.global import type { Int32Array };
    from js.global("Atomics") import { wait, load };
    let ready = (cells) => { wait(cells, 0, 1, 0); load(cells, 0) };
    let exchange = (cells) => { ready(cells) };
    let call = (cells: Int32Array) => { exchange(cells) };
  `);
  expectBinding(result.env, "call", { type: "Int32Array -> Result<Real64.Real, Js.Error>!", vars: 0 });
});

Deno.test("importers retain RPC exports after several pending FFI declaration boundaries", async () => {
  const results = await checkVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/shared.wm",
        `
      from js.global import type { SharedArrayBuffer, Int32Array };
      from js.global import unsafe { Int32Array as constructor: Js.Value };
      from js.global("Reflect") import { construct };
      let cells = (shared: SharedArrayBuffer) => {
        construct(constructor, JSON[shared]) :> Result.andThen((raw) => {
          let typed: Result<Int32Array, Js.Error> = raw :> Json.assert;
          typed
        })
      };
    `,
      ],
      [
        "/test/rpc.wm",
        `
      from "./shared.wm" import * as Shared;
      from js.global import { Worker, SharedArrayBuffer, TextEncoder };
      from js.global("Atomics") import { wait, load };
      let ready = (cells) => { wait(cells, 0, 1, 0); load(cells, 0) };
      let connect = (worker) => {
        SharedArrayBuffer.new(8) :> Result.andThen((signal) => {
          Shared.cells(signal) :> Result.andThen((cells) => {
            worker :> .postMessage(JSON{ signal: signal })
              :> Result.andThen((_) => { ready(cells) })
          })
        })
      };
      let exchange = (worker, cells) => {
        worker :> .postMessage(JSON{ phase: "run" })
          :> Result.andThen((_) => { ready(cells) })
      };
      let call = (url) => {
        Worker.new(url, JSON{ "type": "module" }) :> Result.andThen((worker) => {
          connect(worker) :> Result.andThen((_) => { SharedArrayBuffer.new(8) })
            :> Result.andThen((signal) => {
              Shared.cells(signal) :> Result.andThen((cells) => { exchange(worker, cells) })
            })
        })
      };
      let encodedSize = (text) => {
        TextEncoder.new() :> Result.andThen((encoder) => { encoder :> .encode(text) })
          :> Result.andThen((encoded) => { encoded :> .byteLength })
      };
    `,
      ],
      [
        "/test/main.wm",
        `
      from "./rpc.wm" import * as Rpc;
      let call = (url) => { Rpc.call(url) };
      let size = (text) => { Rpc.encodedSize(text) };
    `,
      ],
    ]),
  );
  assertEquals(results.get("/test/rpc.wm")?.exports.has("call"), true);
  assertEquals(results.get("/test/main.wm")?.diagnostics, []);
});

Deno.test("typed-array parameters reject a different nominal view", async () => {
  await assertRejects(() =>
    checkSource(`
    from js.global import type { Float64Array };
    from js.global("Atomics") import { wait };
    let ready = (cells) => { wait(cells, 0, 1, 0) };
    let bad = (cells: Float64Array) => { ready(cells) };
  `)
  );
});

Deno.test("Atomics helpers operate on the original typed-array storage at runtime", async () => {
  const source = `
    from js.global import { Int32Array };
    from js.global("Atomics") import { wait, load, store };
    let set = (cells) => { wait(cells, 0, 1, 0); store(cells, 0, 42) };
    let read = (cells) => { wait(cells, 0, 1, 0); load(cells, 0) };
    let answer = Int32Array.new(2) :> Result.andThen((cells) => {
      set(cells) :> Result.andThen((_) => { read(cells) })
    }) :> Result.getOr(-1);
  `;
  const js = await compileLibraryVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const module = await import(`data:text/javascript;base64,${btoa(js)}`);
  assertEquals(module.answer, 42);
});
