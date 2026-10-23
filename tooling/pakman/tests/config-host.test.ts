import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("add-dir persists across CLI processes and resolves named private dependencies", async () => {
  const root = await Deno.makeTempDir();
  const old = Deno.env.get("PAKMAN_PKGS");
  try {
    await Deno.mkdir(`${root}/catalog with spaces`);
    const fixtures = fileURLToPath(new URL("./pkgs/", import.meta.url));
    for (const name of ["private-wm", "private-runtime"]) {
      await Deno.mkdir(`${root}/catalog with spaces/${name}`);
      const recipe = await Deno.readTextFile(`${fixtures}/${name}/pak.wm`);
      await Deno.writeTextFile(
        `${root}/catalog with spaces/${name}/pak.wm`,
        recipe.replaceAll("../../../src/", "pakman/"),
      );
    }
    const info = await new Deno.Command(Deno.execPath(), {
      args: ["info", "--json", "--no-config"],
    }).output();
    const denoDir = JSON.parse(new TextDecoder().decode(info.stdout)).denoDir;
    const env = {
      XDG_CONFIG_HOME: `${root}/config`,
      XDG_STATE_HOME: `${root}/state`,
      HOME: `${root}/home`,
      DENO_DIR: denoDir,
      PAKMAN_STATE: "",
      PAKMAN_BASE: "none",
      WORKMAN_DENO_PATH: Deno.execPath(),
    };
    Deno.env.delete("PAKMAN_PKGS");
    const cli = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));
    const run = async (args: string[]) => {
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", cli, "pakman", ...args],
        cwd: root,
        env,
      }).output();
      return {
        code: result.code,
        text: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
      };
    };
    const added = await run(["add-dir", "./catalog with spaces"]);
    assertEquals(added.code, 0, added.text);
    assertStringIncludes(added.text, "Package directory registered:");
    const config = JSON.parse(await Deno.readTextFile(`${root}/config/workman/config.json`));
    assertEquals(config.pakman.directories, [await Deno.realPath(`${root}/catalog with spaces`)]);
    assertEquals((await run(["add-dir", "./catalog with spaces"])).code, 0);
    const installed = await run(["install", "private-wm", "--root", `${root}/profile`]);
    assertEquals(installed.code, 0, installed.text);
    assertEquals((await Deno.stat(`${root}/state/workman/pakman/store`)).isDirectory, true);
    assertEquals((await Deno.stat(`${root}/profile/.local/bin/private-wm`)).isFile, true);
    const rejected = await run(["add-dir"]);
    assertEquals(rejected.code, 1);
    assertStringIncludes(rejected.text, "exactly one");
  } finally {
    if (old !== undefined) Deno.env.set("PAKMAN_PKGS", old);
    await Deno.remove(root, { recursive: true });
  }
});
