import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("WM CLI resolves Node declarations without a package adapter or local node_modules", async () => {
  const root = await Deno.makeTempDir();
  try {
    const input = `${root}/main.wm`;
    await Deno.writeTextFile(
      input,
      `
      from js.module("node:buffer") import { Buffer };
      let main = () => {
        match(Buffer.from("ok")) {
          Err(_) => { print("failed") },
          Ok(buffer) => {
            let typed: Buffer = buffer;
            print(typed :> .toString("base64") :> Result.withDefault("failed"))
          }
        }
      };
    `,
    );
    const output = `${root}/main.mjs`;
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--no-lock",
        "--node-modules-dir=none",
        "--config",
        fileURLToPath(new URL("../deno.json", import.meta.url)),
        fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
        "compile",
        input,
        output,
      ],
      cwd: root,
      env: { WORKMAN_DENO_PATH: Deno.execPath() },
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const ran = await new Deno.Command(Deno.execPath(), { args: ["run", "--no-config", output] })
      .output();
    assertEquals(ran.code, 0, new TextDecoder().decode(ran.stderr));
    assertEquals(new TextDecoder().decode(ran.stdout), "b2s=\n");
    assertEquals((await Array.fromAsync(Deno.readDir(root), (item) => item.name)).sort(), [
      "main.mjs",
      "main.wm",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("wm pakman writes its generated launcher to the user cache", async () => {
  const root = await Deno.makeTempDir();
  try {
    // Changing XDG_CACHE_HOME also changes Deno's default cache. Keep its
    // existing dependency cache while isolating WM's generated launcher.
    const info = await new Deno.Command(Deno.execPath(), {
      args: ["info", "--json", "--no-config"],
    }).output();
    assertEquals(info.code, 0);
    const { denoDir } = JSON.parse(new TextDecoder().decode(info.stdout));
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--no-lock",
        "--node-modules-dir=none",
        "--config",
        fileURLToPath(new URL("../deno.json", import.meta.url)),
        fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
        "pakman",
      ],
      cwd: root,
      env: {
        XDG_CACHE_HOME: root,
        LOCALAPPDATA: root,
        DENO_DIR: denoDir,
        WORKMAN_DENO_PATH: Deno.execPath(),
      },
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const entries = await Array.fromAsync(Deno.readDir(`${root}/workman`));
    assertEquals(entries.length, 1);
    const launcher = `${root}/workman/${entries[0].name}/pakman.js`;
    assertEquals((await Deno.stat(launcher)).isFile, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
