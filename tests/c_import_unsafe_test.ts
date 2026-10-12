import { assertRejects } from "@std/assert";
import { prepareCImports, resetCExtractions } from "../src/ffi/c/prepare.ts";
import { parseCompilerModule as parse } from "../src/compiler_frontend.ts";

// C calls can misbehave at the process level, so every C value import must be marked unsafe
// (markdown/c_ffi/surface-syntax.md). These declare their types, so no header is extracted.

Deno.test("C value imports without unsafe are rejected", async () => {
  for (
    const source of [
      `from c.lib("libc") import { printf: String -> Number };`,
      `from c.lib("libc") import * as Libc;`,
    ]
  ) {
    resetCExtractions();
    await assertRejects(
      async () => await prepareCImports(await parse(source)),
      Error,
      "C calls are process-unsafe; add unsafe",
    );
  }
});

Deno.test("unsafe C value imports are accepted", async () => {
  resetCExtractions();
  await prepareCImports(await parse(`from c.lib("libc") import unsafe { printf: String -> Number };`));
});
