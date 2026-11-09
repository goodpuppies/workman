import { assertEquals, assertStringIncludes } from "@std/assert";
import { runFile } from "../src/run.ts";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

Deno.test("wm test preserves the invoking project's Deno import map for its temporary entry", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wm-testman-project-" });
  const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const config = fileURLToPath(new URL("../deno.json", import.meta.url));
  const test = relative(dir, fileURLToPath(new URL("../tooling/testman/test.wm", import.meta.url)))
    .replaceAll("\\", "/");
  try {
    await Deno.writeTextFile(
      `${dir}/deno.json`,
      JSON.stringify({ imports: { "test-host": "./host.ts" } }),
    );
    await Deno.writeTextFile(
      `${dir}/host.ts`,
      'export function label(): string { return "project config"; }',
    );
    await Deno.writeTextFile(
      `${dir}/config.test.wm`,
      `
      from ${JSON.stringify(test)} import * as T;
      from js.module("test-host") import unsafe { label };
      let tests = [T.test("uses project import map", () => { T.assertEqual(label(), "project config") })];
    `,
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--config", config, cli, "test", "config.test.wm"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(20000),
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertStringIncludes(new TextDecoder().decode(result.stdout), "1 passed | 0 failed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("testman exits after successful suites even with a library's live timer", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wm-testman-exit-" });
  const path = `${dir}/main.wm`;
  const runner = relative(
    dir,
    fileURLToPath(new URL("../tooling/testman/runner.wm", import.meta.url)),
  ).replaceAll(
    "\\",
    "/",
  );
  const test = relative(dir, fileURLToPath(new URL("../tooling/testman/test.wm", import.meta.url)))
    .replaceAll(
      "\\",
      "/",
    );
  try {
    await Deno.writeTextFile(
      path,
      `
      from ${JSON.stringify(runner)} import * as Runner;
      from ${JSON.stringify(test)} import * as T;
      from js.global import unsafe { setInterval };
      let main = () => {
        Runner.runSuites([Runner.suite("live-handle.test.wm", [T.test("finishes", () => {
          setInterval((_) => { void }, 1000);
          T.pass()
        })])])
      };
    `,
    );
    const result = await runFile(path, {
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(15000),
    });
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertStringIncludes(new TextDecoder().decode(result.stdout), "1 passed | 0 failed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
