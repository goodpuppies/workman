import { assertEquals } from "@std/assert";

// In a child process: environment variables are shared by every test file running in parallel, and
// other files read these to find the user cache.
Deno.test("WM uses XDG config, cache and state roots with an explicit pakman override", async () => {
  if (Deno.build.os === "windows") return;
  const check = `
    import { assertEquals } from "@std/assert";
    import { join } from "node:path";
    import {
      pakmanStateDirectory,
      workmanCache,
      workmanConfigFile,
      workmanState,
    } from ${JSON.stringify(new URL("../src/user_paths.ts", import.meta.url).href)};
    const root = "/wm-test-root";
    Deno.env.set("XDG_CONFIG_HOME", join(root, "config"));
    Deno.env.set("XDG_CACHE_HOME", join(root, "cache"));
    Deno.env.set("XDG_STATE_HOME", join(root, "state"));
    Deno.env.delete("PAKMAN_STATE");
    assertEquals(workmanConfigFile(), join(root, "config/workman/config.json"));
    assertEquals(workmanCache(), join(root, "cache/workman"));
    assertEquals(workmanState(), join(root, "state/workman"));
    assertEquals(pakmanStateDirectory(), join(root, "state/workman/pakman"));
    Deno.env.set("PAKMAN_STATE", join(root, "explicit"));
    assertEquals(pakmanStateDirectory(), join(root, "explicit"));
  `;
  const child = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", new URL("../deno.json", import.meta.url).pathname, check],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(new TextDecoder().decode(child.stderr), "");
  assertEquals(child.code, 0);
});
