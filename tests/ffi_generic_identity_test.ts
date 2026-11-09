import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { fileURLToPath } from "node:url";
import { checkSource, checkVirtual, compile } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";
import { setActiveJsReflectionBasePath } from "../src/ffi/reflect/host.ts";
import { type JsCallArgHint, jsModuleMemberValueRef, jsRefCall } from "../src/ffi/reflect/types.ts";

const fixture = "./tests/fixtures/ffi_generic_box.ts";
// Workman string literals and emitted JS imports both accept forward-slash native paths.
const absoluteFixture = fileURLToPath(new URL("./fixtures/ffi_generic_box.ts", import.meta.url))
  .replaceAll("\\", "/");
const name = (name: string) => ({ kind: "TName" as const, name, args: [] });

Deno.test("foreign generic instances keep their arguments regardless of import order", async () => {
  for (
    const clause of [
      "unsafe { numberBox, stringBox }",
      "unsafe { stringBox, numberBox }",
      "unsafe * as Box",
    ]
  ) {
    const prefix = clause.includes("*") ? "Box." : "";
    const result = await checkSource(`
      from js.module("${fixture}") import ${clause};
      let number = ${prefix}numberBox();
      let text = ${prefix}stringBox();
      let numberValue = number :> .value;
      let textValue = text :> .value;
    `);
    expectBinding(result.env, "number", { type: "Box<Number>!", vars: 0 });
    expectBinding(result.env, "text", { type: "Box<String>!", vars: 0 });
    expectBinding(result.env, "numberValue", { type: "Number!", vars: 0 });
    expectBinding(result.env, "textValue", { type: "String!", vars: 0 });
  }
});

Deno.test("generic foreign calls preserve scalar and tuple callback results", async () => {
  const source = `
    from js.module("${fixture}") import unsafe * as Box;
    let number = Box.run(Box.succeed(20));
    let text = Box.run(Box.succeed("hello"));
    let grouped = Box.flatMap(Box.succeed(1), (number) => {
      Box.map(Box.succeed("hello"), (text) => { (number, text) })
    });
    let pair = Box.run(grouped);
    let main = () => {
      let (number, text) = pair;
      if (number == 1 && text == "hello") { print("tuple ok") }
      else { Panic("wrong foreign tuple result") }
    };
  `;
  const result = await checkSource(source);
  expectBinding(result.env, "number", { type: "Number!", vars: 0 });
  expectBinding(result.env, "text", { type: "String!", vars: 0 });
  expectBinding(result.env, "grouped", { type: "Box<(Number, String)>!", vars: 0 });
  expectBinding(result.env, "pair", { type: "(Number, String)!", vars: 0 });
  const runtimeSource = source.replaceAll(
    fixture,
    absoluteFixture,
  );
  const js = await compile(runtimeSource);
  // Run the emitted program as a module: the inferred tuple must also survive
  // the callback adapters at runtime, without an extra conversion or assertion.
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, js);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", path],
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "tuple ok");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("type-only foreign imports retain generic arity and reject wrong arguments", async () => {
  const header = `
    from js.module("${fixture}") import type { Box as Container };
    from js.module("${fixture}") import unsafe { numberBox };
  `;
  const result = await checkSource(`${header}
    let boxed: Container<Number> = numberBox();
    let value = boxed :> .value;
  `);
  expectBinding(result.env, "value", { type: "Number!", vars: 0 });
  await assertRejects(() =>
    checkSource(`${header}
    let boxed: Container<String> = numberBox();
  `)
  );
});

Deno.test("concrete foreign generic parameters reject incompatible payloads", async () => {
  const header = `from js.module("${fixture}") import unsafe * as Box;`;
  const result = await checkSource(`${header}
    let size = Box.textLength(Box.stringBox());
  `);
  expectBinding(result.env, "size", { type: "Number!", vars: 0 });
  await assertRejects(() =>
    checkSource(`${header}
    let size = Box.textLength(Box.numberBox());
  `)
  );
});

Deno.test("generic overload specialization preserves discriminator literals", async () => {
  const result = await checkSource(`
    from js.module("./tests/fixtures/ffi_generic_box_overloads.ts") import unsafe * as Foreign;
    let number = Foreign.select("number");
    let text = Foreign.select("string");
    let numberValue = number :> .value;
    let textValue = text :> .value;
  `);
  expectBinding(result.env, "number", { type: "Box<Number>!", vars: 0 });
  expectBinding(result.env, "text", { type: "Box<String>!", vars: 0 });
  expectBinding(result.env, "numberValue", { type: "Number!", vars: 0 });
  expectBinding(result.env, "textValue", { type: "String!", vars: 0 });
});

Deno.test("generic callback captures resolve before their result is materialized", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe * as Box;
    from js.module("./tests/fixtures/ffi_generic_box_overloads.ts") import unsafe * as Foreign;
    let double = (boxed) => { Foreign.transform(boxed, (number) => { number * 2 }) };
    let number = Box.succeed(21) :> double;
    let grouped = Box.flatMap(number, (value) => {
      Foreign.transform(Box.succeed("hello"), (text) => { (value, text) })
    });
    let (value, text) = Box.run(grouped);
  `);
  expectBinding(result.env, "value", { type: "Number!", vars: 0 });
  expectBinding(result.env, "text", { type: "String!", vars: 0 });
});

Deno.test("safe imports retain foreign generic arguments inside Result", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { numberBox, stringBox };
    let number = numberBox();
    let text = stringBox();
    let numberValue = number :> Result.andThen((box) => { box :> .value });
    let textValue = text :> Result.andThen((box) => { box :> .value });
  `);
  expectBinding(result.env, "number", { type: "Result<Box<Number>, Js.Error>!", vars: 0 });
  expectBinding(result.env, "text", { type: "Result<Box<String>, Js.Error>!", vars: 0 });
  expectBinding(result.env, "numberValue", { type: "Result<Number, Js.Error>!", vars: 0 });
  expectBinding(result.env, "textValue", { type: "Result<String, Js.Error>!", vars: 0 });
});

Deno.test("foreign generic arguments survive Workman module interfaces", async () => {
  const results = await checkVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/boxes.wm",
        `
      from js.module("${absoluteFixture}") import unsafe * as Box;
      let number = Box.succeed(20);
      let text = Box.succeed("hello");
    `,
      ],
      [
        "/test/main.wm",
        `
      from "./boxes.wm" import { number, text };
      let numberValue = number :> .value;
      let textValue = text :> .value;
    `,
      ],
    ]),
  );
  const result = results.get("/test/main.wm");
  assertExists(result);
  expectBinding(result.env, "numberValue", { type: "Number!", vars: 0 });
  expectBinding(result.env, "textValue", { type: "String!", vars: 0 });
});

Deno.test("concrete generic call refs retain distinct payload types in TS reflection", () => {
  const previous = setActiveJsReflectionBasePath(
    fileURLToPath(new URL("../main.wm", import.meta.url)),
  );
  try {
    const succeed = jsModuleMemberValueRef(fixture, "succeed");
    const run = jsModuleMemberValueRef(fixture, "run");
    const cases: [JsCallArgHint, string][] = [
      [{ kind: "number", value: 20 }, "Number"],
      [{ kind: "string", value: "hello" }, "String"],
    ];
    // Keep both refs alive before consuming either; the shared Box name must not
    // overwrite their concrete TS identities at this layer.
    const refs = cases.map(([hint]) => {
      const wrapped = jsRefCall(succeed, [hint]);
      const ref = wrapped?.variants?.[0].resultRef;
      assertExists(ref);
      return ref;
    });
    for (const [index, [, expected]] of cases.entries()) {
      const unwrapped = jsRefCall(run, [{ kind: "ref", ref: refs[index] }]);
      assertEquals(unwrapped?.type.kind, "TFn");
      if (unwrapped?.type.kind !== "TFn") throw new Error("missing call signature");
      assertEquals(unwrapped.type.result, name(expected));
    }
  } finally {
    setActiveJsReflectionBasePath(previous);
  }
});

Deno.test("concrete tuple callback results survive local generic TS reflection", () => {
  const previous = setActiveJsReflectionBasePath(
    fileURLToPath(new URL("../main.wm", import.meta.url)),
  );
  try {
    const succeed = jsModuleMemberValueRef(fixture, "succeed");
    const map = jsModuleMemberValueRef(fixture, "map");
    const run = jsModuleMemberValueRef(fixture, "run");
    const input = jsRefCall(succeed, [{ kind: "number", value: 20 }])?.variants?.[0].resultRef;
    assertExists(input);
    const tuple = { kind: "TTuple" as const, items: [name("Number"), name("String")] };
    const mapped = jsRefCall(map, [
      { kind: "ref", ref: input },
      { kind: "function", arity: 1, resultType: tuple },
    ]);
    const ref = mapped?.variants?.[0].resultRef;
    assertExists(ref);
    const output = jsRefCall(run, [{ kind: "ref", ref }]);
    if (output?.type.kind !== "TFn") throw new Error("missing call signature");
    assertEquals(output.type.result, tuple);
    assertEquals(mapped?.variants?.[0].callbackParamRefs?.[0].params[0].type, name("Number"));
  } finally {
    setActiveJsReflectionBasePath(previous);
  }
});
