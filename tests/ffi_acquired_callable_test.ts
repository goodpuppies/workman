import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, checkVirtual, compile } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";
import { fileURLToPath } from "node:url";
const fixture = "./tests/fixtures/ffi_acquired_callable.ts";

Deno.test("acquired callable tuple entries specialize replacement and updater calls", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { state };
    let (_, set, get) = state(0) :> Result.debug;
    let replace = set(10);
    let update = set((previous) => { previous + 1 });
    let unchanged = set((previous) => { previous });
    let constant = set((_) => { 10 });
    let piped = 10 :> set;
    let read = get();
  `);
  expectBinding(result.env, "replace", { type: "Result<Void, Js.Error>!", vars: 0 });
  expectBinding(result.env, "update", { type: "Result<Void, Js.Error>!", vars: 0 });
  expectBinding(result.env, "read", { type: "Number!", vars: 0 });
});

Deno.test("unsafe imports preserve raw acquired setter calls with full reflection", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe { state };
    let (_, set, get) = state(0);
    let replace = set(10);
    let update = set((previous) => { previous + 1 });
    let piped = 10 :> set;
  `);
  for (const name of ["replace", "update", "piped"]) {
    expectBinding(result.env, name, { type: "Void!", vars: 0 });
  }
  for (const call of ['set("wrong")', 'set((previous) => { "wrong" })']) {
    await assertRejects(() =>
      checkSource(`
      from js.module("${fixture}") import unsafe { state };
      let (_, set, get) = state(0);
      let wrong = ${call};
    `)
    );
  }
});

Deno.test("safe and unsafe acquired signatures coexist without changing one another", async () => {
  for (
    const declarations of [
      "let (_, safe, _) = safeState(0) :> Result.debug; let (_, raw, _) = rawState(0);",
      "let (_, raw, _) = rawState(0); let (_, safe, _) = safeState(0) :> Result.debug;",
    ]
  ) {
    const result = await checkSource(`
      from js.module("${fixture}") import { state as safeState };
      from js.module("${fixture}") import unsafe { state as rawState };
      ${declarations}
      let checked = safe(1);
      let direct = raw(1);
    `);
    expectBinding(result.env, "checked", { type: "Result<Void, Js.Error>!", vars: 0 });
    expectBinding(result.env, "direct", { type: "Void!", vars: 0 });
  }
});

Deno.test("unsafe policy survives namespace imports aliases and computed initial values", async () => {
  const result = await checkSource(`
    record Holder<t> = { call: t };
    from js.module("${fixture}") import unsafe * as Foreign;
    let identity = (value) => { value };
    let example = () => {
      let initial = 1 + 2;
      let (_, set, _) = Foreign.state(initial);
      let holder = .{ call = identity(set) };
      let alias = holder.call;
      alias((previous) => { previous + 1 })
    };
  `);
  expectBinding(result.env, "example", { type: "Void -> Void!", vars: 0 });
});

Deno.test("unsafe acquired functions propagate raw calls to their returned callables", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import unsafe { setterFactory, identityFactory };
    let create = setterFactory();
    let set = create(0);
    let replacement = set(1);
    let updater = set((previous) => { previous + 1 });
    let identity = identityFactory();
    let number = identity(1);
    let text = identity("one");
  `);
  expectBinding(result.env, "replacement", { type: "Void!", vars: 0 });
  expectBinding(result.env, "updater", { type: "Void!", vars: 0 });
  expectBinding(result.env, "number", { type: "Number!", vars: 0 });
  expectBinding(result.env, "text", { type: "String!", vars: 0 });
});

Deno.test("unsafe acquired callable identity survives WM module imports", async () => {
  const absolute = fileURLToPath(new URL("./fixtures/ffi_acquired_callable.ts", import.meta.url))
    .replaceAll("\\", "/");
  const results = await checkVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/state.wm",
        `from js.module("${absolute}") import unsafe { state }; let (_, set, _) = state(0);`,
      ],
      [
        "/test/main.wm",
        `from "./state.wm" import { set }; let replace = set(10); let update = set((previous) => { previous + 1 });`,
      ],
    ]),
  );
  const result = results.get("/test/main.wm")!;
  expectBinding(result.env, "replace", { type: "Void!", vars: 0 });
  expectBinding(result.env, "update", { type: "Void!", vars: 0 });
});

Deno.test("unsafe acquired calls invoke the captured closure and propagate exceptions", async () => {
  const absolute = fileURLToPath(new URL("./fixtures/ffi_acquired_callable.ts", import.meta.url))
    .replaceAll("\\", "/");
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(
      path,
      await compile(`
      from js.module("${absolute}") import unsafe { state, throwingSetter };
      let main = () => {
        let (_, set, get) = state(0);
        set(10);
        set((previous) => { previous + 1 });
        if (get() == 11) { print("updated") } else { Panic("wrong closure") };
        let fail = throwingSetter();
        fail(1)
      };
    `),
    );
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "updated");
    assertEquals(result.code === 0, false);
    assertEquals(new TextDecoder().decode(result.stderr).includes("setter failed"), true);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("acquired callable identity survives records and ordinary identity helpers", async () => {
  const result = await checkSource(`
    record Holder<t> = { call: t };
    from js.module("${fixture}") import { state };
    let (_, set, get) = state(0) :> Result.debug;
    let identity = (value) => { value };
    let holder = .{ call = identity(set) };
    let alias = holder.call;
    let replaced = alias(10);
    let updated = alias((previous) => { previous + 1 });
  `);
  expectBinding(result.env, "replaced", { type: "Result<Void, Js.Error>!", vars: 0 });
  expectBinding(result.env, "updated", { type: "Result<Void, Js.Error>!", vars: 0 });
});

Deno.test("acquired callables execute the captured closure and normalize thrown errors", async () => {
  const absolute = fileURLToPath(new URL("./fixtures/ffi_acquired_callable.ts", import.meta.url))
    .replaceAll("\\", "/");
  const js = await compile(`
    from js.module("${absolute}") import { state, throwingSetter };
    let main = () => {
      let (_, set, get) = state(0) :> Result.debug;
      let (_, otherSet, otherGet) = state(100) :> Result.debug;
      set(10) :> Result.debug;
      set((previous) => { previous + 1 }) :> Result.debug;
      otherSet((previous) => { previous + 2 }) :> Result.debug;
      if (get() == 11) { print("updated") } else { Panic("wrong closure") };
      if (otherGet() == 102) { void } else { Panic("shared closure") };
      let fail = throwingSetter() :> Result.debug;
      match(fail(1)) {
        Err(_) => { print("caught") },
        Ok(_) => { Panic("lost exception") },
      }
    };
  `);
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, js);
    const output = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "updated\ncaught");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("acquired setters resolve after HM establishes a computed initial value", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { state };
    let example = () => {
      let initial = 1 + 2;
      let (_, set, get) = state(initial) :> Result.debug;
      set(10) :> Result.debug;
      set((previous) => { previous + 1 }) :> Result.debug;
      get()
    };
  `);
  expectBinding(result.env, "example", { type: "Void -> Number!", vars: 0 });
});

Deno.test("acquired callable restrictions survive aliases", async () => {
  const header = `from js.module("${fixture}") import { state };
    let (_, set, get) = state(0) :> Result.debug;
    let alias = set;`;
  for (const call of ['alias("wrong")', 'alias((previous) => { "wrong" })']) {
    await assertRejects(() => checkSource(`${header} let bad = ${call};`));
  }
  for (const call of ["alias()", "alias(1, 2)", "alias(true)"]) {
    await assertRejects(() => checkSource(`${header} let bad = ${call};`));
  }
});

Deno.test("acquired callables retain scalar unions, optional arities, and rest parameters", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { scalarConsumer, optionalConsumer, restConsumer };
    let scalar = scalarConsumer() :> Result.debug;
    let a = scalar(1);
    let b = scalar("one");
    let optional = optionalConsumer() :> Result.debug;
    let c = optional();
    let d = optional(1);
    let rest = restConsumer() :> Result.debug;
    let e = rest();
    let f = rest(1, 2, 3);
  `);
  for (const name of ["a", "b"]) {
    expectBinding(result.env, name, { type: "Result<String, Js.Error>!", vars: 0 });
  }
  for (const name of ["c", "d", "e", "f"]) {
    expectBinding(result.env, name, { type: "Result<Number, Js.Error>!", vars: 0 });
  }
  await assertRejects(() =>
    checkSource(`
    from js.module("${fixture}") import { ambiguousResult };
    let consume = ambiguousResult() :> Result.debug;
    let unsupported = consume(1);
  `)
  );
});

Deno.test("returned overloads and generic functions specialize each call independently", async () => {
  const result = await checkSource(`
    from js.module("${fixture}") import { converter, identityFactory };
    let convert = converter() :> Result.debug;
    let text = convert(42);
    let number = convert("hello");
    let identity = identityFactory() :> Result.debug;
    let a = identity(42);
    let b = identity("hello");
  `);
  expectBinding(result.env, "text", { type: "Result<String, Js.Error>!", vars: 0 });
  expectBinding(result.env, "number", { type: "Result<Number, Js.Error>!", vars: 0 });
  expectBinding(result.env, "a", { type: "Result<Number, Js.Error>!", vars: 0 });
  expectBinding(result.env, "b", { type: "Result<String, Js.Error>!", vars: 0 });
});

Deno.test("acquired callable identities survive WM module interfaces", async () => {
  const absolute = fileURLToPath(new URL("./fixtures/ffi_acquired_callable.ts", import.meta.url))
    .replaceAll("\\", "/");
  const results = await checkVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/state.wm",
        `
      from js.module("${absolute}") import { state };
      let (_, set, get) = state(0) :> Result.debug;
    `,
      ],
      [
        "/test/main.wm",
        `
      from "./state.wm" import { set };
      let replacement = set(10);
      let update = set((previous) => { previous + 1 });
    `,
      ],
    ]),
  );
  const result = results.get("/test/main.wm")!;
  expectBinding(result.env, "replacement", { type: "Result<Void, Js.Error>!", vars: 0 });
  expectBinding(result.env, "update", { type: "Result<Void, Js.Error>!", vars: 0 });
});
