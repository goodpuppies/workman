import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { CHeaderExtractError, extractCHeader } from "../src/ffi/c/extract.ts";

Deno.test("C header reflection explains a missing system Zig installation", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const error = await assertRejects(
      () =>
        extractCHeader({
          header: "stdio.h",
          symbols: [],
          zigPath: `${dir}/missing-zig`,
          cacheDir: dir,
        }),
      CHeaderExtractError,
      "was not found",
    );
    assertStringIncludes(error.message, "WM_ZIG_PATH");
    assertStringIncludes(error.message, "Zig 0.16.x");
    assertStringIncludes(error.message, "lib directory");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "C header reflection rejects incompatible Zig before running the extractor",
  ignore: Deno.build.os === "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      const zigPath = `${dir}/zig.ts`;
      await writeExecutable(
        zigPath,
        `
        if (Deno.args[0] !== "version") throw new Error("unexpected extraction");
        console.log("0.15.2");
      `,
      );
      await assertRejects(
        () => extractCHeader({ header: "stdio.h", symbols: [], zigPath, cacheDir: dir }),
        CHeaderExtractError,
        "unsupported Zig version",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "C header reflection probes Zig once and caches host-target extraction",
  ignore: Deno.build.os === "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      const zigPath = `${dir}/zig.ts`;
      const logPath = `${dir}/calls.jsonl`;
      const header = `${dir}/fixture.h`;
      await Deno.writeTextFile(header, "typedef int Answer;");
      await writeExecutable(
        zigPath,
        `
        await Deno.writeTextFile(${
          JSON.stringify(logPath)
        }, JSON.stringify(Deno.args) + "\\n", { append: true });
        console.log(Deno.args[0] === "version" ? "0.16.0" : '{"types":[],"fns":[],"values":[]}');
      `,
      );
      const options = { header, symbols: ["Answer"], zigPath, cacheDir: `${dir}/cache` };
      assertEquals(await extractCHeader(options), { types: [], fns: [], values: [] });
      await extractCHeader(options);
      const calls = (await Deno.readTextFile(logPath)).trim().split("\n").map((line) =>
        JSON.parse(line)
      );
      assertEquals(calls.length, 2);
      assertEquals(calls[0], ["version"]);
      assertEquals(calls[1].slice(0, 5), [
        "run",
        "-target",
        Deno.build.os === "linux" ? `${Deno.build.arch}-linux-gnu` : "native",
        "-lc",
        "-fstrip",
      ]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

async function writeExecutable(path: string, body: string): Promise<void> {
  await Deno.writeTextFile(
    path,
    `#!/usr/bin/env -S ${JSON.stringify(Deno.execPath())} run -A --no-config\n${body}`,
  );
  await Deno.chmod(path, 0o755);
}
