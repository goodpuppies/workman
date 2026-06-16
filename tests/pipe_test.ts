import { assertStringIncludes } from "@std/assert";
import { checkSource } from "../src/compiler.ts";

Deno.test("basic pipe to function", async () => {
  await checkSource(`
    let double = (x) => { x * 2 };
    let result = 42 :> double;
  `);
});

Deno.test("chained pipe operators", async () => {
  await checkSource(`
    let double = (x) => { x * 2 };
    let add = (x, y) => { x + y };
    let print = (x) => { x };
    let result = 42 :> double :> add(10) :> print;
  `);
});

Deno.test("pipe with multi-argument function", async () => {
  await checkSource(`
    let add = (x, y) => { x + y };
    let result = 10 :> add(5);
  `);
});

Deno.test("pipe with tuple for multiple arguments", async () => {
  await checkSource(`
    let add = (x, y) => { x + y };
    let result = (10, 5) :> add;
  `);
});

Deno.test("pipe preserves FFI receiver reflection in inline functions", async () => {
  await checkSource(`
    let text = 16 :> ((byte: Number) => { byte.toString(16) });
  `);
});

Deno.test("pipe member segments elaborate to FFI receiver calls", async () => {
  await checkSource(`
    let hex = (byte: Number) => {
      byte :> .toString(16)
    };
    let joined = (items: Js.Object) => {
      items :> .join("")
    };
  `);
});

Deno.test("pipe member chains continue through HM-typed primitive results", async () => {
  await checkSource(`
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let hex = (byte: Number) => {
      let text: String = byte :> .toString(16) :> try;
      text :> .padStart(2, "0")
    };
  `);
});

Deno.test("pipe task error mismatch points at both origin slots", async () => {
  let error: Error | undefined;
  try {
    await checkSource(`
      let scanAll: () => Task<Void, Js.Error> = () => {
        void :> Task.succeed
      };
      let left: Result<Number, String> = Err("cli");
      let bad = left
        :> Task.fromResult
        :> Task.andThen((n) => {
          scanAll()
        });
    `);
  } catch (caught) {
    error = caught as Error;
  }
  if (!error) throw new Error("expected checkSource to reject");
  assertStringIncludes(error.message, "type mismatch in Task.andThen callback result");
  assertStringIncludes(error.message, "expected Task error: Js.Error");
  assertStringIncludes(error.message, "got      Task error: String");
  assertStringIncludes(error.message, "from callback result");
});
