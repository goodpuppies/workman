import { assertEquals, assertRejects } from "@std/assert";
import { runBuildCommand } from "../src/host.ts";

Deno.test("generic command builds use recipe arguments, permit downloads and install only declared output", async () => {
  const root = await Deno.makeTempDir();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    () => new Response("downloaded"),
  );
  try {
    const tree = `${root}/tool`, dependency = `${root}/runtime`;
    for (const dir of [tree, dependency, `${root}/source/app`, `${root}/work`, `${root}/out`]) {
      await Deno.mkdir(dir, { recursive: true });
    }
    await Deno.writeTextFile(`${root}/secret`, "private host data");
    await Deno.writeTextFile(`${dependency}/marker`, "private tool runtime");
    await Deno.writeTextFile(`${dependency}.json`, JSON.stringify({ instances: [], base: [] }));
    await Deno.writeTextFile(`${tree}.json`, JSON.stringify({ instances: [dependency], base: [] }));
    await Deno.writeTextFile(`${root}/source/app/input.txt`, "source input");
    const archived = await new Deno.Command("bsdtar", {
      args: ["-cf", `${root}/source.tar`, "-C", root, "source"],
    }).output();
    assertEquals(archived.code, 0);
    const program = `${tree}/builder`;
    await Deno.writeTextFile(
      program,
      `#!/bin/sh
set -eu
test "$1" = render
test "$2" = app/input.txt
test "$3" = 'argument with spaces'
test "$4" = result.txt
test ! -e '${root}/secret'
test -f '${dependency}/marker'
test -f "$2"
test "$HOME" = /work
test -z "\${DENO_DIR-}"
! touch /usr/pakman-command-escape 2>/dev/null
curl -fsS http://127.0.0.1:${server.addr.port} > "$4"
echo 'undeclared output' > /work/extra
`,
    );
    await Deno.chmod(program, 0o755);
    const args = ["render", "app/input.txt", "argument with spaces", "result.txt"];
    const run = (output = "result.txt", trees = [tree], dest = "share/result.txt") =>
      runBuildCommand(
        program,
        trees,
        args,
        `${root}/source.tar`,
        1,
        output,
        `${root}/out`,
        dest,
        0o644,
        `${root}/work`,
      );
    await run();
    assertEquals(await Deno.readTextFile(`${root}/out/share/result.txt`), "downloaded");
    assertEquals((await Deno.stat(`${root}/out/share/result.txt`)).mode! & 0o777, 0o644);
    assertEquals(Array.from(Deno.readDirSync(`${root}/out`), (item) => item.name), ["share"]);
    assertEquals(Array.from(Deno.readDirSync(`${root}/work`)), []);
    await assertRejects(() => run("../secret"), Error, "invalid command build path");
    await assertRejects(
      () => run("result.txt", [], "bin/escape"),
      Error,
      "private package instance",
    );
    await Deno.writeTextFile(program, "#!/bin/sh\nln -s /usr/bin/sh result.txt\n");
    await assertRejects(() => run(), Error, "regular output");
    await Deno.writeTextFile(program, "#!/bin/sh\nln -s /usr/bin foreign\n");
    await assertRejects(() => run("foreign/bash"), Error, "output escapes");
    await Deno.writeTextFile(program, "#!/bin/sh\necho partial > result.txt\nexit 7\n");
    await assertRejects(() => run("result.txt", [tree], "bin/failed"));
    assertEquals(Array.from(Deno.readDirSync(`${root}/work`)), []);
    assertEquals(Array.from(Deno.readDirSync(`${root}/out`), (item) => item.name), ["share"]);
  } finally {
    await server.shutdown();
    await Deno.remove(root, { recursive: true });
  }
});
