import { assertEquals } from "@std/assert";
import { ProjectIndex } from "../src/lsp/project_index.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("[module update A612-A615] LSP project indexing enrolls only active forward closures", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const barrel = `${dir}/barrel.wm`;
  const shared = `${dir}/lib/shared.wm`;
  const libraryTest = `${dir}/lib/test.wm`;
  const testOnly = `${dir}/lib/test_only.wm`;
  const unrelated = `${dir}/unrelated.wm`;
  await Deno.mkdir(`${dir}/lib`);
  await Promise.all([
    Deno.writeTextFile(
      main,
      'from "./barrel.wm" import * as Barrel; from "./lib/shared.wm" import { value }; ' +
        "let main = () => { value };",
    ),
    Deno.writeTextFile(barrel, "let main = () => { 0 };"),
    Deno.writeTextFile(shared, "let value = 1;"),
    Deno.writeTextFile(
      libraryTest,
      'from "./shared.wm" import { value }; from "./test_only.wm" import { helper }; ' +
        "let main = () => { value + helper };",
    ),
    Deno.writeTextFile(testOnly, "let helper = 2;"),
    Deno.writeTextFile(
      unrelated,
      'from "./lib/shared.wm" import { value }; let referenceOnly = value;',
    ),
  ]);

  const index = new ProjectIndex();
  index.rememberWorkspaceRoots({
    workspaceFolders: [{ uri: pathToFileUri(dir) }],
  });
  assertEquals(await index.initialize(new Map()), 6);

  assertEquals(
    await index.affectedUrisForChange(pathToFileUri(main), new Map()),
    [pathToFileUri(main)],
  );
  // Although barrel declares main, the already-active application reaches it.
  assertEquals(
    await index.affectedUrisForChange(pathToFileUri(barrel), new Map()),
    [pathToFileUri(main)],
  );
  assertEquals(
    await index.affectedUrisForChange(pathToFileUri(shared), new Map()),
    [pathToFileUri(main)],
  );
  // This uncovered file activates the library's own closest test head.
  assertEquals(
    await index.affectedUrisForChange(pathToFileUri(testOnly), new Map()),
    [pathToFileUri(libraryTest)],
  );
  assertEquals(
    await index.affectedUrisForWatchedFiles([pathToFileUri(shared)], new Map()),
    [pathToFileUri(libraryTest), pathToFileUri(main)].sort(),
  );
  // A reverse importer that belongs to no active forward closure remains discovery-only.
  assertEquals(
    await index.affectedUrisForWatchedFiles([pathToFileUri(unrelated)], new Map()),
    [],
  );

  index.forgetOpenFile(pathToFileUri(main));
  assertEquals(index.fallbackUri(pathToFileUri(shared)), pathToFileUri(libraryTest));
});
