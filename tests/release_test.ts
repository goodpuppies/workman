import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "node:path";
import { stageRelease } from "../scripts/release.ts";
import config from "../deno.json" with { type: "json" };

Deno.test("release staging separates portable npm code from exact-version platform binaries", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-release-test-" });
  try {
    await Deno.mkdir(join(directory, "binaries/linux-x64"), { recursive: true });
    await Deno.writeTextFile(join(directory, "binaries/linux-x64/wm"), "test-binary");
    await stageRelease(directory, ["linux-x64"], false);
    const read = async (path: string) => JSON.parse(await Deno.readTextFile(join(directory, path)));
    const main = await read("npm/workman/package.json");
    const platform = await read("npm/workman-linux-x64/package.json");
    assertEquals(main.name, config.name);
    assertEquals(main.version, config.version);
    assertEquals(main.optionalDependencies[platform.name], config.version);
    assertEquals(platform.version, config.version);
    assertEquals(platform.os, ["linux"]);
    assertEquals(platform.cpu, ["x64"]);
    assertEquals(platform.libc, ["glibc"]);
    assertEquals(main.private, undefined);
    assertEquals(main.scripts, undefined, "installing the release must not execute a downloader");
    assertEquals(main.typescript.contentMapper.exec, ["node", "./bin/wm.cjs", "content-mapper"]);
    assertEquals(
      await Deno.readTextFile(join(directory, "npm/workman-linux-x64/bin/wm")),
      "test-binary",
    );
    const bridge = await Deno.readTextFile(
      join(directory, "npm/workman/src/integrations/compile.mjs"),
    );
    assert(bridge.includes("resolveBinary()"));
    assert(
      !bridge.includes("deno.json"),
      "release integration must not launch checkout TS sources",
    );
    const metadata = await read("release.json");
    assertEquals(metadata.artifacts.length, 1);
    assertEquals(metadata.artifacts[0].sha256.length, 64);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("release staging selects the Windows executable name and rejects unknown targets", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-release-test-" });
  try {
    await assertRejects(
      () => stageRelease(directory, ["unsupported-cpu"], false),
      Error,
      "Unsupported release target",
    );
    await Deno.mkdir(join(directory, "binaries/win32-arm64"), { recursive: true });
    await Deno.writeTextFile(join(directory, "binaries/win32-arm64/wm.exe"), "test-windows-binary");
    await stageRelease(directory, ["win32-arm64"], false);
    assertEquals(
      await Deno.readTextFile(join(directory, "npm/workman-win32-arm64/bin/wm.exe")),
      "test-windows-binary",
    );
    const manifest = JSON.parse(
      await Deno.readTextFile(join(directory, "npm/workman-win32-arm64/package.json")),
    );
    assertEquals(manifest.cpu, ["arm64"]);
    assertEquals(manifest.libc, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
