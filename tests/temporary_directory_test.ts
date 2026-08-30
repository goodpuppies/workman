import { assert, assertEquals, assertRejects } from "@std/assert";
import { createTemporaryDirectory } from "../src/temporary_directory.ts";

Deno.test("temporary directory cleanup is bound to the path created by Deno", async () => {
  const protectedDirectory = await createTemporaryDirectory({ prefix: "wm-protected-" });
  const temporaryDirectory = await createTemporaryDirectory({ prefix: "wm-owned-" });
  const sentinel = `${protectedDirectory.path}/keep.txt`;
  try {
    await Deno.writeTextFile(sentinel, "still here");

    // JavaScript can ignore the TypeScript arity check, so verify that even a
    // mistakenly supplied path cannot redirect cleanup.
    await (temporaryDirectory.cleanup as unknown as (path: string) => Promise<void>)(
      protectedDirectory.path,
    );

    assertEquals(await Deno.readTextFile(sentinel), "still here");
    await assertRejects(() => Deno.stat(temporaryDirectory.path), Deno.errors.NotFound);
  } finally {
    await temporaryDirectory.cleanup();
    await protectedDirectory.cleanup();
  }
});

Deno.test("temporary directory cleanup is idempotent and preserves its parent", async () => {
  const parent = await createTemporaryDirectory({ prefix: "wm-temp-parent-" });
  try {
    const child = await createTemporaryDirectory({ dir: parent.path, prefix: "child-" });
    await child.cleanup();
    await child.cleanup();

    assert((await Deno.stat(parent.path)).isDirectory);
  } finally {
    await parent.cleanup();
  }
});
