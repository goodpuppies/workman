import { checkInstanceClosure, checkInstanceFile } from "../src/host.ts";

async function rejects(body: () => Promise<unknown>, fragment: string) {
  try {
    await body();
  } catch (error) {
    if (!String(error).includes(fragment)) throw error;
    return;
  }
  throw new Error(`expected failure containing ${fragment}`);
}

Deno.test("instance exports reject traversal and symlinks outside their tree", async () => {
  const root = await Deno.makeTempDir();
  try {
    const tree = `${root}/instance`;
    await Deno.mkdir(`${tree}/bin`, { recursive: true });
    await Deno.writeTextFile(`${tree}/bin/tool`, "tool");
    await Deno.writeTextFile(`${root}/outside`, "outside");
    await Deno.symlink("tool", `${tree}/bin/inside`);
    await Deno.symlink(`${root}/outside`, `${tree}/bin/escape`);
    await checkInstanceFile(tree, "bin/inside");
    await rejects(() => checkInstanceFile(tree, "../outside"), "invalid instance file");
    await rejects(() => checkInstanceFile(tree, "/outside"), "invalid instance file");
    await rejects(() => checkInstanceFile(tree, "bin/escape"), "escapes its package");
    await rejects(() => checkInstanceFile(tree, "bin"), "not a file");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("activation checks transitive exports and still accepts legacy manifests", async () => {
  const root = await Deno.makeTempDir();
  try {
    const app = `${root}/app`;
    const wm = `${root}/wm`;
    const deno = `${root}/deno`;
    for (const tree of [app, wm, deno]) await Deno.mkdir(tree);
    await Deno.writeTextFile(`${deno}/tool`, "runtime");
    await Deno.writeTextFile(`${wm}/tool`, "compiler");
    await Deno.writeTextFile(`${deno}.json`, JSON.stringify({ base: [], instances: [] }));
    await Deno.writeTextFile(
      `${wm}.json`,
      JSON.stringify({ base: [], instances: [deno], instanceUses: [{ tree: deno, path: "tool" }] }),
    );
    await Deno.writeTextFile(
      `${app}.json`,
      JSON.stringify({ base: [], instances: [wm], instanceUses: [{ tree: wm, path: "tool" }] }),
    );
    await Deno.symlink(`${deno}/tool`, `${wm}/runtime`);
    await checkInstanceFile(wm, "runtime");
    await checkInstanceClosure(app);
    await Deno.remove(`${deno}/tool`);
    await rejects(() => checkInstanceClosure(app), "No such file");
    await Deno.writeTextFile(`${app}.json`, JSON.stringify({ name: "legacy", files: [] }));
    await checkInstanceClosure(app);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
