import { assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, checkVirtual, compile } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("reflected JS calls report unresolved overload selection", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.global("Deno") import * as Deno;
        let text = Deno.readTextFileSync();
      `),
    Error,
    "cannot determine JS FFI overload for Deno.readTextFileSync with 0 arguments; available arities: 1",
  );
});

Deno.test("rejects Workman ADT values passed to JS FFI calls", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.global("console") import * as console;
        let value = Ok("x");
        let main = () => {
          console.log(value);
        };
      `),
    Error,
    'type mismatch expected "Js.Value", got "Result<String,',
  );
});

Deno.test("supports JSON literals as explicit JS values", async () => {
  const result = await checkSource(`
    from js.module("node:child_process") import {
      spawn: (String, Js.Value, Js.Value) => Js.Value
    };
    let proc = spawn(
      "curl",
      JSON["-s", "https://api.github.com/repos/denoland/deno"],
      JSON{
        stdio: JSON["ignore", "pipe", "inherit"],
        env: JSON{ "USER_AGENT": "Workman-FFI" }
      }
    );
  `);

  expectBinding(result.env, "spawn", {
    type: "((String, Js.Value, Js.Value)) => Js.Value",
    vars: 0,
  });
  expectBinding(result.env, "proc", { type: "Js.Value", vars: 0 });
});

Deno.test("JSON literal variables can settle to primitive types", async () => {
  const result = await checkSource(`
    from js.global import unsafe { Response };
    let response = (body, status) => {
      Response.new(body, JSON{ status: status })
    };
    let value = response("ok", 200);
  `);

  expectBinding(result.env, "response", { type: "((String, Number)) => Response", vars: 0 });
  expectBinding(result.env, "value", { type: "Response", vars: 0 });
});

Deno.test("dynamic JS receiver callbacks adapt Workman lambdas", async () => {
  const js = await compile(`
    from js.global("JSON") import unsafe { parse: (String) => Js.Object } as JSON;
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let items = JSON.parse("[1,2]");
    let doubled: Js.Object = items :> .map((value, index, array) => {
      value + value
    }) :> try :> Json.assert :> try;
  `);

  assertStringIncludes(js, '{"kind":"fn","params":["id","id","id"],"result":"id"}');
});

Deno.test("unresolved FFI receiver callbacks require an explicit JS value check", async () => {
  await assertRejects(
    () =>
      checkSource(`
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let hexByte = (byte, index, array) => {
      let text = byte :> .toString(16) :> try;
      text :> .padStart(2, "0") :> try
    };
  `),
    Error,
    "top-level free type variable in hexByte",
  );
});

Deno.test("dynamic JS callback parameter annotations are rejected", async () => {
  await assertRejects(
    () =>
      compile(`
        from js.global("JSON") import unsafe { parse: (String) => Js.Object } as JSON;
        let try = (result) => {
          match(result) {
            Ok(value) => { value },
            Err(_) => { Panic("ffi") },
          }
        };
        let double = (value: Number, index, array) => {
          value + value
        };
        let items = JSON.parse("[1,2]");
        let doubled: Js.Object = items :> .map(double) :> try :> Json.assert :> try;
      `),
    Error,
    "JS callback parameter annotations cannot cast dynamic callback arguments",
  );

  await assertRejects(
    () =>
      compile(`
        from js.global("JSON") import unsafe { parse: (String) => Js.Object } as JSON;
        let try = (result) => {
          match(result) {
            Ok(value) => { value },
            Err(_) => { Panic("ffi") },
          }
        };
        let items = JSON.parse("[1,2]");
        let doubled: Js.Object = items :> .map((value: Number, index, array) => {
          value + value
        }) :> try :> Json.assert :> try;
      `),
    Error,
    "JS callback parameter annotations cannot cast dynamic callback arguments",
  );
});

Deno.test("dynamic JS annotations require explicit Json.assert", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.global("JSON") import unsafe { parse: (String) => Js.Object } as JSON;
        let try = (result) => {
          match(result) {
            Ok(value) => { value },
            Err(_) => { Panic("ffi") },
          }
        };
        let payload = JSON.parse("{}");
        let commits: Js.Object = payload :> .commits :> try;
      `),
    Error,
    "type annotations cannot cast dynamic JS/JSON values",
  );
});

Deno.test("Json.assert is an explicit dynamic shape assertion", async () => {
  const result = await checkSource(`
    from js.global("JSON") import unsafe { parse: (String) => Js.Object } as JSON;
    record Commit = { id: String, message: String };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let commit: Commit = JSON.parse("{\\"id\\":\\"abcdef\\",\\"message\\":\\"ok\\"}") :> Json.assert :> try;
    let text = commit.id ++ ": " ++ commit.message;
  `);

  expectBinding(result.env, "text", { type: "String", vars: 0 });
});

Deno.test("dynamic JS array receiver annotations require an explicit assertion", async () => {
  await assertRejects(
    () =>
      compile(`
        from js.global("JSON") import unsafe { parse: (String) => Js.Object } as JSON;
        record Commit = { id: String, message: String };
        record PushPayload = { commits: Js.Array<Commit> };
        let formatCommit = (commit: Commit) => {
          commit.id ++ ": " ++ commit.message
        };
        let try = (result) => {
          match(result) {
            Ok(value) => { value },
            Err(_) => { Panic("ffi") },
          }
        };
        let payload: PushPayload = JSON.parse("{\\"commits\\":[{\\"id\\":\\"abcdef\\",\\"message\\":\\"ok\\"}]}") :> Json.assert :> try;
        let commits = payload.commits;
        let commitLines: Js.Array<String> = commits :> .map((commit, index, array) => {
          formatCommit(commit)
        }) :> try;
      `),
    Error,
    "type annotations cannot cast dynamic JS/JSON values",
  );
});

Deno.test("typed JS array receiver results infer through map and join", async () => {
  const result = await checkSource(`
    from js.global("JSON") import unsafe { parse: (String) => Js.Object } as JSON;
    record Commit = { id: String, message: String };
    record PushPayload = { commits: Js.Array<Commit> };
    let formatCommit = (commit: Commit) => {
      commit.id ++ ": " ++ commit.message
    };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let payload: PushPayload = JSON.parse("{\\"commits\\":[{\\"id\\":\\"abcdef\\",\\"message\\":\\"ok\\"}]}") :> Json.assert :> try;
    let commits = payload.commits;
    let commitLines = commits :> .map((commit, index, array) => {
      formatCommit(commit)
    }) :> try;
    let text = commitLines :> .join("\\n") :> try;
  `);

  expectBinding(result.env, "commitLines", { type: "Js.Array<String>", vars: 0 });
  expectBinding(result.env, "text", { type: "String", vars: 0 });
});

Deno.test("Array.from works with explicit typed array element annotations", async () => {
  const source = `
    from js.global import unsafe { Uint8Array };
    from js.global import type { Uint8Array };
    from js.global("Array") import unsafe { from as arrayFrom };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let hexByte = (byte: Number, index, array) => {
      byte :> .toString(16) :> try
    };
    let makeHex = () => {
      let bytes: Uint8Array = Uint8Array.new(JSON{});
      let hexParts = arrayFrom(bytes) :> .map(hexByte) :> try;
      hexParts :> .join("") :> try
    };
  `;
  const results = await checkVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const result = results.get("/test/main.wm")!;

  expectBinding(result.env, "makeHex", { type: "(Void) => String", vars: 0 });
});

Deno.test("JSON literals reject ordinary ML values at the JS boundary", async () => {
  await assertRejects(
    () =>
      checkSource(`
        type Int_list = Empty | Cons<Number, Int_list>;
        let bad = JSON{ xs: Cons(1, Empty) };
      `),
    Error,
    'type mismatch "Int_list" vs "Js.Value"',
  );
});
