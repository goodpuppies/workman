import { assertEquals, assertRejects } from "@std/assert";
import {
  analyzeRecoveredVirtual,
  checkSource,
  checkVirtual,
  compileLibraryVirtual,
} from "../src/compiler.ts";
import { moduleId } from "../src/module_id.ts";
import { expectBinding } from "./type_helpers.ts";

const records = `
  record Inner<T> = { value: T };
  record Outer<T> = { inner: Inner<T>, add: Real64.Real -> Real64.Real };
  let make = (value) => { Outer(Inner(value), (n) => { n + 1 }) };
`;

Deno.test("recovery retains imported record pipe projections and calls beside a type error", async () => {
  const snapshot = await analyzeRecoveredVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/members.wm",
        `${records}
        let get = (item) => { item :> .inner :> .value };
        let call = (item) => { item :> .add(41.0) };
      `,
      ],
      [
        "/test/main.wm",
        `
        from "./members.wm" import { make, get, call };
        let text = get(make("hello"));
        let broken: String = 1;
        let answer = call(make(0));
      `,
      ],
    ]),
  );
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;
  assertEquals(main.diagnostics.some((diagnostic) => diagnostic.severity === "error"), true);
  assertEquals(main.occurrences.some(({ name }) => name === "text"), true);
  assertEquals(main.occurrences.some(({ name }) => name === "answer"), true);
});

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
  for (const name of ["computed", "chained", "number"]) {
    expectBinding(result.env, name, { type: "Int32.Int", vars: 0 });
  }
  expectBinding(result.env, "called", { type: "Real64.Real", vars: 0 });
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
  await assertRejects(() =>
    checkSource(`
      record Label = { text: String };
      let call = (item) => { item :> .text() };
      let bad = call(Label("not callable"));
    `), Error);
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
      record Count = { value: Real64.Real };
      let text = get(Text("hello"));
      let number = get(Count(42));
    `,
    ],
  ]);
  const result = (await checkVirtual("/test/main.wm", sources)).get("/test/main.wm")!;
  expectBinding(result.env, "text", { type: "String", vars: 0 });
  expectBinding(result.env, "number", { type: "Real64.Real", vars: 0 });
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
    let call = (item) => { item :> .add(41.0) };
    let answer = call(make(0));
  `);
  expectBinding(result.env, "value", { type: "Int32.Int!", vars: 0 });
  expectBinding(result.env, "answer", { type: "Real64.Real", vars: 0 });
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
