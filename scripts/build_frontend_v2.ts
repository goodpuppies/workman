import { compileLibraryFile } from "../src/compiler.ts";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL(
    "../tooling/frontend-v2/compiler_frontend.wm",
    import.meta.url,
  ),
);
const output = new URL("../src/generated/frontend_v2_parser.js", import.meta.url);

const current = await Deno.readTextFile(output).catch((error) => {
  if (error instanceof Deno.errors.NotFound) {
    throw new Error(
      "frontend-v2 stage-0 artifact is missing; restore src/generated/frontend_v2_parser.js",
    );
  }
  throw error;
});

// The tracked artifact is stage 0: use it to compile the next artifact, then replace it only
// when the self-hosted output changes.
const javaScript = await compileLibraryFile(source, {
  frontend: "v2",
  frontendV2ModuleUrl: output,
});
if (current !== javaScript) await Deno.writeTextFile(output, javaScript);
