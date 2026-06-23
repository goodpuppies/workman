import { assertEquals, assertStringIncludes } from "@std/assert";

const installer = new URL("../scripts/install.ts", import.meta.url).pathname;

Deno.test("installer creates a cwd-independent wm launcher", async () => {
  const binDir = await Deno.makeTempDir();
  const cwd = await Deno.makeTempDir();
  const home = await Deno.makeTempDir();

  const install = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-env", installer, "--bin-dir", binDir],
    env: { HOME: home },
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(install.code, 0);
  assertEquals(new TextDecoder().decode(install.stderr), "");

  const result = await runInstalledWm(binDir, cwd, ["--help"]);

  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "wm-mini - Workman subset compiler and runner");

  if (Deno.build.os !== "windows") {
    const bashrc = await Deno.readTextFile(`${home}/.bashrc`);
    const zshrc = await Deno.readTextFile(`${home}/.zshrc`);
    const fishConfig = await Deno.readTextFile(`${home}/.config/fish/conf.d/wm-mini.fish`);
    assertStringIncludes(bashrc, `export PATH='${binDir}':"$PATH"`);
    assertStringIncludes(zshrc, `export PATH='${binDir}':"$PATH"`);
    assertStringIncludes(fishConfig, `fish_add_path --global '${binDir}'`);
  }
});

Deno.test("installer shell PATH configuration is idempotent", async () => {
  if (Deno.build.os === "windows") return;

  const binDir = await Deno.makeTempDir();
  const home = await Deno.makeTempDir();
  await Deno.writeTextFile(`${home}/.bashrc`, "# existing bash setup\n");

  for (let run = 0; run < 2; run++) {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", "--allow-write", "--allow-env", installer, "--bin-dir", binDir],
      env: { HOME: home },
      stdout: "null",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0);
  }

  const bashrc = await Deno.readTextFile(`${home}/.bashrc`);
  assertEquals(bashrc.match(/# >>> wm-mini installer >>>/g)?.length, 1);
  assertStringIncludes(bashrc, "# existing bash setup");
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
