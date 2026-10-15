import { extract } from "../src/host.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
async function command(cmd: string, args: string[]) {
  const result = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  assert(result.code === 0, new TextDecoder().decode(result.stderr));
  return result.stdout;
}
const choices = [
  "data.tar",
  "data.tar.gz",
  "data.tar.xz",
  "data.tar.zst",
  "data.tar.bz2",
  "data.tar.lzma",
];
async function rejects(body: () => Promise<void>, fragment: string) {
  try {
    await body();
  } catch (error) {
    assert(String(error).includes(fragment), String(error));
    return;
  }
  throw new Error(`expected rejection: ${fragment}`);
}
async function fixture(body: (root: string) => Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "pakman-payload-test-" });
  try {
    await Deno.mkdir(`${root}/input/usr/share/example`, { recursive: true });
    await Deno.writeTextFile(`${root}/input/usr/share/example/greeting`, "payload\n");
    await command("bsdtar", ["-cf", `${root}/data.tar`, "-C", `${root}/input`, "usr"]);
    await Deno.writeTextFile(`${root}/debian-binary`, "2.0\n");
    await body(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("payload extraction detects uncompressed, gzip, xz and zstd Debian payloads", async () => {
  await fixture(async (root) => {
    for (
      const [suffix, compressor] of [["", ""], [".gz", "gzip"], [".xz", "xz"], [".zst", "zstd"]]
    ) {
      const payload = `${root}/data.tar${suffix}`;
      if (compressor) {
        await Deno.writeFile(payload, await command(compressor, ["-c", `${root}/data.tar`]));
      }
      const archive = `${root}/app${suffix}.deb`;
      await command("ar", ["qc", archive, `${root}/debian-binary`, payload]);
      const dest = `${root}/out${suffix}`;
      await extract([archive], [], dest, 0, choices);
      assert(await Deno.readTextFile(`${dest}/usr/share/example/greeting`) === "payload\n", suffix);
    }
  });
});

Deno.test("payload extraction rejects missing, multiple, duplicate and unsupported members", async () => {
  await fixture(async (root) => {
    for (
      const [name, members, count] of [
        ["missing", [], 0],
        ["multiple", ["data.tar", "data.tar.gz"], 2],
        ["duplicate", ["data.tar", "data.tar"], 2],
        ["unsupported", ["data.tar.unknown"], 0],
      ] as const
    ) {
      await Deno.copyFile(`${root}/data.tar`, `${root}/data.tar.gz`);
      await Deno.copyFile(`${root}/data.tar`, `${root}/data.tar.unknown`);
      const archive = `${root}/${name}.deb`;
      await command("ar", [
        "qc",
        archive,
        `${root}/debian-binary`,
        ...members.map((m) => `${root}/${m}`),
      ]);
      await rejects(
        () => extract([archive], [], `${root}/out-${name}`, 0, choices),
        `found ${count}`,
      );
    }
  });
});

Deno.test("general payload selection composes with nested archives and custom member names", async () => {
  await fixture(async (root) => {
    await Deno.copyFile(`${root}/data.tar`, `${root}/custom.bundle`);
    await command("bsdtar", ["-cf", `${root}/inner.tar`, "-C", root, "custom.bundle"]);
    await command("bsdtar", ["-cf", `${root}/outer.tar`, "-C", root, "inner.tar"]);
    await extract([`${root}/outer.tar`, "inner.tar"], [], `${root}/out`, 0, ["custom.bundle"]);
    assert(
      await Deno.readTextFile(`${root}/out/usr/share/example/greeting`) === "payload\n",
      "missing nested output",
    );
  });
});
