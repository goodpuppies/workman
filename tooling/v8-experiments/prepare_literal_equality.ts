// Scratch-only control: specialize equality when either operand is a primitive literal.
import ts from "typescript-api";
import { resolve } from "node:path";
const destination = resolve(Deno.args[0]);
const scratch = await Deno.realPath("_scratch");
if (!destination.startsWith(scratch + "/")) throw new Error("destination must be under _scratch");
const text = await Deno.readTextFile(Deno.args[1] ?? "src/generated/frontend_v2_parser.js");
const source = ts.createSourceFile(
  "parser.js",
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const edits: { start: number; end: number; text: string }[] = [];
function scalar(expr: ts.Expression): boolean {
  return ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand));
}
function visit(node: ts.Node): void {
  if (
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
    node.expression.text === "__wm_eq" && node.arguments.length === 2 && node.arguments.some(scalar)
  ) {
    edits.push({
      start: node.getStart(source),
      end: node.end,
      text: `(${node.arguments[0].getText(source)} === ${node.arguments[1].getText(source)})`,
    });
    return;
  }
  ts.forEachChild(node, visit);
}
visit(source);
let result = text;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
}
await Deno.writeTextFile(destination, result);
console.log(`specialized ${edits.length} literal equality sites`);
