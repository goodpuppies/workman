import { buildIdentity, download, runBuild, stageBuildInput } from "../src/host.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
async function rejects(body: () => Promise<unknown>, fragment: string) {
  try {
    await body();
  } catch (error) {
    assert(String(error).includes(fragment), String(error));
    return;
  }
  throw new Error(`expected failure containing ${fragment}`);
}

Deno.test("host builds deny child network, host writes and private reads", async () => {
  const root = await Deno.makeTempDir();
  try {
    for (const dir of ["inputs", "work", "out"]) await Deno.mkdir(`${root}/${dir}`);
    const program = `${root}/program.js`;
    await Deno.writeTextFile(
      program,
      `
      const script = "test ! -e ${root}/private && ! touch /usr/pakman-escape && test $(wc -l < /proc/net/route) -eq 1 && echo ok > /out/result";
      const child = await new Deno.Command('/usr/bin/sh', { args: ['-c', script] }).output();
      if (child.code) throw new Error(new TextDecoder().decode(child.stderr));
    `,
    );
    await Deno.writeTextFile(`${root}/private`, "host secret");
    await runBuild(program, "test", "1", "", `${root}/inputs`, `${root}/work`, `${root}/out`, [
      "/usr/bin/sh",
    ]);
    assert(await Deno.readTextFile(`${root}/out/result`) === "ok\n", "no staged output");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("identity includes imported JS, program code and declared tool contents", async () => {
  const root = await Deno.makeTempDir();
  try {
    const program = `${root}/program.js`, helper = `${root}/helper.js`, tool = `${root}/tool`;
    await Deno.writeTextFile(program, `await import('./helper.js');`);
    await Deno.writeTextFile(helper, "export const value = 1;");
    await Deno.writeTextFile(tool, "first tool");
    const first = await buildIdentity(program, [tool]);
    await Deno.writeTextFile(helper, "export const value = 2;");
    const second = await buildIdentity(program, [tool]);
    assert(first !== second, "helper changes reused identity");
    await Deno.writeTextFile(tool, "second tool");
    const third = await buildIdentity(program, [tool]);
    assert(second !== third, "tool changes reused identity");
    await Deno.writeTextFile(program, "console.log('changed');");
    assert(third !== await buildIdentity(program, [tool]), "program changes reused identity");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("local sources snapshot bytes and input names cannot escape staging", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/patch`, cached = `${root}/cached`;
    await Deno.writeTextFile(source, "first patch");
    await download(new URL(`file://${source}`).href, cached);
    await Deno.writeTextFile(source, "second patch");
    assert(await Deno.readTextFile(cached) === "first patch", "not a source snapshot");
    await rejects(() => stageBuildInput(source, root, "../escape"), "unsafe build input name");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("failed builds and unsupported output fail closed", async () => {
  const root = await Deno.makeTempDir();
  try {
    for (const dir of ["inputs", "work", "out"]) await Deno.mkdir(`${root}/${dir}`);
    const program = `${root}/program.js`;
    await Deno.writeTextFile(program, "Deno.exit(7);");
    await rejects(
      () => runBuild(program, "x", "1", "", `${root}/inputs`, `${root}/work`, `${root}/out`, []),
      "exited with 7",
    );
    await Deno.writeTextFile(
      program,
      "await Deno.writeTextFile('/out/file', 'x'); await Deno.chmod('/out/file', 0o4755);",
    );
    await rejects(
      () => runBuild(program, "x", "1", "", `${root}/inputs`, `${root}/work`, `${root}/out`, []),
      "unsupported file",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("compilation follows imported Workman helpers, including restored mtimes", async () => {
  const { compileProgram } = await import("../src/host.ts");
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/pak.wm`, helper = `${root}/helper.wm`, output = `${root}/pak.js`;
    await Deno.writeTextFile(
      source,
      'from "./helper.wm" import { greeting };\nlet main = () => { print(greeting) };\n',
    );
    await Deno.writeTextFile(helper, 'let greeting = "first-helper";\n');
    const time = (await Deno.stat(helper)).mtime!;
    await compileProgram(source, output);
    const first = await Deno.readTextFile(output);
    await Deno.writeTextFile(helper, 'let greeting = "second-helper";\n');
    await Deno.utime(helper, time, time);
    await compileProgram(source, output);
    const second = await Deno.readTextFile(output);
    assert(
      first !== second && second.includes("second-helper"),
      "import changes left stale compiled code",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
