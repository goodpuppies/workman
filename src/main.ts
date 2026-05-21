import { compileFile } from "./compiler.ts";

if (import.meta.main) {
  const [input, output] = Deno.args;
  if (!input) {
    console.error("usage: deno task compile <input.wm> [output.js]");
    Deno.exit(2);
  }
  const js = await compileFile(input);
  if (output) await Deno.writeTextFile(output, js);
  else console.log(js);
}
