import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { pathToFileURL } from "node:url";
import {
  checkFile,
  checkSource,
  checkVirtual,
  compile,
  compileFile,
  compileVirtual,
} from "../src/compiler.ts";
import { parse } from "../src/parser.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("parses type and let declarations", async () => {
  const ast = await parse("type Option<T> = None | Some<T>; let x = Some(1);");
  assertEquals(ast.decls.length, 2);
});

Deno.test("rejects unsupported SML and advanced Workman syntax", async () => {
  await assertRejects(() => parse("fun id x = x;"));
  await assertRejects(() => parse("structure Math = struct end;"));
  await assertRejects(() => parse("infectious effect type IO<T> = Pure<T>;"));
});

Deno.test("compiles factorial and ADT match", async () => {
  const source = await Deno.readTextFile(new URL("../examples/factorial.wm", import.meta.url));
  const js = await compile(source);
  assertStringIncludes(js, "const Some");
  assertStringIncludes(js, "let factorial");
  assertStringIncludes(js, "non-exhaustive match");
});

Deno.test("rejects type errors", async () => {
  await assertRejects(
    () => checkSource("let nope = 1 + true;"),
    Error,
    "type mismatch",
  );
});

Deno.test("Panic acts as an escape hatch in any type context", async () => {
  await checkSource(`
    type Option<T> = None | Some<T>;
    let unwrapOrPanic = (opt) => {
      match(opt) {
        Some(x) => { x },
        None => { Panic("Expected a value") },
      }
    };
    let n: Number = unwrapOrPanic(Some(1));
  `);
});

Deno.test("compiled Panic emits runtime Panic failure", async () => {
  const js = await compile('let crash = Panic("boom");');
  assertStringIncludes(js, '__wm_fail("Panic", "boom")');
});

Deno.test("compiled manual root JS imports target global member names", async () => {
  const js = await compile(`
    from js.global import unsafe { isFinite: (Number) => Bool };
    let ok = isFinite(1);
  `);

  assertStringIncludes(js, '__wm_js_member("isFinite")');
});

Deno.test("supports multiline string literals", async () => {
  const source = "let text = `first\nsecond\\nthird \\` quoted`;";
  const result = await checkSource(source);
  const js = await compile(source);

  expectBinding(result.env, "text", { type: "String", vars: 0 });
  assertStringIncludes(js, JSON.stringify("first\nsecond\nthird ` quoted"));
});

Deno.test("quoted string literals reject raw newlines", async () => {
  await assertRejects(
    () => parse('let text = "first\nsecond";'),
    Error,
  );
});

Deno.test("reports inferred principal type shapes for core bindings", async () => {
  const result = await checkSource(`
    let id = (x) => { x };
    let fst = (x, y) => { x };
    let pair = (x, y) => { (x, y) };
  `);
  expectBinding(result.env, "id", { type: "('a) => 'a", vars: 1 });
  expectBinding(result.env, "fst", { type: "(('a, 'b)) => 'a", vars: 2 });
  expectBinding(result.env, "pair", { type: "(('a, 'b)) => ('a, 'b)", vars: 2 });
});

Deno.test("inferred match function type reflects constructor payload constraints", async () => {
  const result = await checkSource(`
    type Option<T> = None | Some<T>;
    let get = match(opt) => {
      Some(x) => { x },
      None => { 0 },
    };
  `);
  expectBinding(result.env, "get", { type: "(Option<Number>) => Number", vars: 0 });
});

Deno.test("single-item alias declarations are transparent in inferred types", async () => {
  const result = await checkSource(`
    type MyNumber = Number;
    let inc = (x: MyNumber) => { x + 1 };
  `);
  expectBinding(result.env, "inc", { type: "(Number) => Number", vars: 0 });
});

Deno.test("compiles file imports as implicit structures", async () => {
  const js = await compileFile(new URL("../examples/use_math.wm", import.meta.url).pathname);
  assertStringIncludes(js, "const Math");
  assertStringIncludes(js, "Math.add");
  assertStringIncludes(js, "Math.Just");
});

Deno.test("source-only frontend rejects imports with clear API boundary", async () => {
  await assertRejects(
    () => checkSource('from "./math.wm" import * as Math; let x = 1;'),
    Error,
    "source strings with imports require checkFile",
  );
});

Deno.test("imports are declaration-ordered and not hoisted", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "export let value = 1;"],
    ["/test/main.wm", 'let x = Lib.value; from "./lib.wm" import * as Lib;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown name Lib.value",
  );
});

Deno.test("checkFile accepts URL pathname entry paths", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "export let value = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.value;'],
  ]);
  const pathname = pathToFileURL("/test/main.wm").pathname;
  await checkVirtual(pathname, virtualFs);
});

Deno.test("supports long type constructors from imported files", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/box.wm", "export type Box<T> = | Box<T>; export let make = (x) => { Box(x) };"],
    [
      "/test/main.wm",
      'from "./box.wm" import * as Boxed; let x: Boxed.Box<Number> = Boxed.make(1);',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports long constructor identifiers in match patterns", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/option.wm",
      "export type Option<T> = None | Some<T>; export let wrap = (x) => { Some(x) };",
    ],
    [
      "/test/main.wm",
      'from "./option.wm" import * as Opt; let value = Opt.wrap(1); let get = match(value) => { Opt.Some(x) => { x }, Opt.None => { 0 } };',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports named imports for values constructors and types", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/option.wm",
      "export type Option<T> = None | Some<T>; export let make = (x) => { Some(x) };",
    ],
    [
      "/test/main.wm",
      'from "./option.wm" import { Option, Some, None, make as wrap }; let value: Option<Number> = wrap(1); let get = match(value) => { Some(x) => { x }, None => { 0 } };',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports typed JS namespace imports", async () => {
  const result = await checkSource(`
    from js.global("console") import { log: (String, Number) => Void } as console;
    let main = () => {
      console.log("answer", 42)
    };
  `);

  expectBinding(result.env, "main", { type: "(Void) => Void", vars: 0 });
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

Deno.test("supports inferred variadic JS imports as polymorphic unary functions", async () => {
  const result = await checkSource(`
    from js.global("console") import * as console;
    let main = () => {
      console.log("hello world");
      console.log("answer", 42)
    };
  `);

  expectBinding(result.env, "main", { type: "(Void) => Result<Void, Js.Error>", vars: 0 });
});

Deno.test("supports inferred JS module imports", async () => {
  const result = await checkSource(`
    from js.module("node:crypto") import { createHash };
    let hash = createHash("sha256");
  `);

  expectBinding(result.env, "hash", { type: "Result<Js.Object, Js.Error>", vars: 0 });
});

Deno.test("maps reflected JS nullish returns to basis Option", async () => {
  const result = await checkSource(`
    from js.global("document") import { querySelector };
    let found = querySelector("main");
    let isMissing = match(found) {
      Ok(Some(_)) => { false },
      Ok(None) => { true },
      Err(_) => { true },
    };
  `);

  expectBinding(result.env, "found", { type: "Result<Option<Js.Value>, Js.Error>", vars: 0 });
  expectBinding(result.env, "isMissing", { type: "Bool", vars: 0 });
});

Deno.test("resolves reflected JS optional arities before HM", async () => {
  const result = await checkSource(`
    from js.module("node:child_process") import { spawn };
    let p1 = spawn("cmd");
    let p2 = spawn("cmd", JSON[]);
    let p3 = spawn("cmd", JSON[], JSON{});
  `);

  expectBinding(result.env, "p1", { type: "Result<Js.Object, Js.Error>", vars: 0 });
  expectBinding(result.env, "p2", { type: "Result<Js.Object, Js.Error>", vars: 0 });
  expectBinding(result.env, "p3", { type: "Result<Js.Object, Js.Error>", vars: 0 });
});

Deno.test("reflects prototype member calls from JS object results before HM", async () => {
  const result = await checkSource(`
    from js.module("node:child_process") import { spawn };
    from js.module("node:crypto") import { createHash };
    let hash = createHash("sha256");
    let proc = spawn("cmd");
    let hooked = match(proc) {
      Ok(p) => {
        match(hash) {
          Ok(h) => {
            p.stdout.on("data", (chunk) => {
              h.update(chunk);
            })
          },
          Err(_) => { proc },
        }
      },
      Err(_) => { proc },
    };
  `);

  expectBinding(result.env, "proc", { type: "Result<Js.Object, Js.Error>", vars: 0 });
  expectBinding(result.env, "hooked", { type: "Result<Js.Object, Js.Error>", vars: 0 });
});

Deno.test("reflects literal JS event callback parameter types", async () => {
  const result = await checkSource(`
    from js.module("node:child_process") import { spawn };
    let proc = spawn("cmd");
    let closed = match(proc) {
      Ok(p) => {
        p.on("close", (code) => {
          match(code) {
            Some(n) => { n == 0 },
            None => { false },
          };
        })
      },
      Err(_) => { proc },
    };
  `);

  expectBinding(result.env, "closed", { type: "Result<Js.Object, Js.Error>", vars: 0 });
});

Deno.test("keeps reflected receiver event callback refs distinct", async () => {
  const result = await checkSource(`
    from js.module("node:fs") import { createReadStream };
    let stream = createReadStream("data.txt");
    let hooked = match(stream) {
      Ok(s) => {
        s.on("data", (chunk) => {
          chunk.length;
        });
        s.on("error", (err) => {
          match(err.message) {
            Ok(message) => { message == "" },
            Err(_) => { false },
          };
        });
        s.on("close", () => {
          void
        })
      },
      Err(_) => { stream },
    };
  `);

  expectBinding(result.env, "hooked", { type: "Result<Js.Object, Js.Error>", vars: 0 });
});

Deno.test("reflects global value constructors through new member", async () => {
  const result = await checkSource(`
    from js.global import { URL, Response };
    let url = URL.new("https://example.com/a");
    let response = Response.new("ok", JSON{status: 200});
  `);

  expectBinding(result.env, "url", { type: "Result<Js.Object, Js.Error>", vars: 0 });
  expectBinding(result.env, "response", { type: "Result<Js.Object, Js.Error>", vars: 0 });
});

Deno.test("reflects JS object property reads from known refs", async () => {
  const result = await checkSource(`
    from js.global import { URL };
    let path = match(URL.new("https://example.com/a")) {
      Ok(url) => { url.pathname },
      Err(_) => { Panic("url failed") },
    };
  `);

  expectBinding(result.env, "path", { type: "Result<String, Js.Error>", vars: 0 });
});

Deno.test("reflects callback parameter object refs before HM", async () => {
  const result = await checkSource(`
    from js.global("Deno") import { serve };
    from js.global import { Response };
    let server = serve((req, info) => {
      let url = match(req.url) {
        Ok(value) => { value },
        Err(_) => { "/" },
      };
      match(Response.new(url, JSON{status: 200})) {
        Ok(response) => { response },
        Err(_) => { Panic("response failed") },
      }
    });
  `);

  expectBinding(result.env, "server", { type: "Result<Js.Object, Js.Error>", vars: 0 });
});

Deno.test("reflects dynamic properties from annotated Js.Object values", async () => {
  const result = await checkSource(`
    let methodOf = (req: Js.Object) => {
      match(req.method) {
        Ok(value) => { value == "GET" },
        Err(_) => { false },
      }
    };
  `);

  expectBinding(result.env, "methodOf", { type: "(Js.Object) => Bool", vars: 0 });
});

Deno.test("reflects properties from type-only JS imports before HM", async () => {
  const result = await checkSource(`
    from js.global import type { Request };
    let methodOf = (req: Request) => {
      match(req.method) {
        Ok(value) => { value == "GET" },
        Err(_) => { false },
      }
    };
  `);

  expectBinding(result.env, "methodOf", { type: "(Request) => Bool", vars: 0 });
});

Deno.test("delays foreign property reflection until HM constrains the receiver", async () => {
  const result = await checkSource(`
    from js.global import type { Request };
    let useRequest = (h: (Request) => Js.Object, req) => {
      let method = match(req.method) {
        Ok(value) => { value },
        Err(_) => { "" },
      };
      h(req)
    };
  `);

  expectBinding(result.env, "useRequest", {
    type: "(((Request) => Js.Object, Request)) => Js.Object",
    vars: 0,
  });
});

Deno.test("delays foreign property reflection until downstream HM constrains the receiver", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/http.wm",
      `
        from js.global import type { Request };
        export let dispatch = () => {
          (req, info) => {
            let method = match(req.method) {
              Ok(value) => { value },
              Err(_) => { "" },
            };
            method == "GET"
          }
        };
      `,
    ],
    [
      "/test/server.wm",
      `
        from js.global import type { Request };
        from js.global("Deno") import unsafe {
          serve: ((Request, Js.Object) => Bool) => Js.Object
        };
        from "./http.wm" import { dispatch };
        let server = serve(dispatch());
      `,
    ],
  ]);

  const results = await checkVirtual("/test/server.wm", virtualFs);
  const http = results.get("/test/http.wm");
  if (!http) throw new Error("missing http result");
  expectBinding(http.env, "dispatch", {
    type: "(Void) => ((Request, 'a)) => Bool",
    vars: 1,
  });
});

Deno.test("foreign JS type identity is keyed by reflected source, not local name", async () => {
  const shared = new Map<string, string>([
    [
      "/test/a.wm",
      `from js.global import type { Request as Thing }; export let id = (x: Thing) => { x };`,
    ],
    [
      "/test/b.wm",
      `from js.global import type { Request as Thing }; export let use = (x: Thing) => { x };`,
    ],
    [
      "/test/main.wm",
      `from "./a.wm" import * as A; from "./b.wm" import * as B; let ok = B.use(A.id(Panic("x")));`,
    ],
  ]);
  await checkVirtual("/test/main.wm", shared);

  const distinct = new Map<string, string>([
    [
      "/test/a.wm",
      `from js.global import type { Request as Thing }; export let id = (x: Thing) => { x };`,
    ],
    [
      "/test/b.wm",
      `from js.global import type { Response as Thing }; export let use = (x: Thing) => { x };`,
    ],
    [
      "/test/main.wm",
      `from "./a.wm" import * as A; from "./b.wm" import * as B; let bad = B.use(A.id(Panic("x")));`,
    ],
  ]);
  await assertRejects(() => checkVirtual("/test/main.wm", distinct), Error, "type mismatch");
});

Deno.test("delays foreign method reflection until downstream HM constrains the receiver", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/http.wm",
      `
        export let cloneResponse = () => {
          (res) => {
            res.clone()
          }
        };
      `,
    ],
    [
      "/test/server.wm",
      `
        from js.global import type { Response };
        from "./http.wm" import { cloneResponse };
        let useResponse = (handler: (Response) => Result<Js.Object, Js.Error>) => {
          handler(Panic("response"))
        };
        let server = useResponse(cloneResponse());
      `,
    ],
  ]);

  const results = await checkVirtual("/test/server.wm", virtualFs);
  const http = results.get("/test/http.wm");
  if (!http) throw new Error("missing http result");
  expectBinding(http.env, "cloneResponse", {
    type: "(Void) => (Response) => Result<Js.Object, Js.Error>",
    vars: 0,
  });
});

Deno.test("delayed foreign methods provide callback parameter refs", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/events.wm",
      `
        export let listen = () => {
          (target) => {
            target.addEventListener("click", (evt) => {
              let isTrusted = evt.isTrusted;
            })
          }
        };
      `,
    ],
    [
      "/test/main.wm",
      `
        from js.global import type { EventTarget };
        from "./events.wm" import { listen };
        let use = (handler: (EventTarget) => Result<Void, Js.Error>) => {
          handler(Panic("target"))
        };
        let installed = use(listen());
      `,
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const events = results.get("/test/events.wm");
  if (!events) throw new Error("missing events result");
  expectBinding(events.env, "listen", {
    type: "(Void) => (EventTarget) => Result<Void, Js.Error>",
    vars: 0,
  });
});

Deno.test("reflected JS overload sets are not bare HM values", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.module("node:child_process") import { spawn };
        let f = spawn;
      `),
    Error,
    "unknown name spawn",
  );
});

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
        from js.module("node:crypto") import { createHash };
        let hash = match(createHash("sha256")) {
          Ok(h) => { h },
          Err(_) => { Panic("err") }
        };
        let main = () => {
          console.log("SHA256:", hash.digest("hex"));
        };
      `),
    Error,
    'cannot pass "Result<String, Js.Error>" to JS FFI call',
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

Deno.test("named imports reject missing members", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "export let present = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { missing }; let x = 1;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown import missing",
  );
});

Deno.test("rejects duplicate imported bindings in the same namespace", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "export let present = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { present, present as present }; let x = present;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "duplicate value import present",
  );
});

Deno.test("rejects duplicate qualified imports from repeated namespace aliases", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "export let value = 1;"],
    ["/test/b.wm", "export let value = 2;"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as Lib; from "./b.wm" import * as Lib; let x = Lib.value;',
    ],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "duplicate value import Lib.value",
  );
});

Deno.test("rejects duplicate named imports across import declarations", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "export let value = 1;"],
    ["/test/b.wm", "export let value = 2;"],
    [
      "/test/main.wm",
      'from "./a.wm" import { value }; from "./b.wm" import { value }; let x = value;',
    ],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "duplicate value import value",
  );
});

Deno.test("local declarations shadow imported bindings", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "export let value = 1;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import { value }; let value = "local"; let ok = value == "local";',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("imports only see explicit exports", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; export let visible = hidden + 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { hidden }; let x = 1;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown import hidden",
  );
});

Deno.test("namespace imports only expose explicit exports", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; export let visible = hidden + 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.hidden;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown name Lib.hidden",
  );
});

Deno.test("supports transitive file imports", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/base.wm", "export let id = (x) => { x };"],
    ["/test/mid.wm", 'from "./base.wm" import * as Base; export let keep = (x) => { Base.id(x) };'],
    [
      "/test/main.wm",
      'from "./mid.wm" import * as Mid; let a = Mid.keep(1); let b = Mid.keep("s");',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("compiles virtual file system to JS", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "export type Option<T> = None | Some<T>; export let wrap = (x) => { Some(x) };",
    ],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let value = Lib.wrap(1);'],
  ]);
  const js = await compileVirtual("/test/main.wm", virtualFs);
  assertStringIncludes(js, "const Lib");
  assertStringIncludes(js, "Lib.wrap");
  assertStringIncludes(js, "Some");
});

Deno.test("rejects import cycles", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", 'from "./b.wm" import * as B; let x = 1;'],
    ["/test/b.wm", 'from "./a.wm" import * as A; let y = 2;'],
  ]);
  await assertRejects(() => checkVirtual("/test/a.wm", virtualFs), Error, "import cycle");
});

Deno.test("same-spelled datatypes from different files are nominally distinct", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "export type Box = | Box; export let make = () => { Box };"],
    ["/test/b.wm", "export type Box = | Box; export let make = () => { Box };"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as A; from "./b.wm" import * as B; let bad: A.Box = B.make();',
    ],
  ]);
  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});

Deno.test("rejects duplicate pattern binders", async () => {
  await assertRejects(
    () => checkSource("let bad = ((x, x)) => { x };"),
    Error,
    "duplicate pattern binder",
  );
  await assertRejects(
    () => checkSource("let bad = (x, x) => { x };"),
    Error,
    "duplicate pattern binder x",
  );
  await assertRejects(
    () => checkSource("let bad = match(x, x) => { _ => { 0 } };"),
    Error,
    "duplicate pattern binder x",
  );
});

Deno.test("supports Workman tuple destructuring let bindings", async () => {
  await checkSource(`
    let (a, b) = (1, "x");
    let use_a = a + 1;
    let use_b = b == "x";
  `);
});

Deno.test("generalizes destructured let binding components", async () => {
  await checkSource(`
    let (id_a, id_b) = ((x) => { x }, (y) => { y });
    let a = id_a(1);
    let b = id_a("s");
    let c = id_b(true);
    let d = id_b(2);
  `);
});

Deno.test("rejects duplicate tuple let binders in the same declaration", async () => {
  await assertRejects(
    () => checkSource("let (x, x) = (1, 2);"),
    Error,
    "duplicate binding x",
  );
  await assertRejects(
    () =>
      checkSource("type Option<T> = None | Some<T>; let Some(x) = Some(1) and Some(x) = Some(2);"),
    Error,
    "duplicate binding x",
  );
});

Deno.test("rejects duplicate names in a single let-and binding group", async () => {
  await assertRejects(
    () => checkSource("let x = 1 and x = 2;"),
    Error,
    "duplicate binding x",
  );
});

Deno.test("non-rec let-and bindings are simultaneous, not sequential", async () => {
  await assertRejects(
    () => checkSource("let x = 1 and y = x;"),
    Error,
    "unknown name x",
  );
});

Deno.test("rejects recursive destructuring let bindings", async () => {
  await assertRejects(
    () => checkSource("let rec (a, b) = (1, 2);"),
    Error,
    "recursive bindings must bind one name",
  );
});

Deno.test("rejects duplicate type parameters and constructors", async () => {
  await assertRejects(
    () => checkSource("type Bad<T, T> = Bad<T>;"),
    Error,
    "duplicate type parameter T",
  );
  await assertRejects(
    () => checkSource("type Bad = A | A;"),
    Error,
    "duplicate constructor A",
  );
});

Deno.test("rejects duplicate type declarations in the same scope", async () => {
  await assertRejects(
    () => checkSource("type Box = Number; type Box = String;"),
    Error,
    "duplicate type declaration Box",
  );
});

Deno.test("disambiguates alias and variant single-item type bodies", async () => {
  await checkSource("type MyNumber = Number; let x: MyNumber = 1;");
  await assertRejects(
    () => checkSource("type MyNumber = Number; let bad = MyNumber;"),
    Error,
    "unknown name MyNumber",
  );
  await checkSource("type Token = | Token; let x: Token = Token;");
  await checkSource("type Flag = On | Off; let x: Flag = On;");
});

Deno.test("statement-only blocks infer Void", async () => {
  await checkSource(`
    let do_it = () => {
      print("side effect");
    };
    let result: Void = do_it();
  `);
});

Deno.test("empty blocks infer Void", async () => {
  await checkSource("let nothing: Void = {}; ");
});

Deno.test("if branches can be statement-only Void blocks", async () => {
  await checkSource(`
    let branch: Void = if (true) {
      print("then");
    } else {
      print("else");
    };
  `);
});

Deno.test("block-local type names do not leak outward", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let make = () => {
          type Local = | Local;
          let x = Local;
          x
        };
      `),
    Error,
    "local type escapes scope",
  );
  await assertRejects(
    () =>
      checkSource(`
        let use = () => {
          type Local = | Local;
          let x: Local = Local;
          void
        };
        let y: Local = void;
      `),
    Error,
    "unknown type Local",
  );
});

Deno.test("supports typed lambda parameters", async () => {
  await checkSource(`
    let inc = (x: Number) => { x + 1 };
    let ok = inc(41);
  `);
});

Deno.test("typed lambda parameters reject incompatible calls", async () => {
  await assertRejects(
    () => checkSource('let inc = (x: Number) => { x + 1 }; let bad = inc("no");'),
    Error,
    "type mismatch",
  );
});

Deno.test("compiled refutable let pattern failures raise Bind", async () => {
  const source = "type Option<T> = None | Some<T>; let Some(x) = None;";
  const js = await compile(source);
  assertStringIncludes(js, '__wm_fail("Bind", "pattern match failure in let binding")');
});

Deno.test("compiled lambda parameter mismatch raises Match", async () => {
  const source = "let first = (x, _) => { x };";
  const js = await compile(source);
  assertStringIncludes(js, '__wm_fail("Match", "pattern match failure in function")');
});

Deno.test("reflected constructors return imported nominal foreign types", async () => {
  const result = await checkSource(`
    from js.global import unsafe { Request };
    from js.global import type { Request };

    let request: Request = Request.new("https://example.test/", JSON{
      method: "POST"
    });

    let contentType = request.headers.get("content-type");
  `);

  expectBinding(result.env, "request", { type: "Request", vars: 0 });
  expectBinding(result.env, "contentType", {
    type: "Result<Option<String>, Js.Error>",
    vars: 0,
  });
});
