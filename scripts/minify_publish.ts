// Minifies generated JavaScript in place before `deno publish`, to keep the JSR package under its
// 20 MiB limit. The publish workflow runs it after checking that src/generated matches the commit,
// so the repository keeps the readable files that tests pin.
//
// src/generated/subsetml.js is left alone: its runtime error reporting maps JavaScript line and
// column ranges (`__wm_call_sites`) and function names (`__wm_stack_overflow_sites`) back to the
// SubsetML sources, and minification would move and rename both. The files below have neither.
import * as esbuild from "esbuild";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
  "src/generated/frontend_v2_parser.js",
  ...await javaScriptFiles(join(root, "src/generated/wm")),
];

let before = 0;
let after = 0;
for (const file of files) {
  const path = join(root, file);
  const source = await Deno.readTextFile(path);
  // esnext keeps class syntax, which the WM runtime tests with Function.prototype.toString.
  const result = await esbuild.transform(source, {
    loader: "js",
    format: "esm",
    target: "esnext",
    minify: true,
    legalComments: "inline",
  });
  await Deno.writeTextFile(path, result.code);
  before += source.length;
  after += result.code.length;
}
await esbuild.stop();
console.log(
  `minified ${files.length} generated files: ${(before / 1e6).toFixed(2)} MB -> ${
    (after / 1e6).toFixed(2)
  } MB`,
);

async function javaScriptFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) found.push(...await javaScriptFiles(path));
    else if (entry.name.endsWith(".js")) found.push(relative(root, path));
  }
  return found.sort();
}
