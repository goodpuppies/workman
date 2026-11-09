import { assertRejects } from "@std/assert";
import { checkSource, checkVirtual, compile } from "../src/compiler.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import { snapshotType } from "../src/infer/expr_flow.ts";
import { fn, prim, type Ty } from "../src/types.ts";
import { expectBinding } from "./type_helpers.ts";
const fixture = "./tests/fixtures/ffi_receiver_safety.ts";
const absoluteFixture = fileURLToPath(new URL("./fixtures/ffi_receiver_safety.ts", import.meta.url))
  .replaceAll("\\", "/");

Deno.test("unsafe receivers retain raw properties methods and chained results", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe { box };
    let value = box();
    let property = value.value;
    let method = value.read();
    let nested = value.child :> .read();
    let chained = value.add(2) :> .read();
  `);
  for (const name of ["property", "method", "nested", "chained"]) {
    expectBinding(result.env, name, { type: "Number!", vars: 0 });
  }
});

Deno.test("safe and unsafe receivers coexist in either acquisition order", async () => {
  for (
    const acquisitions of [
      "let safe = safeBox() :> Result.debug; let raw = rawBox();",
      "let raw = rawBox(); let safe = safeBox() :> Result.debug;",
    ]
  ) {
    const result = await checkSource(`
      from js.module("${fixture}") import { box as safeBox };
      from js.module("${fixture}") import unsafe { box as rawBox };
      ${acquisitions}
      let safeRead = safe.read();
      let rawRead = raw.read();
      let safeProperty = safe.value;
      let rawProperty = raw.value;
    `);
    for (const name of ["safeRead", "safeProperty"]) {
      expectBinding(result.env, name, { type: "Result<Number, Js.Error>!", vars: 0 });
    }
    for (const name of ["rawRead", "rawProperty"]) {
      expectBinding(result.env, name, { type: "Number!", vars: 0 });
    }
  }
});

Deno.test("unsafe callbacks infer raw receiver members without annotations", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe { withBox };
    let answer = withBox((value) => { value.read() + value.value });
  `);
  expectBinding(result.env, "answer", { type: "Number!", vars: 0 });
});

Deno.test("safe callback receivers stay wrapped beside unsafe callbacks and extracted methods", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { withBox as safeWithBox };
    from js.module("${fixture}") import unsafe { withBox as rawWithBox, box };
    let safe = safeWithBox((value) => { value.read() :> Result.debug });
    let raw = rawWithBox((value) => { value.read() });
    let instance = box(); let read = instance.read; let extracted = read();
  `);
  expectBinding(result.env, "safe", { type: "Result<Number, Js.Error>!", vars: 0 });
  expectBinding(result.env, "raw", { type: "Number!", vars: 0 });
  expectBinding(result.env, "extracted", { type: "Number!", vars: 0 });
});

Deno.test("unsafe receivers still reject wrong members and arguments", async () => {
  for (const call of ["value.missing", 'value.add("wrong")']) {
    await assertRejects(() =>
      checkSource(`
      from js.module("${fixture}") import unsafe { box };
      let value = box(); let wrong = ${call};
    `)
    );
  }
});

Deno.test("unsafe nominal receiver policy survives Option arrays and Task payloads", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe { boxLater, maybeBox, boxList };
    let pending = boxLater();
    let later = pending :> Task.map((value) => { value.read() });
    let maybe = maybeBox() :> Option.map((value) => { value.read() });
    let many = boxList() :> Js.Array.toList :> List.map((value) => { value :> .read() });
  `);
  expectBinding(result.env, "later", { type: "Task<Number!, Js.Error>!", vars: 0 });
  expectBinding(result.env, "pending", { type: "Task<ReceiverBox, Js.Error>!", vars: 0 });
  expectBinding(result.env, "maybe", { type: "Option<Number!>!", vars: 0 });
  expectBinding(result.env, "many", { type: "List<Number!>!", vars: 0 });
});

Deno.test("unsafe receiver policy survives aliases records tuples and identity calls", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe { box, boxes, identity };
    record Holder<a> = { item: a };
    let alias = box();
    let holder = .{ item = alias };
    let recordRead = holder.item :> .read();
    let (first, second) = boxes();
    let firstRead = first :> .read();
    let secondRead = second :> .read();
    let id = (value) => { value };
    let nativeRead = id(alias) :> .read();
    let reflectedRead = identity(alias) :> .read();
  `);
  for (const name of ["recordRead", "firstRead", "secondRead", "nativeRead", "reflectedRead"]) {
    expectBinding(result.env, name, { type: "Number!", vars: 0 });
  }
});

Deno.test("unsafe receiver policy crosses WM module boundaries", async () => {
  const result = await checkVirtual(
    "/main.wm",
    new Map([
      [
        "/factory.wm",
        `from js.module("${absoluteFixture}") import unsafe { box }; let make = () => { box() };`,
      ],
      [
        "/main.wm",
        `from "./factory.wm" import { make }; let value=make(); let answer=value.read();`,
      ],
    ]),
  );
  expectBinding(result.get("/main.wm")!.env, "answer", { type: "Number!", vars: 0 });
});

Deno.test("ordinary foreign annotations do not erase unsafe receiver policy", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import type { ReceiverBox };
    from js.module("${fixture}") import unsafe { box };
    let value: ReceiverBox = box();
    let direct = value.read();
    let id = (input: ReceiverBox) => { input };
    let through = id(box()) :> .read();
  `);
  for (const name of ["direct", "through"]) {
    expectBinding(result.env, name, { type: "Number!", vars: 0 });
  }
});

Deno.test("annotated identity helpers keep safe and unsafe uses independent", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import type { ReceiverBox };
    from js.module("${fixture}") import { box as safeBox };
    from js.module("${fixture}") import unsafe { box as rawBox };
    let id = (value: ReceiverBox) => { value };
    let safeRead = id(safeBox() :> Result.debug) :> .read();
    let rawRead = id(rawBox()) :> .read();
  `);
  expectBinding(result.env, "safeRead", { type: "Result<Number, Js.Error>!", vars: 0 });
  expectBinding(result.env, "rawRead", { type: "Number!", vars: 0 });
});

Deno.test("a concretely safe member adapter cannot silently consume an unsafe receiver", async () => {
  await assertRejects(() =>
    checkSource(`
    from js.module("${fixture}") import type { ReceiverBox };
    from js.module("${fixture}") import unsafe { box };
    let read = (value: ReceiverBox) => { value.read() };
    let answer = read(box());
  `)
  );
});

Deno.test("constructors inherit unsafe policy and safe constructors remain wrapped", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe { ReceiverBox as RawBox };
    from js.module("${fixture}") import { ReceiverBox as SafeBox };
    let raw = RawBox.new(); let safe = SafeBox.new() :> Result.debug;
    let rawRead = raw.read(); let safeRead = safe.read();
    from js.global import unsafe { URL };
    let url = URL.new("https://example.test/path");
    let path = url.pathname;
  `);
  expectBinding(result.env, "rawRead", { type: "Number!", vars: 0 });
  expectBinding(result.env, "safeRead", { type: "Result<Number, Js.Error>!", vars: 0 });
  expectBinding(result.env, "path", { type: "String!", vars: 0 });
});

Deno.test("match arm snapshots terminate for deferred render calls", async () => {
  await checkSource(`
    from js.module("${fixture}") import unsafe { maybeBox, createRoot, createElement, view };
    let main = () => {
      match(maybeBox()) {
        Some(mount) => {
          let root = createRoot(mount);
          let component = (_) => { view() };
          let tree = createElement(component, JSON{});
          root.render(tree)
        },
        None => { Panic "missing mount" },
      }
    };
  `);
});

Deno.test("match snapshots preserve cyclic deferred FFI graphs without sharing mutable constraints", () => {
  const result: Ty = { tag: "ffi", id: -1, kind: "call", path: [], args: [] };
  if (result.tag !== "ffi") throw new Error("expected an FFI obligation");
  const callback = fn([result], prim("Void"));
  result.args.push(callback);
  result.constraints = [callback];
  const copy = snapshotType(result);
  if (copy.tag !== "ffi" || copy.args[0].tag !== "fn") {
    throw new Error("snapshot lost obligation shape");
  }
  assertEquals(copy === result, false);
  assertEquals(copy.args[0] === callback, false);
  assertEquals(copy.args[0].params[0] === copy, true);
  result.constraints.push(prim("Number"));
  assertEquals(copy.constraints?.length, 1);
});

Deno.test("unsafe receiver adapters preserve this and propagate getter and method exceptions", async () => {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    const source = `from js.module("${absoluteFixture}") import unsafe {box};`;
    await Deno.writeTextFile(
      path,
      await compile(`${source}
      let main=()=>{ let value=box(); let next=value.add(4); print(next.read()); };
    `),
    );
    const run = () => new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    let result = await run();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "7");
    for (
      const [expression, error] of [["value.fail()", "method exploded"], [
        "value.broken",
        "getter exploded",
      ]]
    ) {
      await Deno.writeTextFile(
        path,
        await compile(`${source} let main=()=>{let value=box(); print(${expression});};`),
      );
      result = await run();
      assertEquals(result.code, 1);
      assertStringIncludes(new TextDecoder().decode(result.stderr), error);
    }
    await Deno.writeTextFile(
      path,
      await compile(`
      from js.module("${absoluteFixture}") import {box};
      let main=()=>{let value=box():>Result.debug;
        match(value.fail()){Err(_)=>{print("method caught")},Ok(_)=>{Panic "lost method error"}};
        match(value.broken){Err(_)=>{print("getter caught")},Ok(_)=>{Panic "lost getter error"}}
      };
    `),
    );
    result = await run();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "method caught\ngetter caught");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("unsafe reflected promises normalize as Tasks at runtime", async () => {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(
      path,
      await compile(`
      from js.module("${absoluteFixture}") import unsafe { boxLater, rejectLater };
      let main = () => {
        boxLater() :> Task.andThen((value) => {
          print(value.read());
          rejectLater() :> Task.recover((error) => {
            match(error) {
              Js.Error(message) => { print(message); 0 },
              Js.Unknown => { Panic "lost rejection" },
            }
          })
        })
      };
    `),
    );
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "3\npromise exploded");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("unsafe async receiver members and direct multiargument adapters preserve Task payload conversion", async () => {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(
      path,
      await compile(`
      from js.module("${absoluteFixture}") import unsafe { box, pairLater };
      from js.module("${absoluteFixture}") import unsafe { taskPrimitive as ready: Void -> Task<Number, Js.Error> };
      let higher = (f) => { f(4, 5) };
      let main = () => {
        let value = box();
        value.readLater() :> Task.andThen((number) => {
          print(number);
          value.pendingValue :> Task.andThen((number) => {
            print(number);
            pairLater(2, 3) :> Task.andThen((pair) => {
              let (sum, missing) = pair;
              if (sum == 5 && missing == None) { print("converted") } else { Panic "wrong payload" };
              higher(pairLater) :> Task.andThen((pair) => {
                let (sum, _) = pair; print(sum);
                ready() :> Task.map((number) => { print(number) })
              })
            })
          })
        })
      };
    `),
    );
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "3\n3\nconverted\n9\n17");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("unsafe promise calls propagate synchronous throws while safe calls produce failed Tasks", async () => {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    const run = () => new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    await Deno.writeTextFile(
      path,
      await compile(`
      from js.module("${absoluteFixture}") import unsafe { throwBeforePromise };
      let main=()=>{ throwBeforePromise() :> Task.recover((_)=>{ print("unexpected catch"); 0 }) };
    `),
    );
    let result = await run();
    assertEquals(result.code, 1);
    assertStringIncludes(new TextDecoder().decode(result.stderr), "before promise");
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "");
    await Deno.writeTextFile(
      path,
      await compile(`
      from js.module("${absoluteFixture}") import { throwBeforePromise };
      let main=()=>{ throwBeforePromise() :> Task.recover((_)=>{ print("caught"); 0 }) };
    `),
    );
    result = await run();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "caught");
  } finally {
    await Deno.remove(path);
  }
});
