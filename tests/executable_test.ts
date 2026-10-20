import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { compileArguments, compileExecutable } from "../src/executable.ts";
import { compileFileArtifacts } from "../src/compiler.ts";

Deno.test("compile options preserve JS output and require explicit executable output", () => {
  assertEquals(compileArguments(["main.wm", "out.js"]), {
    input: "main.wm",
    output: "out.js",
    executable: false,
  });
  assertEquals(compileArguments(["--executable", "main.wm", "-o", "app"]), {
    input: "main.wm",
    output: "app",
    executable: true,
  });
  assertThrows(() => compileArguments(["main.wm", "--executable"]));
  assertThrows(() => compileArguments(["main.wm", "--typo"]));
  assertThrows(() => compileArguments(["main.wm", "-o"]));
  assertThrows(() => compileArguments(["main.wm", "out.js", "extra"]));
});

Deno.test("executable retains generated workers and JS imports after source removal", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/source`;
    await Deno.mkdir(source);
    // Use a JS harness so this exercises worker packaging rather than UI code.
    await Deno.writeTextFile(
      `${source}/harness.ts`,
      `
      export async function start(url: string): Promise<string> {
        const worker = new Worker(url, { type: "module" });
        try {
          return await new Promise<string>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = (event) => reject(new Error(event.message));
          });
        } finally { worker.terminate(); }
      }
      export function args(): string { return Deno.args.join("|"); }
    `,
    );
    // postMessage is a callable global; import it through a tiny typed helper.
    await Deno.writeTextFile(
      `${source}/worker.wm`,
      `
      from js.module("./post.ts") import { send };
      let main = () => { send("worker alive") };
    `,
    );
    await Deno.writeTextFile(
      `${source}/post.ts`,
      `export function send(text: string): void { postMessage(text); }`,
    );
    await Deno.writeTextFile(
      `${source}/main.wm`,
      `
      from js.worker("./worker.wm") import { url } as Background;
      from js.module("./harness.ts") import { start, args };
      let main = () => {
        start(Background.url) :> Task.map((text) => { print(text); print(args() :> Result.withDefault("")) })
      };
    `,
    );
    const artifacts = await compileFileArtifacts(`${source}/main.wm`);
    assertEquals(await compileExecutable(artifacts, `${root}/app`), 0);
    await Deno.remove(source, { recursive: true });
    const result = await new Deno.Command(`${root}/app`, { args: ["one", "two words"] }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout), "worker alive\none|two words\n");
    assertEquals(Array.from(Deno.readDirSync(root), (entry) => entry.name), ["app"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("failed executable compilation preserves previous output and removes staging", async () => {
  const root = await Deno.makeTempDir();
  try {
    const output = `${root}/app`;
    await Deno.writeTextFile(output, "previous executable");
    const code = await compileExecutable([
      { kind: "entry", path: "main.mjs", code: 'import "./missing.mjs";' },
    ], output);
    assertEquals(code === 0, false);
    assertEquals(await Deno.readTextFile(output), "previous executable");
    assertEquals(Array.from(Deno.readDirSync(root), (entry) => entry.name), ["app"]);
    await assertRejects(() => compileExecutable([], output), Error, "no entrypoint");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
