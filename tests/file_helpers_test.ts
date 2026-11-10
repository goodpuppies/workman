import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchVerified, unpackFile } from "../tooling/pakman/api/js/files.ts";
import { sha256File } from "../tooling/pakman/src/host.ts";
import { readProjectCommands } from "../src/project_commands.ts";

Deno.test("file fetch verifies bytes, reuses an offline destination, and leaves it intact on failure", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = join(root, "source");
    const dest = join(root, "downloads", "two words");
    await Deno.writeTextFile(source, "pinned bytes");
    const url = pathToFileURL(source).href;
    const hash = await sha256File(source);
    assertEquals(await fetchVerified(url, hash, dest), dest);
    await Deno.remove(source);
    assertEquals(await fetchVerified(url, hash, dest), dest);
    await Deno.writeTextFile(source, "different bytes");
    await assertRejects(() => fetchVerified(url, "0".repeat(64), dest), Error, "SHA-256 mismatch");
    assertEquals(await Deno.readTextFile(dest), "pinned bytes");
    assertEquals([...Deno.readDirSync(join(root, "downloads"))].map((entry) => entry.name), [
      "two words",
    ]);
    await Deno.writeTextFile(dest, "corrupted");
    await Deno.writeTextFile(source, "pinned bytes");
    await fetchVerified(url, hash, dest);
    assertEquals(await Deno.readTextFile(dest), "pinned bytes");
    await assertRejects(() => fetchVerified(url, "bad", dest), Error, "SHA-256");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("unpack reports invalid extraction options through its error callback", async () => {
  const result = await unpackFile(
    "unused.tar",
    "unused-output",
    -1,
    () => "unexpected success",
    (error) => error,
  );
  assertStringIncludes(result, "strip must be a nonnegative integer");
});

Deno.test("WM setup prepares ordinary project files, repeats offline, and fails on a bad hash", async () => {
  const root = await Deno.makeTempDir();
  try {
    const payload = join(root, "payload");
    await Deno.mkdir(payload);
    await Deno.writeTextFile(join(payload, "hello.txt"), "plain project file");
    await Deno.symlink("hello.txt", join(payload, "alias.txt"));
    const archive = join(root, "release.tar.gz");
    const packed = await new Deno.Command("bsdtar", {
      args: ["-czf", archive, "-C", root, "payload"],
    }).output();
    assertEquals(packed.code, 0);
    const hash = await sha256File(archive);
    const recipe = (sha256: string) => `
      from "pakman/files.wm" import {fetch,unpack};
      from "pakman/project.wm" import {command,Wm};
      let main=()=>{
        fetch(.{url=${
      JSON.stringify(pathToFileURL(archive).href)
    },sha256="${sha256}"},"downloads/archive.tar.gz")
          :> Task.andThen((archive)=>{unpack(archive,"vendor",1)})
          :> Task.recover((error)=>{Panic(error)})
      };
      let commands=[command("setup",[Wm(["run","pak.wm"])])];
    `;
    const pak = join(root, "pak.wm");
    await Deno.writeTextFile(pak, recipe(hash));
    await readProjectCommands(pak);
    await assertRejects(() => Deno.stat(join(root, "downloads")), Deno.errors.NotFound);
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const config = fileURLToPath(new URL("../deno.json", import.meta.url));
    const run = async () =>
      await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--config", config, cli, "run", "setup"],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(30000),
      }).output();
    const first = await run();
    assertEquals(first.code, 0, new TextDecoder().decode(first.stderr));
    assertEquals(await Deno.readTextFile(join(root, "vendor", "alias.txt")), "plain project file");
    await Deno.remove(archive);
    const second = await run();
    assertEquals(second.code, 0, new TextDecoder().decode(second.stderr));
    assertEquals(await Deno.readTextFile(join(root, "vendor", "hello.txt")), "plain project file");
    await Deno.writeTextFile(archive, "wrong bytes");
    await Deno.writeTextFile(pak, recipe("0".repeat(64)));
    const failed = await run();
    assertEquals(failed.success, false);
    assertStringIncludes(new TextDecoder().decode(failed.stderr), "SHA-256 mismatch");
    assertEquals(await Deno.readTextFile(join(root, "vendor", "hello.txt")), "plain project file");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
