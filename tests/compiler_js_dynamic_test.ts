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
    from js.module("node:child_process") import unsafe {
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
  try {
    await checkSource(`
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let hexByte = (byte, index, array) => {
      let text = byte :> .unknownJs(16) :> try;
      text :> .padStart(2, "0") :> try
    };
  `);
    throw new Error("expected checkSource to reject");
  } catch (error) {
    assertStringIncludes(String(error), "cannot resolve JS FFI method unknownJs");
  }
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

Deno.test("opaque Js.Object does not expose typed array at", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let try = (result) => {
          match(result) {
            Ok(value) => { value },
            Err(_) => { Panic("ffi") },
          }
        };
        let object: Js.Object = JSON{} :> Json.assert :> try;
        let first = object :> .at(0) :> try;
      `),
    Error,
    "cannot use typed array method at on opaque Js.Object",
  );
});

Deno.test("typed JS array at constrains unannotated helper receivers", async () => {
  const result = await checkSource(`
    record WttrValue = { value: String };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let firstValue = (items, fallback) => {
      match(items :> .at(0) :> try) {
        Some(item) => { item.value },
        None => { fallback },
      }
    };
  `);
  expectBinding(result.env, "firstValue", {
    type: "((Js.Array<WttrValue>, String)) => String",
    vars: 0,
  });
});

Deno.test("typed JS array at works through record field receivers", async () => {
  const result = await checkSource(`
    record Item = { label: String };
    record Payload = { items: Js.Array<Item> };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let firstLabel = (payload) => {
      match(payload.items :> .at(0) :> try) {
        Some(item) => { item.label },
        None => { "" },
      }
    };
  `);
  expectBinding(result.env, "firstLabel", { type: "(Payload) => String", vars: 0 });
});

Deno.test("primitive JS methods constrain unannotated helper receivers", async () => {
  const result = await checkSource(`
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let numberText = (n) => {
      n :> .toString() :> try
    };
    let paddedRight = (text, width) => {
      text :> .padEnd(width, " ") :> try
    };
  `);
  expectBinding(result.env, "numberText", { type: "(Number) => String", vars: 0 });
  expectBinding(result.env, "paddedRight", { type: "((String, Number)) => String", vars: 0 });
});

Deno.test("broad Js.Value JS parameters are instantiated by helper call sites", async () => {
  const result = await checkSource(`
    from js.global("JSON") import unsafe {
      parse: (String) => Js.Object,
      stringify: (Js.Value) => String,
    } as JSON;
    record Entry = { city: String };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let save = (value) => {
      JSON.stringify(value)
    };
    let saveAnnotated = (value: Js.Dict<Entry>) => {
      JSON.stringify(value)
    };
    let cache: Js.Dict<Entry> = JSON.parse("{}") :> Json.assert :> try;
    let text = save(cache);
    let annotatedText = saveAnnotated(cache);
  `);
  expectBinding(result.env, "save", { type: "(Js.Dict<Entry>) => String", vars: 0 });
  expectBinding(result.env, "saveAnnotated", { type: "(Js.Dict<Entry>) => String", vars: 0 });
  expectBinding(result.env, "text", { type: "String", vars: 0 });
  expectBinding(result.env, "annotatedText", { type: "String", vars: 0 });
});

Deno.test("Workman ADT values are still rejected through JS boundary helpers", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.global("JSON") import unsafe {
          stringify: (Js.Value) => String,
        } as JSON;
        let save = (value) => {
          JSON.stringify(value)
        };
        let bad = save(Ok("x"));
      `),
    Error,
    "cannot pass",
  );
});

Deno.test("undetermined JS boundary parameters are reported, not defaulted", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.global("JSON") import unsafe {
          stringify: (Js.Value) => String,
        } as JSON;
        let save = (value) => {
          JSON.stringify(value)
        };
      `),
    Error,
    "unsolved JS boundary type in save",
  );
});

Deno.test("Js.Dict supports typed string-key access through Dict.get and Dict.set", async () => {
  const result = await checkSource(`
    from js.global("JSON") import unsafe {
      parse: (String) => Js.Object,
      stringify: (Js.Value) => String,
    } as JSON;
    record CacheEntry = { fetchedAt: Number, city: String };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let cache: Js.Dict<CacheEntry> = JSON.parse("{}") :> Json.assert :> try;
    let entry = Dict.get(cache, "oulu");
    let stored = Dict.set(cache, "oulu", .{ fetchedAt = 1, city = "Oulu" });
    let text = JSON.stringify(cache);
  `);
  expectBinding(result.env, "entry", { type: "Option<CacheEntry>", vars: 0 });
  expectBinding(result.env, "stored", { type: "Void", vars: 0 });
  expectBinding(result.env, "text", { type: "String", vars: 0 });
});

Deno.test("Response.json() result feeds a following then", async () => {
  const result = await checkSource(`
    from js.global import unsafe { fetch };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let fetchJson = (url) => {
      let requestUrl = url ++ "";
      fetch(requestUrl) :> Task.andThen((res) => {
        let ok = res :> .ok :> try;
        if (!ok) {
          let status = res :> .status :> try;
          Panic("HTTP " ++ (status :> .toString() :> try) ++ " fetching " ++ requestUrl)
        } else {
          res :> .json()
        }
      }) :> Task.map((body) => {
        let data: Js.Object = body :> Json.assert :> try;
        data
      })
    };
  `);
  expectBinding(result.env, "fetchJson", {
    type: "(String) => Task<Js.Object, Js.Error>",
    vars: 0,
  });
});

Deno.test("typed JS array filter and includes infer with string callbacks", async () => {
  const result = await checkSource(`
    from js.global("Deno") import unsafe {
      args: Js.Array<String>,
    };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let flags = (rawArgs) => {
      rawArgs :> .filter((a, index, array) => {
        a :> .startsWith("--") :> try
      }) :> try
    };
    let fahrenheit = flags(args) :> .includes("--f") :> try;
  `);
  expectBinding(result.env, "flags", {
    type: "(Js.Array<String>) => Js.Array<String>",
    vars: 0,
  });
  expectBinding(result.env, "fahrenheit", { type: "Bool", vars: 0 });
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
