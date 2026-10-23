import { assertEquals } from "@std/assert";
import { join } from "node:path";
import {
  pakmanStateDirectory,
  workmanCache,
  workmanConfigFile,
  workmanState,
} from "../src/user_paths.ts";

Deno.test("WM uses XDG config, cache and state roots with an explicit pakman override", async () => {
  if (Deno.build.os === "windows") return;
  const root = await Deno.makeTempDir();
  const vars = ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "PAKMAN_STATE"];
  const saved = vars.map((name) => Deno.env.get(name));
  try {
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
  } finally {
    vars.forEach((name, i) =>
      saved[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, saved[i]!)
    );
    await Deno.remove(root, { recursive: true });
  }
});
