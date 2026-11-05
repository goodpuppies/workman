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
  await succeeds(`let main ==> { void };`);
});

Deno.test("only the outermost Err fails main", () =>
  succeeds(`let main = () => { Task.succeed(Err("inner")) };`));

Deno.test("a user constructor named Err isn't a failure", () =>
  succeeds(`
    type Mine = | Oops<Number>;
    let main = () => { Oops(1) };
  `));

Deno.test("a whole number returned from main is the exit code", async () => {
  for (const [source, code] of [["3", 3], ["0", 0], ["2.5", 0]] as const) {
    const result = await run(`let main = () => { ${source} };`);
    assertEquals(result.code, code, result.stderr);
    assertEquals(result.stderr, "");
  }
});

Deno.test("an I32 from main is the exit code, and a Task's Ok(n) is a success", async () => {
  const typed = await run(`let main = () => { let code: I32 = 4; code };`);
  assertEquals(typed.code, 4, typed.stderr);
  const task = await run(`let main = () => { Task.succeed(3) };`);
  assertEquals(task.code, 0, task.stderr);
});

Deno.test("main's exit code works in a program that uses the Number module", async () => {
  const result = await run(`let main = () => { Number.div(7, 2) };`);
  assertEquals(result.code, 3, result.stderr);
  assertEquals(result.stderr, "");
});
