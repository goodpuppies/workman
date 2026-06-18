import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkFile, checkSource, checkVirtual, compile, compileFile } from "../src/compiler.ts";
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

Deno.test("Js.Error is a matchable basis datatype", async () => {
  const result = await checkSource(`
    let describe = (error: Js.Error) => {
      match(error) {
        Js.Error(message) => { message },
        Js.Unknown => { "unknown" },
      }
    };
  `);

  expectBinding(result.env, "describe", { type: "(Js.Error) => String", vars: 0 });
  assertEquals(result.warnings, []);
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

Deno.test("resolves local JS module imports relative to source file", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `export function shout(text: string): string { return text.toUpperCase(); }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import { shout };
      let loud = shout("hello");
    `,
  );

  await checkFile(input);
  const js = await compileFile(input);

  assertStringIncludes(js, `await import("file:///`);
  assertStringIncludes(js, `/helper.ts")`);
});

Deno.test("reflects local JS module namespace imports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `export function shout(text: string): string { return text.toUpperCase(); }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import * as Helper;
      let loud = Helper.shout("hello");
    `,
  );

  await checkFile(input);
});

Deno.test("reflects nested local JS module namespace receiver calls", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `export const H = { shout(text: string): string { return text.toUpperCase(); } };\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import * as Helper;
      let loud = Helper.H.shout("hello");
    `,
  );

  await checkFile(input);
});

Deno.test("orders generated receiver imports after local record types", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `
      export type Color = { r: number };
      export const H = { make(): Color { return { r: 1 }; } };
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import * as Helper;
      let title = "colors";
      record Color = { r: Number };
      let made = Helper.H.make();
    `,
  );

  await checkFile(input);
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
    type: "Task<Response, Js.Error>",
    vars: 0,
  });
  assertStringIncludes(js, '__wm_js_member("fetch")');
});

Deno.test("supports Task as a basis type", async () => {
  const result = await checkSource(`
    let task: Task<String, Js.Error> = Panic("task");
  `);

  expectBinding(result.env, "task", { type: "Task<String, Js.Error>", vars: 0 });
});

Deno.test("maps reflected TS promises to Task", async () => {
  const result = await checkSource(`
    from js.global("Deno") import { readTextFile };
    let file = readTextFile("README.md");
  `);

  expectBinding(result.env, "file", {
    type: "Task<String, Js.Error>",
    vars: 0,
  });
});

Deno.test("preserves reflected nominal promise results", async () => {
  const result = await checkSource(`
    from js.global("crypto.subtle") import unsafe { sign };
    let signature = sign("HMAC", Panic("key"), Panic("bytes"));
  `);

  expectBinding(result.env, "signature", { type: "Task<ArrayBuffer, Js.Error>", vars: 0 });
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
    let bytes = sign("HMAC", Panic("key"), Panic("bytes")) :> Task.map((buffer) => {
      Uint8Array.new(buffer)
    });
  `);

  expectBinding(result.env, "bytes", { type: "Task<Uint8Array, Js.Error>", vars: 0 });
});

Deno.test("typed JS promise receiver results infer through then", async () => {
  const result = await checkSource(`
    from js.global("Deno") import { readTextFile };
    let readBang = () => {
      readTextFile("README.md") :> Task.map((text) => {
        text ++ "!"
      })
    };
  `);

  expectBinding(result.env, "readBang", { type: "(Void) => Task<String, Js.Error>", vars: 0 });
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

  expectBinding(result.env, "key", { type: "Task<CryptoKey, Js.Error>", vars: 0 });
});

Deno.test("typed task receivers work through explicit foreign receiver types", async () => {
  const result = await checkSource(`
    from js.global import type { Request };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let useText = (req) => {
      let textTask = req :> .text();
      textTask :> Task.map((bodyText) => { bodyText })
    };
    let checked = ((handler: (Request) => Task<String, Js.Error>, req: Request) => {
      handler(req)
    })(useText, Panic("req"));
  `);

  expectBinding(result.env, "useText", { type: "(Request) => Task<String, Js.Error>", vars: 0 });
});
