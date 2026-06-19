import { assertEquals, assertStringIncludes } from "@std/assert";

const installer = new URL("../scripts/install.ts", import.meta.url).pathname;

Deno.test("installer creates a cwd-independent wm launcher", async () => {
  const binDir = await Deno.makeTempDir();
  const cwd = await Deno.makeTempDir();

  const install = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-env", installer, "--bin-dir", binDir],
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(install.code, 0);
  assertEquals(new TextDecoder().decode(install.stderr), "");

  const result = await runInstalledWm(binDir, cwd, ["--help"]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "wm-mini - Workman subset compiler and runner");
});

async function runInstalledWm(binDir: string, cwd: string, args: string[]) {
  const command = Deno.build.os === "windows" ? "cmd" : "sh";
  const shellArgs = Deno.build.os === "windows"
    ? ["/d", "/c", ["wm", ...args].join(" ")]
    : ["-c", ["wm", ...args.map(shellQuote)].join(" ")];
  const path = `${binDir}${Deno.build.os === "windows" ? ";" : ":"}${Deno.env.get("PATH") ?? ""}`;

  const result = await new Deno.Command(command, {
    args: shellArgs,
    cwd,
    env: { PATH: path },
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
