import { assertEquals, assertRejects } from "@std/assert";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";

const modules = (main: string, extra: Record<string, string> = {}) =>
  new Map<string, string>(Object.entries({
    "/test/base.wm": `
      let value = 7;
      let add = (a, b) => { a + b };
      type Shape = | Circle<Number> | Dot;
      let area = (shape) => { match(shape) { Circle(r) => { r }, Dot => { 0 } } };
    `,
    "/test/mid.wm": `export from "./base.wm" import *; let own = value + 1;`,
    "/test/main.wm": main,
    ...extra,
  }));

async function run(main: string, extra: Record<string, string> = {}): Promise<string> {
  const js = await compileVirtual("/test/main.wm", modules(main, extra));
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  await Deno.writeTextFile(path, js);
  const child = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--no-config", path],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  assertEquals(child.code, 0, decoder.decode(child.stderr));
  return decoder.decode(child.stdout).trim();
}

Deno.test("export from import * makes the opened module's values part of the public environment", async () => {
  const results = await checkVirtual(
    "/test/main.wm",
    modules(`from "./mid.wm" import * as Mid; let value = Mid.value + Mid.own;`),
  );
  const mid = results.get("/test/mid.wm")!;
  assertEquals(mid.exportedStructure.valEnv.has("value"), true);
  assertEquals(mid.exportedStructure.valEnv.has("own"), true);
});

Deno.test("values opened in another module work at runtime, by every import form", async () => {
  assertEquals(
    await run(`from "./mid.wm" import * as Mid; print(Mid.value + Mid.own);`),
    "15",
  );
  assertEquals(await run(`from "./mid.wm" import { value }; print(value);`), "7");
  assertEquals(await run(`from "./mid.wm" import *; print(value + own);`), "15");
});

Deno.test("a statically known function called through an open keeps working", async () => {
  // A literal tuple call targets the function's direct entry point, which must also be forwarded.
  assertEquals(
    await run(`from "./mid.wm" import *; print(add(2, 3));`),
    "5",
  );
  assertEquals(
    await run(`from "./mid.wm" import * as Mid; print(Mid.add(2, 3));`),
    "5",
  );
});

Deno.test("opening through a chain keeps type and constructor identity", async () => {
  const main = `
    from "./top.wm" import * as Top;
    from "./base.wm" import { area };
    let shape: Top.Shape = Top.Circle(4);
    let radius = match(shape) { Top.Circle(r) => { r }, Top.Dot => { 0 } };
    print(radius + area(shape));
  `;
  assertEquals(await run(main, { "/test/top.wm": `export from "./mid.wm" import *;` }), "8");
});

Deno.test("sequential declarations shadow across an open, right-biased as in SML", async () => {
  const later = { "/test/mid.wm": `export from "./base.wm" import *; let value = 100;` };
  assertEquals(await run(`from "./mid.wm" import { value }; print(value);`, later), "100");
  const earlier = { "/test/mid.wm": `let value = 100; export from "./base.wm" import *;` };
  assertEquals(await run(`from "./mid.wm" import { value }; print(value);`, earlier), "7");
  const named = {
    "/test/mid.wm": `export from "./base.wm" import *; let value = 100; let use = value;`,
  };
  assertEquals(await run(`from "./mid.wm" import * as Mid; print(Mid.use);`, named), "100");
});

Deno.test("plain imports stay private, whatever the clause", async () => {
  for (const clause of [`*`, `* as Base`, `{ value }`]) {
    const extra = { "/test/mid.wm": `from "./base.wm" import ${clause}; let own = 1;` };
    await assertRejects(() =>
      checkVirtual(
        "/test/main.wm",
        modules(`from "./mid.wm" import { value }; let v = value;`, extra),
      )
    );
    await assertRejects(() =>
      checkVirtual(
        "/test/main.wm",
        modules(`from "./mid.wm" import * as Mid; let v = Mid.Base.value;`, extra),
      )
    );
  }
});

Deno.test("export from a namespace import gives real nested access", async () => {
  const extra = { "/test/os.wm": `export from "./base.wm" import * as Process;` };
  assertEquals(
    await run(`from "./os.wm" import * as OS; print(OS.Process.value);`, extra),
    "7",
  );
  assertEquals(
    await run(`from "./os.wm" import * as OS; print(OS.Process.add(2, 3));`, extra),
    "5",
  );
  assertEquals(
    await run(
      `from "./os.wm" import * as OS;
       let shape: OS.Process.Shape = OS.Process.Circle(4);
       print(match(shape) { OS.Process.Circle(r) => { r }, OS.Process.Dot => { 0 } });`,
      extra,
    ),
    "4",
  );
  // A named import of the structure, and through a further level.
  assertEquals(
    await run(`from "./os.wm" import { Process }; print(Process.value);`, extra),
    "7",
  );
  assertEquals(
    await run(`from "./os.wm" import *; print(Process.value);`, extra),
    "7",
  );
  assertEquals(
    await run(
      `from "./sys.wm" import * as Sys; print(Sys.Process.value);`,
      { ...extra, "/test/sys.wm": `export from "./os.wm" import { Process };` },
    ),
    "7",
  );
  assertEquals(
    await run(
      `from "./sys.wm" import * as Sys; print(Sys.OS.Process.value);`,
      { ...extra, "/test/sys.wm": `export from "./os.wm" import * as OS;` },
    ),
    "7",
  );
});

Deno.test("export from a named import forwards one binding, renamed", async () => {
  const extra = {
    "/test/mid.wm": `export from "./base.wm" import { add as plus, Shape, Circle, value };`,
  };
  assertEquals(await run(`from "./mid.wm" import * as M; print(M.plus(2, 3));`, extra), "5");
  assertEquals(
    await run(
      `from "./mid.wm" import * as M;
       let shape: M.Shape = M.Circle(9);
       print(match(shape) { M.Circle(r) => { r }, _ => { 0 } });`,
      extra,
    ),
    "9",
  );
  // Only what was named.
  await assertRejects(() =>
    checkVirtual(
      "/test/main.wm",
      modules(`from "./mid.wm" import * as M; let a = M.area;`, extra),
    )
  );
});

Deno.test("the Basis OS module nests Process, as in SML", async () => {
  const main = (expression: string) =>
    `from "basis/os.wm" import * as OS;
     print(${expression});`;
  assertEquals(await run(main(`OS.Process.isSuccess(OS.Process.success)`)), "true");
  assertEquals(await run(main(`OS.Process.isSuccess(OS.Process.failure)`)), "false");
});

Deno.test("export is still an ordinary name elsewhere", async () => {
  assertEquals(await run(`let export = 3; print(export + 1);`), "4");
});
