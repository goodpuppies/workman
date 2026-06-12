import { assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, checkVirtual, compile } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("supports typed JS namespace imports", async () => {
  const result = await checkSource(`
    from js.global("console") import unsafe { log: (String, Number) => Void } as console;
    let main = () => {
      console.log("answer", 42)
    };
  `);

  expectBinding(result.env, "main", { type: "(Void) => Void", vars: 0 });
});

Deno.test("manual non-unsafe imports are fallible", async () => {
  const result = await checkSource(`
    from js.global("JSON") import {
      parse: (String) => Js.Object,
      stringify: (Js.Value) => Result<String, Js.Error>,
    } as JSON;
    from js.global("Deno") import { args: Js.Array<String> };
    let parsed = JSON.parse("{}");
    let text = JSON.stringify(JSON{ ok: true });
  `);

  expectBinding(result.env, "parsed", { type: "Result<Js.Object, Js.Error>", vars: 0 });
  expectBinding(result.env, "text", { type: "Result<String, Js.Error>", vars: 0 });
  expectBinding(result.env, "args", { type: "Result<Js.Array<String>, Js.Error>", vars: 0 });
});

Deno.test("rejects generic handwritten JS FFI signatures", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.global import unsafe {
          id: (T) => T
        };
      `),
    Error,
    "FFI signatures must be explicit",
  );
});

Deno.test("supports inferred JS named and namespace imports", async () => {
  const result = await checkSource(`
    from js.global("Math") import { max as jsmax, floor };
    from js.global("Math") import * as Math;
    let bigger = jsmax(1, 2);
    let rounded = floor(4.8);
    let rooted = Math.sqrt(9);
  `);

  expectBinding(result.env, "floor", { type: "(Number) => Result<Number, Js.Error>", vars: 0 });
  expectBinding(result.env, "bigger", { type: "Result<Number, Js.Error>", vars: 0 });
  expectBinding(result.env, "rounded", { type: "Result<Number, Js.Error>", vars: 0 });
  expectBinding(result.env, "rooted", { type: "Result<Number, Js.Error>", vars: 0 });
});

Deno.test("supports inferred callable root JS globals", async () => {
  const result = await checkSource(`
    from js.global import { fetch };
    let response = fetch("https://example.test");
  `);
  const js = await compile(`
    from js.global import { fetch };
    let response = fetch("https://example.test");
  `);

  expectBinding(result.env, "response", {
    type: "Result<Js.Promise<Response>, Js.Error>",
    vars: 0,
  });
  assertStringIncludes(js, '__wm_js_member("fetch")');
});

Deno.test("supports Js.Promise as a basis type", async () => {
  const result = await checkSource(`
    let promise: Js.Promise<String> = Panic("promise");
  `);

  expectBinding(result.env, "promise", { type: "Js.Promise<String>", vars: 0 });
});

Deno.test("maps reflected TS promises to Js.Promise", async () => {
  const result = await checkSource(`
    from js.global("Deno") import { readTextFile };
    let file = readTextFile("README.md");
  `);

  expectBinding(result.env, "file", {
    type: "Result<Js.Promise<String>, Js.Error>",
    vars: 0,
  });
});

Deno.test("preserves reflected nominal promise results", async () => {
  const result = await checkSource(`
    from js.global("crypto.subtle") import unsafe { sign };
    let signature = sign("HMAC", Panic("key"), Panic("bytes"));
  `);

  expectBinding(result.env, "signature", { type: "Js.Promise<ArrayBuffer>", vars: 0 });
});

Deno.test("uses nominal promise results with reflected constructors", async () => {
  const result = await checkSource(`
    from js.global("crypto.subtle") import unsafe { sign };
    from js.global import unsafe { Uint8Array };
    from js.global import type { Uint8Array };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let bytes = sign("HMAC", Panic("key"), Panic("bytes")) :> .then((buffer) => {
      Uint8Array.new(buffer)
    }) :> try;
  `);

  expectBinding(result.env, "bytes", { type: "Js.Promise<Uint8Array>", vars: 0 });
});

Deno.test("typed JS promise receiver results infer through then", async () => {
  const result = await checkSource(`
    from js.global("Deno") import { readTextFile };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let readBang = () => {
      let file = readTextFile("README.md") :> try;
      file :> .then((text) => {
        text ++ "!"
      }) :> try
    };
  `);

  expectBinding(result.env, "readBang", { type: "(Void) => Js.Promise<String>", vars: 0 });
});

Deno.test("maps function-valued JS union parameters as JS values", async () => {
  const result = await checkSource(`
    from js.global import unsafe { setTimeout };
    let timer = setTimeout(() => { void }, 10);
  `);

  expectBinding(result.env, "timer", { type: "Number", vars: 0 });
});

Deno.test("maps object-bearing JS union parameters as JS values", async () => {
  const result = await checkSource(`
    from js.global("crypto.subtle") import unsafe { importKey };
    let key = importKey(
      "raw",
      JSON{ key: "secret" },
      JSON{ name: "HMAC", hash: "SHA-256" },
      false,
      JSON["sign"],
    );
  `);

  expectBinding(result.env, "key", { type: "Js.Promise<CryptoKey>", vars: 0 });
});

Deno.test("typed promise receivers work through explicit foreign receiver types", async () => {
  const result = await checkSource(`
    from js.global import type { Request };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let useText = (req: Request) => {
      let textPromise = req :> .text() :> try;
      textPromise :> .then((bodyText) => { bodyText }) :> try
    };
  `);

  expectBinding(result.env, "useText", { type: "(Request) => Js.Promise<String>", vars: 0 });
});
