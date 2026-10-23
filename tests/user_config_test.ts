import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { addPackageDirectory, packageDirectories } from "../src/user_config.ts";

Deno.test("registered directories persist canonically without losing unrelated WM settings", async () => {
  const root = await Deno.makeTempDir();
  const old = Deno.env.get("PAKMAN_PKGS");
  Deno.env.delete("PAKMAN_PKGS");
  try {
    const dir = `${root}/catalog`, config = `${root}/configuration/config.json`;
    await Deno.mkdir(dir);
    await Deno.mkdir(`${root}/configuration`);
    await Deno.writeTextFile(
      config,
      JSON.stringify({ compiler: { setting: true }, pakman: { extra: 42 } }),
    );
    assertEquals(await addPackageDirectory(`${dir}/.`, config), await Deno.realPath(dir));
    await addPackageDirectory(dir, config);
    assertEquals(packageDirectories("/fallback", config), [await Deno.realPath(dir), "/fallback"]);
    assertEquals(JSON.parse(await Deno.readTextFile(config)), {
      compiler: { setting: true },
      pakman: { extra: 42, directories: [await Deno.realPath(dir)] },
    });
    Deno.env.set("PAKMAN_PKGS", "/override:/other:/override");
    assertEquals(packageDirectories("/fallback", config), ["/override", "/other"]);
    assertEquals((await Array.fromAsync(Deno.readDir(`${root}/configuration`))).length, 1);
  } finally {
    if (old === undefined) Deno.env.delete("PAKMAN_PKGS");
    else Deno.env.set("PAKMAN_PKGS", old);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("invalid registrations and malformed config leave existing settings intact", async () => {
  const root = await Deno.makeTempDir();
  const old = Deno.env.get("PAKMAN_PKGS");
  Deno.env.delete("PAKMAN_PKGS");
  try {
    const config = `${root}/config.json`;
    await Deno.writeTextFile(config, "{broken json");
    await assertRejects(
      () => addPackageDirectory(root, config),
      Error,
      "cannot read WM configuration",
    );
    assertEquals(await Deno.readTextFile(config), "{broken json");
    assertThrows(
      () => packageDirectories("/fallback", config),
      Error,
      "cannot read WM configuration",
    );
    await Deno.writeTextFile(config, '{"pakman":{"directories":["relative"]}}');
    await assertRejects(() => addPackageDirectory(root, config), Error, "absolute paths");
    await Deno.remove(config);
    await assertRejects(() => addPackageDirectory(`${root}/missing`, config));
    await Deno.writeTextFile(`${root}/file`, "not a directory");
    await assertRejects(
      () => addPackageDirectory(`${root}/file`, config),
      Error,
      "not a directory",
    );
  } finally {
    if (old === undefined) Deno.env.delete("PAKMAN_PKGS");
    else Deno.env.set("PAKMAN_PKGS", old);
    await Deno.remove(root, { recursive: true });
  }
});
