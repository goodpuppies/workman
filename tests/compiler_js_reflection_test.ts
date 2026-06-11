import { assertRejects } from "@std/assert";
import { checkSource, checkVirtual } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("unresolved JS FFI property results cannot escape as generic values", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let format = (item) => {
          "message: " ++ item.message
        };
      `),
    Error,
    "unresolved JS FFI access is not a generic value",
  );

  await assertRejects(
    () =>
      checkSource(`
        let format = (item) => {
          let message = item.message;
          "message: " ++ message
        };
      `),
    Error,
    'type mismatch "String" vs "Result<?ffi',
  );
});

Deno.test("record fields on unannotated params are not preempted by unresolved JS FFI", async () => {
  const result = await checkSource(`
    record Commit = { id: String, message: String };
    let formatCommit = (commit, index, array) => {
      let shortId = commit.id;
      let message = commit.message;
      "- [" ++ shortId ++ "] " ++ message
    };
  `);

  expectBinding(result.env, "formatCommit", {
    type: "((Commit, 'a, 'b)) => String",
    vars: 2,
  });
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

  expectBinding(result.env, "hash", { type: "Result<Hash, Js.Error>", vars: 0 });
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

  expectBinding(result.env, "p1", {
    type: "Result<ChildProcessWithoutNullStreams, Js.Error>",
    vars: 0,
  });
  expectBinding(result.env, "p2", {
    type: "Result<ChildProcessWithoutNullStreams, Js.Error>",
    vars: 0,
  });
  expectBinding(result.env, "p3", {
    type: "Result<ChildProcessWithoutNullStreams, Js.Error>",
    vars: 0,
  });
});

Deno.test("reflects global value constructors through new member", async () => {
  const result = await checkSource(`
    from js.global import { URL, Response };
    let url = URL.new("https://example.com/a");
    let response = Response.new("ok", JSON{status: 200});
  `);

  expectBinding(result.env, "url", { type: "Result<URL, Js.Error>", vars: 0 });
  expectBinding(result.env, "response", { type: "Result<Response, Js.Error>", vars: 0 });
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
      req.method
    };
  `);

  expectBinding(result.env, "methodOf", {
    type: "(Js.Object) => Result<Js.Value, Js.Error>",
    vars: 0,
  });
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
          (req) => {
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
          serve: ((Request) => Bool) => Js.Object
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
    type: "(Void) => (Request) => Bool",
    vars: 0,
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
        let useResponse = (handler: (Response) => Result<Response, Js.Error>) => {
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
    type: "(Void) => (Response) => Result<Response, Js.Error>",
    vars: 0,
  });
});

Deno.test("reflected FFI method placeholders solve before parent receiver calls", async () => {
  const result = await checkSource(`
    from js.global import type { Request };
    from js.global("Promise") import unsafe {
      resolve: (String) => Js.Promise<Js.Value>
    } as Promise;

    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };

    let handle = (req) => {
      let textPromise = req :> .text() :> try;
      textPromise :> .then((text) => {
        Promise.resolve(text :> .slice(0, 1) :> try)
      }) :> try
    };

    let use = (handler: (Request) => Js.Promise<Js.Value>, req: Request) => {
      handler(req)
    };

    let checked = use(handle, Panic("req"));
  `);

  expectBinding(result.env, "handle", {
    type: "(Request) => Js.Promise<Js.Value>",
    vars: 0,
  });
  expectBinding(result.env, "use", {
    type: "(((Request) => Js.Promise<Js.Value>, Request)) => Js.Promise<Js.Value>",
    vars: 0,
  });
  expectBinding(result.env, "checked", { type: "Js.Promise<Js.Value>", vars: 0 });
});

Deno.test("FFI-involved handlers stay monomorphic across downstream callback constraints", async () => {
  const result = await checkSource(`
    from js.global import type { Request };
    from js.global("Deno") import unsafe {
      serve: (Js.Value, (Request, Js.Value) => Js.Promise<Js.Value>) => Js.Value
    };
    from js.global("Promise") import unsafe {
      resolve: (String) => Js.Promise<Js.Value>
    } as Promise;

    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };

    let handler = (req, info) => {
      let textPromise = req :> .text() :> try;
      textPromise :> .then((text) => {
        Promise.resolve(text)
      }) :> try
    };

    let server = serve(JSON{}, handler);
  `);

  expectBinding(result.env, "handler", {
    type: "((Request, Js.Value)) => Js.Promise<Js.Value>",
    vars: 0,
  });
  expectBinding(result.env, "server", { type: "Js.Value", vars: 0 });
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

Deno.test("unannotated helper receivers keep delayed FFI obligations", async () => {
  const source = `
    from js.global import unsafe { TextEncoder };
    from js.global import type { TextEncoder, Uint8Array };

    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };

    let encodeText = (encoder, text) => {
      encoder :> .encode(text) :> try
    };

    let makeBytes = () => {
      let encoder = TextEncoder.new();
      encodeText(encoder, "hello")
    };
  `;

  const results = await checkVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const result = results.get("/test/main.wm")!;

  expectBinding(result.env, "makeBytes", { type: "(Void) => Uint8Array", vars: 0 });
});
