import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, checkVirtual, compileLibraryVirtual } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const records = `
  record Inner<T> = { value: T };
  record Outer<T> = { inner: Inner<T>, add: Number -> Number };
  let make = (value) => { Outer(Inner(value), (n) => { n + 1 }) };
`;

Deno.test("pipe members project ordinary records without FFI effects", async () => {
  const result = await checkSource(`
    ${records}
    let item = make("hello");
    let direct = item :> .inner;
    let nested = item :> .inner.value;
    let computed = make(42) :> .inner.value;
    let chained = make(42) :> .inner :> .value;
    let called = make(42) :> .add(1);
    let get = (item) => { item :> .inner.value };
    let text = get(make("text"));
    let number = get(make(42));
  `);
  expectBinding(result.env, "direct", { type: "Inner<String>", vars: 0 });
  for (const name of ["nested", "text"]) {
    expectBinding(result.env, name, { type: "String", vars: 0 });
  }
  for (const name of ["computed", "chained", "called", "number"]) {
    expectBinding(result.env, name, { type: "Number", vars: 0 });
  }
  assertEquals(result.diagnostics, []);
});

Deno.test("pipe record members evaluate receivers once and before call arguments", async () => {
  const source = `
    ${records}
    let trace = (label, value) => { print(label); value };
    let projected = trace("receiver", make("text")) :> .inner.value;
    let called = trace("function", make(0)) :> .add(trace("argument", 41));
  `;
  const js = await compileLibraryVirtual(
    "/test/members.wm",
    new Map([["/test/members.wm", source]]),
  );
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const module = await import(`data:text/javascript;base64,${btoa(js)}`);
    assertEquals(module.projected, "text");
    assertEquals(module.called, 42);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["receiver", "function", "argument"]);
});

Deno.test("pipe record members reject missing fields and invalid field calls", async () => {
  await assertRejects(
    () => checkSource(`${records} let bad = make(1) :> .missing;`),
    Error,
    "no field missing",
  );
  await assertRejects(
    () => checkSource(`${records} let bad = make(1) :> .inner.missing;`),
    Error,
    "no field missing",
  );
  await assertRejects(() => checkSource(`${records} let bad = make(1) :> .add("wrong");`), Error);
  await assertRejects(() => checkSource(`${records} let bad = make(1) :> .inner(1);`), Error);
});

Deno.test("pipe record field constraints survive imports and caller-owned records", async () => {
  const sources = new Map([
    [
      "/test/access.wm",
      `
      record Known<T> = { value: T };
      let get = (item) => { item :> .value };
    `,
    ],
    [
      "/test/main.wm",
      `
      from "./access.wm" import { get };
      record Text = { value: String };
      record Count = { value: Number };
      let text = get(Text("hello"));
      let number = get(Count(42));
    `,
    ],
  ]);
  const result = (await checkVirtual("/test/main.wm", sources)).get("/test/main.wm")!;
  expectBinding(result.env, "text", { type: "String", vars: 0 });
  expectBinding(result.env, "number", { type: "Number", vars: 0 });
  const js = await compileLibraryVirtual("/test/main.wm", sources);
  const module = await import(`data:text/javascript;base64,${btoa(js)}`);
  assertEquals(module.text, "hello");
  assertEquals(module.number, 42);
});

Deno.test("pipe record fields retain receiver effects and ordinary function constraints", async () => {
  const result = await checkSource(`
    ${records}
    let traced = () => { print("made"); make(42) };
    let value = traced() :> .inner.value;
    let call = (item) => { item :> .add(41) };
    let answer = call(make(0));
  `);
  expectBinding(result.env, "value", { type: "Number!", vars: 0 });
  expectBinding(result.env, "answer", { type: "Number", vars: 0 });
});

Deno.test("JavaScript pipe members still work when record labels overlap", async () => {
  const result = await checkSource(`
    record Named = { name: String };
    from js.global("JSON") import unsafe { parse: String -> Js.Object } as JSON;
    let read = (text: String) => { JSON.parse(text) :> .name };
    let person = Named("Ellie") :> .name;
  `);
  expectBinding(result.env, "person", { type: "String", vars: 0 });
  assertEquals(result.diagnostics, []);
});
