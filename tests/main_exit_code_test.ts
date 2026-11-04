import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function run(source: string) {
  const dir = await Deno.makeTempDir({ prefix: "wm-main-exit-" });
  try {
    await Deno.writeTextFile(`${dir}/m.wm`, source);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", main, "run", "m.wm"],
      cwd: dir,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    return { code: output.code, stdout: decode(output.stdout), stderr: decode(output.stderr) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function failsWith(source: string, shown: string) {
  const result = await run(source);
  assertEquals(result.code, 1, result.stderr);
  assertStringIncludes(result.stderr, `error[runtime.main-failed]: main failed with ${shown}`);
}

async function succeeds(source: string, stdout = "") {
  const result = await run(source);
  assertEquals(result, { code: 0, stdout, stderr: "" });
}

Deno.test("a failed main Task reports its error and exits 1", () =>
  failsWith(
    `let main = () => { Task.fail("boom") :> Task.map((x) => { print(x) }) };`,
    `"boom"`,
  ));

Deno.test("a main Result Err reports its error and exits 1", () =>
  failsWith(`let main = () => { Err(42) };`, "42"));

Deno.test("a failed main reports a user error type", () =>
  failsWith(
    `
      type AppError = | NotFound<String>;
      let main = () => { Task.fail(NotFound("x.bin")) };
    `,
    `NotFound("x.bin")`,
  ));

Deno.test("a real IO failure as main exits 1", async () => {
  const result = await run(`
    from js.host("bytes") import * as Bytes;
    let main = () => { Bytes.readFile("missing.bin") };
  `);
  assertEquals(result.code, 1, result.stderr);
  assertStringIncludes(result.stderr, "error[runtime.main-failed]");
});

Deno.test("a successful main stays silent and exits 0", async () => {
  await succeeds(`let main = () => { Task.succeed(void) };`);
  await succeeds(`let main = () => { Ok(1) };`);
  await succeeds(`let main = () => { print("hi") };`, "hi\n");
  await succeeds(`let main = () => { 7 };`);
  await succeeds(`let main ==> { void };`);
});

Deno.test("only the outermost Err fails main", () =>
  succeeds(`let main = () => { Task.succeed(Err("inner")) };`));

Deno.test("a user constructor named Err isn't a failure", () =>
  succeeds(`
    type Mine = | Oops<Number>;
    let main = () => { Oops(1) };
  `));
