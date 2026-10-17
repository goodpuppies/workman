// Differential checks for diagnostics/recovery/formatting as well as valid ASTs.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const before = await import(pathToFileURL(resolve(Deno.args[0])).href);
const after = await import(pathToFileURL(resolve(Deno.args[1])).href);
const sources = [
  "let identity = (x) => { x }; let answer = identity(42);",
  "type Option<T> = None | Some<T>; let value = Some(42);",
  "let rec factorial = (n) => { if (n == 0) { 1 } else { factorial(n - 1) * n } };",
  "record Point = { x: Number, y: Number }; let add = (x) => (y) => { x + y };",
  'let value = "hello"; // comment\nlet pair = (1, true);',
  "let answer = ;",
  "let main = (x => { x };",
  "let value = JSON { key: 1; };",
  "",
];
let checked = 0;
for (const source of sources) {
  for (
    const name of [
      "parseSurfaceProgram",
      "parseSurfaceFailure",
      "formatSurfaceSource",
      "formatSurfaceSourceFix",
    ]
  ) {
    const oldValue = JSON.stringify(before[name](source));
    const newValue = JSON.stringify(after[name](source));
    if (oldValue !== newValue) throw new Error(`${name} differs on ${JSON.stringify(source)}`);
    checked++;
  }
}
console.log(`matched ${checked} complete AST/diagnostic/format results`);
