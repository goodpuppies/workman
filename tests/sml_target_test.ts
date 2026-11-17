import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function wm(args: string[], cwd: string) {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
}

async function hasMlton(): Promise<boolean> {
  try {
    return (await new Deno.Command("mlton", { args: ["-version"], stdout: "null", stderr: "null" }).output())
      .success;
  } catch {
    return false;
  }
}

const program = `record P = { x: Int32.Int, s: String };
let failed: Result<Int32.Int, String> = Err("e");
let _ = print(\`n=\${-7 % 3} r=\${-7.5 % 2.0} same=\${0.1 + 0.2 != 0.3} \${[1, 2]}\`);
let _ = print(1, "a", true, failed, .{ x = -1, s = "q" }, [Some(0.1 + 0.2), None]);
`;

Deno.test("wm sml writes a relocatable MLton project that prints as wm run does", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-sml-test-" });
  try {
    await Deno.writeTextFile(join(directory, "app.wm"), program);
    const translated = await wm(["sml", "app.wm", "out"], directory);
    assertEquals(translated.code, 0, translated.stderr);
    const project = await Deno.readTextFile(join(directory, "out", "project.mlb"));
    assert(!project.includes(directory), "project.mlb names files inside the output directory relatively");
    assertStringIncludes(project, '"subset_host_native.sml"');
    if (!await hasMlton()) return;

    // The directory builds after it moves.
    await Deno.rename(join(directory, "out"), join(directory, "moved"));
    const built = await new Deno.Command("mlton", {
      args: ["-output", "app", "project.mlb"],
      cwd: join(directory, "moved"),
      stderr: "piped",
    }).output();
    assert(built.success, new TextDecoder().decode(built.stderr));
    const native = await new Deno.Command(join(directory, "moved", "app"), { stdout: "piped" }).output();
    const run = await wm(["run", "app.wm"], directory);
    assertEquals(new TextDecoder().decode(native.stdout), run.stdout);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("wm sml translates a program that never prints, and rejects JavaScript imports", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-sml-test-" });
  try {
    await Deno.writeTextFile(join(directory, "quiet.wm"), "let answer = 6 * 7;\n");
    const quiet = await wm(["sml", "quiet.wm", "quiet"], directory);
    assertEquals(quiet.code, 0, quiet.stderr);

    await Deno.writeTextFile(
      join(directory, "js.wm"),
      'from js.global("console") import * as console;\nlet _ = print("x");\n',
    );
    const js = await wm(["sml", "js.wm", "js"], directory);
    assertEquals(js.code, 1);
    assertStringIncludes(js.stderr, "JavaScript imports");

    const usage = await wm(["sml", "quiet.wm"], directory);
    assertEquals(usage.code, 2);
    assertStringIncludes(usage.stderr, "usage: wm sml");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
