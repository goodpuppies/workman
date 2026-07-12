import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  checkFile,
  checkSource,
  checkVirtual,
  compile,
  compileFile,
  compileFileArtifacts,
} from "../src/compiler.ts";
import { runFile } from "../src/run.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("supports typed JS namespace imports", async () => {
  const result = await checkSource(`
    from js.global("console") import unsafe { log: (String, Number) => Void } as console;
    let main = () => {
      console.log("answer", 42)
    };
  `);

  expectBinding(result.env, "main", { type: "(Void) => Void", vars: 0 });
});

Deno.test("manual non-unsafe imports are fallible", async () => {
  const result = await checkSource(`
    from js.global("JSON") import {
      parse: (String) => Js.Object,
      stringify: (Js.Value) => Result<String, Js.Error>,
    } as JSON;
    from js.global("Deno") import { args: Js.Array<String> };
    let parsed = JSON.parse("{}");
    let text = JSON.stringify(JSON{ ok: true });
  `);

  expectBinding(result.env, "parsed", { type: "Result<Js.Object, Js.Error>", vars: 0 });
  expectBinding(result.env, "text", { type: "Result<String, Js.Error>", vars: 0 });
  expectBinding(result.env, "args", { type: "Result<Js.Array<String>, Js.Error>", vars: 0 });
});

Deno.test("Js.Error is a matchable basis datatype", async () => {
  const result = await checkSource(`
    let describe = (error: Js.Error) => {
      match(error) {
        Js.Error(message) => { message },
        Js.Unknown => { "unknown" },
      }
    };
  `);

  expectBinding(result.env, "describe", { type: "(Js.Error) => String", vars: 0 });
  assertEquals(result.warnings, []);
});

Deno.test("rejects generic handwritten JS FFI signatures", async () => {
  await assertRejects(
    () =>
      checkSource(`
        from js.global import unsafe {
          id: (T) => T
        };
      `),
    Error,
    "FFI signatures must be explicit",
  );
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

Deno.test("resolves local JS module imports relative to source file", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `export function shout(text: string): string { return text.toUpperCase(); }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import { shout };
      let loud = shout("hello");
    `,
  );

  await checkFile(input);
  const js = await compileFile(input);

  assertStringIncludes(js, `await import("file:///`);
  assertStringIncludes(js, `/helper.ts")`);
});

Deno.test("runs a Workman dependency with a JS module import", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/helper.ts`,
    `export function shout(text: string): string { return text.toUpperCase(); }\n`,
  );
  await Deno.writeTextFile(
    `${dir}/foreign_runtime.wm`,
    `
      from js.module("./helper.ts") import { shout };
      let fileName = (path: String) => { shout(path) };
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from "./foreign_runtime.wm" import { fileName };
      from js.global("console") import unsafe { log: (String) => Void } as console;
      let main = () => {
        match(fileName("one/two.txt")) {
          Ok(name) => { console.log(name) },
          Err(_) => { console.log("err") },
        }
      };
    `,
  );

  const js = await compileFile(input);
  assertStringIncludes(js, "await (async () => {");

  const result = await runFile(input, { stdout: "piped", stderr: "piped" });
  assertEquals(result.code, 0);
  assertEquals(new TextDecoder().decode(result.stdout), "ONE/TWO.TXT\n");
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("reflects JSR module imports", async () => {
  const result = await checkSource(`
    from js.module("jsr:@std/path@^1.0.9") import { basename };
    let file = basename("/tmp/x.txt");
  `);
  const js = await compile(`
    from js.module("jsr:@std/path@^1.0.9") import { basename };
    let file = basename("/tmp/x.txt");
  `);

  expectBinding(result.env, "file", { type: "Result<String, Js.Error>", vars: 0 });
  assertStringIncludes(js, `await import("jsr:@std/path@^1.0.9")`);
});

Deno.test("reflects bare npm modules through node_modules declarations", async () => {
  const result = await checkSource(`
    from js.module("typescript") import { createSourceFile };
    let file = createSourceFile("example.ts", "", 99);
  `);

  expectBinding(result.env, "file", { type: "Result<SourceFile, Js.Error>", vars: 0 });
});

Deno.test("reflects Deno import-map aliases for JSR modules", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/deno.json`,
    JSON.stringify({ imports: { "std-path": "jsr:@std/path@^1.0.9" } }),
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("std-path") import { basename };
      let file = basename("/tmp/x.txt");
    `,
  );

  const results = await checkFile(input);
  const result = results.get(input);
  if (!result) throw new Error("missing main result");
  expectBinding(result.env, "file", { type: "Result<String, Js.Error>", vars: 0 });
});

Deno.test("resolves import-map aliases during delayed reflection independent of process cwd", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/deno.json`,
    JSON.stringify({ imports: { "sf-local": "./service.ts" } }),
  );
  await Deno.writeTextFile(
    `${dir}/service.ts`,
    `
      export class Service {
        async create(file: string): Promise<{ file: string }> {
          return { file };
        }
      }
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("sf-local") import { Service };
      let app = match(Service.new()) {
        Ok(service) => {
          service.create("worker.mjs")
        },
        Err(error) => {
          Task.fail(error)
        },
      };
    `,
  );

  const previous = Deno.cwd();
  try {
    Deno.chdir("/");
    const results = await checkFile(input);
    const result = results.get(input);
    if (!result) throw new Error("missing main result");
    expectBinding(result.env, "app", { type: "Task<Js.Object, Js.Error>", vars: 0 });
  } finally {
    Deno.chdir(previous);
  }
});

Deno.test("emits Workman worker targets as sibling artifacts", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(`${dir}/worker.wm`, `let main = () => { void };\n`);
  await Deno.writeTextFile(
    input,
    `
      from js.worker("./worker.wm") import { url } as AppWorker;
      let workerUrl = AppWorker.url;
    `,
  );

  const artifacts = await compileFileArtifacts(input);
  const entry = artifacts.find((artifact) => artifact.kind === "entry");
  const worker = artifacts.find((artifact) => artifact.kind === "worker");

  assertEquals(artifacts.map((artifact) => artifact.path).sort(), [
    "main.mjs",
    "worker.worker.mjs",
  ]);
  if (!entry || !worker) throw new Error("missing worker artifacts");
  assertStringIncludes(entry.code, `new URL("./worker.worker.mjs", import.meta.url).href`);
  assertStringIncludes(worker.code, `await main_`);
});

Deno.test("runs generated Workman workers", async () => {
  const dir = await Deno.makeTempDir();
  const marker = `${dir}/ready.txt`;
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/worker_harness.ts`,
    `
      export async function startAndWait(url: string, path: string): Promise<string> {
        const worker = new Worker(url, { type: "module" });
        for (let index = 0; index < 100; index++) {
          try {
            const text = await Deno.readTextFile(path);
            worker.terminate();
            return text;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        worker.terminate();
        return await Deno.readTextFile(path);
      }
    `,
  );
  await Deno.writeTextFile(
    `${dir}/worker.wm`,
    `
      from js.global("Deno") import unsafe { writeTextFileSync: (String, String) => Void };
      let main = () => {
        writeTextFileSync(${JSON.stringify(marker)}, "ready")
      };
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.worker("./worker.wm") import { url } as AppWorker;
      from js.module("./worker_harness.ts") import { startAndWait };
      let main = () => {
        startAndWait(AppWorker.url, ${JSON.stringify(marker)})
      };
    `,
  );

  const result = await runFile(input, { stdout: "piped", stderr: "piped" });

  assertEquals(result.code, 0);
  assertEquals(new TextDecoder().decode(result.stderr), "");
  assertEquals(await Deno.readTextFile(marker), "ready");
});

Deno.test("reflects local JS module namespace imports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `export function shout(text: string): string { return text.toUpperCase(); }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import * as Helper;
      let loud = Helper.shout("hello");
    `,
  );

  await checkFile(input);
});

Deno.test("reflects constructor-valued JS module exports through new member", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/thing.ts`;
  await Deno.writeTextFile(
    helper,
    `export class Thing { constructor(readonly name: string) {} }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./thing.ts") import { Thing };
      let thing = Thing.new("ok");
    `,
  );

  const results = await checkFile(input);
  const result = [...results.values()][0];
  if (!result) throw new Error("missing main result");
  expectBinding(result.env, "thing", { type: "Result<Thing, Js.Error>", vars: 0 });
});

Deno.test("module constructor results retain nominal identity across Workman modules", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/thing.ts`,
    `export class Thing { constructor(readonly name: string) {} }\n`,
  );
  await Deno.writeTextFile(
    `${dir}/renderer.wm`,
    `
      from js.module("./thing.ts") import type { Thing };
      let accept = (thing: Thing) => { thing };
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./thing.ts") import { Thing };
      from "./renderer.wm" import { accept };
      let thing = Thing.new("ok") :> Result.map(accept);
    `,
  );

  const results = await checkFile(input);
  const result = results.get(await Deno.realPath(input));
  if (!result) throw new Error("missing main result");
  expectBinding(result.env, "thing", { type: "Result<Thing, Js.Error>", vars: 0 });
});

Deno.test("a TypeScript bridge handles foreign class inheritance explicitly", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/three.ts`,
    `
      export class Material {}
      export class MeshStandardMaterial extends Material {}
      export class Mesh { constructor(readonly material: Material) {} }
    `,
  );
  await Deno.writeTextFile(
    `${dir}/three_bridge.ts`,
    `
      import { Mesh, MeshStandardMaterial } from "./three.ts";
      export function buildStandardMesh(material: MeshStandardMaterial): Mesh {
        return new Mesh(material);
      }
    `,
  );
  await Deno.writeTextFile(
    `${dir}/renderer.wm`,
    `
      from js.module("./three.ts") import type { MeshStandardMaterial };
      from js.module("./three_bridge.ts") import { buildStandardMesh };
      let build = (material: MeshStandardMaterial) => { buildStandardMesh(material) };
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./three.ts") import { MeshStandardMaterial };
      from "./renderer.wm" import { build };
      let mesh = MeshStandardMaterial.new() :> Result.andThen(build);
    `,
  );

  const results = await checkFile(input);
  const result = results.get(await Deno.realPath(input));
  if (!result) throw new Error("missing main result");
  expectBinding(result.env, "mesh", { type: "Result<Mesh, Js.Error>", vars: 0 });
});

Deno.test("reflects static methods on constructor-valued JS module exports", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/thing.ts`;
  await Deno.writeTextFile(
    helper,
    `export class Thing { static greet(name: string): string { return \`hi \${name}\`; } }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./thing.ts") import { Thing };
      let msg = Thing.greet("Ada");
    `,
  );

  const results = await checkFile(input);
  const result = [...results.values()][0];
  if (!result) throw new Error("missing main result");
  expectBinding(result.env, "Thing", { type: "Js.Object", vars: 0 });
  expectBinding(result.env, "msg", { type: "Result<String, Js.Error>", vars: 0 });
});

Deno.test("emits imported class values with static members intact", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/thing.ts`;
  await Deno.writeTextFile(
    helper,
    `export class Thing { static greet(name: string): string { return \`hi \${name}\`; } }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./thing.ts") import { Thing };
      from js.global("console") import unsafe { log: (String) => Void } as console;

      let main = () => {
        match(Thing.greet("Ada")) {
          Ok(message) => { console.log(message) },
          Err(_) => { console.log("err") },
        }
      };
    `,
  );

  const result = await runFile(input, { stdout: "piped", stderr: "piped" });

  assertEquals(result.code, 0);
  assertEquals(new TextDecoder().decode(result.stdout), "hi Ada\n");
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("reflects nested local JS module namespace receiver calls", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `export const H = { shout(text: string): string { return text.toUpperCase(); } };\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import * as Helper;
      let loud = Helper.H.shout("hello");
    `,
  );

  await checkFile(input);
});

Deno.test("reflects JS namespace functions as values", async () => {
  const result = await checkSource(`
    from js.global("Math") import * as Math;
    let liftR = Monad.lift Result;
    let sin = liftR Math.sin;
    let wave = Ok(1) :> sin;
  `);

  expectBinding(result.env, "sin", {
    type: "(Result<Number, Js.Error>) => Result<Number, Js.Error>",
    vars: 0,
  });
  expectBinding(result.env, "wave", {
    type: "Result<Number, Js.Error>",
    vars: 0,
  });
});

Deno.test("delayed JS binding calls preserve their Result carrier in operators", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    `${dir}/helper.ts`,
    `export function getTime(): number { return 1; }\n`,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import * as Helper;
      let time = Helper.getTime();
      let scaled = time * 2;
    `,
  );

  const results = await checkFile(input);
  const result = [...results.values()][0];
  if (!result) throw new Error("missing main result");
  expectBinding(result.env, "time", { type: "Result<Number, Js.Error>", vars: 0 });
  expectBinding(result.env, "scaled", { type: "Result<Number, Js.Error>", vars: 0 });
});

Deno.test("orders generated receiver imports after local record types", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  const helper = `${dir}/helper.ts`;
  await Deno.writeTextFile(
    helper,
    `
      export type Color = { r: number };
      export const H = { make(): Color { return { r: 1 }; } };
    `,
  );
  await Deno.writeTextFile(
    input,
    `
      from js.module("./helper.ts") import * as Helper;
      let title = "colors";
      record Color = { r: Number };
      let made = Helper.H.make();
    `,
  );

  await checkFile(input);
});

Deno.test("supports inferred callable root JS globals", async () => {
  const result = await checkSource(`
    from js.global import { fetch };
    let response = fetch("https://example.test");
  `);
  const js = await compile(`
    from js.global import { fetch };
    let response = fetch("https://example.test");
  `);

  expectBinding(result.env, "response", {
    type: "Task<Response, Js.Error>",
    vars: 0,
  });
  assertStringIncludes(js, '__wm_js_member("fetch")');
});

Deno.test("supports Task as a basis type", async () => {
  const result = await checkSource(`
    let task: Task<String, Js.Error> = Panic("task");
  `);

  expectBinding(result.env, "task", { type: "Task<String, Js.Error>", vars: 0 });
});

Deno.test("maps reflected TS promises to Task", async () => {
  const result = await checkSource(`
    from js.global("Deno") import { readTextFile };
    let file = readTextFile("README.md");
  `);

  expectBinding(result.env, "file", {
    type: "Task<String, Js.Error>",
    vars: 0,
  });
});

Deno.test("preserves reflected nominal promise results", async () => {
  const result = await checkSource(`
    from js.global("crypto.subtle") import unsafe { sign };
    let signature = sign("HMAC", Panic("key"), Panic("bytes"));
  `);

  expectBinding(result.env, "signature", { type: "Task<ArrayBuffer, Js.Error>", vars: 0 });
});

Deno.test("uses nominal promise results with reflected constructors", async () => {
  const result = await checkSource(`
    from js.global("crypto.subtle") import unsafe { sign };
    from js.global import unsafe { Uint8Array };
    from js.global import type { Uint8Array };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let bytes = sign("HMAC", Panic("key"), Panic("bytes")) :> Task.map((buffer) => {
      Uint8Array.new(buffer)
    });
  `);

  expectBinding(result.env, "bytes", { type: "Task<Uint8Array, Js.Error>", vars: 0 });
});

Deno.test("typed JS promise receiver results infer through then", async () => {
  const result = await checkSource(`
    from js.global("Deno") import { readTextFile };
    let readBang = () => {
      readTextFile("README.md") :> Task.map((text) => {
        text ++ "!"
      })
    };
  `);

  expectBinding(result.env, "readBang", { type: "(Void) => Task<String, Js.Error>", vars: 0 });
});

Deno.test("maps function-valued JS union parameters as JS values", async () => {
  const result = await checkSource(`
    from js.global import unsafe { setTimeout };
    let timer = setTimeout(() => { void }, 10);
  `);

  expectBinding(result.env, "timer", { type: "Number", vars: 0 });
});

Deno.test("maps object-bearing JS union parameters as JS values", async () => {
  const result = await checkSource(`
    from js.global("crypto.subtle") import unsafe { importKey };
    let key = importKey(
      "raw",
      JSON{ key: "secret" },
      JSON{ name: "HMAC", hash: "SHA-256" },
      false,
      JSON["sign"],
    );
  `);

  expectBinding(result.env, "key", { type: "Task<CryptoKey, Js.Error>", vars: 0 });
});

Deno.test("typed task receivers work through explicit foreign receiver types", async () => {
  const result = await checkSource(`
    from js.global import type { Request };
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let useText = (req) => {
      let textTask = req :> .text();
      textTask :> Task.map((bodyText) => { bodyText })
    };
    let checked = ((handler: (Request) => Task<String, Js.Error>, req: Request) => {
      handler(req)
    })(useText, Panic("req"));
  `);

  expectBinding(result.env, "useText", { type: "(Request) => Task<String, Js.Error>", vars: 0 });
});
