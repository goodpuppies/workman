import { assertEquals } from "@std/assert";
import { parseCompilerModule } from "../src/compiler_frontend.ts";

const frontendV2ModuleUrl = new URL("../src/generated/frontend_v2_parser.js", import.meta.url);

async function declarationCount(source: string) {
  const module = await parseCompilerModule(source, { frontend: "v2", frontendV2ModuleUrl });
  return module.decls.length;
}

for (
  const [source, declarations] of [
    ["-- c", 0],
    ["// c", 0],
    ["--", 0],
    ["-- c\n", 0],
    ["/* c */", 0],
    ["", 0],
    ["let a = 1; -- c", 1],
    ["let a = 1;\n-- c", 1],
    ["let a = 1;\n// c", 1],
    ["let a = 1;\n-- c\n", 1],
    ["let a = 1; -- first\n-- second", 1],
    ["let f = () => { 1 -- c", 1],
  ] as const
) {
  Deno.test(`a comment can end a file without a newline: ${JSON.stringify(source)}`, async () => {
    assertEquals(await declarationCount(source), declarations);
  });
}
