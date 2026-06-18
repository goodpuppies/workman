import { assertEquals, assertThrows } from "@std/assert";
import { prepareFfiElaboration } from "../src/ffi/elab.ts";
import { inferModule } from "../src/infer.ts";
import { parse } from "../src/parser.ts";

Deno.test("FFI elaboration collects manual and reflected JS bindings before HM", async () => {
  const module = await parse(`
    from js.global("Math") import { floor as jsfloor };
    from js.global("console") import { log: (String) => Void } as console;
  `);

  const ffi = prepareFfiElaboration(module);

  assertEquals([...ffi.bindings.keys()].sort(), ["console.log", "jsfloor"]);
  assertEquals(ffi.bindings.get("jsfloor")?.variants[0].memberName, "floor");
  assertEquals(ffi.bindings.get("console.log")?.variants[0].memberName, "log");
});

Deno.test("FFI elaboration rewrites namespace and object calls to concrete imports", async () => {
  const module = await parse(`
    from js.global("Math") import * as Math;
    from js.global("console") import { log: (String, Number) => Void } as console;
    let main = () => {
      console.log("answer", 42);
      Math.sqrt(9)
    };
  `);

  const ffi = prepareFfiElaboration(module);
  const imports = ffi.module.decls.filter((decl) => decl.kind === "JsImportDecl");

  assertEquals(imports.some((decl) => decl.clause.kind === "Namespace"), true);
  assertEquals(imports.some((decl) => decl.clause.kind === "Named"), true);
  assertEquals(
    ffi.bindings.get("console.log")?.variants[0].internalName,
    "__ffi_console_log_log_0",
  );
  assertEquals(ffi.bindings.get("Math.sqrt")?.variants[0].internalName, "__ffi_Math_sqrt_sqrt_0");

  const main = ffi.module.decls.find((decl) => decl.kind === "LetDecl");
  const body = main?.kind === "LetDecl" ? main.bindings[0].value : undefined;
  const block = body?.kind === "Lambda" ? body.body : undefined;
  const first = block?.kind === "Block" ? block.items[0] : undefined;
  const second = block?.kind === "Block" ? block.result : undefined;

  assertEquals(
    first?.kind === "Call" && first.callee.kind === "Var" && first.callee.name,
    "__ffi_console_log_log_0",
  );
  assertEquals(
    second?.kind === "Call" && second.callee.kind === "Var" && second.callee.name,
    "__ffi_Math_sqrt_sqrt_0",
  );
});

Deno.test("HM inference rejects unelaborated reflected JS imports", async () => {
  const module = await parse(`
    from js.global("Math") import * as Math;
    let rooted = Math.sqrt(9);
  `);

  assertThrows(
    () => inferModule(module),
    Error,
    "Js.Object is not a record type",
  );
});

Deno.test("FFI elaboration skips Result wrapping for unsafe imports", async () => {
  const module = await parse(`
    from js.global("Reflect") import unsafe { get, construct };
    from js.global("Math") import unsafe * as R;
    let main = () => {
      get({}, "foo");
      R.sqrt(9)
    };
  `);

  const ffi = prepareFfiElaboration(module);

  assertEquals(ffi.bindings.get("get")?.variants[0].fallible, false);
  assertEquals(ffi.bindings.get("construct")?.variants[0].fallible, false);
  assertEquals(ffi.bindings.get("R.sqrt")?.variants[0].fallible, false);
});

Deno.test("FFI elaboration reflects callable root globals", async () => {
  const module = await parse(`
    from js.global import { fetch };
    let response = fetch("https://example.test");
  `);

  const ffi = prepareFfiElaboration(module);

  assertEquals(ffi.bindings.get("fetch")?.variants[0].memberName, "fetch");
  assertEquals(ffi.bindings.get("fetch")?.variants[0].target.kind, "JsGlobalRoot");
});

Deno.test("FFI elaboration reflects callback parameter refs", async () => {
  const module = await parse(`
    from js.global("Deno") import { serve };
    from js.global import { Response };
    let server = serve((req, info) => {
      let path = match(req.url) {
        Ok(value) => { value },
        Err(_) => { "/" },
      };
      match(Response.new(path, JSON{status: 200})) {
        Ok(response) => { response },
        Err(_) => { Panic("response failed") },
      }
    });
  `);

  const ffi = prepareFfiElaboration(module);
  const receiverImport = ffi.module.decls.find((decl) =>
    decl.kind === "JsImportDecl" && decl.target.kind === "JsReceiver"
  );

  assertEquals(
    receiverImport?.kind === "JsImportDecl" && receiverImport.target.kind === "JsReceiver"
      ? receiverImport.target.path
      : undefined,
    ["url"],
  );
});

Deno.test("FFI elaboration rewrites annotated Js.Object property reads", async () => {
  const module = await parse(`
    let read = (req: Js.Object) => {
      req.method
    };
  `);

  const ffi = prepareFfiElaboration(module);
  const receiverImport = ffi.module.decls.find((decl) =>
    decl.kind === "JsImportDecl" && decl.target.kind === "JsReceiver"
  );

  assertEquals(
    receiverImport?.kind === "JsImportDecl" && receiverImport.target.kind === "JsReceiver"
      ? receiverImport.target.path
      : undefined,
    ["method"],
  );
});

Deno.test("FFI elaboration rewrites annotated primitive receiver methods", async () => {
  const module = await parse(`
    let hex = (byte: Number) => {
      byte.toString(16)
    };
  `);

  const ffi = prepareFfiElaboration(module);
  const receiverImport = ffi.module.decls.find((decl) =>
    decl.kind === "JsImportDecl" && decl.target.kind === "JsReceiver"
  );

  assertEquals(
    receiverImport?.kind === "JsImportDecl" && receiverImport.target.kind === "JsReceiver"
      ? receiverImport.target.path
      : undefined,
    ["toString"],
  );
});

Deno.test("FFI elaboration preserves type-only JS refs for property reads", async () => {
  const module = await parse(`
    from js.global import type { Request };
    let read = (req: Request) => {
      req.method
    };
  `);

  const ffi = prepareFfiElaboration(module);
  const foreignType = ffi.module.decls.find((decl) =>
    decl.kind === "ForeignTypeDecl" && decl.name === "Request"
  );
  const receiverImport = ffi.module.decls.find((decl) =>
    decl.kind === "JsImportDecl" && decl.target.kind === "JsReceiver"
  );

  assertEquals(foreignType?.kind, "ForeignTypeDecl");
  assertEquals(
    receiverImport?.kind === "JsImportDecl" && receiverImport.target.kind === "JsReceiver"
      ? receiverImport.target.path
      : undefined,
    ["method"],
  );
});
