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

  assertEquals(imports.every((decl) => decl.clause.kind === "Named"), true);
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
    "unelaborated JS namespace import Math",
  );
});
